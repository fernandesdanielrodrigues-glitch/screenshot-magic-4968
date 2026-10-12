# Migração Self-Hosted (saída do Lovable) — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sair do Lovable por completo — Supabase self-hosted (Docker) + app SSR self-hosted em VPS com TLS — com banco vazio (replay das migrations) e comportamento do app idêntico.

**Architecture:** Compose único no VPS: stack oficial `supabase/docker` + container do app (Nitro `node-server`) + Caddy (TLS, 80/443). Código do app dessacoplado do Lovable (OAuth nativo Supabase, sem pacotes/reportes do editor). Banco novo recebe as migrations do repo em ordem explícita.

**Tech Stack:** Docker Compose, supabase/docker (release fixada), Caddy, TanStack Start + Nitro (`node-server`), Node 22, Supabase CLI (types + db push opcional).

**Spec:** `docs/superpowers/specs/2026-10-12-self-hosted-migration-design.md`

## Global Constraints

- **Ordem de replay obrigatória** (a migration da S1 referencia `teams`/`event_teams` criadas pelas migrations Drizzle; `drizzle/0002` redefine `is_staff`): `supabase/migrations/` (3 arquivos por timestamp) → `drizzle/migrations/` (0000, 0001, 0002) → `supabase/migrations/20261012120000_publish_schedule_atomic.sql` **por último**. Nunca aplicar por glob de timestamp.
- **TLS obrigatório** (Caddy, 80/443); Studio apenas via túnel SSH; Postgres sem porta pública.
- **Sem dump** do Lovable Cloud; banco começa vazio; dados reais não migram.
- Segredos (senhas, JWT_SECRET, keys, SMTP, OAuth) apenas em `.env` no VPS, fora do git; o repo versiona só `.env.example` documentado.
- Push para o GitHub permanece bloqueado (credenciais) — commits locais; push fica para o usuário.
- `VITE_*` são fixados no build (build-args) — o app nunca lê URL do Supabase em runtime.
- Comportamento/UX/copy pt-BR inalterados; RLS server-side intacta ("Testar como" só-UI).
- Merge da S1 na `main` **antes** da branch `self-host` (Task 1).

## Review Focus

Condições que a spec implica e que os testes de tarefa devem cobrir (cada linha tem teste na tarefa dona):

1. **Sem SMTP configurado, cadastro trava** (confirmação não sai) → Task 6 valida SMTP **antes** do teste de signup.
2. **Redirect do Google OAuth** deve ser exatamente `https://supabase.<dominio>/auth/v1/callback` no GCP **e** no GoTrue → Task 6.
3. **`SITE_URL` errado** quebra links de confirmação/reset (apontam para URL errada) → Task 6 valida URL dos e-mails recebidos.
4. **Replay fora de ordem** (S1 antes do Drizzle) cria a RPC com referência a tabelas inexistentes → Task 5 verifica existência de `teams`/`event_teams` **antes** de aplicar a S1 e testa a função depois.
5. **`VITE_SUPABASE_URL` assado errado no build** (build antes do DNS/env) → Task 6 valida login na URL real; Task 3 fixa build-args no compose.

---

### Task 1: Merge da S1 na `main` + branch `self-host`

**Files:** nenhum (operação git).

**Interfaces:**
- Produces: `main` contendo a S1 (commits `5b06291..f096f88` + docs); branch de trabalho `self-host` criada a partir da `main` pós-merge.

- [ ] **Step 1: Merge local** (a partir do repositório principal, não do worktree):

```bash
git -C "C:\Users\daniel.fernandes\Projetos\screenshot-magic-4968" merge s1-atomic-publish
```

Expected: merge concluído (a branch foi criada da `main` atual, sem divergência — fast-forward esperado).

- [ ] **Step 2: Criar branch de trabalho** `self-host` a partir da `main` pós-merge; confirmar que `supabase/migrations/20261012120000_publish_schedule_atomic.sql` existe nela.

