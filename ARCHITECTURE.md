# Architecture — Local Lead Scraper

## Data flow
```
raw sources -> normalize (domain/phone, dedupe, staleness)
            -> score_lead (explainable, reason codes) -> qualify
            -> lead.discovered / lead.scored / lead.qualified|rejected events
            -> [human/policy approval gate]
            -> build_handoff_payload -> lead.exported -> Voice Appointment Setter
```

## Key guarantees
- **No auto-outreach.** `build_handoff_payload` raises unless a lead passed
  `approve_for_handoff`. The payload sets `requires_compliance_gate: true`.
- **Explainable scoring.** Every score carries reason codes (`scoring.SIGNALS`).
- **Deterministic export.** Airtable upsert keyed on domain; CSV create-only;
  both support dry-run and schema validation.
- **PII-safe telemetry.** Only opaque IDs + score/category travel; contact
  fields are masked by the vendored `aion_events` contract.

## Lead schema
`schema.Lead` is versioned (`LEAD_SCHEMA_VERSION`). See fields in `schema.py`.
