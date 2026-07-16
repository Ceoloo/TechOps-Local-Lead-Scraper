"""Controlled voice-product handoff contract.

The scraper NEVER auto-enrolls a contact into outreach. The handoff enforces
the required sequence:

    discovered -> scored -> qualified -> (human/policy approval) -> exported
    -> [ingested by voice product] -> [compliance gate] -> [campaign eligibility]

Only the first five steps live in this repo. Approval is an explicit gate;
without it, ``build_handoff_payload`` refuses to emit an export.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional

from .schema import Lead, QualificationStatus, OutreachEligibility

HANDOFF_CONTRACT_VERSION = "1.0"


class HandoffError(RuntimeError):
    pass


@dataclass
class ApprovalRecord:
    approved: bool
    approved_by: str
    note: str = ""


def approve_for_handoff(lead: Lead, approver: str, note: str = "") -> Lead:
    """Explicit human/policy approval gate. Only qualified leads are eligible."""
    if lead.qualification_status != QualificationStatus.QUALIFIED.value:
        raise HandoffError(
            f"lead {lead.lead_id} is not qualified "
            f"({lead.qualification_status}); cannot approve for handoff"
        )
    lead.outreach_eligibility = OutreachEligibility.APPROVED_FOR_HANDOFF.value
    lead.compliance_notes.append(f"approved_for_handoff by {approver}: {note}".strip())
    return lead


def build_handoff_payload(lead: Lead, *, correlation_id: str) -> dict[str, Any]:
    """Build the export payload sent to the Voice Appointment Setter.

    Raises ``HandoffError`` unless the lead has passed the approval gate.
    The payload contains only business-contact data appropriate for outreach;
    the downstream compliance gate makes the final eligibility decision.
    """
    if lead.outreach_eligibility != OutreachEligibility.APPROVED_FOR_HANDOFF.value:
        raise HandoffError(
            f"lead {lead.lead_id} has not been approved for handoff; "
            "the scraper will not enroll contacts into outreach"
        )
    return {
        "handoff_contract_version": HANDOFF_CONTRACT_VERSION,
        "correlation_id": correlation_id,
        "lead_id": lead.lead_id,
        "business_name": lead.business_name,
        "business_category": lead.business_category,
        "public_phone": lead.public_phone,
        "public_email": lead.public_email,
        "website": lead.website,
        "location": lead.location,
        "service_area": lead.service_area,
        "score": lead.score,
        "qualification_reasons": lead.qualification_reasons,
        # Explicitly NOT campaign-enrolled; downstream must run its own gate.
        "outreach_eligibility": lead.outreach_eligibility,
        "requires_compliance_gate": True,
    }