- [ ] **Step 3: Atualizar o ledger da S1** (`.worktrees/s1-atomic-publish/.superpowers/sdd/2026-10-12-s1-publish-schedule-atomic/progress.md`): registrar ruling — "verificação dinâmica (Task 3 da S1) relocada para a instância self-hosted (Task 6 deste plano); branch mergeada na main; push pendente de credenciais".

- [ ] **Step 4: Commit** (se merge gerar commit) — mensagem: `chore: merge S1 atomic publish into main`.

### Task 2: Dessacoplar o app do Lovable (branch `self-host`)

**Files:**
- Modify: `src/routes/login.tsx` (função `google`, ~linha 56-59)
- Delete: `src/integrations/lovable/index.ts`
- Modify: `package.json` (remover `@lovable.dev/cloud-auth-js`)
- Delete: `src/lib/lovable-error-reporting.ts`; Modify: `src/routes/__root.tsx` (import + chamada `reportLovableError`, ~linhas 14 e 72-74)
- Modify: `src/integrations/supabase/previewAuthStorage.ts` (substituir implementação broker por `localStorage` puro, mantendo a mesma interface exportada `brokeredPreviewStorage()`)
- Modify: `vite.config.ts` (override do preset Nitro → `node-server`; manter o resto do pacote)
- Modify: `AGENTS.md` (remover bloco `<!-- LOVABLE:BEGIN -->…<!-- LOVABLE:END -->`)

**Interfaces:**
- Consumes: `supabase` de `@/integrations/supabase/client` (existente) para OAuth nativo.
- Produces: app sem nenhuma referência runtime a `lovable.dev`; `brokeredPreviewStorage()` mantém assinatura (client.ts não muda); build Nitro gera `.output/server/index.mjs` (usado na Task 3).

- [ ] **Step 1: login.tsx** — trocar a chamada Google por:

```ts
const google = async () => {
  const r = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.origin },
  });
  if (r.error) setError("Não foi possível entrar com o Google.");
};
```

Remover o import de `@/integrations/lovable` (o import de `supabase` já deve existir ou é adicionado).

- [ ] **Step 2: previewAuthStorage.ts** — reimplementar como wrapper de `localStorage` com a mesma interface (getItem/setItem/removeItem retornando Promises), sem nenhuma lógica de postMessage/domínios Lovable.

- [ ] **Step 3: __root.tsx** — remover import e chamada de `reportLovableError` (o `console.error(error)` existente permanece).

- [ ] **Step 4: vite.config.ts** — dentro do `defineConfig`, sobrescrever o preset:

```ts
export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  nitro: { preset: "node-server" },
});
```

Se o pacote não aceitar a chave `nitro` (verificar no Step 6), aplicar o fallback: reescrever `vite.config.ts` com plugins explícitos (tanstackStart com `server.entry: "server"`, viteReact, tailwindcss, tsConfigPaths, nitro `node-server`, alias `@` → `./src`, dedupe React/TanStack) — sem os plugins de error-logger do Lovable.

- [ ] **Step 5: AGENTS.md + limpeza** — remover bloco LOVABLE do AGENTS.md; deletar `src/integrations/lovable/` e `src/lib/lovable-error-reporting.ts`; remover `@lovable.dev/cloud-auth-js` do `package.json`.

- [ ] **Step 6: Verificação**

