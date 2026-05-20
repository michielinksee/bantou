-- ============================================================
-- Migration 03: Transactions (Group 3) — Cockpit MCP sync targets
-- 5 tables: partners, transactions, transaction_classifications, exclusion_decisions, reconciliation_candidates
-- ============================================================

-- partners (= 取引先マスタ) - created first since transactions reference it
CREATE TABLE partners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  name_normalized TEXT NOT NULL,
  bank_account TEXT, -- recommend column-level encryption in app layer
  freee_partner_id TEXT,
  mf_partner_id TEXT,
  category_default TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_partners_org_normalized ON partners(org_id, name_normalized);
CREATE UNIQUE INDEX idx_partners_freee ON partners(client_id, freee_partner_id) WHERE freee_partner_id IS NOT NULL;
CREATE UNIQUE INDEX idx_partners_mf ON partners(client_id, mf_partner_id) WHERE mf_partner_id IS NOT NULL;

CREATE TRIGGER set_partners_updated_at BEFORE UPDATE ON partners
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- transactions (= main fact table)
CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  source_transaction_id TEXT,
  date DATE NOT NULL,
  amount_jpy INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'JPY',
  memo TEXT NOT NULL,
  partner_id UUID REFERENCES partners(id),
  partner_name_raw TEXT,
  fingerprint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  registered_to_source_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(client_id, source, source_transaction_id),
  CONSTRAINT tx_source_valid CHECK (source IN ('freee', 'mf', 'manual', 'csv')),
  CONSTRAINT tx_status_valid CHECK (status IN ('pending', 'classified', 'excluded', 'reconciled', 'registered', 'failed'))
);
CREATE INDEX idx_transactions_client_date ON transactions(client_id, date DESC);
CREATE INDEX idx_transactions_fingerprint ON transactions(client_id, fingerprint);
CREATE INDEX idx_transactions_status ON transactions(org_id, status);

CREATE TRIGGER set_transactions_updated_at BEFORE UPDATE ON transactions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- transaction_classifications (= AI suggestion + human override)
CREATE TABLE transaction_classifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  ai_category TEXT,
  ai_account_code INTEGER,
  ai_tax_code INTEGER,
  ai_confidence TEXT,
  ai_reason TEXT,
  ai_classifier_version TEXT,
  human_override_category TEXT,
  human_override_account_code INTEGER,
  human_override_tax_code INTEGER,
  human_override_user_id UUID REFERENCES users(id),
  human_override_reason TEXT,
  human_overridden_at TIMESTAMPTZ,
  final_category TEXT NOT NULL,
  final_account_code INTEGER NOT NULL,
  final_tax_code INTEGER NOT NULL,
  final_decided_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ai_confidence_valid CHECK (ai_confidence IS NULL OR ai_confidence IN ('high', 'medium', 'low'))
);
CREATE INDEX idx_classifications_transaction ON transaction_classifications(transaction_id);
CREATE INDEX idx_classifications_confidence ON transaction_classifications(org_id, ai_confidence);

-- exclusion_decisions (= which of the 7 rules fired)
CREATE TABLE exclusion_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  rule_id TEXT NOT NULL,
  rule_version TEXT NOT NULL,
  reason TEXT NOT NULL,
  suggested_next_step TEXT,
  resolved_at TIMESTAMPTZ,
  resolved_by_user_id UUID REFERENCES users(id),
  resolution TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_exclusion_transaction ON exclusion_decisions(transaction_id);
CREATE INDEX idx_exclusion_org_resolved ON exclusion_decisions(org_id, resolved_at);

-- reconciliation_candidates (= cross-SaaS double-entry)
CREATE TABLE reconciliation_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  freee_transaction_id UUID REFERENCES transactions(id),
  mf_transaction_id UUID REFERENCES transactions(id),
  fingerprint TEXT NOT NULL,
  ai_resolution TEXT,
  ai_confidence TEXT,
  ai_reason TEXT,
  human_decision TEXT,
  human_decided_by_user_id UUID REFERENCES users(id),
  human_decided_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT reconciliation_status_valid CHECK (status IN ('pending', 'resolved', 'dismissed')),
  CONSTRAINT ai_resolution_valid CHECK (ai_resolution IS NULL OR ai_resolution IN ('merge_keep_freee', 'merge_keep_mf', 'separate', 'unsure'))
);
CREATE INDEX idx_reconciliation_org_status ON reconciliation_candidates(org_id, status);
CREATE INDEX idx_reconciliation_client ON reconciliation_candidates(client_id);

CREATE TRIGGER set_reconciliation_updated_at BEFORE UPDATE ON reconciliation_candidates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
