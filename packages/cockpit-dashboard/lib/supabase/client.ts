// Supabase browser client (= Client Components / React hooks 用).
// Phase 1.B Week 1: 5/16-5/22 で実際の auth flow + RLS 検証.

import { createBrowserClient } from '@supabase/ssr';

export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
