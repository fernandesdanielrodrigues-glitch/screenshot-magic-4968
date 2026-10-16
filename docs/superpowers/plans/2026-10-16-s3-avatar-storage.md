# S3 — Storage de Avatares — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrar a foto de perfil de data URL para Supabase Storage self-hosted: bucket público `avatars` via migration (IaC), upload owner-based direto do cliente, `perfil.tsx` enviando Blob real + URL pública em `profiles.avatar_url`, limpeza das data URLs legadas.

**Architecture:** Migration única (bucket + 4 policies `storage.objects` + cleanup) → refator de `perfil.tsx` (canvas→Blob→upload→publicUrl→update) → validação local com RLS via SQL (SET ROLE + claims, fidelidade PostgREST) → revisão final → merge.

**Tech Stack:** Postgres/RLS (storage schema da stack), supabase-js storage API, React 19, canvas.

**Spec:** `docs/superpowers/specs/2026-10-13-s3-avatar-storage-design.md`

## Global Constraints

- Migration NUNCA edita aplicadas; arquivo novo `20261016100000_s3_avatar_storage.sql` (ordena como 11ª no replay).
- Bucket `avatars` público criado por SQL (idempotente, `ON CONFLICT DO NOTHING`); ZERO etapas manuais no Studio.
- RLS `storage.objects`: INSERT/UPDATE/DELETE exigem `bucket_id='avatars' AND owner = auth.uid() AND name LIKE auth.uid()::text || '/%'` (prefixo do dono obrigatório); SELECT authenticated higiênico.
- `perfil.tsx` mantém o redimensionamento canvas 256px/JPEG (troca `toDataURL` por `toBlob`); path `{authId}/{Date.now()}.jpg`; remove best-effort do objeto antigo (só quando a URL anterior aponta para o bucket `avatars`; falha NÃO bloquea o save).
- `avatar_url` guarda URL pública (`getPublicUrl`); migration zera `LIKE 'data:%'`.
- Commit local; push só ao final (autorizado no encerramento); copy/UX pt-BR inalterada.

## Review Focus

1. **Path de outro dono rejeitado** — INSERT com path de usuário B sob claims de A → RLS nega. → Task 3.
2. **Bucket alheio rejeitado** — INSERT em bucket ≠ avatars → nega. → Task 3.
3. **Prefixo obrigatório** — INSERT com path sem o prefixo do próprio auth id → nega. → Task 3.
4. **Limpeza** — data URL pré-existente vira NULL pós-migration. → Task 3.
5. **Contrato do cliente** — nenhum `toDataURL` restante; remove do objeto antigo só para URLs do bucket avatars; `authId` (S2) como chave. → Task 2 (grep) + Task 3.

---

### Task 1: Branch + migration do bucket/policies/limpeza

**Files:**
- Git: branch `s3-avatar-storage` a partir de `main`
- Create: `supabase/migrations/20261016100000_s3_avatar_storage.sql`

**Interfaces:**
- Produces: bucket `avatars` público + 4 policies em `storage.objects` + `profiles.avatar_url` sem data URLs — consumidos pela Task 2 (URL pública) e Task 3 (testes).

- [ ] **Step 1:** criar branch `s3-avatar-storage` (worktree `.worktrees/s3-avatar-storage` criado pelo controller no setup).
- [ ] **Step 2: escrever a migration** com o corpo exato da spec (seção 1):
  - `INSERT INTO storage.buckets (id, name, public) VALUES ('avatars','avatars',true) ON CONFLICT (id) DO NOTHING;`
  - 4 policies (read-authenticated; insert/update/delete own com `bucket_id + owner + prefixo`) — USING+CHECK nos de UPDATE
  - `UPDATE public.profiles SET avatar_url = NULL WHERE avatar_url LIKE 'data:%';`
- [ ] **Step 3: verificação estática** — policies com USING/CHECK completos; prefixo `auth.uid()::text || '/%'` nas 3 de escrita; cleanup por último; nada além do arquivo novo.
- [ ] **Step 4: commit** — `feat(db): public avatars bucket with owner-based RLS + legacy cleanup (S3)`.

