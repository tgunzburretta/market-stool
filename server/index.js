const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const pgSessionStore = require('connect-pg-simple')(session);

const { pool, initSchema } = require('./db');
const { signup, verifyLogin, requireAuth } = require('./auth');
const { buildRewrite, seasonalKeywordsFor } = require('./rewrite');
const { getQueue } = require('./queue');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

if (!process.env.SESSION_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('SESSION_SECRET is required in production — set it to a long random string');
}

const app = express();
app.set('trust proxy', 1);
app.use(express.json());
app.use(
  session({
    store: new pgSessionStore({ pool, createTableIfMissing: true }),
    secret: process.env.SESSION_SECRET || 'dev-only-secret-do-not-use-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 30 * 24 * 60 * 60 * 1000,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    },
  })
);
app.use(express.static(PUBLIC_DIR));

function normalizeTags(tags) {
  if (Array.isArray(tags)) return tags.map((t) => String(t).trim()).filter(Boolean);
  if (typeof tags === 'string') return tags.split(',').map((t) => t.trim()).filter(Boolean);
  return [];
}

function toListingJson(row) {
  return {
    id: row.id,
    title: row.title,
    tags: row.tags,
    description: row.description,
    category: row.category,
    createdAt: row.created_at.toISOString(),
    lastRefreshedAt: row.last_refreshed_at ? row.last_refreshed_at.toISOString() : null,
  };
}

function asyncRoute(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

// --- Auth ---

app.post(
  '/api/signup',
  asyncRoute(async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !String(email).includes('@') || !password || password.length < 8) {
      return res.status(400).json({ error: 'A valid email and a password of at least 8 characters are required' });
    }
    const user = await signup(String(email).trim().toLowerCase(), password);
    req.session.userId = user.id;
    req.session.userEmail = user.email;
    res.status(201).json({ email: user.email });
  })
);

app.post(
  '/api/login',
  asyncRoute(async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
    const user = await verifyLogin(String(email).trim().toLowerCase(), password);
    req.session.userId = user.id;
    req.session.userEmail = user.email;
    res.json({ email: user.email });
  })
);

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.status(204).end());
});

app.get('/api/me', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Not signed in' });
  res.json({ id: req.session.userId, email: req.session.userEmail });
});

// --- Listings (scoped to the signed-in seller) ---

app.get(
  '/api/listings',
  requireAuth,
  asyncRoute(async (req, res) => {
    const { rows } = await pool.query(
      'SELECT * FROM listings WHERE user_id = $1 ORDER BY created_at ASC',
      [req.session.userId]
    );
    res.json(rows.map(toListingJson));
  })
);

app.get(
  '/api/listings/:id',
  requireAuth,
  asyncRoute(async (req, res) => {
    const { rows } = await pool.query('SELECT * FROM listings WHERE id = $1 AND user_id = $2', [
      req.params.id,
      req.session.userId,
    ]);
    if (!rows.length) return res.status(404).json({ error: 'Listing not found' });
    res.json(toListingJson(rows[0]));
  })
);

app.post(
  '/api/listings',
  requireAuth,
  asyncRoute(async (req, res) => {
    const { title, tags, description, category } = req.body || {};
    if (!title || !String(title).trim()) {
      return res.status(400).json({ error: 'title is required' });
    }
    const id = `lst_${crypto.randomBytes(6).toString('hex')}`;
    const { rows } = await pool.query(
      `INSERT INTO listings (id, user_id, title, tags, description, category)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        id,
        req.session.userId,
        String(title).trim(),
        JSON.stringify(normalizeTags(tags)),
        description ? String(description).trim() : '',
        category ? String(category).trim() : '',
      ]
    );
    res.status(201).json(toListingJson(rows[0]));
  })
);

app.put(
  '/api/listings/:id',
  requireAuth,
  asyncRoute(async (req, res) => {
    const { title, tags, description, category } = req.body || {};
    const { rows } = await pool.query(
      `UPDATE listings SET
         title = COALESCE($1, title),
         tags = COALESCE($2, tags),
         description = COALESCE($3, description),
         category = COALESCE($4, category)
       WHERE id = $5 AND user_id = $6 RETURNING *`,
      [
        typeof title === 'string' && title.trim() ? title.trim() : null,
        tags !== undefined ? JSON.stringify(normalizeTags(tags)) : null,
        typeof description === 'string' ? description.trim() : null,
        typeof category === 'string' ? category.trim() : null,
        req.params.id,
        req.session.userId,
      ]
    );
    if (!rows.length) return res.status(404).json({ error: 'Listing not found' });
    res.json(toListingJson(rows[0]));
  })
);

app.delete(
  '/api/listings/:id',
  requireAuth,
  asyncRoute(async (req, res) => {
    const result = await pool.query('DELETE FROM listings WHERE id = $1 AND user_id = $2', [
      req.params.id,
      req.session.userId,
    ]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Listing not found' });
    res.status(204).end();
  })
);

// Applies an accepted rewrite to a listing and marks it refreshed for this week.
app.post(
  '/api/listings/:id/refresh',
  requireAuth,
  asyncRoute(async (req, res) => {
    const { title, tags, description } = req.body || {};
    const { rows } = await pool.query(
      `UPDATE listings SET
         title = COALESCE($1, title),
         tags = COALESCE($2, tags),
         description = COALESCE($3, description),
         last_refreshed_at = now()
       WHERE id = $4 AND user_id = $5 RETURNING *`,
      [
        typeof title === 'string' && title.trim() ? title.trim() : null,
        tags !== undefined ? JSON.stringify(normalizeTags(tags)) : null,
        typeof description === 'string' && description.trim() ? description.trim() : null,
        req.params.id,
        req.session.userId,
      ]
    );
    if (!rows.length) return res.status(404).json({ error: 'Listing not found' });
    res.json(toListingJson(rows[0]));
  })
);

// --- Rewrite tool (works on any pasted listing, saved or not) ---

app.post('/api/rewrite', requireAuth, (req, res) => {
  const { title, tags, description } = req.body || {};
  if (!title || !String(title).trim()) {
    return res.status(400).json({ error: 'title is required' });
  }
  const rewrite = buildRewrite({ title, tags: normalizeTags(tags), description });
  res.json(rewrite);
});

app.get('/api/seasonal', requireAuth, (req, res) => {
  res.json({ keywords: seasonalKeywordsFor(new Date()) });
});

// --- Weekly refresh queue ---

app.get(
  '/api/queue',
  requireAuth,
  asyncRoute(async (req, res) => {
    const queue = await getQueue(req.session.userId);
    const { rows } = await pool.query('SELECT * FROM listings WHERE user_id = $1 AND id = ANY($2::text[])', [
      req.session.userId,
      queue.listingIds,
    ]);
    const listingsById = new Map(rows.map((r) => [r.id, toListingJson(r)]));
    const listings = queue.listingIds.map((id) => listingsById.get(id)).filter(Boolean);
    const refreshedCount = listings.filter((l) => l.lastRefreshedAt && l.lastRefreshedAt >= queue.generatedAt).length;

    res.json({ week: queue.week, generatedAt: queue.generatedAt, listings, refreshedCount });
  })
);

app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message || 'Something went wrong' });
});

const PORT = process.env.PORT || 3000;
initSchema()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Listing refresher running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize database schema:', err);
    process.exit(1);
  });
