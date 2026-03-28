// src/utils/supabaseClient.ts
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL_STAGE;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY_STAGE;
// Userbase DB (skatehive3.0 Supabase project — separate from the leaderboard DB)
const userbaseUrl = process.env.SUPABASE_USERBASE_URL || process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Initialize Supabase client only if both URL and Key are present and URL is valid
const isValidUrl = (url?: string) => url && (url.startsWith('http://') || url.startsWith('https://'));

export const supabase = (supabaseUrl && isValidUrl(supabaseUrl) && supabaseAnonKey)
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

// Service role client for server-side queries against RLS-protected userbase tables
export const supabaseAdmin = (userbaseUrl && isValidUrl(userbaseUrl) && supabaseServiceRoleKey)
  ? createClient(userbaseUrl, supabaseServiceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null;
