// score.js — qualification filter, opportunity scoring, and deduplication.

import { log, normalize, clamp } from './utils.js';

// Keep only "qualified/active" leads: rating >= minRating AND
// review_count >= minReviewCount.
export function filterQualified(leads, config) {
  const minRating = config.scoring?.minRating ?? 4.0;
  const minReviews = config.scoring?.minReviewCount ?? 20;
  const qualified = leads.filter(
    (l) => (l.google_rating ?? 0) >= minRating && (l.review_count ?? 0) >= minReviews
  );
  log.info(
    `Qualification filter (rating >= ${minRating}, reviews >= ${minReviews}): ` +
      `${qualified.length}/${leads.length} kept`
  );
  return qualified;
}

// opportunity_score (1-10) per the offer's scoring rules.
export function computeOpportunityScore(lead) {
  const a = lead.website_analysis || {};
  let score = 5;
  const reasons = [];

  if (!lead.has_website) {
    score += 2;
    reasons.push('+2 no website');
  } else if (!a.has_booking_tool) {
    // Website exists but no online booking/scheduling widget.
    score += 2;
    reasons.push('+2 website without booking widget');
  }

  if (lead.has_website) {
    const outdated = a.outdated || !a.has_ssl || !a.mobile_responsive;
    if (outdated) {
      score += 1;
      reasons.push('+1 outdated site (no SSL / no viewport / old copyright)');
    }

    const strongModernTooling = a.has_booking_tool && a.mobile_responsive && !a.outdated;
    if (strongModernTooling) {
      score -= 3;
      reasons.push('-3 strong modern tooling');
    }
  }

  const final = clamp(score, 1, 10);
  return { score: final, reasons };
}

export function scoreLeads(leads) {
  log.step('Scoring opportunity for each lead');
  for (const lead of leads) {
    const { score, reasons } = computeOpportunityScore(lead);
    lead.opportunity_score = score;
    lead.opportunity_reasons = reasons;
  }
  return leads;
}

// Deduplicate by normalized (business_name + street_address). When the same
// business appears via multiple search terms, merge the source terms and keep
// the record with the most complete data.
export function deduplicate(leads) {
  const byKey = new Map();
  for (const lead of leads) {
    const key = normalize(lead.business_name) + '|' + normalize(lead.street_address);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, lead);
      continue;
    }
    // Merge search terms.
    const terms = new Set([
      ...(existing.source_search_terms || []),
      ...(lead.source_search_terms || []),
    ]);
    // Prefer the record with more review data / a website / an address.
    const better = pickBetter(existing, lead);
    better.source_search_terms = [...terms];
    byKey.set(key, better);
  }
  const deduped = [...byKey.values()];
  log.info(`Deduplication: ${deduped.length} unique businesses (from ${leads.length})`);
  return deduped;
}

function completeness(lead) {
  let c = 0;
  if (lead.website_url) c += 1;
  if (lead.full_address) c += 1;
  if (lead.phone) c += 1;
  if (lead.place_id) c += 1;
  c += (lead.review_count || 0) / 100000; // tie-break toward more reviews
  return c;
}

function pickBetter(a, b) {
  return completeness(b) > completeness(a) ? b : a;
}
