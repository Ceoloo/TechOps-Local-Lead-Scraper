"""The lead scraper emits workflow cost into the shared cash funnel."""

from aion_platform.economics import CashFunnel

from lead_scraper import aion_events as ev
from lead_scraper.economics import record_workflow_cost
from lead_scraper.pipeline import run_pipeline
from lead_scraper.schema import Lead


def _leads():
    return [
        Lead(business_name="Strong", business_category="electrical",
             public_phone="5551234567", public_email="owner@strong.com",
             signals=["strong_service_demand", "no_online_booking", "poor_local_search"]),
        Lead(business_name="Ghost", business_category="hvac"),
    ]


def test_record_workflow_cost_emits_valid_event():
    events = []
    record_workflow_cost(events.append, "run-1", amount=42.5, breakdown={"serpapi": 42.5})
    assert len(events) == 1
    assert ev.validate_event(events[0]) == []
    assert events[0]["event_type"] == "revenue.workflow_cost_recorded"
    assert events[0]["metrics"]["amount"] == 42.5


def test_none_sink_is_a_noop():
    assert record_workflow_cost(None, "run-1", amount=10) is None


def test_run_pipeline_emits_cost_when_supplied():
    events = []
    result = run_pipeline(_leads(), sink=events.append, run_cost=8.0)
    cost_events = [e for e in events if e["event_type"] == "revenue.workflow_cost_recorded"]
    assert len(cost_events) == 1
    assert cost_events[0]["metrics"]["amount"] == 8.0
    assert cost_events[0]["payload"]["breakdown"]["leads_processed"] == result["processed"]
    assert cost_events[0]["payload"]["breakdown"]["cost_per_lead"] == round(8.0 / result["processed"], 4)
    assert result["run_cost"] == 8.0
    assert result["cost_correlation_id"]


def test_run_pipeline_without_cost_emits_none():
    events = []
    run_pipeline(_leads(), sink=events.append)
    assert not any(e["event_type"] == "revenue.workflow_cost_recorded" for e in events)


def test_scraper_cost_feeds_the_cash_funnel():
    events = []
    run_pipeline(_leads(), sink=events.append, run_cost=25.0)

    funnel = CashFunnel()
    funnel.ingest_events(events)  # lead.* events are ignored; only cost lands
    report = funnel.report()
    assert report.workflow_cost == 25.0
    assert report.cash_collected == 0.0
    assert report.cost_recovered is False  # scraping spent, no cash yet in this repo
