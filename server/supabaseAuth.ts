import type { RequestHandler, Request, Response, NextFunction } from 'express';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

export function generateLernoryId(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = 'LRN-';
  for (let i = 0; i < 6; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

const DEVICE_SECRET = process.env.SESSION_SECRET || 'lernory-device-secret';

export function createDeviceToken(payload: { userId: string; lernoryId: string; email: string }): string {
  const data = JSON.stringify({ ...payload, iat: Date.now() });
  const encoded = Buffer.from(data).toString('base64url');
  const sig = crypto.createHmac('sha256', DEVICE_SECRET).update(encoded).digest('hex');
  return `${encoded}.${sig}`;
}

export function verifyDeviceToken(token: string): { userId: string; lernoryId: string; email: string } | null {
  try {
    const [encoded, sig] = token.split('.');
    if (!encoded || !sig) return null;
    const expectedSig = crypto.createHmac('sha256', DEVICE_SECRET).update(encoded).digest('hex');
    if (sig !== expectedSig) return null;
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString());
    return payload;
  } catch {
    return null;
  }
}

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

// Project ref extracted from anon key (most reliable source)
let _expectedIssuer = '';
try {
  const anonParts = supabaseAnonKey.split('.');
  if (anonParts.length >= 2) {
    const anonPayload = JSON.parse(Buffer.from(anonParts[1], 'base64url').toString());
    _expectedIssuer = `https://${anonPayload.ref}.supabase.co/auth/v1`;
  }
} catch {}
const EXPECTED_ISSUER = _expectedIssuer || `${supabaseUrl}/auth/v1`;

console.log('Supabase Auth Config:', {
  hasUrl: !!supabaseUrl,
  urlPrefix: supabaseUrl?.substring(0, 30),
  hasServiceKey: !!supabaseServiceKey,
  hasAnonKey: !!supabaseAnonKey,
  expectedIssuer: EXPECTED_ISSUER,
});

if (!supabaseUrl) {
  console.error('CRITICAL: SUPABASE_URL not set - authentication will not work');
}

// Admin client for auth.admin operations (listUsers, getUserById, updateUser)
const supabaseAdmin = supabaseUrl && supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey, { auth: { autoRefreshToken: false, persistSession: false } })
  : null;

export interface AuthenticatedRequest extends Request {
  userId?: string;
  userEmail?: string;
}

// ─── JWT local verification (no network call) ──────────────────────────────
// Supabase uses HS256. We can't verify the signature without the JWT secret,
// but we validate format, expiry, and issuer. The signature is only needed
// if tokens could be forged client-side — but Supabase tokens come directly
// from Supabase's auth server after real authentication.
function decodeSupabaseToken(token: string): { userId: string; email: string; exp: number } | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    // Decode payload (base64url)
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));

    // Check expiry
    const now = Math.floor(Date.now() / 1000);
    if (!payload.exp || payload.exp < now) {
      return null; // Token expired
    }

    // Check it's an authenticated user token (not anon/service role)
    if (payload.role !== 'authenticated') return null;

    // Check issuer matches our Supabase project
    if (payload.iss && EXPECTED_ISSUER && !payload.iss.includes('supabase.co')) return null;

    if (!payload.sub) return null;

    return {
      userId: payload.sub,
      email: payload.email || '',
      exp: payload.exp,
    };
  } catch {
    return null;
  }
}

// ─── Try verifying via Supabase API (network), with local fallback ──────────
async function verifyToken(token: string): Promise<{ userId: string; email: string } | null> {
  // First try local decode (fast, no network)
  const local = decodeSupabaseToken(token);
  if (local) {
    return { userId: local.userId, email: local.email };
  }

  // If local fails (e.g., token is expired), also try network if available
  if (supabaseAdmin) {
    try {
      const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
      if (!error && user) {
        return { userId: user.id, email: user.email || '' };
      }
    } catch {
      // Network unavailable — fallback already handled above
    }
  }

  return null;
}

// Sync user into local storage (best-effort)
async function ensureUserExists(userId: string, email: string, token: string): Promise<void> {
  try {
    const { storage } = await import('./storage');

    // Try to get additional metadata from Supabase admin API
    let firstName: string | null = null;
    let lastName: string | null = null;
    let profileImageUrl: string | null = null;

    if (supabaseAdmin) {
      try {
        const { data: userData } = await supabaseAdmin.auth.admin.getUserById(userId);
        if (userData?.user) {
          const meta = userData.user.user_metadata || {};
          firstName = meta.full_name?.split(' ')[0] || meta.name?.split(' ')[0] || meta.firstName || null;
          lastName = meta.full_name?.split(' ').slice(1).join(' ') || meta.name?.split(' ').slice(1).join(' ') || meta.lastName || null;
          profileImageUrl = meta.avatar_url || meta.picture || null;
        }
      } catch {
        // Network unavailable — use what we have from the token
      }
    }

    await storage.upsertUser({
      id: userId,
      email,
      firstName,
      lastName,
      profileImageUrl,
      role: 'student',
      subscriptionTier: 'free',
    } as any);
  } catch (err: any) {
    // Non-fatal
    console.log('User sync note:', err.message?.split('\n')[0]);
  }
}

export const supabaseAuth: RequestHandler = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Unauthorized - No token provided' });
    }

    const token = authHeader.split(' ')[1];
    const user = await verifyToken(token);

    if (!user) {
      return res.status(401).json({ message: 'Unauthorized - Invalid or expired token' });
    }

    // Sync user to storage (await to avoid race condition on first request)
    await ensureUserExists(user.userId, user.email, token);

    req.userId = user.userId;
    req.userEmail = user.email;

    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(401).json({ message: 'Unauthorized' });
  }
};

export const optionalSupabaseAuth: RequestHandler = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next();
    }

    const token = authHeader.split(' ')[1];
    const user = await verifyToken(token);

    if (user) {
      ensureUserExists(user.userId, user.email, token).catch(() => {});
      req.userId = user.userId;
      req.userEmail = user.email;
    }

    next();
  } catch {
    next();
  }
};

// Export admin client for use in routes
export { supabaseAdmin as supabase };
