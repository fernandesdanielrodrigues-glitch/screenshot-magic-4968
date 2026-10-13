# S2 — Notificações Pessoais + Lembretes Server-Side — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Notificações pessoais (destinatário + lida, RLS híbrido), aviso de escalação atômico no RPC da S1, lembretes server-side via Edge Function + crontab do VPS, entrega plugável (webhook/simulação) e remoção do cálculo de lembretes do cliente.

**Architecture:** Migration de schema (`notifications.user_id`/`read_at` + RLS híbrido + `reminder_log` idempotente) + `publish_schedule_atomic` v3 (insere pessoais para perfis vinculados) + Edge Function Deno `send-reminders` (autenticada por `CRON_SECRET`, service_role, webhook plugável) acionada por crontab do VPS + cliente exibindo estado server-side.

**Tech Stack:** Postgres/RLS (self-hosted v0.8.2), plpgsql, Deno + supabase-js (Edge Runtime), Docker Compose, React 19/TanStack.

**Spec:** `docs/superpowers/specs/2026-10-13-s2-notifications-reminders-design.md`

## Global Constraints

- Nunca editar migration aplicada: schema e RPC entram em **novas** migrations (`20261013110000`, `20261013110100`).
- RLS híbrido: SELECT `user_id = auth.uid() OR (user_id IS NULL AND is_staff(auth.uid()))`; membro **deixa de ver** atividade alheia (motivos de troca).
- Entrega **plugável**: webhook único server-side `NOTIFY_WEBHOOK_URL`; sem valor → `status='simulated'`; NENHUM segredo de provedor no código.
- Idempotência de lembrete: `UNIQUE (schedule_id, window, channel)` em `reminder_log` é a ÚNICA fonte anti-duplicação; log inserido com `ignoreDuplicates` ANTES da entrega.
- Notificações pessoais só para perfis **vinculados** (`profiles.user_id IS NOT NULL`); RPC/edge inserem via service_role (bypassa RLS — correto).
- `auth.uid()` nesta stack lê `request.jwt.claim.sub` (singular) — testes locais de RLS usam esse setting.
- Copy pt-BR exata nas mensagens (definida nas tasks); nada de "lovable" em texto/código.
- Commit local; `git push` só quando o usuário mandar (credenciais hoje OK — confirmar antes de push).
- Função edge versionada em `supabase/functions/send-reminders/` no repo; deploy = copiar para `deploy/supabase/functions/` (runbook).

## Review Focus

Condições que os testes das tasks precisam cobrir (cada linha tem teste na tarefa dona):

1. **Membro não vê atividade alheia** (RLS): com claims de membro, SELECT em `notifications` retorna só as próprias; staff vê próprias + globais. → Task 6.
2. **Pessoais só para vinculados**: perfil seed (sem `user_id`) NÃO gera notificação pessoal; perfil vinculado gera. → Task 6.
3. **Idempotência do lembrete**: 2 execuções seguidas da função na mesma janela → `reminder_log` não duplica e webhook não é chamado 2×. → Task 6.
4. **Simulação vs webhook**: sem `NOTIFY_WEBHOOK_URL` → `status='simulated'` e nenhum POST; com webhook (mock local) → POST recebido e `status='sent'`. → Task 6.
5. **Auth do cron**: sem/errado Bearer → 401. → Task 6.
6. **RPC v3**: toast/count de linhas inalterado; pessoais atômicas (falha depois do insert reverte tudo — mesma transação). → Task 6.

---

### Task 1: Branch + migration de schema

**Files:**
- Create: `supabase/migrations/20261013110000_s2_notifications_schema.sql`
- Git: branch `s2-notifications` a partir de `main`

**Interfaces:**
- Produces: `notifications.user_id`, `notifications.read_at`, novas policies de `notifications`, tabela `reminder_log` (com RLS) — consumidos pelas Tasks 2 (RPC), 3 (edge) e 5 (cliente).

