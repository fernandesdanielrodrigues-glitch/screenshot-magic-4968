# SyncMídia self-hosted — runbook do VPS

Pacote de deploy do SyncMídia (app TanStack Start SSR + Supabase self-hosted + Caddy),
para rodar tudo em um único VPS com Docker Compose — fora da plataforma de origem do
projeto. Este runbook cobre provisionamento, replay do banco, operação e atualizações.

## 1. Arquitetura

```
                    Internet
                        │
              ┌─────────▼─────────┐
              │  proxy (Caddy)    │  80/443 — único serviço público; TLS automático
              └───┬───────────┬───┘
        app.<dominio>   supabase.<dominio> (só rotas de API)
              │               │
      ┌───────▼──────┐  ┌─────▼──────────────────────────┐
      │ app:3000     │  │ api-gw:8000  (gateway Envoy)   │
      │ TanStack SSR │  │ auth/rest/realtime/storage/... │
      │ (node 22)    │  └─────┬──────────────────────────┘
      └──────────────┘  ┌─────▼─────┐
                        │ db (Postgres 17) + pooler │  sem porta pública
                        └───────────────────────────┘
```

- **Stack oficial do Supabase** — clone de `supabase/supabase`, pasta `docker/`,
  no tag fixado **`self-hosted/v0.8.2`** (2026-09-23), em `deploy/supabase/`.
- **`app`** — imagem construída do `Dockerfile` na raiz do repo (Nitro `node-server`,
  `node .output/server/index.mjs`); as variáveis `VITE_*` são **fixadas no build**.
- **`proxy`** — Caddy (`deploy/Caddyfile`): `app.<dominio>` → `app:3000`;
  `supabase.<dominio>` → `api-gw:8000` apenas para rotas de API (Studio → 403).
- Rede interna do Compose; as portas de host da stack Supabase ficam presas ao
  loopback (`127.0.0.1`) pelo `supabase/compose.ports.yml` (criado no §3.4).

Arquivos deste diretório:

| Arquivo | Papel |
|---|---|
| `docker-compose.yml` | composição (inclui a stack oficial + `app` + `proxy`) |
| `Caddyfile` | TLS automático e proxy dos dois domínios |
| `.env.example` | modelo de variáveis — copie para `.env` e preencha |
| `supabase/` | **criado no provisionamento** (§3.3–3.4); nunca versionado |

## 2. Pré-requisitos

- VPS **2 vCPU / 4 GB+** (a stack Supabase é pesada) com acesso root.
- Docker **Engine + plugin Compose v2.24 ou maior** (`docker compose version`).
  Compose mais antigo? Use a alternativa do §9.
- Um domínio próprio com controle de DNS (dois registros A — §3.7).
- Credenciais **SMTP** (host, porta, usuário, senha, remetente).
- Um **client OAuth Google** próprio no Google Cloud Console (§3.6).

## 3. Provisionamento

### 3.1 Instalar Docker (se necessário)

```bash
curl -fsSL https://get.docker.com | sh
docker compose version   # >= v2.24
```

### 3.2 Clonar o repositório do app

```bash
git clone <URL-DO-SEU-REPO> syncmidia && cd syncmidia/deploy
```

### 3.3 Clonar a stack Supabase no release fixado

A stack oficial vive em `supabase/supabase` (pasta `docker/`) e é publicada nos tags
`self-hosted/vX.Y.Z`. Este deploy fixa **`self-hosted/v0.8.2`**. Para atualizar depois,
escolha um tag novo, leia o `CHANGELOG.md` da pasta e repita o clone (§7).

```bash
git clone --depth 1 --branch self-hosted/v0.8.2 \
  https://github.com/supabase/supabase.git /tmp/supabase-src
mv /tmp/supabase-src/docker ./supabase
rm -rf /tmp/supabase-src
```

### 3.4 Criar `supabase/compose.ports.yml` (portas ao loopback)

Este arquivo é um override local da stack oficial. Ele substitui (`!override`) as
publicações de porta do gateway e do pooler para **127.0.0.1** — nada do Supabase fica
acessível da Internet; `psql`, `pg_dump` e o Studio passam por `docker exec` ou túnel SSH.

