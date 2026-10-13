-- Correção: republish com token preservado violava schedules_confirmation_token_key.
-- Causa: no wCTE único, o DELETE e o re-INSERT da mesma chave no mesmo statement
-- conflitam (o efeito do delete não precede a checagem de unicidade do insert).
-- Fix: captura do estado antigo em temp table (statement próprio), DELETE, INSERT —
-- tudo na mesma transação da função (atomicidade de transação preservada).

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

  RETURN v_count;
END;
$$;