Run: `npx tsc --noEmit` — Expected: 0 erros
Run: `npx eslint src --rule '{"prettier/prettier":"off"}'` — Expected: sem novos erros (warnings pre-existentes de react-refresh ok)
Run: `npm run build` com env dummy (`VITE_SUPABASE_URL=https://supabase.example.com`, `VITE_SUPABASE_PUBLISHABLE_KEY=dummy`) — Expected: build conclui e gera `.output/server/index.mjs` (prova do preset node-server e da ausência de plugins Lovable)
Run: `grep -ri "lovable" src/ package.json` — Expected: nenhuma ocorrência runtime (comentários históricos aceitáveis apenas em docs/)

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: decouple app from Lovable (native Supabase OAuth, nitro node-server)"
```

### Task 3: Empacotar deploy (Dockerfile + compose + Caddy + docs)

**Files:**
- Create: `Dockerfile`, `.dockerignore`
- Create: `deploy/docker-compose.yml`, `deploy/Caddyfile`, `deploy/.env.example`, `deploy/README.md`

**Interfaces:**
- Consumes: `.output/server/index.mjs` do build da Task 2; stack oficial `supabase/docker` (clonada no VPS em release fixada — o compose deste repo referencia via `include:` ou documenta o clone no README, decisão abaixo).
- Produces: infra reproduzível do VPS (usada nas Tasks 4–6); `.env.example` lista TODAS as variáveis que o usuário preenche.

- [ ] **Step 1: Dockerfile** — multi-stage: `build` (node:22, `npm ci` via package.json existente, build com build-args `VITE_SUPABASE_URL`/`VITE_SUPABASE_PUBLISHABLE_KEY`) → `runtime` (node:22-slim, copia `.output/`, `CMD ["node", ".output/server/index.mjs"]`, `ENV PORT=3000`).

- [ ] **Step 2: `.dockerignore`** — `node_modules`, `.output`, `.worktrees`, `.superpowers`, `.env*` (exceto nada), `.git`.

- [ ] **Step 3: `deploy/docker-compose.yml`** — três serviços em rede interna (`proxy` Caddy com ports 80/443 e volumes de certs; `app` build do Dockerfile com build-args; Supabase via `include:` do compose oficial clonado em `deploy/supabase/` — README fixa a release e o clone; se `include:` indisponível, o README instrui `docker compose -f` múltiplos). Studio/Postgres sem ports públicos (override explícito).

- [ ] **Step 4: `deploy/Caddyfile`** — `app.<dominio>` → `app:3000`; `supabase.<dominio>` → `kong:8000`; TLS automático; headers de segurança básicos.

- [ ] **Step 5: `deploy/.env.example` + `deploy/README.md`** — lista completa de variáveis (senhas/JWT/keys do Supabase, SMTP do GoTrue, GOOGLE client id/secret, domínios, build-args do app) + passo a passo do provisionamento (Task 4) e do replay (Task 5), incluindo a **ordem explícita de migrations** (constraint global) e o túnel do Studio.

- [ ] **Step 6: Verificação**

Run: `docker compose -f deploy/docker-compose.yml config` (se Docker disponível na máquina) — Expected: config válida, sem erros de sintaxe; senão: revisão estática do YAML + `npx yaml-lint`-equivalente ou leitura par a par com o compose oficial.

- [ ] **Step 7: Commit**

```bash
git add Dockerfile .dockerignore deploy/
git commit -m "feat(deploy): self-hosted packaging (dockerfile, compose, caddy, runbook)"
```

### Task 4: Provisionamento no VPS (usuário-gated, com runbook pronto)

**Files:** nenhum no repo (execução no VPS seguindo `deploy/README.md`).

**Interfaces:**
- Consumes: artefatos da Task 3; pré-requisitos do usuário (VPS, DNS `app.`/`supabase.`, SMTP, GCP OAuth).
- Produces: instância Supabase saudável em `https://supabase.<dominio>` e app servido em `https://app.<dominio>` (ainda com banco vazio).

- [ ] **Step 1 (usuário):** instalar Docker+Compose, clonar repo e `supabase/docker` (release fixada), gerar `JWT_SECRET`/keys, preencher `.env`, `docker compose up -d`
- [ ] **Step 2 (usuário):** DNS propagado → Caddy emite TLS; Studio apenas via túnel
- [ ] **Step 3 (verificação):** `curl https://supabase.<dominio>/auth/v1/health` → `{"healthy":true}` (ou equivalente); `https://app.<dominio>` responde (mesmo sem banco ainda pode mostrar erro de dados — aceitável até Task 5)

### Task 5: Replay das migrations + regenerar types

**Files:**
- Modify: `src/integrations/supabase/types.ts` (regenerado)