```bash
cat > supabase/compose.ports.yml <<'EOF'
# Override local (deploy/README.md §3.4): portas de host da stack no loopback.
services:
  api-gw:
    ports: !override
      - "127.0.0.1:${API_GW_HTTP_PORT:-8000}:8000"
  supavisor:
    ports: !override
      - "127.0.0.1:${POSTGRES_PORT}:5432"
      - "127.0.0.1:${POOLER_PROXY_PORT_TRANSACTION}:6543"
EOF
```

### 3.5 Gerar o `.env` e os segredos

```bash
cp .env.example .env
```

Edite o `.env` e preencha, **nesta ordem**:

1. **Domínios e URLs** — `APP_DOMAIN`, `SUPABASE_DOMAIN`, `VITE_SUPABASE_URL`,
   `SUPABASE_PUBLIC_URL`, `API_EXTERNAL_URL` (deve terminar em `/auth/v1`),
   `SITE_URL` — substitua `<dominio>` pelo seu domínio.
2. **Chaves da stack** — gere de dentro de `deploy/` (o utilitário edita o `./.env`
   local, que é exatamente o arquivo que o compose interpola):

   ```bash
   sh supabase/utils/generate-keys.sh --update-env   # JWT_SECRET, ANON_KEY, SERVICE_ROLE_KEY
   ```

   Preencha então `VITE_SUPABASE_PUBLISHABLE_KEY` com **o mesmo valor de `ANON_KEY`**.
3. **Outros segredos** (`openssl rand -hex N`, hex evita caracteres que quebram URLs):

   ```bash
   openssl rand -hex 24   # POSTGRES_PASSWORD, CRON_SECRET, DASHBOARD_PASSWORD
   openssl rand -base64 48  # SECRET_KEY_BASE
   openssl rand -hex 16    # VAULT_ENC_KEY (exatamente 32 chars), POOLER_TENANT_ID
   openssl rand -base64 24 # PG_META_CRYPTO_KEY
   openssl rand -hex 16    # S3_PROTOCOL_ACCESS_KEY_ID
   openssl rand -hex 32    # S3_PROTOCOL_ACCESS_KEY_SECRET
   ```

4. **SMTP (obrigatório)** — `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`,
   `SMTP_ADMIN_EMAIL`, `SMTP_SENDER_NAME`. **Sem SMTP o cadastro e o reset de senha
   não enviam e-mail** — valide antes do primeiro teste de cadastro (§6).
5. **Google OAuth** — §3.6 abaixo.
6. `CRON_SECRET` — segredo das rotas de cron do app. Para rotacionar no futuro,
   gere um novo, mova o antigo para `CRON_SECRET_PREVIOUS` e reinicie o `app`.

### 3.6 Google OAuth

1. No Google Cloud Console → *APIs e Serviços* → *Credenciais* → seu client OAuth:
   **Authorized redirect URIs** → adicionar exatamente
   `https://supabase.<dominio>/auth/v1/callback`
   (é `API_EXTERNAL_URL` + `/callback`; o valor de `GOOGLE_SECRET` vai no `.env`).
2. Habilitar o provedor no GoTrue — no clone, `supabase/docker-compose.yml`,
   serviço `auth`, **descomente as 4 linhas** do Google:

   ```yaml
   GOTRUE_EXTERNAL_GOOGLE_ENABLED: ${GOOGLE_ENABLED}
   GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID: ${GOOGLE_CLIENT_ID}
   GOTRUE_EXTERNAL_GOOGLE_SECRET: ${GOOGLE_SECRET}
   GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI: ${API_EXTERNAL_URL}/callback
   ```

   (ou `sed -i 's/^      # GOTRUE_EXTERNAL_GOOGLE_/      GOTRUE_EXTERNAL_GOOGLE_/' supabase/docker-compose.yml`)
3. No `.env`: descomente e preencha `GOOGLE_ENABLED=true`, `GOOGLE_CLIENT_ID`,
   `GOOGLE_SECRET`.