- [ ] **Step 1:** criar branch `s2-notifications` a partir de `main`.

- [ ] **Step 2: escrever a migration** com o corpo exato:

```sql
-- S2: notificações pessoais (destinatário + lida) e log idempotente de lembretes

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS read_at timestamptz;

DROP POLICY IF EXISTS "read notifications" ON public.notifications;
DROP POLICY IF EXISTS "insert notifications" ON public.notifications;
CREATE POLICY "read notifications hybrid" ON public.notifications FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR (user_id IS NULL AND public.is_staff(auth.uid())));
CREATE POLICY "insert notifications" ON public.notifications FOR INSERT TO authenticated
  WITH CHECK (user_id IS NULL OR user_id = auth.uid());
CREATE POLICY "update own notifications" ON public.notifications FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TABLE public.reminder_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES public.schedules(id) ON DELETE CASCADE,
  window text NOT NULL CHECK (window IN ('24h','2h')),
  channel text NOT NULL CHECK (channel IN ('whatsapp','email')),
  status text NOT NULL CHECK (status IN ('sent','simulated','failed','skipped')),
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (schedule_id, window, channel)
);
ALTER TABLE public.reminder_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read reminder_log" ON public.reminder_log FOR SELECT TO authenticated USING (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reminder_log TO service_role;
GRANT SELECT ON public.reminder_log TO authenticated;
```

- [ ] **Step 3: Verificação estática** — policies antigas dropadas antes das novas; UPDATE com USING+CHECK próprios; UNIQUE tripla; grants: service_role completo, authenticated só SELECT.

- [ ] **Step 4: Commit** — `git add supabase/migrations/20261013110000_s2_notifications_schema.sql` + `feat(db): personal notifications schema and reminder_log (S2)`.

### Task 2: RPC v3 — notificação pessoal atômica

**Files:**
- Create: `supabase/migrations/20261013110100_s2_publish_personal_notifications.sql`

**Interfaces:**
- Consumes: função `publish_schedule_atomic` (estado pós-fix 20261013090000 — temp table), tabela `notifications` (Task 1), `profiles.user_id`, `events.title/date_time`.
- Produces: RPC v3 — assinatura/retorno inalterados; efeito novo: pessoais kind `assignment` para perfis vinculados.

- [ ] **Step 1: escrever a migration** — `CREATE OR REPLACE FUNCTION public.publish_schedule_atomic(...)` idêntica ao estado atual (temp table `_old_schedules`, mesmas travas e validações) **acrescentando, após o INSERT das escalas e antes do `RETURN v_count`**:

```sql
  -- Notificações pessoais (apenas perfis vinculados a auth.users)
  INSERT INTO public.notifications (user_id, message, kind)
  SELECT
    p.user_id,
    'Você foi escalado para ' || coalesce(nullif(trim(x->>'role_label'), ''), x->>'sector')
      || ' no evento ' || e.title || ' em ' || to_char(e.date_time, 'DD/MM/YYYY HH24:MI') || '.',
    'assignment'
  FROM jsonb_array_elements(p_schedules) x
  JOIN public.profiles p ON p.id = (x->>'profile_id')::uuid
  JOIN public.events e ON e.id = p_event_id
  WHERE p.user_id IS NOT NULL;
```

- [ ] **Step 2: Verificação estática** — corpo idêntico ao fix `20261013090000` (comparar bloco a bloco), exceto o bloco novo; mensagem/`to_char` exatos; sem mudança de assinatura/retorno.

- [ ] **Step 3: Commit** — `feat(db): assignment notifications inside publish RPC (S2)`.

### Task 3: Edge Function `send-reminders`

**Files:**
- Create: `supabase/functions/send-reminders/index.ts`

