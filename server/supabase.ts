// server/supabase.ts
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!supabaseUrl || !supabaseServiceKey) {
  console.warn('⚠️ Supabase credentials missing. Some features will not work.');
}

// This is the SERVER-ONLY admin client - NEVER expose to client!
export const supabaseAdmin = createClient(
  supabaseUrl,
  supabaseServiceKey,
  { 
    auth: { 
      autoRefreshToken: false, 
      persistSession: false 
    } 
  }
);

// Also export a regular client for server-side if needed
export const supabase = createClient(
  supabaseUrl,
  process.env.VITE_SUPABASE_ANON_KEY || ''
);

// ─── Helper Functions ──────────────────────────────────────

export async function checkEmailExists(email: string): Promise<{ exists: boolean; error?: string }> {
  try {
    // Check database first
    const { data: dbUser } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('email', email)
      .maybeSingle();

    if (dbUser) {
      return { exists: true };
    }

    // Use listUsers and filter
    let page = 1;
    const perPage = 1000;
    while (true) {
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
      if (error) {
        console.error('Error checking email:', error);
        return { exists: false, error: error.message };
      }
      
      const userFound = data.users.some((u: any) => u.email?.toLowerCase() === email.toLowerCase());
      if (userFound) return { exists: true };
      
      if (data.users.length < perPage) break;
      page++;
    }
    
    return { exists: false };
  } catch (error: any) {
    console.error('Error checking email existence:', error);
    return { exists: false, error: error.message };
  }
}