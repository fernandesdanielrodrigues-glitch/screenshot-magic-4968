# S1 — Publicação Atômica de Escalas (RPC)

- **Data:** 2026-10-12
- **Status:** Aguardando revisão
- **Ciclo:** S1 de 4 (S1 Publicação atômica → S2 Notificações/lembretes → S3 Avatares no Storage → S4 Limpeza de legado)

## Problema

`publishSchedule` em `src/lib/store.tsx` publica escalas com duas chamadas independentes ao banco:

1. `DELETE FROM schedules WHERE event_id = X`
2. `INSERT` das novas linhas

Se a inserção falhar (RLS, rede, validação), as escalas antigas **já foram apagadas** e não voltam — perda de dados silenciosa. Hoje não existe qualquer transação envolvendo as duas operações.

## Objetivo

Mover a publicação para uma **única função SQL atômica** (`publish_schedule_atomic`) chamada via `supabase.rpc()`, garantindo:

- **Tudo-ou-nada**: delete + insert de `schedules` e a sincronização de `event_teams` numa transação só; qualquer erro reverte tudo.
- **Preservação server-side**: `status`, `notified_at` e `confirmation_token` das linhas existentes (mesma pessoa + mesmo setor) são preservados a partir da **tabela**, não do estado do React — eliminando a condição de corrida entre dois líderes publicando ao mesmo tempo.
- **Segurança**: a função é `SECURITY DEFINER` (bypassa RLS) e **valida `is_staff(auth.uid())` internamente** — sem isso, qualquer membro autenticado poderia publicar escalas.

## Fora de escopo

- Redesenho de notificações/lembretes (S2), Storage de avatares (S3), limpeza de legados (S4).
- Mudança de comportamento visível na UI: toasts, contagem de notificações, flags `team_id`/`adjusted`, cálculo de `role_label` e `adjusted` continuam idênticos.

## Design

### 1. Migration — `public.publish_schedule_atomic`

Nova migration em `supabase/migrations/` criando:

```sql
publish_schedule_atomic(
  p_event_id  uuid,      -- evento alvo
  p_team_id   uuid,      -- equipe atribuída (nullable = remove vínculo)
  p_notify    boolean,   -- true = notificar agora (status pending + notified_at)
  p_schedules jsonb      -- [{"profile_id","sector","role_label","adjusted"}, ...]
) RETURNS integer        -- nº de linhas publicadas
```

Comportamento:

1. **Trava de permissão primeiro**: `auth.uid()` nulo ou `NOT is_staff(...)` → `RAISE EXCEPTION` com `ERRCODE '42501'`.
2. **Validações**: evento existe; `p_team_id` (se enviado) existe; nenhum par `(profile_id, sector)` duplicado no payload.
3. **`event_teams`** sincronizado na mesma transação: delete do vínculo atual do evento; insert do novo se `p_team_id IS NOT NULL` (com `assigned_by = auth.uid()`).
4. **`schedules` num único statement** com CTEs (`old` → `d` delete → `i` insert), que compartilham o mesmo snapshot — `old` lê o estado pré-delete:
   - Join `old` por `(profile_id, sector)` com `DISTINCT ON` (proteção contra duplicatas históricas);
   - `status = pending` quando `p_notify`, senão `coalesce(old.status, 'pending')`;
   - `notified_at = now()` quando `p_notify`, senão o antigo;
   - `confirmation_token = coalesce(old.confirmation_token, gen_random_uuid())` — **detail crítico**: insert explícito de NULL violaria o `NOT NULL` da coluna (o default não se aplica a valores explícitos);
   - `team_id = p_team_id`, `adjusted` vem do payload.
5. Payload vazio é permitido (publica escala vazia = remove todas as linhas, como hoje).
6. `REVOKE EXECUTE ... FROM PUBLIC, anon` + `GRANT EXECUTE ... TO authenticated` (padrão das migrations existentes).

Qualquer erro (FK inexistente, setor fora do enum `skill`, duplicata, permissão) aborta a transação inteira — as escalas antigas permanecem intactas. É a propriedade que hoje não existe.

### 2. Cliente — `src/lib/store.tsx`

Só a função `publishSchedule` muda:

- Continua calculando `role_label` (Câmera N / Redes Sociais / setor) e `adjusted` (membro fora da composição da equipe) — dependem de dados que só o cliente tem.
- Deixa de ler `prev` (estado atual) para preservar status/token — o banco faz isso.
- Monta o array `{ profile_id, sector, role_label, adjusted }` e chama `supabase.rpc("publish_schedule_atomic", { p_event_id, p_team_id, p_notify, p_schedules })`.
- Mantém: `pushNotification`, `refresh()`, retorno do número de linhas (usado nos toasts).

**Nota de integração**: `src/integrations/supabase/types.ts` é gerado automaticamente pelo Lovable ao aplicar migrations; a chamada rpc ficará tipada. Se os tipos não forem regenerados no ambiente local, usa-se um cast local estreito na chamada (sem editar o arquivo gerado).

### 3. Fluxo de dados (depois da mudança)

```
UI (Publicar) → publishSchedule() → monta payload {profile_id, sector, role_label, adjusted}
  → rpc publish_schedule_atomic
      → [transação] valida staff → valida payload → sincroniza event_teams
      → [mesma transação] delete schedules do evento + insert preservando status/token
  → retorna count → pushNotification → refresh (Realtime/React Query)
```

## Testes e validação

1. **Caminho feliz** (UI): publicar escala com equipe → escalas + `event_teams` gravados; contagem no toast correta.
2. **Preservação**: publicar com notificação, anotar o `confirmation_token`; republicar a mesma composição sem notificar → status e token idênticos (links já enviados continuam válidos).
3. **Prova de atomicidade** (SQL editor): chamar a função com um setor inválido → erro; `SELECT count(*) FROM schedules WHERE event_id = X` **inalterado**; idem com `p_team_id` inexistente.
4. **Permissão**: chamada como membro real (sem "Testar como") → `permission denied`.
5. **Saúde**: `tsc --noEmit` sem erros; lint sem novos erros.
6. **Regressão de UI**: criar/editar equipe, autoFill, copiar escala anterior, conflito de equipe — inalterados.

## Arquivos

| Arquivo | Mudança |
|---|---|
| `supabase/migrations/<ts>_publish_schedule_atomic.sql` | novo |
| `src/lib/store.tsx` | corpo de `publishSchedule` |
| `src/routes/escalas.nova.tsx` | chamada `setEventTeam` removida — a RPC é o único escritor de `event_teams` na publicação |

## Riscos

- **Comportamento de publicação concorrente muda de "último escreve" para transação única** — desejado; dois líderes publicando simultaneamente resultam numa composição consistente.
- `types.ts` desatualizado localmente → mitigado pela nota de integração (cast estreito local).