**Interfaces:**
- Consumes: Postgres do VPS (Task 4); arquivos de migration na ordem da constraint global.
- Produces: schema completo (incl. `publish_schedule_atomic`); `types.ts` coerente com a instância nova.

- [ ] **Step 1: Ordem explícita** (contra o Postgres do VPS, via `psql` ou `supabase db push`):

```text
1. supabase/migrations/20260929100441_*.sql
2. supabase/migrations/20260930103622_*.sql
3. supabase/migrations/20261001084838_*.sql
4. drizzle/migrations/0000_calendar_token.sql
5. drizzle/migrations/0001_add_phone_to_profiles.sql
6. drizzle/migrations/0002_teams_model.sql
7. supabase/migrations/20261012120000_publish_schedule_atomic.sql  (SEMPRE por último)
```

- [ ] **Step 2: Verificação SQL** (todas devem retornar OK):

```sql
select to_regclass('public.teams') is not null and to_regclass('public.event_teams') is not null;      -- t
select to_regproc('public.publish_schedule_atomic') is not null;                                        -- t
select to_regproc('public.handle_new_user') is not null and to_regproc('public.respond_invite') is not null;
select count(*) from public.sectors; -- 5 (seed)
```

- [ ] **Step 3: Regenerar types** — `supabase gen types typescript --project-id <novo> --schema public > src/integrations/supabase/types.ts` (ou via DB URL local do VPS); confirmar que `publish_schedule_atomic` aparece em `Functions` e avaliar remoção do cast local em `store.tsx` (opcional, commit separado se removido).

- [ ] **Step 4: Commit** (apenas se types/cast mudarem): `chore: regenerate supabase types against self-hosted instance`.

### Task 6: Validação completa (usuário-assistida, na instância nova)

**Files:** nenhum.

**Interfaces:**
- Consumes: tudo das Tasks 2–5.
- Produces: evidência de paridade + fechamento da Task 3 da S1 (ledger).

- [ ] **Step 1: SMTP primeiro** — configurado/testado ANTES de testar cadastro (Review Focus 1)
- [ ] **Step 2: Auth** — cadastro com confirmação (URL dos e-mails = `https://app.<dominio>`), login e-mail+senha, Google (Review Focus 2), reset de senha (Review Focus 3), `handle_new_user` (1º signup admin)
- [ ] **Step 3: Realtime** — 2 abas, mutação reflete ao vivo
- [ ] **Step 4: RLS** — membro real não publica; "Testar como" só-UI
- [ ] **Step 5: Token público + ICS** — `/confirmar/$token` funciona; `/api/public/agenda/<token>.ics` responde
- [ ] **Step 6: S1 (fecha Task 3 da S1)** — scripts 4a/4b/4c do plano S1 + publicar com equipe na UI + `select count(*), count(team_id), count(assigned_by) from public.event_teams;`
- [ ] **Step 7: Higiene** — `npx tsc --noEmit` 0 erros; `grep -ri "lovable.dev" src/` sem resultados runtime; backups pg_dump agendados conferidos

---

## Self-review (executado)

1. **Cobertura da spec**: arquitetura alvo (Task 3/4), dessacoplamento (Task 2), config Supabase/SMTP/OAuth (Tasks 4/6), replay + types (Task 5), deploy/backup (Tasks 3/4/6), validação com S1 (Task 6), pré-requisitos do usuário (Task 4 gated). ✓
2. **Passos**: cada passo = uma ação verificável; SQL/TS/infra com conteúdo exato onde o algoritmo não é óbvio. ✓
3. **Tipos/nomes consistentes**: `brokeredPreviewStorage()` mantém assinatura; `.output/server/index.mjs` em T2/T3; ordem de migrations idêntica na constraint, Task 5 e README (T3). ✓
4. **Review Focus**: itens 1/2/3 → Task 6 (Steps 1–2); item 4 → Task 5 (Steps 1–2); item 5 → Task 3 (Step 1) + Task 6. ✓
5. **Proporção**: plano ~proporcional à spec; código completo só onde determinado (login, nitro override, ordem SQL). ✓
