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

## Accounts & data

Each seller signs up with an email + password. Listings, the weekly queue and sessions are all scoped to the signed-in account and stored in Postgres — one seller's data is never visible to another, so this is safe to open up to multiple real sellers rather than just a single-tenant pilot.

## Running it

Requires a Postgres database. Locally:

```bash
createdb listing_refresh
npm install
DATABASE_URL=postgresql://localhost/listing_refresh npm start
```

Then open `http://localhost:3000` and sign up. There's no seed data — a new account starts empty, same as a real seller would.

Environment variables:

- `DATABASE_URL` (required) — Postgres connection string. TLS is enabled automatically unless the host is `localhost`/`127.0.0.1`, which covers both local dev and hosts like Railway's managed Postgres.
- `SESSION_SECRET` — a long random string used to sign session cookies. Required in production (`NODE_ENV=production`); a fallback dev-only value is used otherwise.
- `PORT` — defaults to 3000.

## What's intentionally out of scope for the MVP

- An actual Etsy API connection (listings are pasted in by hand rather than synced)
- A true AI rewrite (the heuristic engine below; swap for an LLM call once validated)
- Payment/subscription billing, email reminders when the weekly queue refreshes, password reset

## Project layout

```
server/
  index.js    Express API, sessions, auth routes — listings, rewrite, weekly queue
  db.js       Postgres connection pool + schema setup
  auth.js     Signup/login/password hashing + the requireAuth middleware
  rewrite.js  Heuristic title/tags/first-line rewriter + seasonal keyword map
  queue.js    Weekly stale-listing queue selection, per seller
public/       Vanilla JS single-page frontend (mobile-first, no build step)
```
