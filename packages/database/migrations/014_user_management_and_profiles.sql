ALTER TABLE identity.users ADD COLUMN IF NOT EXISTS name varchar(120) NOT NULL DEFAULT '';

GRANT INSERT ON identity.memberships TO atlas_auth;
CREATE POLICY membership_management_insert ON identity.memberships FOR INSERT TO atlas_auth
  WITH CHECK (tenant_id = NULLIF(current_setting('atlas.tenant_id', true), '')::uuid
    AND current_setting('atlas.manage_users', true) = 'true');

GRANT DELETE ON identity.memberships TO atlas_auth;
CREATE POLICY membership_management_delete ON identity.memberships FOR DELETE TO atlas_auth
  USING (tenant_id = NULLIF(current_setting('atlas.tenant_id', true), '')::uuid
    AND current_setting('atlas.manage_users', true) = 'true');
