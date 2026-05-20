-- ============================================================
-- Migration 06: Cockpit Specific (Group 6) — Per-firm customization
-- 3 tables: keyword_dict_overrides, exclusion_rule_overrides, claude_md_versions
-- ============================================================

CREATE TABLE keyword_dict_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL,
  additional_keywords TEXT[] DEFAULT ARRAY[]::TEXT[],
  exclude_keywords TEXT[] DEFAULT ARRAY[]::TEXT[],
  custom_account_code INTEGER,
  custom_tax_code INTEGER,
  created_by_user_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(org_id, category_id)
);

CREATE TRIGGER set_keyword_overrides_updated_at BEFORE UPDATE ON keyword_dict_overrides
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE exclusion_rule_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  rule_id TEXT NOT NULL,
  disabled BOOLEAN NOT NULL DEFAULT false,
  additional_keywords TEXT[] DEFAULT ARRAY[]::TEXT[],
  exclude_keywords TEXT[] DEFAULT ARRAY[]::TEXT[],
  created_by_user_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(org_id, rule_id)
);

CREATE TRIGGER set_exclusion_overrides_updated_at BEFORE UPDATE ON exclusion_rule_overrides
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE claude_md_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  content TEXT NOT NULL,
  base_template TEXT NOT NULL DEFAULT 'jp-tax-firm-v1.0.0',
  created_by_user_id UUID NOT NULL REFERENCES users(id),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(org_id, version)
);
CREATE INDEX idx_claude_md_org_active ON claude_md_versions(org_id) WHERE active = true;
