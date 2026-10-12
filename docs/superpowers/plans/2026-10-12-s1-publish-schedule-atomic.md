# S1 — Publicação Atômica de Escalas (RPC) — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publicar escalas numa única transação SQL (delete + insert de `schedules` + sincronização de `event_teams`), preservando `status`/`notified_at`/`confirmation_token` a partir da tabela, com trava de permissão `is_staff` dentro da função.

**Architecture:** Nova função `publish_schedule_atomic` (`SECURITY DEFINER`) em migration Supabase, chamada via `supabase.rpc()` a partir de `publishSchedule` em `src/lib/store.tsx`. O cálculo de `role_label`/`adjusted` permanece no cliente; a preservação de dados existentes passa a ser server-side (CTEs num único statement compartilham o mesmo snapshot).

**Tech Stack:** PostgreSQL 15 (Supabase/Lovable Cloud), plpgsql, supabase-js v2, TypeScript 5.8.

**Spec:** `docs/superpowers/specs/2026-10-12-s1-publish-schedule-atomic-design.md`

## Global Constraints

- Função `SECURITY DEFINER` com `SET search_path = public`; trava `is_staff(auth.uid())` como **primeira** instrução, com `ERRCODE = '42501'`.
- `confirmation_token` gravado como `coalesce(old.confirmation_token, gen_random_uuid())` — **nunca** NULL explícito (coluna `NOT NULL`; o default não se aplica a valor explícito).
- CTEs `old`/`d`/`i` num **único statement** (mesmo snapshot); `event_teams` sincronizado **na mesma transação**.
- `REVOKE EXECUTE ... FROM PUBLIC, anon;` + `GRANT EXECUTE ... TO authenticated;`.
- Payload do cliente: `[{ profile_id: string, sector: Skill, role_label: string, adjusted: boolean }]`.
- `src/integrations/supabase/types.ts` é gerado — **nunca editar à mão**; chamada rpc usa cast local estreito.
- Nenhuma mudança de UI/copy: toasts pt-BR idênticos aos atuais.
- `git push` está falhando por credenciais GitHub — commitar **localmente**; push fica para quando o usuário renovar o token.

## Review Focus

Condições que os testes de tarefa precisam cobrir (cada linha tem teste na tarefa dona):

1. **Membro real (não staff) chama a RPC** → deve receber `permission denied` e nada gravar. → Teste na Task 3.
2. **Payload com duplicata `(profile_id, sector)`** → erro e escalas antigas intactas. → Teste na Task 1.
3. **Republicar sem notificar** → `status` e `confirmation_token` preservados (links enviados continuam válidos). → Teste na Task 3.
4. **Payload vazio** → remove todas as escalas do evento sem erro, retorna 0. → Teste na Task 1.
5. **`p_team_id` inexistente** → erro e escalas antigas intactas (transação inteira reverte, inclusive `event_teams`). → Teste na Task 1.

---

### Task 1: Migration `publish_schedule_atomic`

**Files:**
- Create: `supabase/migrations/20261012120000_publish_schedule_atomic.sql`

**Interfaces:**
- Consumes (existentes no banco): `public.is_staff(uuid) returns boolean` (admin/leader via `user_roles`), tabelas `events`, `teams`, `schedules` (colunas `event_id, profile_id, sector, role_label, status, swap_reason, notified_at, confirmation_token, team_id, adjusted`), `event_teams (event_id UNIQUE, team_id, assigned_by)`, enum `public.skill`.
- Produces: `public.publish_schedule_atomic(p_event_id uuid, p_team_id uuid, p_notify boolean, p_schedules jsonb) RETURNS integer` — usada pela Task 2.

- [ ] **Step 1: Escrever a migration** com o corpo exato abaixo (algoritmo definido pela spec — wCTE com mesmo snapshot):