**Interfaces:**
- Consumes (env do serviço `edge-runtime`): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (oficiais da stack), `CRON_SECRET`, `NOTIFY_WEBHOOK_URL` (opcionais nossos, Task 4).
- Produces: endpoint POST `/functions/v1/send-reminders` → `{ processed, sent, simulated, failed }`; efeitos: `reminder_log`, `notifications` (kind `reminder`), `schedules.notified_at`.

- [ ] **Step 1: escrever a função** (Deno, corpo completo abaixo é o contrato — ajustes mínimos de tipagem permitidos):

```ts
// S2 — Lembretes server-side (24h/2h). Cron do VPS: Bearer CRON_SECRET.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const WEBHOOK = Deno.env.get("NOTIFY_WEBHOOK_URL") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function authOk(req: Request): boolean {
  const m = /^Bearer (.+)$/.exec(req.headers.get("authorization") ?? "");
  return !!m && timingSafeEqual(m[1], CRON_SECRET);
}

Deno.serve(async (req) => {
  if (req.method !== "POST" || !authOk(req)) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  }
  const db = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const now = new Date();
  const in24h = new Date(now.getTime() + 24 * 3600e3).toISOString();
  const in2h = new Date(now.getTime() + 2 * 3600e3).toISOString();
  const windows: Array<{ key: "24h" | "2h"; until: string }> = [
    { key: "24h", until: in24h },
    { key: "2h", until: in2h },
  ];
  let processed = 0, sent = 0, simulated = 0, failed = 0;

  for (const w of windows) {
    const { data: rows, error } = await db
      .from("schedules")
      .select("id, role_label, status, notified_at, events!inner(id, title, date_time), profiles!inner(id, user_id, phone, email, name)")
      .in("status", ["pending", "confirmed"])
      .gt("events.date_time", now.toISOString())
      .lte("events.date_time", w.until);
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

    for (const row of rows ?? []) {
      const ev = row.events as { title: string; date_time: string };
      const prof = row.profiles as { user_id: string | null; phone: string | null; email: string | null; name: string };
      const channels: Array<{ channel: "whatsapp" | "email"; to: string }> = [];
      if (prof.phone) channels.push({ channel: "whatsapp", to: prof.phone });
      if (prof.email) channels.push({ channel: "email", to: prof.email });
      if (channels.length === 0) {
        await db.from("reminder_log").upsert(
          { schedule_id: row.id, window: w.key, channel: "email", status: "skipped", error: "sem contato" },
          { onConflict: "schedule_id,window,channel", ignoreDuplicates: true },
        );
        continue;
      }
      for (const ch of channels) {
        const { data: logged, error: logErr } = await db
          .from("reminder_log")
          .upsert(
            { schedule_id: row.id, window: w.key, channel: ch.channel, status: "sent" },
            { onConflict: "schedule_id,window,channel", ignoreDuplicates: true },
          )
          .select("id");
        if (logErr || !logged || logged.length === 0) continue; // já disparado — idempotência
        const message =
          `Olá ${prof.name.split(" ")[0]}! Lembrete (${w.key === "24h" ? "24 horas" : "2 horas"}): você está escalado para ` +
          `${row.role_label} no evento ${ev.title} em ` +
          `${new Date(ev.date_time).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}.`;
        let status = "simulated";
        let errText: string | null = null;
        if (WEBHOOK) {
          try {
            const res = await fetch(WEBHOOK, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ channel: ch.channel, to: ch.to, message, scheduleId: row.id, window: w.key }),
            });
            status = res.ok ? "sent" : "failed";
            if (!res.ok) errText = `HTTP ${res.status}`;
          } catch (e) {
            status = "failed";
            errText = e instanceof Error ? e.message : String(e);
          }
        }
        if (status === "sent") sent++;
        else if (status === "failed") { failed++; await db.from("reminder_log").update({ status, error: errText }).eq("id", logged[0].id); }
        else simulated++;
      }
      if (prof.user_id) {
        await db.from("notifications").insert({
          user_id: prof.user_id,
          message: `Lembrete: ${row.role_label} no evento ${ev.title} (veja horário no app).`,
          kind: "reminder",
        });
      }
      await db.from("schedules").update({ notified_at: new Date().toISOString() }).eq("id", row.id);
      processed++;
    }
  }
  return new Response(JSON.stringify({ processed, sent, simulated, failed }), {
    headers: { "Content-Type": "application/json" },
  });
});
```

