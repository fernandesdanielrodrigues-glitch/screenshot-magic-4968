CREATE TABLE public.teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text NOT NULL DEFAULT '',
  color text NOT NULL DEFAULT '#2BB6A3',
  leader_id uuid UNIQUE REFERENCES public.profiles(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'inactive' CHECK (status IN ('active','inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.team_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  user_id uuid NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  sector public.skill NOT NULL,
  UNIQUE (team_id, sector)
);
CREATE TABLE public.event_teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL UNIQUE REFERENCES public.events(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  assigned_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.schedules ADD COLUMN team_id uuid REFERENCES public.teams(id) ON DELETE SET NULL;
ALTER TABLE public.schedules ADD COLUMN adjusted boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.sectors.leader_id IS 'DEPRECATED: leadership now lives in teams.leader_id';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.teams, public.team_members, public.event_teams TO authenticated;
GRANT ALL ON public.teams, public.team_members, public.event_teams TO service_role;
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_teams ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_staff(_user_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role IN ('admin','leader'))
$$;

CREATE POLICY "read teams" ON public.teams FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin write teams" ON public.teams FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "read team_members" ON public.team_members FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin write team_members" ON public.team_members FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "read event_teams" ON public.event_teams FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin write event_teams" ON public.event_teams FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TRIGGER teams_updated BEFORE UPDATE ON public.teams FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.sync_team_leader_role()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _old uuid; _new uuid;
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') AND OLD.leader_id IS NOT NULL THEN
    SELECT user_id INTO _old FROM profiles WHERE id = OLD.leader_id;
    IF _old IS NOT NULL AND NOT EXISTS (SELECT 1 FROM teams WHERE leader_id = OLD.leader_id AND id <> OLD.id) THEN
      DELETE FROM user_roles WHERE user_id = _old AND role = 'leader';
      IF NOT EXISTS (SELECT 1 FROM user_roles WHERE user_id = _old) THEN
        INSERT INTO user_roles (user_id, role) VALUES (_old, 'member');
      END IF;
    END IF;
  END IF;
  IF TG_OP IN ('INSERT','UPDATE') AND NEW.leader_id IS NOT NULL THEN
    SELECT user_id INTO _new FROM profiles WHERE id = NEW.leader_id;
    IF _new IS NOT NULL AND NOT EXISTS (SELECT 1 FROM user_roles WHERE user_id = _new AND role IN ('admin','leader')) THEN
      DELETE FROM user_roles WHERE user_id = _new AND role = 'member';
      INSERT INTO user_roles (user_id, role) VALUES (_new, 'leader');
    END IF;
  END IF;
  RETURN NULL;
END $$;
REVOKE EXECUTE ON FUNCTION public.sync_team_leader_role() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER teams_leader_role AFTER INSERT OR UPDATE OF leader_id OR DELETE ON public.teams FOR EACH ROW EXECUTE FUNCTION public.sync_team_leader_role();

ALTER PUBLICATION supabase_realtime ADD TABLE public.teams, public.team_members, public.event_teams;