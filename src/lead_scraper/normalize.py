"""Normalization, phone/domain canonicalization, and deduplication."""

from __future__ import annotations

import re
from datetime import datetime, timezone, timedelta
from typing import Iterable, Optional
from urllib.parse import urlparse

from .schema import Lead


def normalize_domain(website: Optional[str]) -> Optional[str]:
    """Return a canonical lowercase apex domain (strip scheme, www, path)."""
    if not website:
        return None
    w = website.strip().lower()
    if "://" not in w:
        w = "http://" + w
    host = urlparse(w).netloc or urlparse(w).path
    host = host.split("/")[0]
    if host.startswith("www."):
        host = host[4:]
    host = host.split(":")[0]
    return host or None


def normalize_phone(phone: Optional[str], default_country: str = "1") -> Optional[str]:
    """Return E.164-ish digits (US default). None if too few digits."""
    if not phone:
        return None
    digits = re.sub(r"\D", "", phone)
    if not digits:
        return None
    if len(digits) == 10:
        digits = default_country + digits
    if len(digits) < 10:
        return None
    return "+" + digits


def normalize_business_name(name: str) -> str:
    n = name.strip().lower()
    n = re.sub(r"[^a-z0-9 ]", "", n)
    n = re.sub(r"\b(llc|inc|co|corp|company|ltd|the)\b", "", n)
    return re.sub(r"\s+", " ", n).strip()


def normalize_lead(lead: Lead) -> Lead:
    lead.domain = normalize_domain(lead.website or lead.domain)
    lead.public_phone = normalize_phone(lead.public_phone)
    if lead.public_email:
        lead.public_email = lead.public_email.strip().lower()
    return lead


def dedupe_key(lead: Lead) -> str:
    """A stable key for duplicate suppression: domain, else phone, else name."""
    if lead.domain:
        return f"domain:{lead.domain}"
    if lead.public_phone:
        return f"phone:{lead.public_phone}"
    return f"name:{normalize_business_name(lead.business_name)}"


def deduplicate(leads: Iterable[Lead]) -> tuple[list[Lead], list[Lead]]:
    """Return (unique, duplicates). First occurrence wins; later dupes returned."""
    seen: dict[str, Lead] = {}
    unique: list[Lead] = []
    dupes: list[Lead] = []
    for lead in leads:
        key = dedupe_key(lead)
        if key in seen:
            dupes.append(lead)
        else:
            seen[key] = lead
            unique.append(lead)
    return unique, dupes


def is_stale(lead: Lead, max_age_days: int = 90) -> bool:
    """True if last_verified_at is older than max_age_days (or missing)."""
    ts = lead.last_verified_at or lead.discovered_at
    if not ts:
        return True
    try:
        dt = datetime.fromisoformat(ts)
    except ValueError:
        return True
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return datetime.now(timezone.utc) - dt > timedelta(days=max_age_days)


def has_valid_contact(lead: Lead) -> bool:
    return bool(lead.public_phone or lead.public_email or lead.website)
