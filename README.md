# TechOps Local Lead Scraper

Acquisition intelligence for TechOps local-service opportunities (electrical,
HVAC, plumbing, commercial maintenance). It **discovers, enriches, scores, and
exports** qualified leads. It does **not** initiate outreach.

## Purpose
Turn public local-business signals into explainably-scored, deduplicated,
qualified leads and hand them off — under explicit approval — to the Voice
Appointment Setter, which runs its own compliance gate.

## Architecture
`src/lead_scraper/`: `schema` (versioned Lead) · `normalize` (domain/phone
canonicalization, dedupe, staleness) · `scoring` (explainable, reason-coded) ·
`export` (CSV + Airtable upsert with dry-run) · `handoff` (approval-gated voice
handoff) · `pipeline` (emits `lead.*` events) · `aion_events` (vendored AION
event contract). See `ARCHITECTURE.md`.

## Current status
Unit-tested (16 tests). Airtable and external sources are **mock/contract-tested
only** — no live credentials exercised. See `SEAMS.md`.

## Local setup & tests
```bash
PYTHONPATH=src python -m pytest -q
```

## Environment variables
See `.env.example` (`AIRTABLE_*`, `AION_TELEMETRY_URL`, `LEAD_SOURCE_API_KEY`).
No secrets are committed; `scripts/secret_scan.py` gates CI.

## Integrations
- **Airtable** — `export_airtable()` via injectable client (fake for tests).
- **AION ecosystem** — emits `lead.discovered/scored/qualified/rejected/exported`
  conforming to the shared event schema. PII never travels raw in telemetry.

## Security notes
Only business-contact data appropriate for the use case is stored. Lead contact
fields are masked in telemetry. Respect source robots/ToS (documented in SEAMS).

## Live validation status
None. All integrations mocked. Production-readiness score is emitted to
`artifacts/production-readiness.json` in CI.

## Current limitations / roadmap
- Real source connectors and a Postgres store are not yet implemented.
- Monitoring/backup not yet configured.
- Roadmap: live Airtable adapter, source connectors, enrichment providers.

## Relationship to the AION ecosystem
First stage of the revenue workflow: `lead.qualified -> approval -> lead.exported
-> Voice Appointment Setter intake -> compliance gate`. See
`Ceoloo/aion-company-os/AION_ECOSYSTEM_ARCHITECTURE.md`.
