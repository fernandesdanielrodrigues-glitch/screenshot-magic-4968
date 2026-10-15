# S2 — Notificações Pessoais + Lembretes Server-Side — Design

- **Data:** 2026-10-13
- **Status:** Aguardando revisão
- **Ciclo:** S2 de 4 (S1 ✅ mergeada → **S2** → S3 Storage de avatares → S4 limpeza de legado)

## Problema

1. **Privacidade**: a tabela `notifications` é um feed global — qualquer membro autenticado vê confirmações, trocas (com motivo!) e nomeações de todos. O sino não é pessoal e não há "lida".
2. **Lembretes simulados no cliente**: o dashboard calcula janelas 24h/2h no navegador e o "envio" é simulado (`VITE_NOTIFY_WEBHOOK_URL` ausente → log). Nada server-side dispara nada.
3. **Sem aviso pessoal de escalação**: o voluntário só descobre que foi escalado abrindo o app.

## Objetivo

Notificações **pessoais** (destinatário + lida) com RLS híbrido, feed de atividade restrito a staff, aviso de escalação **atômico com a publicação** (dentro do RPC da S1), lembretes **server-side** via Edge Function + crontab do VPS, entrega **plugável** (webhook único com fallback de simulação) e remoção do cálculo de lembretes do cliente.

## Decisões registradas (perguntas desta sessão)

| Decisão | Escolha |
|---|---|
| Entrega | **Plugável**: webhook único (`NOTIFY_WEBHOOK_URL`, server-side) + simulação; provedores reais (Evolution API/Resend) entram depois só com env vars |
| Veículo | **A1**: Edge Function `send-reminders` no Edge Runtime da stack v0.8.2 + **crontab do VPS** (hora em hora) com `CRON_SECRET` |
| Escopo pessoal | Aviso de escalação (no RPC) + lembretes (cron). Resultado de troca fica para quando existir fluxo de aprovação de troca |

## Arquitetura

```
cron (VPS, horária) ── Bearer CRON_SECRET ──▶ Edge Function send-reminders (service_role)
                                                ├─ janelas 24h/2h (reminder_log anti-duplo)
                                                ├─ webhook (WhatsApp/E-mail) ou simulação
                                                ├─ notifications pessoais + reminder_log + notified_at
publish_schedule_atomic (S1) ─────────────────▶ notifications pessoais "você foi escalado" (atômico)
cliente (staff) ── pushNotification ──────────▶ feed de atividade (user_id NULL, só staff lê)
sino/dashboard ── RLS ────────────────────────▶ pessoal (user_id = auth.uid(), read_at) + atividade (staff)
```

## 1. Schema (nova migration)

**`notifications`**:
- `user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE` — **nullable** (NULL = atividade global)
- `read_at timestamptz` — NULL = não lida
- RLS: SELECT `user_id = auth.uid() OR (user_id IS NULL AND public.is_staff(auth.uid()))` — membro vê só o seu; staff vê o seu + atividade global; **membro NÃO vê mais atividade alheia** (motivos de troca deixam de vazar)
- INSERT para authenticated: `WITH CHECK (user_id IS NULL OR user_id = auth.uid())` — ações de membros continuam gerando atividade; ninguém insere notificação em nome de outrem
- UPDATE: `user_id = auth.uid()` (marcar lida) — USING/CHECK idênticos
- Seed atual (3 linhas, user_id NULL) vira atividade global — compatível

**`reminder_log`** (nova):
- `id`, `schedule_id → schedules ON DELETE CASCADE`, `window text CHECK (window IN ('24h','2h'))`, `channel text CHECK (channel IN ('whatsapp','email'))`, `status text CHECK (status IN ('sent','simulated','failed','skipped'))`, `error text`, `created_at`
- `UNIQUE (schedule_id, window, channel)` — anti-disparo-duplo idempotente
- RLS: SELECT para authenticated (o dashboard exibe status); INSERT/UPDATE/DELETE só service_role (a Edge Function)

**`publish_schedule_atomic`** (CREATE OR REPLACE em nova migration — a S1 já merged, nunca editar migration aplicada):
- Após inserir as escalas, insere notificação pessoal para cada perfil **vinculado** (`profiles.user_id IS NOT NULL`): kind `assignment`, mensagem `Você foi escalado para {role_label} no evento {title} em {data hora}.`
- Contagem de notificações pessoais entra no retorno? **Não** — retorno continua = nº de linhas de escala (contrato do toast mantido); notificações pessoais são efeito colateral auditável
- Trocar a mensagem de atividade do cliente (`store.tsx`): "Escala de X publicada e N notificações enviadas" → basear N em `reminder?` não — o toast passa a dizer "Escala de X publicada (N escalado(s))" (o envio real é do cron; "notificações enviadas" seria afirmar o que não ocorreu). Decisão de copy registrada na spec.

## 2. Edge Function `send-reminders` (Deno, em `supabase/functions/send-reminders/`)

