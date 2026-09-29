CREATE TYPE public.app_role AS ENUM ('admin','leader','member');
CREATE TYPE public.skill AS ENUM ('Slide','Telão','Câmera','Social','Foto');

CREATE OR REPLACE FUNCTION public.update_updated_at_column() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  skills public.skill[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'Ativo',
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  UNIQUE (user_id, role)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.sectors (
  name public.skill PRIMARY KEY,
  leader_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sectors TO authenticated;
GRANT ALL ON public.sectors TO service_role;
ALTER TABLE public.sectors ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  date_time timestamp NOT NULL,
  end_time text,
  description text NOT NULL DEFAULT '',
  category text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.events TO authenticated;
GRANT ALL ON public.events TO service_role;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  sector public.skill NOT NULL,
  role_label text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  swap_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.schedules TO authenticated;
GRANT ALL ON public.schedules TO service_role;
ALTER TABLE public.schedules ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.unavailability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  date date NOT NULL,
  UNIQUE (profile_id, date)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.unavailability TO authenticated;
GRANT ALL ON public.unavailability TO service_role;
ALTER TABLE public.unavailability ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message text NOT NULL,
  kind text NOT NULL DEFAULT 'system',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE OR REPLACE FUNCTION public.is_staff(_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role IN ('admin','leader'))
    OR EXISTS (SELECT 1 FROM public.sectors s JOIN public.profiles p ON p.id = s.leader_id WHERE p.user_id = _user_id)
$$;

CREATE OR REPLACE FUNCTION public.my_profile_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.profiles WHERE user_id = auth.uid()
$$;

-- Policies
CREATE POLICY "read profiles" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "staff insert profiles" ON public.profiles FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "staff or self update profiles" ON public.profiles FOR UPDATE TO authenticated USING (public.is_staff(auth.uid()) OR user_id = auth.uid()) WITH CHECK (public.is_staff(auth.uid()) OR user_id = auth.uid());
CREATE POLICY "admin delete profiles" ON public.profiles FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));

CREATE POLICY "read roles" ON public.user_roles FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin manage roles" ON public.user_roles FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE POLICY "read sectors" ON public.sectors FOR SELECT TO authenticated USING (true);
CREATE POLICY "staff update sectors" ON public.sectors FOR UPDATE TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE POLICY "read events" ON public.events FOR SELECT TO authenticated USING (true);
CREATE POLICY "staff write events" ON public.events FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE POLICY "read schedules" ON public.schedules FOR SELECT TO authenticated USING (true);
CREATE POLICY "staff write schedules" ON public.schedules FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "own schedule update" ON public.schedules FOR UPDATE TO authenticated USING (profile_id = public.my_profile_id()) WITH CHECK (profile_id = public.my_profile_id());

CREATE POLICY "read unavailability" ON public.unavailability FOR SELECT TO authenticated USING (true);
CREATE POLICY "own or staff unavailability" ON public.unavailability FOR ALL TO authenticated USING (profile_id = public.my_profile_id() OR public.is_staff(auth.uid())) WITH CHECK (profile_id = public.my_profile_id() OR public.is_staff(auth.uid()));

CREATE POLICY "read notifications" ON public.notifications FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert notifications" ON public.notifications FOR INSERT TO authenticated WITH CHECK (true);

-- New user trigger
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _skills public.skill[];
BEGIN
  BEGIN
    SELECT coalesce(array_agg(x::public.skill), '{}') INTO _skills
    FROM jsonb_array_elements_text(coalesce(NEW.raw_user_meta_data->'skills','[]'::jsonb)) x;
  EXCEPTION WHEN others THEN _skills := '{}';
  END;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE lower(email) = lower(NEW.email) AND user_id IS NULL) THEN
    UPDATE public.profiles SET user_id = NEW.id WHERE lower(email) = lower(NEW.email);
  ELSE
    INSERT INTO public.profiles (user_id, name, email, skills)
    VALUES (NEW.id, coalesce(NEW.raw_user_meta_data->>'name', NEW.raw_user_meta_data->>'full_name', split_part(NEW.email,'@',1)), NEW.email, _skills)
    ON CONFLICT (email) DO NOTHING;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin') THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'member');
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles, public.user_roles, public.sectors, public.events, public.schedules, public.unavailability, public.notifications;

