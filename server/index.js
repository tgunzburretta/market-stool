const path = require('path');
const crypto = require('crypto');
const express = require('express');

const db = require('./db');
const { buildRewrite, seasonalKeywordsFor } = require('./rewrite');
const { getQueue } = require('./queue');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const app = express();
app.use(express.json());
app.use(express.static(PUBLIC_DIR));

function findListing(data, id) {
  return data.listings.find((l) => l.id === id);
}

function normalizeTags(tags) {
  if (Array.isArray(tags)) return tags.map((t) => String(t).trim()).filter(Boolean);
  if (typeof tags === 'string') return tags.split(',').map((t) => t.trim()).filter(Boolean);
  return [];
}

// --- Listings ---

app.get('/api/listings', (req, res) => {
  const data = db.load();
  res.json(data.listings);
});

app.get('/api/listings/:id', (req, res) => {
  const data = db.load();
  const listing = findListing(data, req.params.id);
  if (!listing) return res.status(404).json({ error: 'Listing not found' });
  res.json(listing);
});

app.post('/api/listings', (req, res) => {
  const { title, tags, description, category } = req.body || {};
  if (!title || !title.trim()) {
    return res.status(400).json({ error: 'title is required' });
  }

  const data = db.load();
  const listing = {
    id: `lst_${crypto.randomBytes(6).toString('hex')}`,
    title: title.trim(),
    tags: normalizeTags(tags),
    description: description ? String(description).trim() : '',
    category: category ? String(category).trim() : '',
    createdAt: new Date().toISOString(),
    lastRefreshedAt: null,
  };
  data.listings.push(listing);
  db.save(data);
  res.status(201).json(listing);
});

app.put('/api/listings/:id', (req, res) => {
  const data = db.load();
  const listing = findListing(data, req.params.id);
  if (!listing) return res.status(404).json({ error: 'Listing not found' });

  const { title, tags, description, category } = req.body || {};
  if (typeof title === 'string' && title.trim()) listing.title = title.trim();
  if (tags !== undefined) listing.tags = normalizeTags(tags);
  if (typeof description === 'string') listing.description = description.trim();
  if (typeof category === 'string') listing.category = category.trim();

  db.save(data);
  res.json(listing);
});

app.delete('/api/listings/:id', (req, res) => {
  const data = db.load();
  const index = data.listings.findIndex((l) => l.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Listing not found' });
  data.listings.splice(index, 1);
  db.save(data);
  res.status(204).end();
});

// Applies an accepted rewrite to a listing and marks it refreshed for this week.
app.post('/api/listings/:id/refresh', (req, res) => {
  const data = db.load();
  const listing = findListing(data, req.params.id);
  if (!listing) return res.status(404).json({ error: 'Listing not found' });

  const { title, tags, description } = req.body || {};
  if (typeof title === 'string' && title.trim()) listing.title = title.trim();
  if (tags !== undefined) listing.tags = normalizeTags(tags);
  if (typeof description === 'string' && description.trim()) listing.description = description.trim();
  listing.lastRefreshedAt = new Date().toISOString();

  db.save(data);
  res.json(listing);
});

// --- Rewrite tool (works on any pasted listing, saved or not) ---

app.post('/api/rewrite', (req, res) => {
  const { title, tags, description } = req.body || {};
  if (!title || !String(title).trim()) {
    return res.status(400).json({ error: 'title is required' });
  }
  const rewrite = buildRewrite({ title, tags: normalizeTags(tags), description });
  res.json(rewrite);
});

app.get('/api/seasonal', (req, res) => {
  res.json({ keywords: seasonalKeywordsFor(new Date()) });
});

// --- Weekly refresh queue ---

app.get('/api/queue', (req, res) => {
  const data = db.load();
  const queue = getQueue(data);
  db.save(data);

  const listings = queue.listingIds.map((id) => findListing(data, id)).filter(Boolean);
  const refreshedCount = listings.filter(
    (l) => l.lastRefreshedAt && l.lastRefreshedAt >= queue.generatedAt
  ).length;

  res.json({ week: queue.week, generatedAt: queue.generatedAt, listings, refreshedCount });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Listing refresher running on http://localhost:${PORT}`);
});