- [ ] **Step 2: Verificação estática** — auth antes de qualquer query; `ignoreDuplicates` na inserção do log ANTES da entrega (idempotência); canais derivados de `phone`/`email`; pessoal só com `user_id`; sem segredo hardcoded; sem "lovable".

- [ ] **Step 3: Commit** — `feat(edge): send-reminders function with pluggable delivery (S2)`.

### Task 4: Compose/env/runbook (edge + cron)

**Files:**
- Modify: `deploy/docker-compose.yml` (serviço `edge-runtime`: env `CRON_SECRET`, `NOTIFY_WEBHOOK_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` explícitos)
- Modify: `deploy/.env.example` (`NOTIFY_WEBHOOK_URL=` server-side, opcional)
- Modify: `deploy/README.md` (§3: copiar functions + env do edge-runtime; §7: recopiar; §nova: crontab horária + log)

**Interfaces:**
- Consumes: Task 3 (função), `CRON_SECRET`/`NOTIFY_WEBHOOK_URL` do `.env`.
- Produces: provisionamento reproduzível (Tasks 6–7).

- [ ] **Step 1:** no compose do deploy, adicionar ao serviço `edge-runtime` o mapeamento de env (merge de maps no include): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET: ${CRON_SECRET:?}`, `NOTIFY_WEBHOOK_URL: ${NOTIFY_WEBHOOK_URL:-}` — e conferir no compose oficial do tag fixado o nome do volume de functions (`./functions:/home/deno/functions`) para a etapa de cópia.
- [ ] **Step 2:** `.env.example` — bloco novo: `NOTIFY_WEBHOOK_URL=` (server-side; opcional; sem valor = simulação) + comentário apontando o runbook.
- [ ] **Step 3:** README — subseção nova em §3: `mkdir -p supabase/functions && cp -r ../../supabase/functions/send-reminders supabase/functions/` + env do edge + nota de que o VERIFY_JWT do serviço oficial deve permanecer como está (a função faz a própria auth por Bearer); §7: recopiar functions no update; §novo (após §4): crontab `0 * * * * . /opt/syncmidia/deploy/.env && curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://supabase.<dominio>/functions/v1/send-reminders >> /var/log/syncmidia-reminders.log 2>&1` + como inspecionar o log.
- [ ] **Step 4: Verificação** — `docker compose config -q` (Docker disponível na execução local); grep: zero "lovable"; `.env.example` sem segredos reais.
- [ ] **Step 5: Commit** — `feat(deploy): edge function wiring and hourly cron runbook (S2)`.

### Task 5: Cliente — sino pessoal, feed staff, status server-side

**Files:**
- Modify: `src/lib/mock-data.ts` (tipos), `src/lib/store.tsx` (fetchAll + markAllNotificationsRead + filtro), `src/components/AppShell.tsx` (sino/painel), `src/routes/index.tsx` (NotificationStatus + toast de publicação)

**Interfaces:**
- Consumes: Tasks 1–2 (schema/RPC), `profiles.user_id` já no store (usuários com `auth_id`).
- Produces: `markAllNotificationsRead()`; `notifications` com `user_id`/`read_at`; `reminderLog` no store; sem cálculo de janela no cliente.

