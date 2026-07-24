import { createClient } from '@supabase/supabase-js';

// Browser Supabase client. Uses the PUBLIC anon key + URL (safe to ship to the
// client); row-level security policies enforce per-user access on the server.
export const supabase = createClient(
  import.meta.env.PUBLIC_SUPABASE_URL,
  import.meta.env.PUBLIC_SUPABASE_ANON_KEY
);
