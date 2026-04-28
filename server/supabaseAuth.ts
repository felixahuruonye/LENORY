import type { RequestHandler, Request, Response, NextFunction } from 'express';
import { createClient } from '@supabase/supabase-js';
import { db } from './db';
import { users } from '@shared/schema';
import { eq } from 'drizzle-orm';
import crypto from 'crypto';

export function generateLernoryId(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = 'LRN-';
  for (let i = 0; i < 8; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

// Simple HMAC-signed device token (no DB required)
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

// Prioritize VITE_SUPABASE_URL since it's confirmed working for frontend
const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

console.log('Supabase Auth Config:', { 
  hasUrl: !!supabaseUrl, 
  urlPrefix: supabaseUrl?.substring(0, 30),
  hasServiceKey: !!supabaseServiceKey 
});

if (!supabaseUrl) {
  console.error('CRITICAL: SUPABASE_URL not set - authentication will not work');
}
if (!supabaseServiceKey) {
  console.error('CRITICAL: SUPABASE_SERVICE_ROLE_KEY not set - authentication will not work');
}

const supabase = supabaseUrl && supabaseServiceKey ? createClient(supabaseUrl, supabaseServiceKey) : null;

export interface AuthenticatedRequest extends Request {
  userId?: string;
  userEmail?: string;
}

// Helper function to ensure user exists in local database
async function ensureUserExists(supabaseUser: any): Promise<void> {
  try {
    // Check if user exists in local database
    const existingUser = await db.select().from(users).where(eq(users.id, supabaseUser.id)).limit(1);
    
    if (existingUser.length === 0) {
      // Create user in local database with Supabase user data
      const userMetadata = supabaseUser.user_metadata || {};
      let lernoryId = generateLernoryId();
      // Ensure unique lernory_id (retry on collision)
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          await db.insert(users).values({
            id: supabaseUser.id,
            email: supabaseUser.email,
            firstName: userMetadata.full_name?.split(' ')[0] || userMetadata.name?.split(' ')[0] || null,
            lastName: userMetadata.full_name?.split(' ').slice(1).join(' ') || null,
            profileImageUrl: userMetadata.avatar_url || userMetadata.picture || null,
            role: 'student',
            subscriptionTier: 'free',
            lernoryId,
          });
          console.log('Created local user record for:', supabaseUser.email, 'with Lernory ID:', lernoryId);
          break;
        } catch (insertErr: any) {
          if (insertErr.message?.includes('unique') && insertErr.message?.includes('lernory_id')) {
            lernoryId = generateLernoryId();
          } else {
            throw insertErr;
          }
        }
      }
    } else if (!existingUser[0].lernoryId) {
      // Assign Lernory ID to existing users who don't have one
      const lernoryId = generateLernoryId();
      try {
        await db.update(users).set({ lernoryId }).where(eq(users.id, supabaseUser.id));
        console.log('Assigned Lernory ID to existing user:', supabaseUser.email);
      } catch {}
    }
  } catch (error) {
    // Log but don't fail - user might already exist from a race condition
    console.log('User sync note:', (error as Error).message);
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
    
    if (!supabase) {
      console.error('Supabase not configured - missing SUPABASE_SERVICE_ROLE_KEY');
      return res.status(500).json({ message: 'Server authentication not configured' });
    }

    // Log token info for debugging (first 20 chars only)
    console.log('Auth attempt with token prefix:', token.substring(0, 20) + '...');
    
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error) {
      console.error('Supabase auth error:', {
        message: error.message,
        status: error.status,
        name: error.name,
      });
      return res.status(401).json({ message: 'Unauthorized - Invalid token', error: error.message });
    }
    
    if (!user) {
      console.error('Supabase getUser returned no user');
      return res.status(401).json({ message: 'Unauthorized - No user found' });
    }
    
    // Ensure user exists in local database (auto-sync from Supabase Auth)
    await ensureUserExists(user);
    
    console.log('Auth success for user:', user.email);

    req.userId = user.id;
    req.userEmail = user.email;
    
    next();
  } catch (error) {
    console.error('Auth error:', error);
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
    
    if (!authHeader || !authHeader.startsWith('Bearer ') || !supabase) {
      return next();
    }

    const token = authHeader.split(' ')[1];
    const { data: { user } } = await supabase.auth.getUser(token);

    if (user) {
      // Ensure user exists in local database
      await ensureUserExists(user);
      req.userId = user.id;
      req.userEmail = user.email;
    }
    
    next();
  } catch {
    next();
  }
};
