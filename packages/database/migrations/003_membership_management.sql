-- The approved role matrix is canonical in @atlas/contracts. Arbitrary grants are removed.
ALTER TABLE identity.memberships DROP COLUMN capabilities;
DROP POLICY membership_identity ON identity.memberships;
CREATE POLICY membership_identity ON identity.memberships FOR SELECT TO atlas_auth
  USING (user_id = NULLIF(current_setting('atlas.user_id', true), '')::uuid);
CREATE POLICY membership_management_read ON identity.memberships FOR SELECT TO atlas_auth
  USING (tenant_id = NULLIF(current_setting('atlas.tenant_id', true), '')::uuid
    AND current_setting('atlas.manage_users', true) = 'true');
CREATE POLICY membership_management_update ON identity.memberships FOR UPDATE TO atlas_auth
  USING (tenant_id = NULLIF(current_setting('atlas.tenant_id', true), '')::uuid
    AND current_setting('atlas.manage_users', true) = 'true')
  WITH CHECK (tenant_id = NULLIF(current_setting('atlas.tenant_id', true), '')::uuid
    AND current_setting('atlas.manage_users', true) = 'true');
GRANT UPDATE (role) ON identity.memberships TO atlas_auth;
GRANT INSERT ON public.audit_events TO atlas_auth;
CREATE POLICY audit_identity_append ON public.audit_events FOR INSERT TO atlas_auth
  WITH CHECK (tenant_id = NULLIF(current_setting('atlas.tenant_id', true), '')::uuid);