```sql
CREATE OR REPLACE FUNCTION public.publish_schedule_atomic(
  p_event_id uuid,
  p_team_id uuid,
  p_notify boolean,
  p_schedules jsonb
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
  v_uid uuid := auth.uid();
BEGIN
  -- Trava de permissão: SECURITY DEFINER bypassa RLS
  IF v_uid IS NULL OR NOT public.is_staff(v_uid) THEN
    RAISE EXCEPTION 'permission denied: only staff can publish schedules'
      USING ERRCODE = '42501';
  END IF;

  -- Validações
  IF NOT EXISTS (SELECT 1 FROM public.events WHERE id = p_event_id) THEN
    RAISE EXCEPTION 'event % not found', p_event_id;
  END IF;
  IF p_team_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.teams WHERE id = p_team_id) THEN
    RAISE EXCEPTION 'team % not found', p_team_id;
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_schedules) x
    GROUP BY x->>'profile_id', x->>'sector'
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate profile_id+sector in payload';
  END IF;

  -- event_teams na mesma transação
  DELETE FROM public.event_teams WHERE event_id = p_event_id;
  IF p_team_id IS NOT NULL THEN
    INSERT INTO public.event_teams (event_id, team_id, assigned_by)
    VALUES (p_event_id, p_team_id, v_uid);
  END IF;

  -- schedules: um statement, um snapshot ("old" lê o estado pré-delete)
  WITH old AS (
    SELECT DISTINCT ON (profile_id, sector)
           profile_id, sector, status, notified_at, confirmation_token
    FROM public.schedules
    WHERE event_id = p_event_id
  ), d AS (
    DELETE FROM public.schedules WHERE event_id = p_event_id
  ), i AS (
    INSERT INTO public.schedules
      (event_id, profile_id, sector, role_label, status, notified_at, team_id, adjusted, confirmation_token)
    SELECT
      p_event_id,
      (x->>'profile_id')::uuid,
      (x->>'sector')::public.skill,
      coalesce(nullif(trim(x->>'role_label'), ''), x->>'sector'),
      CASE WHEN p_notify THEN 'pending' ELSE coalesce(o.status, 'pending') END,
      CASE WHEN p_notify THEN now() ELSE o.notified_at END,
      p_team_id,
      coalesce((x->>'adjusted')::boolean, false),
      coalesce(o.confirmation_token, gen_random_uuid())
    FROM jsonb_array_elements(p_schedules) AS x
    LEFT JOIN old o
      ON o.profile_id = (x->>'profile_id')::uuid
     AND o.sector = (x->>'sector')::public.skill
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM i;

  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.publish_schedule_atomic(uuid, uuid, boolean, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_schedule_atomic(uuid, uuid, boolean, jsonb) TO authenticated;
```

- [ ] **Step 2: Verificação estática** — reler contra a spec: trava de permissão é a 1ª instrução; `coalesce(..., gen_random_uuid())` no token (não NULL); `DISTINCT ON` em `old`; REVOKE/GRANT presentes; sem referência a colunas que não existem (`swap_reason` não é tocada — delete+insert a descarta, comportamento atual igual: `publishSchedule` atual também não preserva `swap_reason`).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20261012120000_publish_schedule_atomic.sql
git commit -m "feat(db): atomic schedule publication RPC (S1)"
```

- [ ] **Step 4: Aplicar migration no Lovable Cloud** (executada pelo pipeline do Lovable no push, ou colar o SQL no SQL Editor do Lovable Cloud). Verificação dinâmica no **SQL Editor** (roda como postgres; valida a lógica, não a trava de papel):

```sql
-- 4a. Duplicata → erro; contagem inalterada (seed: evento e1 tem 6 escalas)
select public.publish_schedule_atomic(
  '10000000-0000-0000-0000-000000000001'::uuid, null, false,
  '[{"profile_id":"00000000-0000-0000-0000-000000000003","sector":"Slide","role_label":"X","adjusted":false},
    {"profile_id":"00000000-0000-0000-0000-000000000003","sector":"Slide","role_label":"Y","adjusted":false}]'::jsonb);
-- esperado: ERROR duplicate profile_id+sector
select count(*) from public.schedules where event_id = '10000000-0000-0000-0000-000000000001'::uuid;
-- esperado: 6 (intacto)

-- 4b. team inexistente → erro; event_teams intacto
select public.publish_schedule_atomic(
  '10000000-0000-0000-0000-000000000001'::uuid,
  '99999999-0000-0000-0000-000000000009'::uuid, false, '[]'::jsonb);
-- esperado: ERROR team ... not found
select count(*) from public.event_teams where event_id = '10000000-0000-0000-0000-000000000001'::uuid;
-- esperado: 0 (intacto)

-- 4c. Payload vazio → apaga todas, retorna 0, sem erro
select public.publish_schedule_atomic(
  '10000000-0000-0000-0000-000000000001'::uuid, null, false, '[]'::jsonb);
