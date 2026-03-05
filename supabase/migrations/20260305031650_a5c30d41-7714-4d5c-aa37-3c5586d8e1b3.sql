
CREATE TABLE public.crm_deals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  crm_deal_id text NOT NULL,
  deal_name text,
  deal_value numeric,
  stage text,
  status text,
  close_date date,
  company_name text,
  synced_at timestamptz DEFAULT now(),
  metadata jsonb DEFAULT '{}',
  UNIQUE(user_id, crm_deal_id)
);

ALTER TABLE public.crm_deals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own deals" ON public.crm_deals
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own deals" ON public.crm_deals
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own deals" ON public.crm_deals
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.estimate_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  crm_deal_id text,
  quoted_weight_kg numeric,
  quoted_price numeric,
  actual_weight_kg numeric,
  actual_cost numeric,
  award_status text DEFAULT 'pending',
  change_orders_total numeric DEFAULT 0,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, project_id)
);

ALTER TABLE public.estimate_outcomes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own outcomes" ON public.estimate_outcomes
  FOR ALL TO authenticated USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