- [ ] **Step 1: tipos** — `NotificationItem`: `user_id?: string | null; read_at?: string | null; kind: "confirm" | "swap" | "leader" | "system" | "assignment" | "reminder"`; novo `ReminderLog { id, schedule_id, window, channel, status, error?, created_at }`.
- [ ] **Step 2: store** — `fetchAll`: `reminder_log` select + mapeamento; `notifications` mapeia `user_id`/`read_at`; nova ação `markAllNotificationsRead()` (update `read_at` em `notifications` onde `user_id` = perfil do usuário logado e `read_at` null → refresh).
- [ ] **Step 3: sino** — contagem = pessoais não lidas do usuário (`user_id === user.auth_id` e `!read_at`); painel com lista pessoal + "marcar todas como lidas" (chama a ação; feedback sonner).
- [ ] **Step 4: dashboard** — feed de atividade = itens `user_id == null`; `NotificationStatus`: para cada escala futura do evento mais próximo, status do `reminder_log` (`24h`/`2h` → `sent/simulated/failed/skipped/agendado`) — **sem nenhuma aritmética de janela no cliente**; botão "Reenviar" mantido como hoje; toast de publicação → `Escala de ${title} publicada (${n} escalado(s)).`
- [ ] **Step 5: Verificação** — `npx tsc --noEmit` 0 erros; `npx eslint src --rule '{"prettier/prettier":"off"}'` sem novos erros; grep "Lembrete (" / cálculo `3600e3` removido do `index.tsx`.
- [ ] **Step 6: Commit** — `feat(ui): personal bell, staff activity feed, server-driven reminder status (S2)`.

### Task 6: Validação local (Docker — mesma stack da S1)

**Files:** nenhum (execução + evidências).

**Interfaces:**
- Consumes: branch com Tasks 1–5; Docker local (docker compose, supabase CLI, imagens já em cache).

- [ ] **Step 1: replay** — `docker compose up -d db` (em `deploy/`, recriando o clone v0.8.2 conforme README §3 se necessário) + aplicar `20261013110000` e `20261013110100` (psql stdin, ordem — o resto do banco pode já existir da S1 ou re replay completo §4).
- [ ] **Step 2: RLS** — com `set request.jwt.claim.sub` de um usuário membro: SELECT vê só as próprias; com claims de admin: vê próprias + globais; UPDATE read_at próprio OK, alheio bloqueado.
- [ ] **Step 3: RPC v3** — publicar para (a) perfil vinculado → notificação pessoal `assignment` criada; (b) perfil seed sem vínculo → nenhuma; count de linhas inalterado.
- [ ] **Step 4: Edge function** — subir `supabase/edge-runtime` one-off na rede do compose com env de teste + volume das functions; POST sem Bearer → 401; com Bearer e sem `NOTIFY_WEBHOOK_URL` → simulated (verificar `reminder_log` + `notifications` pessoal + `notified_at`); executar 2× → zero linhas novas no log (idempotência); com webhook mock (`nc -l` ou container httpbin) → POST recebido e `status='sent'`.
- [ ] **Step 5: saúde** — tsc/eslint limpos; evidências coladas no relatório.
- [ ] **Step 6 (usuário/VPS):** crontab ativo + primeira janela real + testes de navegador (sino, lidas, feed staff).

---

## Self-review (executado)

1. **Cobertura da spec**: schema/RLS (T1), RPC pessoais (T2), função + entrega plugável (T3), compose/cron/runbook (T4), sino/feed/status (T5), validação RLS/idempotência/auth/simulação (T6). ✓
2. **Passos**: um resultado verificável por passo; código completo onde o algoritmo importa (migration, RPC delta, função Deno, trechos de store). ✓
3. **Tipos/names consistentes**: `reminder_log(schedule_id,window,channel)` idêntico em T1/T3/T6; kinds `assignment`/`reminder` em T2/T3/T5; env `CRON_SECRET`/`NOTIFY_WEBHOOK_URL` em T3/T4. ✓
4. **Review Focus**: 1→T6 Step 2; 2→T6 Step 3; 3→T6 Step 4; 4→T6 Step 4; 5→T6 Step 4; 6→T6 Step 3. ✓
5. **Proporção**: proporcional à spec; código completo só onde determinístico. ✓
