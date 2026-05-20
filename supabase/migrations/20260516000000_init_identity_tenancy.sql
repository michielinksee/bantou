-- ============================================================
-- Migration 01: Identity & Tenancy (Group 1)
-- 4 tables: orgs, users, org_members, clients
-- See: docs/db-schema-a.md
-- ============================================================

-- orgs (= 税理士事務所)
CREATE TABLE orgs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  tax_jurisdiction TEXT NOT NULL DEFAULT 'JP',
  default_locale TEXT NOT NULL DEFAULT 'ja-JP',
  default_currency TEXT NOT NULL DEFAULT 'JPY',
  contact_email TEXT NOT NULL,
  contact_phone TEXT,
  address JSONB,
  cockpit_tier TEXT NOT NULL DEFAULT 'free',
  cockpit_subscription_id UUID, -- FK added in 02_subscriptions migration
  founders_edition BOOLEAN NOT NULL DEFAULT false,
  cyber_insurance_active BOOLEAN NOT NULL DEFAULT false,
  dpa_signed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT cockpit_tier_valid CHECK (cockpit_tier IN ('free', 'solo_pro', 'team', 'customer_facing', 'enterprise', 'founders_edition')),
  CONSTRAINT tax_jurisdiction_valid CHECK (tax_jurisdiction ~ '^[A-Z]{2}$')
);
CREATE INDEX idx_orgs_slug ON orgs(slug);
CREATE INDEX idx_orgs_tier ON orgs(cockpit_tier);

-- users (= linked to Supabase Auth)
-- NOTE: Supabase Auth provides auth.users; we extend with public.users for app-level fields.
CREATE TABLE users (
  id UUID PRIMARY KEY,  -- matches auth.users.id
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  display_name TEXT,
  photo_url TEXT,
  locale TEXT NOT NULL DEFAULT 'ja-JP',
  totp_enabled BOOLEAN NOT NULL DEFAULT false,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_users_email ON users(email);

-- org_members (= role: owner / admin / staff / readonly)
CREATE TABLE org_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'staff',
  invited_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  joined_at TIMESTAMPTZ,
  removed_at TIMESTAMPTZ,
  UNIQUE(org_id, user_id),
  CONSTRAINT role_valid CHECK (role IN ('owner', 'admin', 'staff', 'readonly'))
);
CREATE INDEX idx_org_members_org ON org_members(org_id);
CREATE INDEX idx_org_members_user ON org_members(user_id);

-- clients (= 顧問先)
CREATE TABLE clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  legal_name TEXT,
  tax_id TEXT,  -- recommend column-level encryption in app layer
  fiscal_year_end TEXT,
  industry TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  address JSONB,
  freee_company_id TEXT,
  mf_company_id TEXT,
  service_tier TEXT,
  monthly_fee_jpy INTEGER,
  status TEXT NOT NULL DEFAULT 'active',
  contract_start_date DATE,
  contract_end_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT status_valid CHECK (status IN ('active', 'paused', 'terminated')),
  CONSTRAINT service_tier_valid CHECK (service_tier IS NULL OR service_tier IN ('monthly', 'quarterly', 'annual'))
);
CREATE INDEX idx_clients_org ON clients(org_id);
CREATE INDEX idx_clients_status ON clients(org_id, status);
CREATE INDEX idx_clients_freee ON clients(freee_company_id) WHERE freee_company_id IS NOT NULL;
CREATE INDEX idx_clients_mf ON clients(mf_company_id) WHERE mf_company_id IS NOT NULL;

-- updated_at auto-update trigger
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_orgs_updated_at BEFORE UPDATE ON orgs FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_clients_updated_at BEFORE UPDATE ON clients FOR EACH ROW EXECUTE FUNCTION set_updated_at();
