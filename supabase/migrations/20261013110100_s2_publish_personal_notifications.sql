-- S2: notificação pessoal atômica dentro do RPC de publicação.
-- Mesmo corpo do fix 20261013090000 (temp table _old_schedules, mesmas travas e
-- validações), acrescentando — após o INSERT das escalas e antes do RETURN —
-- INSERT em notifications (kind 'assignment') para perfis vinculados a auth.users.
-- Assinatura/retorno inalterados; tudo na mesma transação da função.

CREATE OR REPLACE FUNCTION public.publish_schedule_atomic(
  p_event_id uuid,
  p_team_id uuid,
  p_notify boolean,
  p_schedules jsonb
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
  v_uid uuid := auth.uid();
BEGIN
  -- Trava de permissão: SECURITY DEFINER bypassa RLS
  IF v_uid IS NULL OR NOT public.is_staff(v_uid) THEN
    RAISE EXCEPTION 'permission denied: only staff can publish schedules'
      USING ERRCODE = '42501';
  END IF;

  -- Validações
  IF NOT EXISTS (SELECT 1 FROM public.events WHERE id = p_event_id) THEN
    RAISE EXCEPTION 'event % not found', p_event_id;
  END IF;
  IF p_team_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.teams WHERE id = p_team_id) THEN
    RAISE EXCEPTION 'team % not found', p_team_id;
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_schedules) x
    GROUP BY x->>'profile_id', x->>'sector'
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate profile_id+sector in payload';
  END IF;

  -- event_teams na mesma transação
  DELETE FROM public.event_teams WHERE event_id = p_event_id;
  IF p_team_id IS NOT NULL THEN
    INSERT INTO public.event_teams (event_id, team_id, assigned_by)
    VALUES (p_event_id, p_team_id, v_uid);
  END IF;

  -- Estado antigo capturado ANTES do delete (statement próprio, mesmo snapshot anterior)
  DROP TABLE IF EXISTS _old_schedules;
  CREATE TEMP TABLE _old_schedules ON COMMIT DROP AS
    SELECT DISTINCT ON (profile_id, sector)
           profile_id, sector, status, notified_at, confirmation_token
    FROM public.schedules
    WHERE event_id = p_event_id
    ORDER BY profile_id, sector, created_at DESC;

  DELETE FROM public.schedules WHERE event_id = p_event_id;

  WITH i AS (
    INSERT INTO public.schedules
      (event_id, profile_id, sector, role_label, status, notified_at, team_id, adjusted, confirmation_token)
    SELECT
      p_event_id,
      (x->>'profile_id')::uuid,
      (x->>'sector')::public.skill,
      coalesce(nullif(trim(x->>'role_label'), ''), x->>'sector'),
      CASE WHEN p_notify THEN 'pending' ELSE coalesce(o.status, 'pending') END,
      CASE WHEN p_notify THEN now() ELSE o.notified_at END,
      p_team_id,
      coalesce((x->>'adjusted')::boolean, false),
      coalesce(o.confirmation_token, gen_random_uuid())
    FROM jsonb_array_elements(p_schedules) AS x
    LEFT JOIN _old_schedules o
      ON o.profile_id = (x->>'profile_id')::uuid
     AND o.sector = (x->>'sector')::public.skill
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM i;

  -- Notificações pessoais (apenas perfis vinculados a auth.users)
  INSERT INTO public.notifications (user_id, message, kind)
  SELECT
    p.user_id,
    'Você foi escalado para ' || coalesce(nullif(trim(x->>'role_label'), ''), x->>'sector')
      || ' no evento ' || e.title || ' em ' || to_char(e.date_time, 'DD/MM/YYYY HH24:MI') || '.',
    'assignment'
  FROM jsonb_array_elements(p_schedules) x
  JOIN public.profiles p ON p.id = (x->>'profile_id')::uuid
  JOIN public.events e ON e.id = p_event_id
  WHERE p.user_id IS NOT NULL;

  RETURN v_count;
END;
$$;
