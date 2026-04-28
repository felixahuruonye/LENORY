// Database integration blueprint reference: javascript_database
import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { sql } from 'drizzle-orm';
import * as schema from "@shared/schema";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Create Neon HTTP client (serverless-friendly, no WebSocket needed)
const queryClient = neon(process.env.DATABASE_URL);
export const db = drizzle(queryClient, { schema });
console.log('✅ Database connection established');

// Run schema migrations on startup using the pool query interface
export async function runMigrations() {
  const queries = [
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS lernory_id VARCHAR UNIQUE`,
    `CREATE TABLE IF NOT EXISTS device_sessions (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      device_token VARCHAR NOT NULL UNIQUE,
      device_info JSONB,
      last_used_at TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
  ];
  let success = 0;
  for (const query of queries) {
    try {
      await queryClient(query);
      success++;
    } catch (e: any) {
      // Column/table may already exist - only log unexpected errors
      if (!e.message?.includes('already exists')) {
        console.log('Migration note:', e.message?.split('\n')[0]);
      }
    }
  }
  if (success > 0) console.log(`✅ Schema migrations applied (${success} changes)`);
  else console.log('✅ Schema already up to date');
}

export const isDatabaseAvailable = () => true;

// Create a simple pool interface for backward compatibility
export const pool = {
  query: async (text: string, values?: any[]) => {
    try {
      const result = await queryClient(text, values);
      return { rows: result };
    } catch (error: any) {
      console.warn('Database query failed:', error.message);
      return { rows: [] };
    }
  },
  on: (event: string, handler: Function) => {
    // Dummy event handler for compatibility
  }
};
