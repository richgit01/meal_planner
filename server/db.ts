import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from "@shared/schema";
import { validateEnvironment, logConnectionDetails } from './env-check';

// Validate environment variables
if (!validateEnvironment()) {
  process.exit(1);
}

logConnectionDetails();

console.log("Using custom Pool with SSL override");

const connectionString = process.env.DATABASE_URL;

// Always use SSL with rejectUnauthorized: false for Supabase
const pool = new Pool({
  connectionString,
  ssl: connectionString?.includes('supabase.com') ? {
    rejectUnauthorized: false,
  } : false,
});

export const db = drizzle(pool, { schema });
export { pool };

// Test connection on startup
pool.on('connect', () => {
  console.log('✅ Database pool connected successfully');
});

pool.on('error', (err) => {
  console.error('❌ Database pool error:', err.message);
});

// Test initial connection
(async () => {
  try {
    const client = await pool.connect();
    console.log('🔌 Initial database connection test successful');
    client.release();
  } catch (error) {
    console.error('❌ Initial database connection failed:', error instanceof Error ? error.message : String(error));
    console.error('Full error:', error);
  }
})();
