-- S2: notificações pessoais (destinatário + lida) e log idempotente de lembretes

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS read_at timestamptz;

DROP POLICY IF EXISTS "read notifications" ON public.notifications;
DROP POLICY IF EXISTS "insert notifications" ON public.notifications;
CREATE POLICY "read notifications hybrid" ON public.notifications FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR (user_id IS NULL AND public.is_staff(auth.uid())));
CREATE POLICY "insert notifications" ON public.notifications FOR INSERT TO authenticated
  WITH CHECK (user_id IS NULL OR user_id = auth.uid());
CREATE POLICY "update own notifications" ON public.notifications FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

GRANT UPDATE ON public.notifications TO authenticated;

CREATE TABLE public.reminder_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES public.schedules(id) ON DELETE CASCADE,
  window text NOT NULL CHECK (window IN ('24h','2h')),
  channel text NOT NULL CHECK (channel IN ('whatsapp','email')),
  status text NOT NULL CHECK (status IN ('sent','simulated','failed','skipped')),
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (schedule_id, window, channel)
);
ALTER TABLE public.reminder_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read reminder_log" ON public.reminder_log FOR SELECT TO authenticated USING (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reminder_log TO service_role;
GRANT SELECT ON public.reminder_log TO authenticated;