### 3.7 DNS

Crie os dois registros **A** apontando para o IP público do VPS e aguarde a propagação:

```
app.<dominio>      A     <IP-do-VPS>
supabase.<dominio> A     <IP-do-VPS>
```

O Caddy só emite certificado com o DNS já apontando para cá — configure antes do `up`.

### 3.8 Subir a stack

```bash
docker compose up -d
docker compose ps                 # todos os serviços healthy/up
docker compose logs proxy app     # sem erros; certificados sendo emitidos
```

Verificações (do próprio VPS ou da sua máquina):

```bash
curl -fsS https://supabase.<dominio>/auth/v1/health   # HTTP 200 com JSON do GoTrue
curl -fsSI https://app.<dominio>                      # HTTP 200/30x
```

Se `https://supabase.<dominio>/` responder **403, está certo** — o Studio nunca é
público (§3.9). O app pode mostrar erro de dados até o replay do banco (§4) — aceitável.

### 3.9 Túnel SSH para o Studio (e psql, se quiser)

```bash
ssh -L 8000:localhost:8000 usuario@<IP-do-VPS>
# no navegador local:
open http://localhost:8000          # usuário/senha = DASHBOARD_USERNAME / DASHBOARD_PASSWORD
```

Opcional, para `psql` local: `ssh -L 5432:localhost:5432 usuario@<IP-do-VPS>`.

## 4. Replay das migrations (banco novo, vazio)

**Ordem obrigatória** — a migration do publish atômico referencia `teams`/`event_teams`
criadas pelas migrations Drizzle. Nunca aplique por glob de timestamp:

```text
1. supabase/migrations/20260929100441_*.sql
2. supabase/migrations/20260930103622_*.sql
3. supabase/migrations/20261001084838_*.sql
4. drizzle/migrations/0000_calendar_token.sql
5. drizzle/migrations/0001_add_phone_to_profiles.sql
6. drizzle/migrations/0002_teams_model.sql
7. supabase/migrations/20261012120000_publish_schedule_atomic.sql  (SEMPRE por último — depende de teams/event_teams do Drizzle)
```

Execução (da raiz do repo no VPS, com a stack de pé; `ON_ERROR_STOP` aborta em erro):

```bash
cd /caminho/para/syncmidia   # raiz do repo (migrations ficam em supabase/ e drizzle/)

docker cp supabase/migrations/20260929100441_a20b14c4-19e5-4c15-b84c-76a5a8f89663.sql supabase-db:/tmp/001.sql
docker cp supabase/migrations/20260930103622_17ffd7bb-f090-417c-ad75-77603b84e400.sql supabase-db:/tmp/002.sql
docker cp supabase/migrations/20261001084838_b19cc302-c4ae-4321-933d-d12df4f6aebc.sql supabase-db:/tmp/003.sql
docker cp drizzle/migrations/0000_calendar_token.sql        supabase-db:/tmp/004.sql
docker cp drizzle/migrations/0001_add_phone_to_profiles.sql supabase-db:/tmp/005.sql
docker cp drizzle/migrations/0002_teams_model.sql           supabase-db:/tmp/006.sql
docker cp supabase/migrations/20261012120000_publish_schedule_atomic.sql supabase-db:/tmp/007.sql

for f in 001 002 003 004 005 006 007; do
  docker exec supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /tmp/$f.sql || break
done
```

Verificação (todas devem retornar `t` / `5`):

```bash
docker exec supabase-db psql -U postgres -d postgres <<'SQL'
select to_regclass('public.teams') is not null and to_regclass('public.event_teams') is not null;          -- t
select to_regproc('public.publish_schedule_atomic') is not null;                                           -- t
select to_regproc('public.handle_new_user') is not null and to_regproc('public.respond_invite') is not null; -- t
select count(*) from public.sectors;                                                                       -- 5 (seed)
SQL
```

### 4.1 Regenerar os types do Supabase

Da sua máquina (com o túnel do §3.9 ativo) ou do VPS, com a CLI do Supabase instalada:

