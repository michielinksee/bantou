-- ============================================================
-- Migration 02: Subscriptions & Billing (Group 2)
-- 3 tables: subscriptions, billing_events, invoices
-- ============================================================

CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  stripe_subscription_id TEXT NOT NULL UNIQUE,
  stripe_customer_id TEXT NOT NULL,
  tier TEXT NOT NULL,
  status TEXT NOT NULL,
  current_period_start TIMESTAMPTZ NOT NULL,
  current_period_end TIMESTAMPTZ NOT NULL,
  amount_jpy INTEGER,
  currency TEXT NOT NULL DEFAULT 'JPY',
  units INTEGER,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
  canceled_at TIMESTAMPTZ,
  trial_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT subscription_tier_valid CHECK (tier IN ('solo_pro', 'team', 'customer_facing', 'enterprise')),
  CONSTRAINT subscription_status_valid CHECK (status IN ('active', 'past_due', 'canceled', 'trialing', 'incomplete', 'incomplete_expired', 'unpaid'))
);
CREATE INDEX idx_subscriptions_org ON subscriptions(org_id);
CREATE INDEX idx_subscriptions_stripe ON subscriptions(stripe_subscription_id);

-- Add FK from orgs.cockpit_subscription_id now that subscriptions exists
ALTER TABLE orgs ADD CONSTRAINT orgs_cockpit_subscription_fk
  FOREIGN KEY (cockpit_subscription_id) REFERENCES subscriptions(id) ON DELETE SET NULL;

CREATE TRIGGER set_subscriptions_updated_at BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE billing_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES orgs(id) ON DELETE SET NULL,
  stripe_event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_billing_events_stripe ON billing_events(stripe_event_id);
CREATE INDEX idx_billing_events_org ON billing_events(org_id);

CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  invoice_number TEXT NOT NULL,
  issue_date DATE NOT NULL,
  due_date DATE NOT NULL,
  total_amount_jpy INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'JPY',
  line_items JSONB NOT NULL,
  cockpit_usage_amount_jpy INTEGER,
  cockpit_savings_hours INTEGER,
  status TEXT NOT NULL DEFAULT 'draft',
  pdf_url TEXT,
  sent_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(org_id, invoice_number),
  CONSTRAINT invoice_status_valid CHECK (status IN ('draft', 'sent', 'paid', 'overdue', 'void'))
);
CREATE INDEX idx_invoices_org_client ON invoices(org_id, client_id);
CREATE INDEX idx_invoices_status ON invoices(org_id, status);

CREATE TRIGGER set_invoices_updated_at BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
