-- ============================================================
-- Migration 08: Realtime publication setup
-- 4 channels: transactions, assignments, notifications, client-specific
-- ============================================================

-- Enable replica identity for tables we want to broadcast changes on
ALTER TABLE transactions REPLICA IDENTITY FULL;
ALTER TABLE transaction_classifications REPLICA IDENTITY FULL;
ALTER TABLE exclusion_decisions REPLICA IDENTITY FULL;
ALTER TABLE reconciliation_candidates REPLICA IDENTITY FULL;
ALTER TABLE assignments REPLICA IDENTITY FULL;
ALTER TABLE comments REPLICA IDENTITY FULL;
ALTER TABLE notifications REPLICA IDENTITY FULL;

-- Add tables to supabase_realtime publication (= for Realtime channel)
ALTER PUBLICATION supabase_realtime ADD TABLE transactions;
ALTER PUBLICATION supabase_realtime ADD TABLE transaction_classifications;
ALTER PUBLICATION supabase_realtime ADD TABLE exclusion_decisions;
ALTER PUBLICATION supabase_realtime ADD TABLE reconciliation_candidates;
ALTER PUBLICATION supabase_realtime ADD TABLE assignments;
ALTER PUBLICATION supabase_realtime ADD TABLE comments;
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;

-- Note: Frontend subscribes via:
--   supabase.channel(`org:${orgId}:transactions`).on('postgres_changes', { table: 'transactions', filter: `org_id=eq.${orgId}` }, ...)
-- RLS policies still apply during realtime delivery.