-- esperado: 0
select count(*) from public.schedules where event_id = '10000000-0000-0000-0000-000000000001'::uuid;
-- esperado: 0
-- (reverter o estado do seed depois do teste com o caminho feliz da Task 3)
```

### Task 2: Cliente — `publishSchedule` via RPC

**Files:**
- Modify: `src/lib/store.tsx` (função `publishSchedule`, dentro do `useMemo` do `StoreProvider`, ~linhas 355–385)

**Interfaces:**
- Consumes: `public.publish_schedule_atomic` (Task 1); `supabase.rpc`; `check`, `pushNotification`, `refresh` (já no escopo do `useMemo`); `teams`, `events` (estado derivado).
- Produces: `publishSchedule(eventId: string, assignments: Record<Skill, string[]>, notify?: boolean, teamId?: string | null) => Promise<number>` — assinatura **inalterada** (consumida por `src/routes/escalas.nova.tsx` sem mudanças).

- [ ] **Step 1: Substituir o corpo de `publishSchedule`** mantendo a assinatura; o cast estreito contorna `types.ts` ainda não regenerado:

```ts
publishSchedule: async (eventId, assignments, notify = false, teamId = null) => {
  const team = teamId ? teams.find((tt) => tt.id === teamId) : undefined;
  const rows = (Object.keys(assignments) as Skill[]).flatMap((sector) =>
    assignments[sector].map((userId, index) => ({
      profile_id: userId,
      sector,
      role_label: sector === "Câmera" ? `Câmera ${index + 1}` : sector === "Social" ? "Redes Sociais" : sector,
      adjusted: !!team && !team.members.some((m) => m.user_id === userId && m.sector === sector),
    })),
  );
  // cast estreito: types.ts é regenerado pelo Lovable após aplicar a migration
  const rpc = supabase.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  const { data: count, error } = await rpc("publish_schedule_atomic", {
    p_event_id: eventId,
    p_team_id: teamId,
    p_notify: notify,
    p_schedules: rows,
  });
  check(error);
  const title = events.find((e) => e.id === eventId)?.title ?? "Evento";
  await pushNotification(notify ? `Escala de ${title} publicada e ${Number(count ?? 0)} notificações enviadas.` : `Escala de ${title} salva.`, "system");
  await refresh();
  return Number(count ?? 0);
},
```

- [ ] **Step 2: Verificar compilação e lint**

Run: `npx tsc --noEmit`
Expected: sem erros

Run: `npx eslint src/lib/store.tsx --rule '{"prettier/prettier":"off"}'`
Expected: sem erros (warnings de `react-refresh/only-export-components` já existentes são aceitáveis)

- [ ] **Step 3: Commit**

```bash
git add src/lib/store.tsx
git commit -m "feat(store): publish schedules atomically via publish_schedule_atomic RPC"
```

### Task 3: Verificação dinâmica ponta a ponta

**Files:** nenhum (somente verificação; ajustes só se um passo falhar).

**Interfaces:**
- Consumes: RPC aplicada (Task 1) + cliente atualizado (Task 2); app rodando (`npm run dev` ou editor Lovable) com um usuário **staff real** (admin/líder de verdade, sem "Testar como").

- [ ] **Step 1: Caminho feliz (UI)** — Criar Escala → aplicar uma equipe Ativa → Publicar (marcar notificações). Esperado: toast "Escala de … publicada e N notificações enviadas." com N = nº de escalados; conferir no SQL Editor: `select count(*), count(team_id) from public.schedules where event_id = '<id>';` → ambas iguais ao nº escalado; `select * from public.event_teams where event_id = '<id>';` → 1 linha com a equipe.

- [ ] **Step 2: Preservação de token/status** — anotar token antes: `select confirmation_token, status from public.schedules where event_id = '<id>' limit 3;` → na UI, alterar uma escala qualquer e **Publicar sem marcar notificações** → reexecutar o select: `status` das linhas não tocadas e todos os `confirmation_token` **iguais** aos anotados (o da linha recomposta gera novo token, esperado).

- [ ] **Step 3: Trava de permissão (membro real)** — com uma conta cujo papel real é `member` (sem "Testar como"), tentar publicar (ou chamar via console do navegador `supabase.rpc(...)`). Esperado: toast "Não foi possível salvar: permission denied: only staff can publish schedules" e nada gravado.

- [ ] **Step 4: Regressão e saúde** — `npx tsc --noEmit` sem erros; fluxos inalterados na UI: autoFill, copiar escala anterior, conflito de equipe (chip "· ocupada"), toast de contagem. Fechar a Task 1/2 com o estado do banco consistente (Step 1 recriou as escalas do evento de teste).

---

## Self-review (executado)

1. **Cobertura da spec**: migration (Task 1), cliente (Task 2), testes 1–6 da spec → Task 1 Steps 4a–4c (atomicidade/payload), Task 3 Steps 1–4 (caminho feliz, token, permissão, regressão + tsc). ✓
2. **Passos**: cada passo = uma ação verificável; corpos SQL/TS completos porque o algoritmo não é determinado só pela assinatura. ✓
3. **Tipos/nomes consistentes**: `publish_schedule_atomic(p_event_id, p_team_id, p_notify, p_schedules)` idêntico na Task 1 e Task 2; payload `{profile_id, sector, role_label, adjusted}` em ambos. ✓
4. **Review Focus**: itens 2/4/5 → Task 1 (4a–4c); itens 1/3 → Task 3 (Steps 3 e 2). ✓
5. **Proporção**: plano curto; SQL e corpo do cliente são as decisões, não transcrição. ✓
