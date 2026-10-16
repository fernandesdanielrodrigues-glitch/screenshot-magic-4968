# S3 — Storage de Avatares — Design

- **Data:** 2026-10-16 (spec nomeada conforme instrução do parceiro: `2026-10-13-s3-avatar-storage-design.md`)
- **Status:** Aguardando revisão
- **Ciclo:** S3 de 4 (S1 ✅ · Self-Hosted ✅ · S2 ✅ · **S3** → S4 limpeza de legados)

## Problema

`profiles.avatar_url` guarda **data URLs Base64** (perfil redimensiona para 256px e salva a string inteira na coluna). Consequências: o payload de toda query de `profiles` carrega as fotos (10 voluntários × ~30KB), sem cache HTTP, sem CDN, e o banco armazena blobs — antipattern que o roadmap marcou para resolver desde a decomposição.

## Objetivo

Migrar a foto de perfil para o **Supabase Storage self-hosted**: bucket público `avatars` criado por migration (IaC, zero cliques no Studio), upload **owner-based** direto do cliente (RLS em `storage.objects`), `perfil.tsx` enviando blob real e gravando a **URL pública** em `avatar_url`, e limpeza das data URLs legadas.

## Decisões registradas

| Decisão | Escolha |
|---|---|
| Abordagem | **A1**: upload direto do cliente autenticado com RLS owner-based (aprovada pelo parceiro) |
| Bucket | `avatars`, **público**, criado via `insert into storage.buckets` em migration (idempotente) |
| Path | `{auth_id}/{timestamp}.jpg` — prefixo obrigatório pelo auth id do dono (bloqueia sobrescrever arquivo de terceiro mesmo com RLS ativo) |
| UX | Redimensionamento canvas 256px/JPEG **mantido** (tráfego/disco otimizados, experiência inalterada) |
| Limpeza | Migration zera `avatar_url LIKE 'data:%'` (fresh start: só sobrevive URL real) |
| Velho avatar | `remove()` best-effort do objeto anterior no upload novo (falha não bloquea o save) |

## Arquitetura

```
perfil.tsx (canvas 256px → Blob JPEG)
  └─ supabase.storage.from('avatars').upload(`${authId}/${Date.now()}.jpg`, blob)
       └─ RLS storage.objects: INSERT/UPDATE/DELETE só owner (auth.uid() + prefixo) 
  └─ getPublicUrl() → UPDATE profiles.avatar_url = URL pública
  └─ remove() do objeto antigo (best-effort)
GET https://supabase.<dominio>/storage/v1/object/public/avatars/{auth_id}/{ts}.jpg  (bucket público)
```

## 1. Migration — `supabase/migrations/20261016100000_s3_avatar_storage.sql`

```sql
-- S3: bucket público de avatares + RLS owner-based + limpeza de data URLs

INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "avatars read authenticated" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'avatars');
CREATE POLICY "avatars insert own" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatars' AND owner = auth.uid() AND name LIKE auth.uid()::text || '/%');
CREATE POLICY "avatars update own" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'avatars' AND owner = auth.uid() AND name LIKE auth.uid()::text || '/%')
  WITH CHECK (bucket_id = 'avatars' AND owner = auth.uid() AND name LIKE auth.uid()::text || '/%');
CREATE POLICY "avatars delete own" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'avatars' AND owner = auth.uid() AND name LIKE auth.uid()::text || '/%');

-- Limpeza de legado: data URLs não sobrevivem
UPDATE public.profiles SET avatar_url = NULL WHERE avatar_url LIKE 'data:%';
```

Notas: bucket público dispensa policy SELECT para o endpoint público (`/object/public/`) — a policy de leitura authenticated é higiene para acesso via API autenticada; o storage schema existe no self-hosted (init da stack); `owner` é o auth uid do uploader.

## 2. Cliente — `src/routes/perfil.tsx`

- `resizeImage` passa a retornar **`Blob`** (`canvas.toBlob`, JPEG 0.82, 256px) em vez de data URL
- `saveAvatar(blob)`: path `${user.authId}/${Date.now()}.jpg`; `upload` (content-type `image/jpeg`); `getPublicUrl` → update `profiles.avatar_url`; **remove o objeto antigo** quando a URL anterior apontar para o bucket `avatars` (regex do path; data URL/externa → só sobrescreve o campo); falha do remove não bloquea
- Remover foto: `remove()` do objeto (se storage URL) + `avatar_url = null`
- `AuthUser.authId` (herdado da S2) é a chave do path — mesma identidade do `owner` do RLS

## 3. Runbook

- Nenhuma etapa manual: **a migration cria o bucket e as policies** no replay (§4 ganha a migration como item 11)
- Nota no §5: URL pública de avatar = `https://supabase.<dominio>/storage/v1/object/public/avatars/...` (servida pelo storage-api/imgproxy da stack, sem passagem pelo PostgREST)

## Validação (stack local, mesma disciplina S1/S2)

1. **Migration**: replay (11 migrations agora) → `storage.buckets` contém `avatars` público; policies existem com os USING/CHECK exatos
2. **RLS via SQL (fidelidade PostgREST)**: com `request.jwt.claim.sub` + `SET ROLE authenticated`: INSERT em `storage.objects` com path próprio → OK; com path de OUTRO usuário → **rejeitado**; INSERT em bucket alheio → rejeitado; DELETE do próprio → OK
3. **Limpeza**: perfil com data URL → `avatar_url` NULL pós-migration
4. **Cliente**: `tsc --noEmit` 0 erros; eslint sem novos; grep: nenhum `toDataURL` restante em perfil.tsx
5. **E2E (usuário no VPS)**: upload real via UI, avatar visível no perfil/sino, troca de foto remove o objeto antigo

## Riscos

- `canvas.toBlob` assíncrono (Promise) — refactor pequeno e testado por tsc/runtime
- Storage self-hosted local: os bind-mounts de arquivo (quirk Docker Desktop Windows) NÃO afetam o bucket (dado em volume, não file-mount); o storage-api usa `GLOBAL_S3_BUCKET=stub` local por padrão — a validação SQL cobre policies; o E2E de upload real é no VPS
- Objetos órfãos se o remove best-effort falhar — aceitável (higiene futura: gc de avatares no S4+)

## Fora de escopo

- Upload de foto pela UI de gestão de equipe (admin editando membro), avatar de perfis sem vínculo de conta, gc de objetos órfãos, compressão server-side
