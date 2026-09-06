ALTER TABLE public.accounts ADD COLUMN creation_key uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.accounts ADD CONSTRAINT accounts_tenant_creation_key UNIQUE (tenant_id, creation_key);