### Task 2: `perfil.tsx` — Blob, upload, URL pública, remove do antigo

**Files:**
- Modify: `src/routes/perfil.tsx`
- Modify: `deploy/README.md` (uma linha: §4 lista vira 11 migrations; nota §5 da URL pública de avatar)

**Interfaces:**
- Consumes: bucket/policies (Task 1); `user.authId` (`AuthUser`, herdado da S2); `supabase.storage`.
- Produces: `saveAvatar(blob)` real; fluxo remover-foto real; zero `toDataURL`.

- [ ] **Step 1:** `resizeImage` retorna `Promise<Blob>` (`canvas.toBlob(resolve, "image/jpeg", 0.82)`) — mesmas dimensões/qualidade.
- [ ] **Step 2:** `saveAvatar`: path `${user.authId}/${Date.now()}.jpg`; `supabase.storage.from("avatars").upload(path, blob, { contentType: "image/jpeg" })`; em erro → toast + return; `getPublicUrl(path)` → `profiles.avatar_url`; depois do update, se a URL anterior casar com `"/storage/v1/object/public/avatars/"` → extrair o path e `remove()` best-effort (`.then(() => undefined)` sem bloquear/toast de erro); por fim `refresh()`.
- [ ] **Step 3:** remover foto: se URL anterior é do bucket → `remove()` best-effort; update `avatar_url = null`; `refresh()`.
- [ ] **Step 4:** README: §4 — item `11. supabase/migrations/20261016100000_s3_avatar_storage.sql (bucket avatars + RLS + limpeza)`; §5 — nota: avatar servido de `https://supabase.<dominio>/storage/v1/object/public/avatars/...` (storage-api, sem PostgREST).
- [ ] **Step 5: verificação** — `npx tsc --noEmit` 0 erros; `npx eslint src/routes/perfil.tsx --rule '{"prettier/prettier":"off"}'` sem novos; grep `toDataURL` em perfil.tsx → zero; grep `avatars` presente.
- [ ] **Step 6: commit** — `feat(ui): avatar upload to storage with public URL (S3)`.

### Task 3: Validação local (stack Docker — controller)

**Files:** nenhum (execução + evidências).

**Interfaces:**
- Consumes: Tasks 1–2; Docker local (stack v0.8.2 com db; storage RLS testável via SQL — o bucket/policies moram no Postgres).

- [ ] **Step 1:** subir db; garantir `supabase_realtime`; replay das **11** migrations (ordem: 10 anteriores + S3).
- [ ] **Step 2:** bucket: `select id, public from storage.buckets where id='avatars';` → `t`; policies listadas em `pg_policies` com as expressões exatas.
- [ ] **Step 3:** RLS (SET ROLE authenticated + `request.jwt.claim.sub` do usuário teste): INSERT próprio path → OK; path de outro auth id → ERRO de policy; bucket alheio → ERRO; DELETE próprio → OK; SELECT authenticated → OK.
- [ ] **Step 4:** limpeza: insert de profile com `avatar_url='data:image/jpeg;base64,xyz'` → aplicar já coberto pelo replay (a migration roda no replay) → conferir NULL.
- [ ] **Step 5:** saúde: `tsc`/eslint já cobertos na Task 2; evidências no relatório.

---

## Self-review (executado)

1. **Cobertura da spec**: bucket/policies/limpeza (T1), perfil+runbook (T2), RLS/limpeza/prefixo (T3) ✓
2. **Passos**: um resultado verificável por passo; SQL exato na spec (transcrição) ✓
3. **Nomes consistentes**: `avatars`, `{authId}/{ts}.jpg`, `/storage/v1/object/public/avatars/` idênticos em T1/T2/T3/README ✓
4. **Review Focus**: 1–3 → T3 Step 3; 4 → T3 Step 4; 5 → T2 Steps 5 ✓
5. **Proporção**: plano enxuto; código completo só onde determinístico ✓
