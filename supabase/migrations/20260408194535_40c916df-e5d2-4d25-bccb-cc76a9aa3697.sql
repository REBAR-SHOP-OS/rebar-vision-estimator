
CREATE TABLE public.orders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  order_number TEXT NOT NULL DEFAULT '',
  customer_name TEXT,
  customer_email TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  due_date DATE,
  total_weight_kg NUMERIC DEFAULT 0,
  total_price NUMERIC DEFAULT 0,
  price_per_ton NUMERIC DEFAULT 0,
  currency TEXT DEFAULT 'CAD',
  validation_status TEXT DEFAULT 'pending',
  pricing_status TEXT DEFAULT 'pending',
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own orders"
  ON public.orders FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_orders_updated_at
  BEFORE UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
