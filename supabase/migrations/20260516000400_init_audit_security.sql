-- ============================================================
-- Migration 05: Audit / Security (Group 5)
-- 3 tables: audit_log (IMMUTABLE), data_exports, data_deletions
-- ============================================================

-- audit_log (= IMMUTABLE INSERT only)
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES orgs(id) ON DELETE SET NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  before JSONB,
  after JSONB,
  ip_address INET,
  user_agent TEXT,
  request_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_log_org ON audit_log(org_id, created_at DESC);
CREATE INDEX idx_audit_log_user ON audit_log(user_id);
CREATE INDEX idx_audit_log_action ON audit_log(action, created_at DESC);
CREATE INDEX idx_audit_log_resource ON audit_log(resource_type, resource_id);

-- ⭐ Enforce immutability at DB level
-- REVOKE UPDATE/DELETE from all roles (= only INSERT + SELECT allowed)
REVOKE UPDATE, DELETE ON audit_log FROM PUBLIC;
REVOKE UPDATE, DELETE ON audit_log FROM authenticated;
REVOKE UPDATE, DELETE ON audit_log FROM anon;
REVOKE UPDATE, DELETE ON audit_log FROM service_role;

CREATE TABLE data_exports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  requested_by_user_id UUID NOT NULL REFERENCES users(id),
  scope TEXT NOT NULL,
  scope_id UUID,
  format TEXT NOT NULL DEFAULT 'json',
  status TEXT NOT NULL DEFAULT 'pending',
  download_url TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT export_scope_valid CHECK (scope IN ('org', 'client')),
  CONSTRAINT export_format_valid CHECK (format IN ('json', 'csv', 'sql_dump')),
  CONSTRAINT export_status_valid CHECK (status IN ('pending', 'processing', 'completed', 'failed'))
);

CREATE TABLE data_deletions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  client_id UUID,
  requested_by_user_id UUID NOT NULL REFERENCES users(id),
  reason TEXT,
  scheduled_for TIMESTAMPTZ NOT NULL,
  executed_at TIMESTAMPTZ,
  certificate_pdf_url TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT deletion_status_valid CHECK (status IN ('scheduled', 'executed', 'canceled'))
);
