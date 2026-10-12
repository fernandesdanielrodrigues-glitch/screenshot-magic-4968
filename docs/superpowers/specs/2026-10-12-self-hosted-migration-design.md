# Migração Supabase Cloud (Lovable) → Self-Hosted — Design

- **Data:** 2026-10-12
- **Status:** Aguardando revisão
- **Ciclo:** trabalho independente da S1 (que deve ser mergeada na `main` antes desta)

## Problema e objetivo

O SyncMídia depende por completo do Lovable: backend no Lovable Cloud (Supabase gerenciado), OAuth Google via `@lovable.dev/cloud-auth-js`, reporte de erros ao editor, config de build do Lovable e deploy no hosting do Lovable. O objetivo é **sair do Lovable por completo**: Supabase self-hosted (Docker) + aplicação hospedada na própria infra (VPS), mantendo o app com comportamento idêntico.

## Decisões registradas (perguntas desta sessão)

| Decisão | Escolha |
|---|---|
| Escopo | **Tudo**: Supabase + app, saída total do Lovable |
| Infraestrutura | **VPS com Docker Compose** (stack oficial `supabase/docker`) |
| Dados | **Banco começa vazio** — só replay das migrations do repo; **sem dump** do Lovable Cloud (decisão revista: dump descartado) |
| Abordagem | **Tudo-em-um no VPS** (compose único: Supabase + app + Caddy) |
| TLS | Obrigatório, via Caddy; `http://ip:8000` rejeitado |
| Studio | Acesso **só via túnel SSH** — nunca público |

## Arquitetura alvo (VPS)

Um `docker-compose.yml` com três grupos:

1. **Stack oficial do Supabase** (release fixada de `supabase/docker`): postgres, gotrue (auth), postgrest, realtime, storage-api, imgproxy, kong, studio, meta
2. **Container do app**: TanStack Start compilado com Nitro preset `node-server`, Dockerfile multi-stage (build → runtime `node:22-slim` executando `.output/server/index.mjs`)
3. **Caddy**: único serviço expondo 80/443; TLS automático; proxy para o app e para o Kong

Domínios (2 registros DNS no VPS):
- `app.<dominio>` → app (UI + SSR + `/api/public/agenda/$token`)
- `supabase.<dominio>` → Kong (API: REST, auth, realtime websocket, storage)

Rede interna Docker; Postgres sem porta pública (bind localhost para admin/psql); Studio ligado apenas em localhost (túnel `ssh -L 3000:localhost:3000 vps`). Volumes nomeados para dados do Postgres e do Storage.

**Pré-requisitos do usuário** (fornecidos por você, placeholders no plano): VPS 2 vCPU/4GB+ com Docker+Compose; domínio com os 2 registros DNS; credenciais SMTP (host/porta/usuário/senha); credenciais Google OAuth próprias do GCP (o client atual pode pertencer ao Lovable).

## Mudanças de código — dessacoplar do Lovable

Branch `self-host` criada **a partir da `main` com a S1 já mergeada** (a migration da RPC entra no replay do banco novo).

| Arquivo | Mudança |
|---|---|
| `src/routes/login.tsx` | `lovable.auth.signInWithOAuth("google", …)` → `supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin } })` |
| `src/integrations/lovable/` + `@lovable.dev/cloud-auth-js` | Remover arquivo e dependência |
| `src/lib/lovable-error-reporting.ts` + uso em `__root.tsx` | Remover (erros seguem no console) |
| `src/integrations/supabase/previewAuthStorage.ts` | Substituir por `localStorage` puro (o broker só era ativo em domínios Lovable) |
| `vite.config.ts` | Manter `@lovable.dev/vite-tanstack-config` (funciona standalone) e trocar o preset do Nitro para `node-server`. **Fallback documentado**: se o pacote não aceitar override do preset, reescrever a config Vite explícita (tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro node, alias @, VITE env) |
| `AGENTS.md` | Remover o bloco LOVABLE (fim do sync com o editor) |
| `.env` | `VITE_SUPABASE_URL=https://supabase.<dominio>`, `VITE_SUPABASE_PUBLISHABLE_KEY=<anon nova>`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY=<service nova>` (client.server.ts já consome) |
| `src/integrations/supabase/types.ts` | Regenerar via `supabase gen types typescript` contra a instância nova **após** o replay; limpeza opcional do cast local da S1 em `store.tsx` |

## Configuração do Supabase self-hosted

`.env` do compose (fora do git): `POSTGRES_PASSWORD` forte; `JWT_SECRET` novo; `ANON_KEY`/`SERVICE_ROLE_KEY` assinadas com o `JWT_SECRET` (utilitário do próprio repo supabase/docker); `API_EXTERNAL_URL=https://supabase.<dominio>`; `SITE_URL=https://app.<dominio>`; `ENABLE_SIGNUP=true`.

