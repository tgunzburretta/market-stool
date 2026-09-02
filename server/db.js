const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required — set it to a Postgres connection string');
}

// Railway (and most managed Postgres hosts) terminate TLS with a cert that isn't in
// Node's default trust store; localhost dev Postgres has no TLS at all.
const useSsl = !/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSsl ? { rejectUnauthorized: false } : false,
});

async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS listings (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      tags JSONB NOT NULL DEFAULT '[]',
      description TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_refreshed_at TIMESTAMPTZ
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS listings_user_id_idx ON listings (user_id);`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS queues (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      week TEXT NOT NULL,
      listing_ids JSONB NOT NULL,
      generated_at TIMESTAMPTZ NOT NULL,
      PRIMARY KEY (user_id, week)
    );
  `);
}

module.exports = { pool, initSchema };
