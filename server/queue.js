const { pool } = require('./db');

const QUEUE_SIZE = 5;

// ISO week id (e.g. "2026-W36") — a stable key so the same 5 listings stay surfaced
// all week regardless of how many times the queue is fetched.
function isoWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

// Returns this week's stale-listing queue for a user, regenerating it (and persisting
// the choice) the first time it's asked for in a new ISO week, if a previously queued
// listing has since been deleted, or if it was generated before the seller had enough
// listings to fill it (so a queue born empty on day one doesn't stay empty all week).
async function getQueue(userId, date = new Date()) {
  const week = isoWeek(date);

  const totalResult = await pool.query('SELECT count(*)::int AS n FROM listings WHERE user_id = $1', [userId]);
  const targetSize = Math.min(QUEUE_SIZE, totalResult.rows[0].n);

  const existing = await pool.query(
    'SELECT listing_ids, generated_at FROM queues WHERE user_id = $1 AND week = $2',
    [userId, week]
  );
  if (existing.rows.length) {
    const listingIds = existing.rows[0].listing_ids;
    if (listingIds.length === targetSize) {
      const stillValid = await pool.query(
        'SELECT count(*)::int AS n FROM listings WHERE user_id = $1 AND id = ANY($2::text[])',
        [userId, listingIds]
      );
      if (stillValid.rows[0].n === listingIds.length) {
        return { week, listingIds, generatedAt: existing.rows[0].generated_at.toISOString() };
      }
    }
  }

  const { rows } = await pool.query(
    `SELECT id FROM listings WHERE user_id = $1
     ORDER BY last_refreshed_at ASC NULLS FIRST, created_at ASC
     LIMIT $2`,
    [userId, QUEUE_SIZE]
  );
  const listingIds = rows.map((r) => r.id);
  const generatedAt = date.toISOString();

  await pool.query(
    `INSERT INTO queues (user_id, week, listing_ids, generated_at) VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, week) DO UPDATE SET listing_ids = $3, generated_at = $4`,
    [userId, week, JSON.stringify(listingIds), generatedAt]
  );

  return { week, listingIds, generatedAt };
}

module.exports = { getQueue, isoWeek };
