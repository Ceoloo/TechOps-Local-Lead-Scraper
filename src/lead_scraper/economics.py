"""Emit-side wiring for the cash-collected funnel: workflow cost.

The lead scraper is a cost origin (scraping, compute, source-API spend), not a
value stage. It emits ``revenue.workflow_cost_recorded`` so the shared
``aion_platform.economics.CashFunnel`` can subtract real scraping cost from the
cash the downstream voice product collects -- making payback honest.

Nothing here estimates a cost: callers supply the figure they actually incurred.
"""

from __future__ import annotations

from typing import Any, Callable, Optional

from . import aion_events as ev

EventSink = Callable[[dict[str, Any]], None]


def record_workflow_cost(
    sink: Optional[EventSink], correlation_id: str, *, amount: float,
    breakdown: Optional[dict[str, Any]] = None,
) -> Optional[dict[str, Any]]:
    """Emit one ``revenue.workflow_cost_recorded`` event. Returns the event dict.

    ``amount`` is in dollars and is supplied by the caller -- never estimated.
    """
    if sink is None:
        return None
    evt = ev.new_event(
        "revenue.workflow_cost_recorded",
        payload={"breakdown": breakdown or {}},
        metrics={"amount": round(float(amount), 2)} if amount else {},
        correlation_id=correlation_id,
    )
    problems = ev.validate_event(evt)
    if problems:
        raise ValueError(f"invalid revenue.workflow_cost_recorded event: {problems}")
    data = evt.to_dict()
    sink(data)
    return data
