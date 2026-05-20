-- ============================================================
-- Migration 07: Row-Level Security (RLS) Policies
-- All tables scoped to org_id via org_members
-- ============================================================

-- Helper function: get user's org IDs
CREATE OR REPLACE FUNCTION user_org_ids()
RETURNS UUID[]
LANGUAGE SQL STABLE SECURITY DEFINER
AS $$
  SELECT COALESCE(ARRAY_AGG(org_id), ARRAY[]::UUID[])
  FROM org_members
  WHERE user_id = auth.uid() AND removed_at IS NULL;
$$;

-- ============================================================
-- Enable RLS on all tables
-- ============================================================

ALTER TABLE orgs ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

ALTER TABLE partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE transaction_classifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE exclusion_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE reconciliation_candidates ENABLE ROW LEVEL SECURITY;

ALTER TABLE assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE dashboard_states ENABLE ROW LEVEL SECURITY;

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_deletions ENABLE ROW LEVEL SECURITY;

ALTER TABLE keyword_dict_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE exclusion_rule_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE claude_md_versions ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- orgs: members can read their orgs; only owners can update
-- ============================================================
CREATE POLICY orgs_select ON orgs FOR SELECT
  USING (id = ANY(user_org_ids()));

CREATE POLICY orgs_update ON orgs FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM org_members
      WHERE org_id = orgs.id AND user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );

-- ============================================================
-- users: anyone can read users in their org (= for assignment UI)
-- ============================================================
CREATE POLICY users_select_own_or_org ON users FOR SELECT
  USING (
    id = auth.uid()
    OR id IN (
      SELECT user_id FROM org_members
      WHERE org_id = ANY(user_org_ids())
    )
  );

CREATE POLICY users_update_self ON users FOR UPDATE
  USING (id = auth.uid());

-- ============================================================
-- org_members: see members of your orgs
-- ============================================================
CREATE POLICY org_members_select ON org_members FOR SELECT
  USING (
    user_id = auth.uid()
    OR org_id = ANY(user_org_ids())
  );

CREATE POLICY org_members_admin_manage ON org_members FOR ALL
  USING (
    org_id IN (
      SELECT om.org_id FROM org_members om
      WHERE om.user_id = auth.uid() AND om.role IN ('owner', 'admin')
    )
  );

-- ============================================================
-- clients / subscriptions / invoices / partners / transactions / etc.: org_id scope
-- ============================================================
CREATE POLICY clients_org_scope ON clients FOR ALL
  USING (org_id = ANY(user_org_ids()));

CREATE POLICY subscriptions_org_scope ON subscriptions FOR SELECT
  USING (org_id = ANY(user_org_ids()));

CREATE POLICY billing_events_org_scope ON billing_events FOR SELECT
  USING (org_id = ANY(user_org_ids()));

CREATE POLICY invoices_org_scope ON invoices FOR ALL
  USING (org_id = ANY(user_org_ids()));

CREATE POLICY partners_org_scope ON partners FOR ALL
  USING (org_id = ANY(user_org_ids()));

CREATE POLICY transactions_org_scope ON transactions FOR ALL
  USING (org_id = ANY(user_org_ids()));

CREATE POLICY classifications_org_scope ON transaction_classifications FOR ALL
  USING (org_id = ANY(user_org_ids()));

CREATE POLICY exclusion_decisions_org_scope ON exclusion_decisions FOR ALL
  USING (org_id = ANY(user_org_ids()));

CREATE POLICY reconciliation_org_scope ON reconciliation_candidates FOR ALL
  USING (org_id = ANY(user_org_ids()));

-- ============================================================
-- Workflow tables
-- ============================================================
CREATE POLICY assignments_org_scope ON assignments FOR ALL
  USING (org_id = ANY(user_org_ids()));

CREATE POLICY comments_org_scope ON comments FOR ALL
  USING (org_id = ANY(user_org_ids()));

CREATE POLICY notifications_recipient ON notifications FOR SELECT
  USING (
    recipient_user_id = auth.uid()
    OR org_id = ANY(user_org_ids())
  );

CREATE POLICY notifications_update_own ON notifications FOR UPDATE
  USING (recipient_user_id = auth.uid());

CREATE POLICY dashboard_states_own ON dashboard_states FOR ALL
  USING (user_id = auth.uid());

-- ============================================================
-- Audit / Security
-- ============================================================
CREATE POLICY audit_log_select_org_scope ON audit_log FOR SELECT
  USING (org_id = ANY(user_org_ids()));

CREATE POLICY audit_log_insert ON audit_log FOR INSERT
  WITH CHECK (true); -- service role can always insert; user inserts validated by trigger

CREATE POLICY data_exports_org_scope ON data_exports FOR ALL
  USING (org_id = ANY(user_org_ids()));

CREATE POLICY data_deletions_admin_only ON data_deletions FOR ALL
  USING (
    org_id IN (
      SELECT om.org_id FROM org_members om
      WHERE om.user_id = auth.uid() AND om.role IN ('owner', 'admin')
    )
  );

-- ============================================================
-- Cockpit-specific overrides (= admin only)
-- ============================================================
CREATE POLICY keyword_overrides_admin ON keyword_dict_overrides FOR ALL
  USING (
    org_id IN (
      SELECT om.org_id FROM org_members om
      WHERE om.user_id = auth.uid() AND om.role IN ('owner', 'admin')
    )
  );

CREATE POLICY exclusion_overrides_admin ON exclusion_rule_overrides FOR ALL
  USING (
    org_id IN (
      SELECT om.org_id FROM org_members om
      WHERE om.user_id = auth.uid() AND om.role IN ('owner', 'admin')
    )
  );

CREATE POLICY claude_md_org_scope ON claude_md_versions FOR ALL
  USING (org_id = ANY(user_org_ids()));
