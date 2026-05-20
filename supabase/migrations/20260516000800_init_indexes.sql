-- ============================================================
-- Migration 09: Performance indexes (= additional beyond per-table indexes)
-- Composite + partial indexes for common queries
-- ============================================================

-- Dashboard home: 顧問先 grid with status
CREATE INDEX IF NOT EXISTS idx_clients_grid ON clients(org_id, status, name);

-- Pending Actions tab: 各 顧問先の 確認待ち件数
CREATE INDEX IF NOT EXISTS idx_transactions_pending ON transactions(org_id, client_id, status)
  WHERE status IN ('pending', 'excluded');

-- Cross-SaaS reconciliation tab
CREATE INDEX IF NOT EXISTS idx_reconciliation_pending ON reconciliation_candidates(org_id, client_id, status)
  WHERE status = 'pending';

-- My assignments view (= スタッフが自分の TODO 見る)
CREATE INDEX IF NOT EXISTS idx_my_assignments ON assignments(assignee_user_id, status, due_date)
  WHERE status IN ('open', 'in_progress');

-- Unread notifications count (= 通知 badge 用)
CREATE INDEX IF NOT EXISTS idx_notifications_unread_count ON notifications(recipient_user_id, severity)
  WHERE read_at IS NULL;

-- Monthly trend queries (= dashboard 月次レポート)
CREATE INDEX IF NOT EXISTS idx_transactions_monthly ON transactions(org_id, date)
  WHERE status = 'registered';

-- Audit log time-series query (= 直近 N 件)
CREATE INDEX IF NOT EXISTS idx_audit_log_recent ON audit_log(org_id, created_at DESC, action);

-- Partner fuzzy search (= 取引先マスタ検索)
CREATE INDEX IF NOT EXISTS idx_partners_name_trgm ON partners USING gin(name_normalized gin_trgm_ops);
CREATE EXTENSION IF NOT EXISTS pg_trgm;
