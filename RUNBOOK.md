# Runbook — Local Lead Scraper

## Normal operation
1. Ingest raw leads. 2. `run_pipeline()` scores + emits events.
3. Review `needs_review`/`qualified`. 4. Approve qualified leads for handoff.
5. Export (CSV/Airtable) and emit `lead.exported`.

## Rollback
This is a stateless worker. To roll back, redeploy the previous image tag;
no schema migration is required. Exports are idempotent (upsert on domain),
so re-running a prior batch will not duplicate records.

## Common issues
- **Export skips leads**: check `ExportSummary.errors` for schema problems.
- **Handoff refused**: lead not approved; call `approve_for_handoff` first.
- **Duplicate leads**: verify `domain`/`phone` normalization populated dedupe key.
