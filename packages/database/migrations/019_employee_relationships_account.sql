-- 019_employee_relationships_account.sql
ALTER TABLE public.employee_relationships
  ADD COLUMN IF NOT EXISTS account_id uuid,
  ADD CONSTRAINT fk_emp_relationships_account FOREIGN KEY (tenant_id, account_id) REFERENCES public.accounts(tenant_id, id) ON DELETE CASCADE;

DROP POLICY IF EXISTS tenant_scope ON public.employee_relationships;
CREATE POLICY tenant_scope ON public.employee_relationships TO atlas_app
  USING (tenant_id = NULLIF(current_setting('atlas.tenant_id', true), '')::uuid
  AND (account_id = NULLIF(current_setting('atlas.account_id', true), '')::uuid OR NULLIF(current_setting('atlas.account_id', true), '') IS NULL))
  WITH CHECK (tenant_id = NULLIF(current_setting('atlas.tenant_id', true), '')::uuid
  AND (account_id = NULLIF(current_setting('atlas.account_id', true), '')::uuid OR NULLIF(current_setting('atlas.account_id', true), '') IS NULL));