```bash
supabase gen types typescript \
  --db-url "postgresql://postgres:<POSTGRES_PASSWORD>@localhost:5432/postgres" \
  --schema public > src/integrations/supabase/types.ts
```

Confirme que `publish_schedule_atomic` aparece em `Functions` no arquivo gerado.
Commit separado se o `types.ts` (ou o cast local em `store.tsx`) mudar.

## 5. Backups — pg_dump via cron no host

```bash
sudo mkdir -p /var/backups/syncmidia
sudo tee /etc/cron.d/syncmidia-backup >/dev/null <<'EOF'
# Backup diário do Postgres (03:00) + retenção de 14 dias
0 3 * * * root docker exec supabase-db pg_dump -U postgres -d postgres | gzip > /var/backups/syncmidia/db-$(date +\%F).sql.gz
30 3 * * * root find /var/backups/syncmidia -name 'db-*.sql.gz' -mtime +14 -delete
EOF
```

Teste manual: `docker exec supabase-db pg_dump -U postgres -d postgres | head -n 5`.
Restaure com `gunzip -c db-YYYY-MM-DD.sql.gz | docker exec -i supabase-db psql -U postgres -d postgres`.
Arquivos do Storage (avatares) vivem no volume `deploy/supabase/volumes/storage` —
inclua o diretório no snapshot do provedor do VPS.

## 6. Validação pós-replay (checklist)

1. **SMTP primeiro** — cadastre um usuário e confirme que o e-mail de confirmação checa
   com URL em `https://app.<dominio>` (o `SITE_URL` errado quebra os links).
2. Login e-mail+senha; login Google (redirect: `https://supabase.<dominio>/auth/v1/callback`).
3. Reset de senha por e-mail.
4. Realtime: duas abas, mutação em uma reflete na outra.
5. Feed público: `/confirmar/<token>` e `/api/public/agenda/<token>.ics` respondem.

## 7. Atualizar a stack Supabase

```bash
cd deploy
git -C supabase fetch --tags --depth 1 origin tag self-hosted/vX.Y.Z
git -C supabase checkout self-hosted/vX.Y.Z
# leia docker/CHANGELOG.md do novo tag e aplique ajustes de config indicados
docker compose pull && docker compose up -d
```

## 8. Atualizar o app

```bash
git pull && docker compose build app && docker compose up -d app
```

As `VITE_*` são fixadas em build-args a partir do `.env` — se `VITE_SUPABASE_URL` ou
`VITE_SUPABASE_PUBLISHABLE_KEY` mudarem, o rebuild acima já as incorpora.

## 9. Alternativa para Compose < 2.24 (multi-`-f`)

O `docker-compose.yml` usa `include` (Compose ≥ 2.20) + tags `!override` (≥ 2.24).
Em versões mais antigas:

1. **Portas ao loopback por sed** no clone (no lugar do `compose.ports.yml`):

   ```bash
   sed -i \
     -e 's|- ${API_GW_HTTP_PORT:-${KONG_HTTP_PORT:-8000}}:8000/tcp|- 127.0.0.1:${API_GW_HTTP_PORT:-8000}:8000/tcp|' \
     -e 's|- ${POSTGRES_PORT}:5432|- 127.0.0.1:${POSTGRES_PORT}:5432|' \
     -e 's|- ${POOLER_PROXY_PORT_TRANSACTION}:6543|- 127.0.0.1:${POOLER_PROXY_PORT_TRANSACTION}:6543|' \
     supabase/docker-compose.yml
   ```

