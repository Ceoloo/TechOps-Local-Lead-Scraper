"""Discovery→scoring→qualification→export pipeline with event emission.

Emits ``lead.discovered``, ``lead.scored``, ``lead.qualified`` / ``lead.rejected``,
and ``lead.exported`` events. Lead PII is never sent raw in telemetry: contact
fields are masked and only opaque IDs + score/reasons travel.
"""

from __future__ import annotations

from typing import Any, Callable, Iterable, Optional

from . import aion_events as ev
from .schema import Lead, QualificationStatus
from .scoring import score_lead
from .normalize import normalize_lead, deduplicate

# Sink signature: (event_dict) -> None
EventSink = Callable[[dict[str, Any]], None]


def _emit(sink: Optional[EventSink], event: ev.Event) -> None:
    if sink is None:
        return
    problems = ev.validate_event(event)
    if problems:
        raise ValueError(f"refusing to emit invalid event: {problems}")
    sink(event.to_dict())


def _lead_metrics(lead: Lead) -> dict[str, Any]:
    return {"score": lead.score, "data_confidence": lead.data_confidence}


def _safe_payload(lead: Lead, correlation_id: str) -> dict[str, Any]:
    # Opaque + non-PII only. Contact details stay out of telemetry.
    return {
        "lead_id": lead.lead_id,
        "business_category": lead.business_category,
        "qualification_status": lead.qualification_status,
        "score": lead.score,
        "correlation_id": correlation_id,
    }


def run_pipeline(
    raw_leads: Iterable[Lead],
    *,
    sink: Optional[EventSink] = None,
    qualify_threshold: int = 50,
) -> dict[str, Any]:
    """Run the full pipeline. Returns a summary with qualified/rejected leads.

    Correlation: each lead gets one correlation_id that threads discovered ->
    scored -> qualified/rejected, and (later, after approval) -> exported.
    """
    unique, dupes = deduplicate(normalize_lead(l) for l in raw_leads)
    qualified: list[Lead] = []
    rejected: list[Lead] = []
    correlations: dict[str, str] = {}

    for lead in unique:
        cid = ev.new_event("lead.discovered").correlation_id
        correlations[lead.lead_id] = cid
        _emit(sink, ev.new_event("lead.discovered", payload=_safe_payload(lead, cid), correlation_id=cid))

        score_lead(lead, qualify_threshold=qualify_threshold)
        _emit(sink, ev.new_event("lead.scored", payload=_safe_payload(lead, cid),
                                 metrics=_lead_metrics(lead), correlation_id=cid))

        if lead.qualification_status == QualificationStatus.QUALIFIED.value:
            qualified.append(lead)
            _emit(sink, ev.new_event("lead.qualified", payload=_safe_payload(lead, cid),
                                     metrics=_lead_metrics(lead), correlation_id=cid))
        else:
            rejected.append(lead)
            _emit(sink, ev.new_event("lead.rejected", payload=_safe_payload(lead, cid),
                                     correlation_id=cid))

    return {
        "processed": len(unique),
        "duplicates": len(dupes),
        "qualified": qualified,
        "rejected": rejected,
        "correlations": correlations,
    }


def emit_export(lead: Lead, correlation_id: str, sink: Optional[EventSink] = None) -> None:
    """Emit ``lead.exported`` after an approved handoff."""
    _emit(sink, ev.new_event("lead.exported", payload=_safe_payload(lead, correlation_id),
                             correlation_id=correlation_id))
