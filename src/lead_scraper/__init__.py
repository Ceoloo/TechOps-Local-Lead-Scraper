"""TechOps Local Lead Scraper — acquisition intelligence for local services.

Discovers, enriches, scores, and exports qualified leads. It does NOT initiate
outreach; a controlled, approval-gated handoff passes qualified leads to the
Voice Appointment Setter, which runs its own compliance gate.
"""

from .schema import Lead, QualificationStatus, OutreachEligibility, LEAD_SCHEMA_VERSION
from .scoring import score_lead, SIGNALS, SCORE_VERSION
from .normalize import normalize_lead, deduplicate, is_stale, normalize_phone, normalize_domain
from .export import export_csv, export_airtable, FakeAirtableClient, ExportSummary
from .handoff import approve_for_handoff, build_handoff_payload, HandoffError
from .pipeline import run_pipeline, emit_export

__version__ = "1.0.0"

__all__ = [
    "Lead", "QualificationStatus", "OutreachEligibility", "LEAD_SCHEMA_VERSION",
    "score_lead", "SIGNALS", "SCORE_VERSION",
    "normalize_lead", "deduplicate", "is_stale", "normalize_phone", "normalize_domain",
    "export_csv", "export_airtable", "FakeAirtableClient", "ExportSummary",
    "approve_for_handoff", "build_handoff_payload", "HandoffError",
    "run_pipeline", "emit_export",
]
