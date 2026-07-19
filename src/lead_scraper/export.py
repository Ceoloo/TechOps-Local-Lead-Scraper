"""Export adapters: CSV and Airtable (mock).

Both adapters support dry-run, deterministic IDs, upsert semantics, schema
validation, and an export summary. The Airtable adapter is a contract-tested
fake; a real client must be configured via env and is documented in SEAMS.md.
"""

from __future__ import annotations

import csv
import io
from dataclasses import dataclass, field
from typing import Any, Iterable, Optional, Protocol

from .schema import Lead, validate_lead

EXPORT_COLUMNS = [
    "lead_id", "business_name", "business_category", "website", "domain",
    "public_phone", "public_email", "location", "service_area", "source",
    "source_url", "discovered_at", "last_verified_at", "score", "score_version",
    "qualification_status", "data_confidence", "outreach_eligibility",
]


@dataclass
class ExportSummary:
    attempted: int = 0
    created: int = 0
    updated: int = 0
    skipped_invalid: int = 0
    errors: list[str] = field(default_factory=list)
    dry_run: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "attempted": self.attempted,
            "created": self.created,
            "updated": self.updated,
            "skipped_invalid": self.skipped_invalid,
            "errors": self.errors,
            "dry_run": self.dry_run,
        }


def _valid_rows(leads: Iterable[Lead], summary: ExportSummary) -> list[Lead]:
    out: list[Lead] = []
    for lead in leads:
        summary.attempted += 1
        problems = validate_lead(lead)
        if problems:
            summary.skipped_invalid += 1
            summary.errors.append(f"{getattr(lead, 'lead_id', '?')}: {'; '.join(problems)}")
            continue
        out.append(lead)
    return out


def export_csv(leads: Iterable[Lead], *, dry_run: bool = False) -> tuple[str, ExportSummary]:
    """Serialize leads to CSV text. Returns (csv_text, summary)."""
    summary = ExportSummary(dry_run=dry_run)
    rows = _valid_rows(leads, summary)
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=EXPORT_COLUMNS, extrasaction="ignore")
    writer.writeheader()
    for lead in rows:
        writer.writerow(lead.to_dict())
        summary.created += 1  # CSV is create-only
    return buf.getvalue(), summary


class AirtableClient(Protocol):
    def upsert(self, table: str, key_field: str, record: dict[str, Any]) -> str:
        """Return 'created' or 'updated'."""
        ...


class FakeAirtableClient:
    """In-memory Airtable stand-in for contract tests (upsert on key_field)."""

    def __init__(self) -> None:
        self.tables: dict[str, dict[str, dict]] = {}

    def upsert(self, table: str, key_field: str, record: dict[str, Any]) -> str:
        store = self.tables.setdefault(table, {})
        key = record.get(key_field)
        result = "updated" if key in store else "created"
        store[key] = record
        return result


def export_airtable(
    leads: Iterable[Lead],
    client: AirtableClient,
    *,
    table: str = "Leads",
    key_field: str = "domain",
    dry_run: bool = False,
    incremental_since: Optional[str] = None,
) -> ExportSummary:
    """Upsert leads into Airtable via the injected client.

    - ``dry_run`` validates and counts without writing.
    - ``incremental_since`` skips leads discovered at/before the watermark.
    - upsert is keyed on ``key_field`` (default domain) for deterministic IDs.
    """
    summary = ExportSummary(dry_run=dry_run)
    rows = _valid_rows(leads, summary)
    for lead in rows:
        if incremental_since and lead.discovered_at <= incremental_since:
            continue
        record = {c: lead.to_dict().get(c) for c in EXPORT_COLUMNS}
        if not record.get(key_field):
            summary.skipped_invalid += 1
            summary.errors.append(f"{lead.lead_id}: missing key_field '{key_field}'")
            continue
        if dry_run:
            summary.created += 1
            continue
        try:
            result = client.upsert(table, key_field, record)
            if result == "updated":
                summary.updated += 1
            else:
                summary.created += 1
        except Exception as exc:  # pragma: no cover - defensive
            summary.errors.append(f"{lead.lead_id}: {exc}")
    return summary
