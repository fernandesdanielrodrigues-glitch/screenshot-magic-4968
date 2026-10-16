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
