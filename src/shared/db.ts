/**
 * Database connection pool and query helpers
 * PostgreSQL with pgvector support
 */

import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { config } from './config.js';
import { dbQueryDurationSeconds } from './metrics.js';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      host: config.postgres.host,
      port: config.postgres.port,
      database: config.postgres.database,
      user: config.postgres.user,
      password: config.postgres.password,
      ssl: config.postgres.ssl,
      max: config.postgres.poolSize,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    pool.on('error', (err) => {
      console.error('Unexpected database pool error:', err);
    });
  }
  return pool;
}

export async function query<T extends QueryResultRow = any>(text: string, params?: any[]): Promise<QueryResult<T>> {
  const start = Date.now();
  const pool = getPool();
  try {
    console.log(`[DB DEBUG] Query: ${text.substring(0, 100)}...`, params);
    const result = await pool.query<T>(text, params);
    console.log(`[DB DEBUG] Query returned ${result.rows.length} rows`);
    return result;
  } finally {
    const duration = Date.now() - start;
    // Record query latency metric
    const operation = text.trim().split(/\s+/)[0].toUpperCase();
    dbQueryDurationSeconds.observe({ operation }, duration / 1000);
    if (duration > 1000) {
      console.warn(`Slow query (${duration}ms):`, text.substring(0, 100));
    }
  }
}

export async function getClient(): Promise<PoolClient> {
  const pool = getPool();
  return pool.connect();
}

export async function transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

export { pool };

// Health check
export async function healthCheck(): Promise<boolean> {
  try {
    await query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}