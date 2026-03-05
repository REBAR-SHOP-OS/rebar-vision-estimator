CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  recipient_email text NOT NULL,
  recipient_name text,
  notification_type text NOT NULL,
  channel text NOT NULL DEFAULT 'email',
  subject text,
  body text,
  status text DEFAULT 'pending',
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON public.notifications FOR ALL USING (true);