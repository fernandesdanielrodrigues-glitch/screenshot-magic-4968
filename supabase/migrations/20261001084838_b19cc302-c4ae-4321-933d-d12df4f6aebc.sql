ALTER TABLE public.schedules ADD COLUMN IF NOT EXISTS confirmation_token uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.schedules ADD COLUMN IF NOT EXISTS notified_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS schedules_confirmation_token_key ON public.schedules(confirmation_token);

CREATE OR REPLACE FUNCTION public.get_invite(_token uuid)
RETURNS TABLE(member_name text, event_title text, event_date timestamp, sector text, role_label text, leader_name text, status text, swap_reason text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.name, e.title, e.date_time, s.sector::text, s.role_label, lp.name, s.status, s.swap_reason
  FROM schedules s
  JOIN profiles p ON p.id = s.profile_id
  JOIN events e ON e.id = s.event_id
  LEFT JOIN sectors sc ON sc.name = s.sector
  LEFT JOIN profiles lp ON lp.id = sc.leader_id
  WHERE s.confirmation_token = _token
$$;

CREATE OR REPLACE FUNCTION public.respond_invite(_token uuid, _action text, _reason text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid;
BEGIN
  SELECT id INTO _id FROM schedules WHERE confirmation_token = _token;
  IF _id IS NULL THEN RAISE EXCEPTION 'invalid token'; END IF;
  IF _action = 'accept' THEN
    UPDATE schedules SET status = 'confirmed', swap_reason = NULL WHERE id = _id;
  ELSIF _action = 'swap' THEN
    IF coalesce(length(trim(_reason)),0) = 0 THEN RAISE EXCEPTION 'reason required'; END IF;
    UPDATE schedules SET status = 'swap_requested', swap_reason = left(trim(_reason), 500) WHERE id = _id;
  ELSE RAISE EXCEPTION 'invalid action'; END IF;
  RETURN 'ok';
END $$;

GRANT EXECUTE ON FUNCTION public.get_invite(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.respond_invite(uuid, text, text) TO anon, authenticated;