-- Seed
INSERT INTO public.profiles (id, name, email, skills, status) VALUES
('00000000-0000-0000-0000-000000000002','Rafael Souza','rafael@syncmidia.app','{Câmera,Telão}','Ativo'),
('00000000-0000-0000-0000-000000000003','Beatriz Lima','beatriz@syncmidia.app','{Slide}','Ativo'),
('00000000-0000-0000-0000-000000000004','Diego Martins','diego@syncmidia.app','{Telão,Slide}','Ativo'),
('00000000-0000-0000-0000-000000000005','Carolina Reis','carolina@syncmidia.app','{Social,Foto}','Ativo'),
('00000000-0000-0000-0000-000000000006','Tiago Ferreira','tiago@syncmidia.app','{Câmera}','Indisponível'),
('00000000-0000-0000-0000-000000000007','Juliana Prado','juliana@syncmidia.app','{Câmera,Social}','Ativo'),
('00000000-0000-0000-0000-000000000008','Lucas Moreira','lucas@syncmidia.app','{Telão}','Ativo'),
('00000000-0000-0000-0000-000000000009','Paula Nogueira','paula@syncmidia.app','{Social,Slide}','Ativo'),
('00000000-0000-0000-0000-000000000010','Bruno Costa','bruno@syncmidia.app','{Foto,Câmera}','Ativo');

INSERT INTO public.sectors (name, leader_id) VALUES
('Slide','00000000-0000-0000-0000-000000000003'),('Telão',NULL),
('Câmera','00000000-0000-0000-0000-000000000002'),('Social','00000000-0000-0000-0000-000000000009'),
('Foto','00000000-0000-0000-0000-000000000010');

INSERT INTO public.events (id, title, date_time, end_time, description, category) VALUES
('10000000-0000-0000-0000-000000000001','Culto de Domingo','2026-10-04 10:00','12:00','Transmissão completa com 3 câmeras.','domingo'),
('10000000-0000-0000-0000-000000000002','Encontro de Jovens','2026-10-07 19:30','21:30','Formato compacto, foco em redes sociais.','semana'),
('10000000-0000-0000-0000-000000000003','Culto de Domingo','2026-10-11 10:00','12:00','Programação especial de louvor.','domingo'),
('10000000-0000-0000-0000-000000000004','Conferência Anual','2026-10-17 18:00','22:00','Evento especial com cobertura fotográfica.','especial');

INSERT INTO public.schedules (event_id, profile_id, sector, role_label, status) VALUES
('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','Slide','Slide Principal','confirmed'),
('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000008','Telão','Telão','pending'),
('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','Câmera','Câmera 1','confirmed'),
('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000007','Câmera','Câmera 2','swap_requested'),
('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000005','Social','Redes Sociais','pending'),
('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000010','Foto','Foto','confirmed'),
('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000009','Social','Redes Sociais','confirmed'),
('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000004','Slide','Slide Principal','pending'),
('10000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000007','Câmera','Câmera 1','pending');

INSERT INTO public.unavailability (profile_id, date) VALUES
('00000000-0000-0000-0000-000000000002','2026-10-11'),
('00000000-0000-0000-0000-000000000006','2026-10-04'),
('00000000-0000-0000-0000-000000000006','2026-10-11'),
('00000000-0000-0000-0000-000000000004','2026-10-04');

INSERT INTO public.notifications (message, kind) VALUES
('Rafael Souza confirmou presença em Culto de Domingo (04/10).','confirm'),
('Juliana Prado solicitou substituição para Câmera 2.','swap'),
('Bruno Costa foi nomeado líder do setor Foto.','leader');