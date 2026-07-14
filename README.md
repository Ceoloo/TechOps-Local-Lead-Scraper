# TechOps Lead Finder

A Node.js + Playwright scraper that identifies **qualified local service business
leads** (electrical, HVAC, plumbing, commercial maintenance) for the TechOps
business-infrastructure consulting offer.

It searches Google for local service businesses, analyzes each business's own
website for digital-maturity signals (booking tools, mobile responsiveness,
SSL, recency), scores the **opportunity** each represents, and exports ranked
leads plus a market-analysis report.

---

## What it produces

Written to `./output/`:

| File | Contents |
| --- | --- |
| `leads.csv` | Flat, ranked table of qualified leads |
| `leads.json` | Same leads with full website-analysis detail |
| `market-analysis.md` | Totals, category breakdown, `% no website`, `% no booking`, averages, and a ranked **top-15 opportunity** table |

For each business it captures: `business_name`, `category`, `full_address`,
`phone`, `website_url`, `has_website`, `google_rating`, `review_count`,
`maps_url`, `place_id`, `last_review_snippet_date`, `digital_maturity_score`
(1–5), and `opportunity_score` (1–10).

---

## Setup

```bash
# 1. Install dependencies
npm install

# 2. (Fallback mode only) install the Chromium browser for Playwright
npx playwright install chromium

# 3. Configure secrets
cp .env.example .env
#   then edit .env and add your keys
```

### `.env`

```
GOOGLE_PLACES_API_KEY=      # optional — see data sources below
AIRTABLE_API_KEY=           # optional — only for --sync-airtable
AIRTABLE_BASE_ID=           # optional
AIRTABLE_TABLE_NAME=Leads   # optional (default: Leads)
```

Secrets are **never** hardcoded — they are read from `.env` only, which is
git-ignored.

---

## Running

```bash
node main.js
```

Optional flags:

```bash
node main.js --sync-airtable          # also push leads to Airtable
node main.js --config ./other.json    # use a different config file
```

The run logs each stage and prints a final summary.

---

## Data sources

1. **Primary — Google Places API (New).** If `GOOGLE_PLACES_API_KEY` is set,
   the scraper uses the official **Text Search** + place data endpoints. This
   is fast, reliable, and terms-compliant. Get a key from the
   [Google Cloud console](https://console.cloud.google.com/) and enable
   "Places API (New)".

2. **Fallback — Playwright Google Maps scraper.** If **no** API key is present,
   the scraper drives a headless Chromium browser against Google Maps with
   **randomized 2–6s delays** and a **rotating user-agent pool**. It logs
   clearly that it is running in `PLAYWRIGHT FALLBACK MODE`. This path is
   best-effort — Google's markup changes often, and Maps may throttle or
   present consent screens.

Either way, each result's website is then fetched and analyzed for:
online booking/scheduling widget, mobile-responsive `<meta viewport>`, a
contact form, SSL, and a detectable copyright / last-modified year.

---

## Scoring rules

**Qualification filter** — a lead is kept only if
`google_rating >= 4.0` **AND** `review_count >= 20`.

**`opportunity_score`** (starts at 5, clamped to 1–10):

| Condition | Adjustment |
| --- | --- |
| No website | **+2** |
| Has website but no online booking/scheduling widget | **+2** |
| Website looks outdated (no SSL, no mobile viewport, or copyright > 2 yrs old) | **+1** |
| Already shows strong modern tooling (booking + responsive + recent) | **−3** |

**`digital_maturity_score`** (1–5): baseline 1, `+1` each for having a website,
a booking tool, mobile responsiveness, and recent activity.

**Deduplication** — leads are de-duplicated on a normalized
`business_name + street_address` key; records found via multiple search terms
are merged.

---

## Configuration

All search inputs live in `config.json` (no code changes needed):

```jsonc
{
  "targetArea": {
    "primaryCity": "Edison",
    "state": "NJ",
    "cities": [ { "city": "Edison", "state": "NJ", "zip": "08817" } ]
  },
  "searchTerms": [
    "Electrician Edison NJ",
    "HVAC Contractor Edison NJ"
  ],
  "seedBusinesses": [ "Gold Medal Electric" ],
  "categoryFilters": ["electrical", "HVAC", "plumbing", "commercial maintenance"],
  "categoryKeywords": { "electrical": ["electric", "electrician"] },
  "scoring": { "minRating": 4.0, "minReviewCount": 20, "outdatedCopyrightYears": 2 },
  "scraper": { "minDelayMs": 2000, "maxDelayMs": 6000, "maxResultsPerSearch": 60 }
}
```

### Add a new search term or city

Just append to the arrays:

- **New search term** → add a string to `searchTerms`, e.g.
  `"Commercial HVAC Metuchen NJ"`.
- **New town** → add an object to `targetArea.cities`, and add matching
  `searchTerms` for that town (search terms drive the actual queries).
- **New seed business** → add a name to `seedBusinesses`; it's looked up with
  the primary city/state appended.
- **Tune categories** → edit `categoryKeywords` so new business types map to a
  category label.

---

## Airtable sync (optional)

With `--sync-airtable` and `AIRTABLE_API_KEY` + `AIRTABLE_BASE_ID` set, each
qualified lead is pushed to the configured table (default `Leads`) in batches
of 10, with `typecast` enabled. Create a table with columns matching the field
names in `src/airtable.js` (Business Name, Category, Full Address, Phone,
Website, Has Website, Google Rating, Review Count, Maps URL, Place ID,
Last Review Date, Digital Maturity Score, Opportunity Score).

---

## Project structure

```
main.js              # pipeline orchestration + CLI
config.json          # search terms, cities, seeds, scoring knobs
.env                 # secrets (git-ignored)
src/
  search.js          # Places API + Playwright fallback → raw results
  enrich.js          # website fetch + digital-maturity analysis
  score.js           # qualify filter, opportunity scoring, dedupe
  export.js          # leads.csv, leads.json, market-analysis.md
  airtable.js        # optional Airtable REST sync
  utils.js           # logging, delays, UA rotation, helpers
output/              # generated results (git-ignored)
```

---

## Notes & compliance

- Prefer the **Places API** path where possible — the Playwright fallback
  scrapes Google Maps, which may conflict with Google's Terms of Service and
  can break without notice. Use it responsibly and at your own risk.
- Randomized delays and rotating user agents in the fallback are there to be a
  polite, low-volume client — not to defeat anti-abuse systems.
- This tool collects only publicly listed business information.
