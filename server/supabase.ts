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

    // Use listUsers and filter (getUserByEmail doesn't exist in Supabase Admin API)
    let page = 1;
    const perPage = 1000;
    while (true) {
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
      if (error) {
        console.error('Error checking email:', error);
        return { exists: false, error: error.message };
      }
      
      const userFound = data.users.some((u) => u.email?.toLowerCase() === email.toLowerCase());
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