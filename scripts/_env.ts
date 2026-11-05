// Dummy credentials so modules that create a Supabase client can load in tests (no network is used).
process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://x.supabase.co";
process.env.VITE_SUPABASE_URL = process.env.SUPABASE_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "k";
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "k";
process.env.VITE_SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || "k";
