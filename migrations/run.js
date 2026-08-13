#!/usr/bin/env node
/**
 * Migration runner for AI Video FTE
 * Runs all SQL migrations in order
 */

import * as fs from 'fs';
import * as path from 'path';
import { Pool } from 'pg';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MIGRATIONS_DIR = __dirname;

async function runMigrations() {
  const dbConfig = {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432'),
    database: process.env.POSTGRES_DB || 'ai_video_fte',
    user: process.env.POSTGRES_USER || 'postgres',
    password: process.env.POSTGRES_PASSWORD || 'postgres',
    ssl: process.env.POSTGRES_SSL === 'true',
  };

  const pool = new Pool(dbConfig);

  try {
    // Create migrations tracking table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id SERIAL PRIMARY KEY,
        filename VARCHAR(255) NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Get applied migrations
    const appliedResult = await pool.query('SELECT filename FROM schema_migrations ORDER BY id');
    const applied = new Set(appliedResult.rows.map(r => r.filename));

    // Get all migration files
    const files = fs.readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .sort();

    console.log(`Found ${files.length} migration files`);

    for (const file of files) {
      if (applied.has(file)) {
        console.log(`⏭  Skipping ${file} (already applied)`);
        continue;
      }

      console.log(`▶  Applying ${file}...`);
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');

      try {
        await pool.query('BEGIN');
        await pool.query(sql);
        await pool.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
        await pool.query('COMMIT');
        console.log(`✓  Applied ${file}`);
      } catch (error) {
        await pool.query('ROLLBACK');
        console.error(`✗  Failed to apply ${file}:`, error);
        throw error;
      }
    }

    console.log('✅ All migrations applied successfully');
  } finally {
    await pool.end();
  }
}

runMigrations().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});