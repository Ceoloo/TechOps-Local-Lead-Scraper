# Security — Local Lead Scraper
- All credentials via environment (`.env.example`); none committed.
- `scripts/secret_scan.py` runs in CI.
- Only business-contact data is stored; lead contact fields are masked in
  telemetry (`aion_events.redact_payload`). No consumer PII.
- Respect external source robots.txt / terms of service before scraping.
- Not claimed: pen-test, formal compliance certification.
