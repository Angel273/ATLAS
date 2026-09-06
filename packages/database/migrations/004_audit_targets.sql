ALTER TABLE public.audit_events ADD COLUMN target_id uuid;
ALTER TABLE public.audit_events ADD COLUMN previous_role varchar(40);
ALTER TABLE public.audit_events ADD COLUMN new_role varchar(40);
