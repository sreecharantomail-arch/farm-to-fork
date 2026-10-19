-- Create notifications table
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  type text not null, -- 'product_status', 'expiry_alert', 'traceability_event', etc.
  title text not null,
  message text not null,
  is_read boolean not null default false,
  related_entity_type text, -- 'product', 'traceability_event'
  related_entity_id text,
  created_at timestamptz not null default now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON public.notifications (user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON public.notifications (is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON public.notifications (created_at desc);

-- Allow frontend access (though the backend currently bypasses RLS using service key, we add it for safety)
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
