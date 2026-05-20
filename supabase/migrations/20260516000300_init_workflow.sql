-- ============================================================
-- Migration 04: Workflow / Collaboration (Group 4)
-- 4 tables: assignments, comments, notifications, dashboard_states
-- ============================================================

CREATE TABLE assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  assignee_user_id UUID NOT NULL REFERENCES users(id),
  assigner_user_id UUID NOT NULL REFERENCES users(id),
  subject_type TEXT NOT NULL,
  subject_id UUID NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  due_date DATE,
  priority TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'open',
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT assignment_priority_valid CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  CONSTRAINT assignment_status_valid CHECK (status IN ('open', 'in_progress', 'completed', 'canceled')),
  CONSTRAINT assignment_subject_valid CHECK (subject_type IN ('transaction', 'client', 'reconciliation', 'exclusion', 'monthly_close'))
);
CREATE INDEX idx_assignments_assignee_status ON assignments(assignee_user_id, status);
CREATE INDEX idx_assignments_subject ON assignments(subject_type, subject_id);

CREATE TRIGGER set_assignments_updated_at BEFORE UPDATE ON assignments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  subject_type TEXT NOT NULL,
  subject_id UUID NOT NULL,
  body TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'internal',
  in_reply_to UUID REFERENCES comments(id),
  edited_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT comment_visibility_valid CHECK (visibility IN ('internal', 'client_visible'))
);
CREATE INDEX idx_comments_subject ON comments(subject_type, subject_id);
CREATE INDEX idx_comments_user ON comments(user_id);

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  recipient_user_id UUID REFERENCES users(id),
  recipient_client_id UUID REFERENCES clients(id),
  type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  link TEXT,
  channels TEXT[] NOT NULL DEFAULT ARRAY['in_app']::TEXT[],
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT notification_severity_valid CHECK (severity IN ('info', 'warning', 'critical')),
  CONSTRAINT notification_type_valid CHECK (type IN ('anomaly', 'reconciliation', 'assignment', 'monthly_close_due', 'subscription', 'system'))
);
CREATE INDEX idx_notifications_recipient_unread ON notifications(recipient_user_id) WHERE read_at IS NULL;
CREATE INDEX idx_notifications_severity ON notifications(org_id, severity);

CREATE TABLE dashboard_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  view_id TEXT NOT NULL,
  preferences JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, org_id, view_id)
);

CREATE TRIGGER set_dashboard_states_updated_at BEFORE UPDATE ON dashboard_states
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
