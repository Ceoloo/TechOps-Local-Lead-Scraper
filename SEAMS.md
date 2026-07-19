# SEAMS — Local Lead Scraper

| Integration | Adapter | Unit tested | Mock tested | Live creds | Live test | Result | Remaining risk |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Airtable | `export.export_airtable` + `FakeAirtableClient` | ✓ | ✓ | no | no | mocked | real pyairtable client not wired |
| CSV export | `export.export_csv` | ✓ | n/a | n/a | n/a | local | none |
| External lead sources | (contract only) | — | — | no | no | not built | robots/ToS compliance to implement |
| AION telemetry | `aion_events` + injectable sink | ✓ | ✓ | n/a | no | mocked | HTTP transport not load-tested |
| Voice product handoff | `handoff.build_handoff_payload` | ✓ | ✓ | n/a | no | contract-tested | end-to-end with live voice repo pending |

No integration validated against live credentials this sprint.
