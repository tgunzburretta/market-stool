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

function staleness(listing) {
  return listing.lastRefreshedAt ? new Date(listing.lastRefreshedAt).getTime() : -Infinity;
}

// Returns this week's stale-listing queue, regenerating it (and persisting the
// choice onto `db.queue`) the first time it's asked for in a new ISO week.
function getQueue(db, date = new Date()) {
  const week = isoWeek(date);
  const existingIds = db.queue && db.queue.week === week ? db.queue.listingIds : null;

  if (existingIds) {
    const stillValid = existingIds.filter((id) => db.listings.some((l) => l.id === id));
    if (stillValid.length === existingIds.length) {
      return db.queue;
    }
  }

  const sorted = [...db.listings].sort((a, b) => {
    const diff = staleness(a) - staleness(b);
    if (diff !== 0) return diff;
    return new Date(a.createdAt) - new Date(b.createdAt);
  });

  db.queue = {
    week,
    listingIds: sorted.slice(0, QUEUE_SIZE).map((l) => l.id),
    generatedAt: date.toISOString(),
  };
  return db.queue;
}

module.exports = { getQueue, isoWeek };
