import pytest

from lead_scraper import (
    Lead, QualificationStatus, OutreachEligibility,
    score_lead, normalize_lead, deduplicate, is_stale,
    normalize_phone, normalize_domain,
    export_csv, export_airtable, FakeAirtableClient,
    approve_for_handoff, build_handoff_payload, HandoffError,
    run_pipeline, emit_export,
)
from lead_scraper import aion_events as ev


# -- normalization ---------------------------------------------------------
def test_normalize_domain():
    assert normalize_domain("https://www.Foo.com/path") == "foo.com"
    assert normalize_domain("foo.com") == "foo.com"
    assert normalize_domain(None) is None


def test_normalize_phone():
    assert normalize_phone("(555) 123-4567") == "+15551234567"
    assert normalize_phone("555.123.4567") == "+15551234567"
    assert normalize_phone("123") is None


def test_dedupe_by_domain():
    a = Lead(business_name="A LLC", business_category="hvac", website="https://x.com")
    b = Lead(business_name="A Inc", business_category="hvac", website="http://www.x.com")
    normalize_lead(a); normalize_lead(b)
    unique, dupes = deduplicate([a, b])
    assert len(unique) == 1 and len(dupes) == 1


# -- scoring ---------------------------------------------------------------
def test_scoring_is_explainable():
    lead = Lead(business_name="No Web Plumbing", business_category="plumbing",
                public_phone="5551234567", signals=["strong_service_demand"])
    normalize_lead(lead)
    score_lead(lead)
    assert lead.score > 0
    assert lead.score_version == "1.0"
    assert any("NO_WEBSITE" in r for r in lead.qualification_reasons)
    assert any("REACHABLE_CONTACT" in r for r in lead.qualification_reasons)


def test_no_contact_is_rejected():
    lead = Lead(business_name="Ghost", business_category="hvac")
    score_lead(lead)
    assert lead.qualification_status == QualificationStatus.REJECTED.value
    assert lead.outreach_eligibility == OutreachEligibility.NOT_ELIGIBLE.value


def test_qualified_lead_needs_approval_not_auto_eligible():
    lead = Lead(business_name="Strong Lead", business_category="electrical",
                public_phone="5551234567",
                signals=["strong_service_demand", "no_online_booking", "poor_local_search"])
    normalize_lead(lead); score_lead(lead)
    assert lead.qualification_status == QualificationStatus.QUALIFIED.value
    # qualified != approved for outreach
    assert lead.outreach_eligibility == OutreachEligibility.PENDING_APPROVAL.value


def test_score_bounded_0_100():
    lead = Lead(business_name="X", business_category="hvac", public_phone="5551234567",
                signals=[s.code.lower() for s in []])
    score_lead(lead)
    assert 0 <= lead.score <= 100


# -- staleness -------------------------------------------------------------
def test_is_stale():
    fresh = Lead(business_name="F", business_category="hvac",
                 last_verified_at="2999-01-01T00:00:00+00:00")
    old = Lead(business_name="O", business_category="hvac",
               last_verified_at="2000-01-01T00:00:00+00:00")
    assert not is_stale(fresh)
    assert is_stale(old)


# -- export ----------------------------------------------------------------
def test_csv_export():
    lead = Lead(business_name="A", business_category="hvac", website="https://a.com")
    normalize_lead(lead)
    text, summary = export_csv([lead])
    assert "business_name" in text.splitlines()[0]
    assert summary.created == 1


def test_airtable_upsert_is_deterministic():
    client = FakeAirtableClient()
    lead = Lead(business_name="A", business_category="hvac", website="https://a.com")
    normalize_lead(lead)
    s1 = export_airtable([lead], client, key_field="domain")
    s2 = export_airtable([lead], client, key_field="domain")
    assert s1.created == 1
    assert s2.updated == 1  # same domain -> upsert updates


def test_airtable_dry_run_does_not_write():
    client = FakeAirtableClient()
    lead = Lead(business_name="A", business_category="hvac", website="https://a.com")
    normalize_lead(lead)
    summary = export_airtable([lead], client, key_field="domain", dry_run=True)
    assert summary.dry_run and summary.created == 1
    assert client.tables == {}


def test_export_skips_invalid_lead():
    bad = Lead(business_name="", business_category="hvac")  # missing name
    _, summary = export_csv([bad])
    assert summary.skipped_invalid == 1


# -- handoff (no auto-outreach) --------------------------------------------
def test_handoff_requires_approval():
    lead = Lead(business_name="Q", business_category="hvac", public_phone="5551234567",
                signals=["strong_service_demand", "no_online_booking", "poor_local_search"])
    normalize_lead(lead); score_lead(lead)
    # not approved yet -> refuses
    with pytest.raises(HandoffError):
        build_handoff_payload(lead, correlation_id="c1")
    approve_for_handoff(lead, "ceo@aion", "pilot")
    payload = build_handoff_payload(lead, correlation_id="c1")
    assert payload["requires_compliance_gate"] is True
    assert payload["outreach_eligibility"] == OutreachEligibility.APPROVED_FOR_HANDOFF.value


def test_cannot_approve_unqualified():
    lead = Lead(business_name="U", business_category="hvac")  # no contact -> rejected
    score_lead(lead)
    with pytest.raises(HandoffError):
        approve_for_handoff(lead, "ceo@aion")


# -- pipeline + events -----------------------------------------------------
def test_pipeline_emits_valid_events_without_pii():
    events = []
    leads = [
        Lead(business_name="Strong", business_category="electrical",
             public_phone="5551234567", public_email="owner@strong.com",
             signals=["strong_service_demand", "no_online_booking", "poor_local_search"]),
        Lead(business_name="Ghost", business_category="hvac"),
    ]
    result = run_pipeline(leads, sink=events.append)
    assert result["processed"] == 2
    assert len(result["qualified"]) == 1
    types = [e["event_type"] for e in events]
    assert "lead.discovered" in types and "lead.scored" in types
    assert "lead.qualified" in types and "lead.rejected" in types
    # every event valid + no raw email/phone leaked
    for e in events:
        assert ev.validate_event(e) == []
        assert "owner@strong.com" not in str(e)
        assert "5551234567" not in str(e)


def test_pipeline_correlation_threads_through():
    events = []
    lead = Lead(business_name="Strong", business_category="electrical",
                public_phone="5551234567",
                signals=["strong_service_demand", "no_online_booking", "poor_local_search"])
    result = run_pipeline([lead], sink=events.append)
    q = result["qualified"][0]
    cid = result["correlations"][q.lead_id]
    approve_for_handoff(q, "ceo@aion")
    emit_export(q, cid, events.append)
    exported = [e for e in events if e["event_type"] == "lead.exported"]
    assert exported and exported[0]["correlation_id"] == cid
