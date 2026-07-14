// enrich.js — visits each business's own website and derives digital-maturity
// signals: booking/scheduling tool, mobile responsiveness, contact form,
// SSL, and a detectable copyright / last-modified year.

import { log, randomUserAgent, clamp } from './utils.js';

// Known online booking / scheduling providers + generic call-to-action phrases.
const BOOKING_SIGNALS = [
  'calendly.com',
  'acuityscheduling',
  'squareup.com/appointments',
  'square appointments',
  'housecallpro',
  'servicetitan',
  'getjobber',
  'jobber.com',
  'booksy',
  'setmore',
  'youcanbook.me',
  'schedulicity',
  'thryv',
  'appointmentplus',
  'mindbody',
  'simplybook',
  'book online',
  'book now',
  'schedule online',
  'schedule service',
  'schedule an appointment',
  'request an appointment',
  'request service',
  'book an appointment',
];

const CURRENT_YEAR = new Date().getFullYear();

function analyzeHtml(html, finalUrl, headers) {
  const lower = html.toLowerCase();

  const hasViewport = /<meta[^>]+name=["']?viewport["']?/i.test(html);
  const mobile_responsive = hasViewport;

  const has_booking_tool = BOOKING_SIGNALS.some((sig) => lower.includes(sig));

  // A contact form: a <form> plus an email/tel input or a "contact" hint.
  const hasForm = /<form[\s>]/i.test(html);
  const hasContactHint =
    /type=["']?email["']?/i.test(html) ||
    /type=["']?tel["']?/i.test(html) ||
    /name=["'][^"']*(email|phone|contact|message)[^"']*["']/i.test(html) ||
    /(contact\s*us|get\s*a\s*quote|request\s*a\s*quote|free\s*estimate)/i.test(lower);
  const has_contact_form = hasForm && hasContactHint;

  // Copyright / last-active year — take the most recent 4-digit year we find
  // near a copyright marker, capped at the current year.
  let copyright_year = null;
  const yearMatches = [
    ...html.matchAll(/(?:©|&copy;|copyright)[^0-9]{0,20}((?:19|20)\d{2})/gi),
  ].map((m) => parseInt(m[1], 10));
  const validYears = yearMatches.filter((y) => y >= 2000 && y <= CURRENT_YEAR);
  if (validYears.length) copyright_year = Math.max(...validYears);

  const has_ssl = finalUrl.startsWith('https://');

  const lastModifiedHeader = headers?.get?.('last-modified') || null;
  let last_modified_year = null;
  if (lastModifiedHeader) {
    const d = new Date(lastModifiedHeader);
    if (!Number.isNaN(d.getTime())) last_modified_year = d.getFullYear();
  }

  return {
    has_booking_tool,
    mobile_responsive,
    has_contact_form,
    has_ssl,
    copyright_year,
    last_modified_year,
  };
}

// Website is "outdated" if it lacks SSL, lacks a mobile viewport, or its most
// recent detectable year is older than `outdatedCopyrightYears`.
function isOutdated(analysis, outdatedYears) {
  if (!analysis.has_ssl) return true;
  if (!analysis.mobile_responsive) return true;
  const year = analysis.copyright_year ?? analysis.last_modified_year;
  if (year !== null && CURRENT_YEAR - year > outdatedYears) return true;
  return false;
}

// "Recent activity": a detectable year within the last `outdatedYears`.
function hasRecentActivity(analysis, outdatedYears) {
  const year = analysis.copyright_year ?? analysis.last_modified_year;
  return year !== null && CURRENT_YEAR - year <= outdatedYears;
}

// digital_maturity_score (1-5): baseline 1, +1 each for website / booking /
// responsive / recent activity.
function digitalMaturityScore(hasWebsite, analysis, outdatedYears) {
  if (!hasWebsite || !analysis) return 1;
  let score = 1;
  if (hasWebsite) score += 1;
  if (analysis.has_booking_tool) score += 1;
  if (analysis.mobile_responsive) score += 1;
  if (hasRecentActivity(analysis, outdatedYears)) score += 1;
  return clamp(score, 1, 5);
}

async function fetchWebsite(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': randomUserAgent(),
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
    const html = await res.text();
    return { ok: res.ok, finalUrl: res.url || url, html, headers: res.headers };
  } finally {
    clearTimeout(timer);
  }
}

// Enrich a single lead in place; returns the same object with website signals
// and digital_maturity_score attached.
export async function enrichLead(lead, config) {
  const outdatedYears = config.scoring?.outdatedCopyrightYears ?? 2;
  const timeoutMs = config.scraper?.websiteFetchTimeoutMs ?? 15000;

  lead.website_analysis = {
    reachable: false,
    has_booking_tool: false,
    mobile_responsive: false,
    has_contact_form: false,
    has_ssl: false,
    copyright_year: null,
    last_modified_year: null,
    outdated: false,
  };

  if (!lead.website_url) {
    lead.has_website = false;
    lead.digital_maturity_score = 1;
    return lead;
  }

  lead.has_website = true;
  let url = lead.website_url;
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;

  try {
    const { ok, finalUrl, html, headers } = await fetchWebsite(url, timeoutMs);
    if (!ok || !html) {
      log.warn(`Website not reachable (status) for ${lead.business_name}: ${url}`);
      lead.digital_maturity_score = digitalMaturityScore(true, null, outdatedYears);
      return lead;
    }
    const analysis = analyzeHtml(html, finalUrl, headers);
    analysis.outdated = isOutdated(analysis, outdatedYears);
    analysis.reachable = true;
    lead.website_analysis = analysis;
    lead.website_url = finalUrl;
    lead.digital_maturity_score = digitalMaturityScore(true, analysis, outdatedYears);
  } catch (err) {
    log.warn(`Website analysis failed for ${lead.business_name} (${url}): ${err.message}`);
    // Unreachable https site is a weak signal of an outdated/absent web presence.
    lead.digital_maturity_score = digitalMaturityScore(true, null, outdatedYears);
  }
  return lead;
}

// Enrich a batch with limited concurrency to stay polite.
export async function enrichLeads(leads, config, concurrency = 4) {
  log.step(`Enriching ${leads.length} leads (website analysis, concurrency ${concurrency})`);
  let done = 0;
  const queue = [...leads];
  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length) {
      const lead = queue.shift();
      await enrichLead(lead, config);
      done += 1;
      if (done % 10 === 0 || done === leads.length) {
        log.info(`Enriched ${done}/${leads.length}`);
      }
    }
  });
  await Promise.all(workers);
  log.ok(`Enrichment complete for ${leads.length} leads`);
  return leads;
}