- **SMTP no GoTrue (obrigatório)**: sem isso confirmação de cadastro e reset de senha não enviam. Host/porta/usuário/senha do provedor escolhido por você + e-mail remetente.
- **Google OAuth no GoTrue**: client id/secret do seu GCP, redirect `https://supabase.<dominio>/auth/v1/callback`.
- **Realtime**: as migrations do repo já fazem `ALTER PUBLICATION supabase_realtime` para as 10 tabelas — sai funcionando com a stack.

## Banco — fresh start (ordem de replay)

Contra o Postgres novo (via `psql` ou Supabase CLI `db push`):

1. `supabase/migrations/` — 4 arquivos em ordem de timestamp (inclui `20261012120000_publish_schedule_atomic.sql` da S1)
2. `drizzle/migrations/` — 3 arquivos (`0000_calendar_token`, `0001_add_phone_to_profiles`, `0002_teams_model`)
3. Regenerar `src/integrations/supabase/types.ts`

Seed de demonstração já vem embutido na migration 1. **Nenhum dado real migra** (decisão: sem dump).

## Deploy e operação

- Compose do VPS versionado neste repo (`deploy/`): `docker-compose.yml` + `Caddyfile` + `.env.example` documentado
- Build/atualização do app: `git pull && docker compose build app && docker compose up -d app` (VITE_* fixados em build-args)
- Backups: `pg_dump` agendado (cron no host) do container do Postgres para arquivo local + snapshot do provedor; secrets apenas no `.env` do VPS

## Validação (paridade com o app atual)

1. Cadastro com confirmação por e-mail (SMTP novo); login e-mail+senha; login Google; reset de senha
2. Trigger `handle_new_user`: 1º signup vira admin; signup com e-mail pré-cadastrado vincula ao perfil
3. Realtime: 2 abas, mutação numa reflete na outra
4. RLS real: membro não publica ("Testar como" continua só-UI)
5. Confirmação por token: link público `/confirmar/$token` (`get_invite`/`respond_invite`)
6. Feed ICS `/api/public/agenda/<token>.ics` (service role server-side)
7. **Scripts da S1 (4a/4b/4c + publicação com equipe + `assigned_by`) executados nesta instância** — fecha a Task 3 pendente da S1
8. `tsc --noEmit` limpo; zero chamadas de rede a `lovable.dev` (auditar com grep)

## Riscos

- Preset do Nitro via pacote Lovable pode não aceitar override → fallback de config explícita (maior, mas conhecido)
- Credenciais Google atuais podem pertencer ao Lovable → criar client GCP próprio
- Entrega de e-mail depende do provedor SMTP escolhido (reputação do domínio/IP)
- Stack Supabase self-hosted é pesada; VPS pequeno sofre (mínimo 4GB)

## Fora de escopo

- S2 (notificações/lembretes server-side), S3 (Storage de avatares — agora sobre o Storage self-hosted), S4 (limpeza de legado): sub-projetos futuros, desenhados contra a instância nova
- Migração de dados reais do Cloud (descartada nesta decisão; rota de dump permanece documentada como opção futura)
