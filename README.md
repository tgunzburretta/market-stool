# CleanProof — turnaround proof for short-let cleaners

**Niche:** cleaners servicing Airbnb/short-let hosts.
**Problem:** disputes over "it wasn't cleaned properly" with no evidence either way.
**MVP:** per-property checklist → before/after photo capture per item → timestamped PDF report generated and (optionally) emailed to the host the moment the job is marked complete.
**Trigger:** every changeover — several a week per cleaner.
**Pricing idea:** £6/mo per cleaner, or £15/mo per property for the host.

## How it works

1. A host or cleaner adds a **property** once, with its cleaning checklist and the host's email.
2. At each changeover, the cleaner opens the app on their phone, picks the property, and starts a job.
3. For every checklist item they capture a **before** and **after** photo and tick it done.
4. Once every item is done with an after photo, they hit **Complete & send report**.
5. The server generates a timestamped PDF (property, cleaner, per-item before/after photos with capture times) and emails it to the host if SMTP is configured — otherwise it's available to view/download immediately.

This is a proof-of-concept: data is stored in a local JSON file and uploaded photos on disk, which is enough to validate the workflow with real cleaners before investing in a database/auth/multi-tenant backend.

## Running it

```bash
npm install
npm start
```

Then open `http://localhost:3000`. A demo property ("Riverside Loft") is seeded so you can try a full changeover immediately.

### Sending real emails (optional)

Without SMTP configuration, completed reports are generated and downloadable, but not emailed — the app tells the cleaner to forward the PDF themselves. To enable emailing, set:

```bash
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=you@example.com
SMTP_PASS=your-password
SMTP_FROM=you@example.com   # optional, defaults to SMTP_USER
```

## What's intentionally out of scope for the MVP

- Accounts/auth (anyone with the URL can add properties or run a changeover — fine for a pilot with one cleaner/agency, not for multi-tenant production)
- A real database (JSON file storage; swap for Postgres/SQLite once validated)
- Editing/deleting properties or re-opening a completed job
- Push notifications, host-side dashboard, or payment/subscription billing

## Project layout

```
server/       Express API — properties, jobs, photo upload, PDF generation, email
public/       Vanilla JS single-page frontend (mobile-first, no build step)
data/db.json  JSON "database" (properties + jobs)
uploads/      Captured before/after photos
reports/      Generated PDF reports
```
