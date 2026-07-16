"""Versioned lead contract for TechOps local-service opportunities."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional

LEAD_SCHEMA_VERSION = "1.0"


class QualificationStatus(str, Enum):
    PENDING = "pending"
    QUALIFIED = "qualified"
    REJECTED = "rejected"
    NEEDS_REVIEW = "needs_review"


class OutreachEligibility(str, Enum):
    # The scraper never enrolls anyone in outreach; it only marks eligibility
    # for the downstream compliance gate to evaluate.
    NOT_ELIGIBLE = "not_eligible"
    PENDING_APPROVAL = "pending_approval"
    APPROVED_FOR_HANDOFF = "approved_for_handoff"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class Lead:
    business_name: str
    business_category: str
    lead_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    schema_version: str = LEAD_SCHEMA_VERSION
    website: Optional[str] = None
    domain: Optional[str] = None
    public_phone: Optional[str] = None
    public_email: Optional[str] = None
    location: Optional[str] = None
    service_area: Optional[str] = None
    source: Optional[str] = None
    source_url: Optional[str] = None
    discovered_at: str = field(default_factory=_now)
    last_verified_at: Optional[str] = None
    signals: list[str] = field(default_factory=list)
    score: int = 0
    score_version: str = "0"
    qualification_status: str = QualificationStatus.PENDING.value
    qualification_reasons: list[str] = field(default_factory=list)
    data_confidence: float = 0.0
    outreach_eligibility: str = OutreachEligibility.NOT_ELIGIBLE.value
    compliance_notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Lead":
        known = {f for f in cls.__dataclass_fields__}  # type: ignore[attr-defined]
        return cls(**{k: v for k, v in data.items() if k in known})


REQUIRED_FIELDS = ("lead_id", "business_name", "business_category", "schema_version")


def validate_lead(lead: Lead | dict[str, Any]) -> list[str]:
    data = lead.to_dict() if isinstance(lead, Lead) else lead
    problems: list[str] = []
    for f in REQUIRED_FIELDS:
        if not data.get(f):
            problems.append(f"missing required field: {f}")
    if data.get("score") is not None and not (0 <= data["score"] <= 100):
        problems.append("score must be between 0 and 100")
    conf = data.get("data_confidence", 0.0)
    if conf is not None and not (0.0 <= conf <= 1.0):
        problems.append("data_confidence must be between 0.0 and 1.0")
    return problems