- **Auth**: porta do `cron-auth.ts` para Deno — Bearer `CRON_SECRET` com comparação timing-safe; sem header válido → 401
- **Janelas**: para cada escala com `status IN ('pending','confirmed')`: janela `24h` quando `0 < event_start - now <= 24h`; janela `2h` quando `0 < event_start - now <= 2h`; pula se `(schedule_id, window, channel)` já em `reminder_log` (idempotência) ou `notified_at` já setado por janela equivalente? — não: `reminder_log` é a única fonte de idempotência (canal por linha)
- **Canais por destinatário**: WhatsApp se `profiles.phone` presente; E-mail se `profiles.email` presente (sempre presente)
- **Entrega**: POST `NOTIFY_WEBHOOK_URL` (env server-side do serviço `edge-runtime`) com `{ channel, to, message, scheduleId, window }`; sem webhook → `status='simulated'`; erro → `status='failed'` + `error`
- **Efeitos**: insere `reminder_log`; insere `notifications` pessoal (kind `reminder`, `user_id` do perfil vinculado; pula perfis sem vínculo); atualiza `schedules.notified_at = now()`
- **Resposta**: JSON `{ processed, sent, simulated, failed }` (auditável no log do cron)
- **Deploy self-hosted**: fonte versionada em `supabase/functions/send-reminders/` no repo; o runbook copia para `deploy/supabase/functions/` (montada pelo serviço `edge-runtime`); env do serviço ganha `CRON_SECRET` + `NOTIFY_WEBHOOK_URL` no compose do deploy

## 3. Cron (VPS)

Crontab do usuário root/deploy, horária: `0 * * * * curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://supabase.<dominio>/functions/v1/send-reminders >> /var/log/syncmidia-reminders.log 2>&1` (entrada documentada no runbook §novo; CRON_SECRET lido do `deploy/.env`).

## 4. Cliente

- **`store.tsx`/`mock-data.ts`**: tipos `NotificationItem` ganham `user_id`, `read_at` e os novos kinds (`'assignment'`, `'reminder'`); novo tipo `ReminderLog`; `fetchAll` inclui `reminder_log`; nova ação `markAllNotificationsRead()` (update `read_at` onde `user_id = me` e `read_at IS NULL`)
- **Sino (`AppShell`)**: contagem = pessoais não lidas; painel lista pessoais com lidas/não-lidas + botão "marcar todas como lidas"
- **Dashboard (`index.tsx`)**: feed de atividade = `user_id IS NULL` (staff); **remover o cálculo de janelas do cliente** — `NotificationStatus` passa a exibir status do `reminder_log` ("Lembrete 24h: enviado/simulado/falhou/agendado"); botão "Reenviar" mantido (staff, via webhook client-side como hoje)
- **`minha-agenda`**: inalterado (confirmação/troca por link e login já cobertos)

## 5. Runbook (deploy/README.md)

- §3.x (subseção nova, numerada no plano): copiar `supabase/functions/send-reminders/` para `deploy/supabase/functions/`; env `CRON_SECRET` + `NOTIFY_WEBHOOK_URL` no serviço `edge-runtime` (override no compose do deploy); §7 (update) recopia functions
- Subseção nova de crontab (numerada no plano): entrada horária + log; `.env.example`: `NOTIFY_WEBHOOK_URL` (server-side, opcional — simulação sem ele)

## Validação

1. Local (Docker, como na S1): replay + SQL — RLS (membro não vê atividade alheia; staff vê), RPC insere pessoais só para vinculados, `reminder_log` idempotente (2 execuções seguidas da função = 0 duplicatas), Edge Function executada localmente (`supabase functions serve`? — não: via `docker run edge-runtime` ou chamada direta ao container com curl) com webhook mockado vs simulado
2. UI local se possível; senão no VPS: sino pessoal, marcar lidas, feed staff, status de lembrete no dashboard
3. Produção: crontab ativo + primeira janela 24h real

## Riscos

- Edge Runtime self-hosted: montagem/env do serviço pode diferir do esperado → validado localmente ANTES do VPS (criterion da validação 1)
- Perfil sem vínculo (seed) não recebe pessoal — comportamento documentado
- Webhook do provedor: retry não existe na v1 (falha → status `failed` no log; próxima janela não repete — revisar na S-observabilidade se necessário)

## Fora de escopo

- Provedores reais (só env vars quando chegarem), aprovação de troca (fluxo + notificação de resultado), digest/semanal, push web

## Adendo (14/10/2026 — decisão do parceiro)

A premissa UTC e o dedupe de republish foram RECLASSIFICADOS de pós-merge para escopo da S2, por decisão do parceiro (janelas estritas + fuso = integridade temporal estrutural). Implementado: parse wall-time America/Sao_Paulo na Edge Function (APP_TIMEZONE, two-pass Intl), dedupe de 'assignment' não lida no RPC v3, validação local com eventos +23h BRT (entregue) e +25h BRT (não entregue).