2. **Salve o conteúdo abaixo como `deploy/docker-compose.legacy.yml`** (o
   `docker-compose.yml` do repo fica fora da linha de comando no modo legacy;
   caminhos relativos resolvem contra `deploy/supabase/`, pois no merge
   multi-`-f` os caminhos resolvem contra a pasta do **primeiro** arquivo):

   ```yaml
   services:
     app:
       build:
         context: ../..
         dockerfile: Dockerfile
         args:
           VITE_SUPABASE_URL: ${VITE_SUPABASE_URL:?defina VITE_SUPABASE_URL em .env}
           VITE_SUPABASE_PUBLISHABLE_KEY: ${VITE_SUPABASE_PUBLISHABLE_KEY:?defina VITE_SUPABASE_PUBLISHABLE_KEY em .env}
           VITE_NOTIFY_WEBHOOK_URL: ${VITE_NOTIFY_WEBHOOK_URL:-}
       restart: unless-stopped
       environment:
         PORT: "3000"
         HOST: "0.0.0.0"
         SUPABASE_URL: ${VITE_SUPABASE_URL}
         SUPABASE_PUBLISHABLE_KEY: ${VITE_SUPABASE_PUBLISHABLE_KEY}
         SUPABASE_SERVICE_ROLE_KEY: ${SERVICE_ROLE_KEY:?defina SERVICE_ROLE_KEY em .env}
         CRON_SECRET: ${CRON_SECRET:?defina CRON_SECRET em .env}
         CRON_SECRET_PREVIOUS: ${CRON_SECRET_PREVIOUS:-}

     proxy:
       image: caddy:2
       restart: unless-stopped
       depends_on:
         - app
       ports:
         - "80:80"
         - "443:443"
         - "443:443/udp"
       environment:
         APP_DOMAIN: ${APP_DOMAIN:?defina APP_DOMAIN em .env}
         SUPABASE_DOMAIN: ${SUPABASE_DOMAIN:?defina SUPABASE_DOMAIN em .env}
       volumes:
         - ../Caddyfile:/etc/caddy/Caddyfile:ro
         - caddy_data:/data
         - caddy_config:/config

   volumes:
     caddy_data:
     caddy_config:
   ```

3. **Invoque sempre** (de `deploy/`) com o trio `--env-file` + `-f`:

   ```bash
   docker compose --env-file .env -f supabase/docker-compose.yml -f docker-compose.legacy.yml up -d
   docker compose --env-file .env -f supabase/docker-compose.yml -f docker-compose.legacy.yml build app
   ```

## 10. Referência rápida de variáveis

Fonte completa: `.env.example` (cada chave comentada). As críticas:

| Variável | Por quê |
|---|---|
| `APP_DOMAIN` / `SUPABASE_DOMAIN` | Caddyfile — os dois hosts com TLS |
| `VITE_SUPABASE_URL` | URL pública da API; fixada no build do app |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | chave anon (= `ANON_KEY`); fixada no build |
| `SUPABASE_PUBLIC_URL` | URL pública da API (sem caminho) |
| `API_EXTERNAL_URL` | base do Auth; **deve terminar em `/auth/v1`** |
| `SITE_URL` | origem do app; links dos e-mails apontam para cá |
| `SERVICE_ROLE_KEY` | usada server-side pelo app (feed ICS, admin) |
| `CRON_SECRET` (+ `_PREVIOUS`) | auth das rotas de cron do app |
| `POSTGRES_PORT` | **não altere** (portas internas dependem); presa ao loopback |
| `DASHBOARD_USERNAME/PASSWORD` | basic auth do Studio via túnel |

## 11. Problemas comuns

- **Certificado não emite** — DNS ainda não propagado ou portas 80/443 bloqueadas;
  veja `docker compose logs proxy`.
- **`403` em `supabase.<dominio>/`** — comportamento esperado (Studio só via túnel §3.9).
- **Cadastro não envia e-mail** — SMTP ausente/errado; `docker compose logs auth`.
- **`502` no app logo após `up`** — gateway/Postgres ainda subindo; aguarde e
  verifique `docker compose ps`.
- **`VITE_SUPABASE_URL` errada no build** — o app chama a URL antiga; confira o `.env`
  e rode `docker compose build app` de novo (§8).

## 12. Higiene do repositório

Arquivos **locais** (nunca versionar): `deploy/.env`, `deploy/supabase/`,
`deploy/docker-compose.legacy.yml` (§9). Recomenda-se adicioná-los ao `.gitignore`
do repo no primeiro provisionamento.
