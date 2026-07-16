"""Explainable lead scoring with reason codes.

Every point of score is attributable to a named signal, so a human (or the
Executive Dashboard) can see exactly *why* a lead qualified or was rejected.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from .schema import Lead, QualificationStatus, OutreachEligibility
from .normalize import has_valid_contact, is_stale

SCORE_VERSION = "1.0"

# Each signal: (reason_code, points, predicate). Positive points = stronger
# opportunity (a digital gap we can help with); negative = disqualifier.
SignalFn = Callable[[Lead], bool]


@dataclass(frozen=True)
class Signal:
    code: str
    points: int
    predicate: SignalFn
    description: str


def _no_website(lead: Lead) -> bool:
    return not (lead.website or lead.domain)


def _has_signal(name: str) -> SignalFn:
    return lambda lead: name in (lead.signals or [])


SIGNALS: tuple[Signal, ...] = (
    Signal("NO_WEBSITE", 25, _no_website, "No website at all (high opportunity)"),
    Signal("OUTDATED_WEBSITE", 15, _has_signal("outdated_website"), "Outdated website"),
    Signal("NO_MOBILE", 10, _has_signal("broken_mobile"), "Broken mobile experience"),
    Signal("NO_ONLINE_BOOKING", 12, _has_signal("no_online_booking"), "No online booking flow"),
    Signal("NO_CRM_INTAKE", 8, _has_signal("no_intake_flow"), "No visible CRM/intake flow"),
    Signal("WEAK_REVIEWS", 6, _has_signal("weak_review_response"), "Weak review response"),
    Signal("MISSING_STRUCTURED_DATA", 4, _has_signal("missing_structured_data"), "No structured data"),
    Signal("SLOW_SITE", 5, _has_signal("slow_site"), "Slow site"),
    Signal("NO_CTA", 5, _has_signal("no_clear_cta"), "No clear CTA"),
    Signal("LOW_AI_VISIBILITY", 6, _has_signal("low_ai_visibility"), "Low AI visibility"),
    Signal("POOR_LOCAL_SEARCH", 8, _has_signal("poor_local_search"), "Poor local-search presence"),
    Signal("STRONG_DEMAND", 10, _has_signal("strong_service_demand"), "Strong service demand"),
    Signal("REACHABLE_CONTACT", 10, has_valid_contact, "Reachable public business contact"),
    # Disqualifiers
    Signal("STALE_LISTING", -20, is_stale, "Duplicate or stale listing"),
    Signal("NO_CONTACT", -30, lambda l: not has_valid_contact(l), "No reachable contact"),
)


def score_lead(lead: Lead, *, qualify_threshold: int = 50) -> Lead:
    """Score a lead in place and set qualification + reason codes."""
    total = 0
    reasons: list[str] = []
    for sig in SIGNALS:
        try:
            fired = sig.predicate(lead)
        except Exception:
            fired = False
        if fired:
            total += sig.points
            reasons.append(f"{sig.code}({sig.points:+d}): {sig.description}")

    total = max(0, min(100, total))
    lead.score = total
    lead.score_version = SCORE_VERSION
    lead.qualification_reasons = reasons

    # Confidence reflects how much verified contact/attribution we have.
    confidence = 0.0
    if has_valid_contact(lead):
        confidence += 0.5
    if lead.source_url:
        confidence += 0.25
    if not is_stale(lead):
        confidence += 0.25
    lead.data_confidence = round(min(1.0, confidence), 2)

    if not has_valid_contact(lead):
        lead.qualification_status = QualificationStatus.REJECTED.value
    elif total >= qualify_threshold:
        lead.qualification_status = QualificationStatus.QUALIFIED.value
    elif total >= qualify_threshold - 15:
        lead.qualification_status = QualificationStatus.NEEDS_REVIEW.value
    else:
        lead.qualification_status = QualificationStatus.REJECTED.value

    # Qualification never auto-approves outreach — that requires explicit
    # human/policy approval downstream.
    if lead.qualification_status == QualificationStatus.QUALIFIED.value:
        lead.outreach_eligibility = OutreachEligibility.PENDING_APPROVAL.value
    else:
        lead.outreach_eligibility = OutreachEligibility.NOT_ELIGIBLE.value

    return lead
