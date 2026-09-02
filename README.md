# Listing Refresh — Etsy & print-on-demand listing refresher

**Niche:** Etsy/POD sellers with 20–200 listings.
**Problem:** listings stagnate — rewriting titles and tags by hand is the job nobody does.
**MVP:** paste a listing, get a rewritten title/tags/first line back, plus seasonal keyword prompts and a weekly queue that surfaces the 5 stalest listings.
**Trigger:** the queue — a fresh 5 to touch every week.
**Pricing idea:** £9/mo.

This is deliberately narrower than a research tool like eRank: it doesn't tell you what to research, it does the rewriting and tells you which five listings to touch this week.

## How it works

1. Add your listings once (title, tags, description, category) — paste in what's currently live on Etsy.
2. Each week, the **queue** surfaces the 5 listings that have gone longest without a refresh (never-refreshed listings first). The same 5 stay on the queue all week so progress is visible.
3. Open a listing from the queue (or from **All listings**) to get a rewritten title, tags and opening line, shown side-by-side with the original, plus 2–3 seasonal keyword prompts for the current month (e.g. "Autumn", "Halloween Prep" in September).
4. Tweak anything you don't like, then **Save refresh** — this updates the listing and marks it refreshed, so next week's queue pulls in different stale listings.
5. The **Rewrite tool** does the same rewrite for any pasted listing without needing to save it first — handy for a listing you haven't added yet, or one-off polishing.

## The rewrite engine

The rewriter is a rule-based heuristic, not a call to an LLM: it re-scores and reorders the words the seller already used (title, tags, description) using well-known Etsy SEO conventions — front-load the highest-signal keyword phrase, remove title/tag duplication, respect the 140-character title limit and the 13-tag/20-character tag limits, and weave in the current month's seasonal terms. See `server/rewrite.js`. It's intentionally simple so it's cheap to run and fully deterministic; swapping in a real AI rewrite call once the workflow is validated with real sellers is a drop-in replacement for that one module.

## Running it

```bash
npm install
npm start
```

Then open `http://localhost:3000`. Eight demo listings are seeded with varying refresh history so the weekly queue and staleness sorting are visible immediately.

## What's intentionally out of scope for the MVP

- Accounts/auth (anyone with the URL can add or refresh listings — fine for a solo seller pilot, not multi-tenant production)
- A real database (JSON file storage; swap for Postgres/SQLite once validated)
- An actual Etsy API connection (listings are pasted in by hand rather than synced)
- A true AI rewrite (the heuristic engine above; swap for an LLM call once validated)
- Payment/subscription billing, email reminders when the weekly queue refreshes

## Project layout

```
server/
  index.js    Express API — listings, rewrite, weekly queue
  db.js       JSON "database" load/save
  rewrite.js  Heuristic title/tags/first-line rewriter + seasonal keyword map
  queue.js    Weekly stale-listing queue selection
public/       Vanilla JS single-page frontend (mobile-first, no build step)
data/db.json  JSON "database" (listings + this week's queue)
```
