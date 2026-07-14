// search.js — collects raw business results from Google.
//
// Primary path:  Google Places API (New) — Text Search + Place Details.
// Fallback path: Playwright-driven Google Maps scraper (randomized delays,
//                rotating user agents) used when GOOGLE_PLACES_API_KEY is unset.

import { log, randomDelay, randomUserAgent, streetAddress } from './utils.js';

const PLACES_TEXT_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';

// Field mask keeps the API response (and billing SKU) tight but complete.
const TEXT_SEARCH_FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.nationalPhoneNumber',
  'places.internationalPhoneNumber',
  'places.rating',
  'places.userRatingCount',
  'places.websiteUri',
  'places.googleMapsUri',
  'places.primaryTypeDisplayName',
  'places.types',
  'places.reviews',
  'nextPageToken',
].join(',');

// Map a raw record (from either source) into our normalized shape.
function baseLead(overrides = {}) {
  return {
    business_name: '',
    category: 'uncategorized',
    full_address: '',
    street_address: '',
    phone: '',
    website_url: '',
    has_website: false,
    google_rating: null,
    review_count: 0,
    maps_url: '',
    place_id: '',
    last_review_snippet_date: null,
    source_search_terms: [],
    ...overrides,
  };
}

// Infer our internal category from a business name / type strings.
export function inferCategory(text, categoryKeywords) {
  const hay = String(text || '').toLowerCase();
  for (const [category, keywords] of Object.entries(categoryKeywords)) {
    if (keywords.some((kw) => hay.includes(kw.toLowerCase()))) return category;
  }
  return 'uncategorized';
}

function mostRecentReviewDate(reviews) {
  if (!Array.isArray(reviews) || reviews.length === 0) return null;
  const times = reviews
    .map((r) => r.publishTime)
    .filter(Boolean)
    .map((t) => new Date(t).getTime())
    .filter((t) => !Number.isNaN(t));
  if (times.length === 0) return null;
  return new Date(Math.max(...times)).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Google Places API (New)
// ---------------------------------------------------------------------------

async function placesTextSearch(query, apiKey, config) {
  const results = [];
  let pageToken = null;
  const maxResults = config.scraper?.maxResultsPerSearch ?? 60;

  do {
    const body = { textQuery: query };
    if (pageToken) body.pageToken = pageToken;

    let res;
    try {
      res = await fetch(PLACES_TEXT_SEARCH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': TEXT_SEARCH_FIELD_MASK,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      log.error(`Places API request failed for "${query}": ${err.message}`);
      break;
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      log.error(`Places API ${res.status} for "${query}": ${detail.slice(0, 200)}`);
      break;
    }

    const data = await res.json();
    for (const p of data.places || []) {
      const fullAddress = p.formattedAddress || '';
      const categoryHint = [
        p.displayName?.text,
        p.primaryTypeDisplayName?.text,
        ...(p.types || []),
      ].join(' ');
      results.push(
        baseLead({
          business_name: p.displayName?.text || '',
          category: inferCategory(categoryHint, config.categoryKeywords),
          full_address: fullAddress,
          street_address: streetAddress(fullAddress),
          phone: p.nationalPhoneNumber || p.internationalPhoneNumber || '',
          website_url: p.websiteUri || '',
          has_website: Boolean(p.websiteUri),
          google_rating: typeof p.rating === 'number' ? p.rating : null,
          review_count: p.userRatingCount || 0,
          maps_url: p.googleMapsUri || '',
          place_id: p.id || '',
          last_review_snippet_date: mostRecentReviewDate(p.reviews),
          source_search_terms: [query],
        })
      );
    }

    pageToken = data.nextPageToken || null;
    // Places API requires a short pause before a page token becomes valid.
    if (pageToken && results.length < maxResults) await randomDelay(1500, 2500);
  } while (pageToken && results.length < maxResults);

  return results.slice(0, maxResults);
}

async function searchWithPlacesApi(config, apiKey) {
  log.step('Running Google Places API (New) Text Search');
  const all = [];
  const queries = buildQueries(config);
  for (const query of queries) {
    log.info(`Searching: "${query}"`);
    const found = await placesTextSearch(query, apiKey, config);
    log.ok(`"${query}" → ${found.length} raw results`);
    all.push(...found);
  }
  return all;
}

// ---------------------------------------------------------------------------
// Playwright fallback (Google Maps)
// ---------------------------------------------------------------------------

async function searchWithPlaywright(config) {
  log.warn('No GOOGLE_PLACES_API_KEY found — running in PLAYWRIGHT FALLBACK MODE.');
  log.warn('This scrapes Google Maps directly with randomized delays. Slower and best-effort.');

  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    log.error('Playwright is not installed. Run `npm install` (and `npx playwright install chromium`).');
    return [];
  }

  const all = [];
  const queries = buildQueries(config);
  const { minDelayMs = 2000, maxDelayMs = 6000 } = config.scraper || {};

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (err) {
    log.error(`Could not launch Chromium: ${err.message}`);
    log.error('Install the browser with: npx playwright install chromium');
    return [];
  }
  try {
    for (const query of queries) {
      const ua = randomUserAgent();
      const context = await browser.newContext({ userAgent: ua, locale: 'en-US' });
      const page = await context.newPage();
      log.info(`[fallback] Searching: "${query}" (UA: ${ua.slice(0, 28)}…)`);

      try {
        const url = `https://www.google.com/maps/search/${encodeURIComponent(query)}?hl=en`;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await randomDelay(minDelayMs, maxDelayMs);
        await dismissConsent(page);

        const found = await scrapeMapsFeed(page, query, config, { minDelayMs, maxDelayMs });
        log.ok(`[fallback] "${query}" → ${found.length} raw results`);
        all.push(...found);
      } catch (err) {
        log.error(`[fallback] "${query}" failed: ${err.message}`);
      } finally {
        await context.close();
        await randomDelay(minDelayMs, maxDelayMs);
      }
    }
  } finally {
    await browser.close();
  }
  return all;
}

async function dismissConsent(page) {
  // Google occasionally shows a consent interstitial; click through if present.
  try {
    const btn = page.locator(
      'button:has-text("Accept all"), button:has-text("Reject all"), form[action*="consent"] button'
    );
    if (await btn.first().isVisible({ timeout: 2500 }).catch(() => false)) {
      await btn.first().click({ timeout: 3000 }).catch(() => {});
    }
  } catch {
    /* no consent screen */
  }
}

async function scrapeMapsFeed(page, query, config, delays) {
  const maxResults = config.scraper?.maxResultsPerSearch ?? 60;
  const feedSelector = 'div[role="feed"]';

  // Scroll the results feed to lazy-load more cards.
  try {
    await page.waitForSelector(feedSelector, { timeout: 15000 });
  } catch {
    log.warn(`[fallback] No results feed for "${query}" (layout may have changed).`);
    return [];
  }

  let previousCount = 0;
  for (let i = 0; i < 12; i++) {
    const count = await page.locator(`${feedSelector} a[href*="/maps/place/"]`).count();
    if (count >= maxResults) break;
    await page.evaluate((sel) => {
      const feed = document.querySelector(sel);
      if (feed) feed.scrollTo(0, feed.scrollHeight);
    }, feedSelector);
    await randomDelay(delays.minDelayMs, delays.maxDelayMs);
    if (count === previousCount && i > 2) break; // reached the end
    previousCount = count;
  }

  const raw = await page.evaluate(
    ({ feedSel, limit }) => {
      const out = [];
      const cards = document.querySelectorAll(`${feedSel} > div > div[jsaction]`);
      cards.forEach((card) => {
        const link = card.querySelector('a[href*="/maps/place/"]');
        if (!link) return;
        const nameEl = card.querySelector('.fontHeadlineSmall, [class*="fontHeadline"]');
        const name = (nameEl?.textContent || link.getAttribute('aria-label') || '').trim();
        if (!name) return;

        // Rating + review count live in an aria-label like "4.7 stars 132 Reviews".
        let rating = null;
        let reviews = 0;
        const ratingEl = card.querySelector('[role="img"][aria-label*="star"]');
        const ratingLabel = ratingEl?.getAttribute('aria-label') || card.textContent || '';
        const rMatch = ratingLabel.match(/([0-9]\.[0-9])/);
        if (rMatch) rating = parseFloat(rMatch[1]);
        const cMatch = (card.textContent || '').match(/\(([\d,]+)\)/);
        if (cMatch) reviews = parseInt(cMatch[1].replace(/,/g, ''), 10);

        // Website link, if the card exposes one.
        let website = '';
        const siteLink = card.querySelector('a[data-value="Website"], a[aria-label*="Visit"]');
        if (siteLink) website = siteLink.getAttribute('href') || '';

        // Phone often appears as a formatted string in the card text.
        const phoneMatch = (card.textContent || '').match(/(\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/);

        out.push({
          business_name: name,
          full_address: '',
          phone: phoneMatch ? phoneMatch[1] : '',
          website_url: website,
          google_rating: rating,
          review_count: reviews,
          maps_url: link.href,
        });
      });
      return out.slice(0, limit);
    },
    { feedSel: feedSelector, limit: maxResults }
  );

  return raw.map((r) =>
    baseLead({
      ...r,
      street_address: streetAddress(r.full_address),
      has_website: Boolean(r.website_url),
      category: inferCategory(r.business_name, config.categoryKeywords),
      source_search_terms: [query],
    })
  );
}

// ---------------------------------------------------------------------------
// Query building + public entry point
// ---------------------------------------------------------------------------

// Combine explicit searchTerms with seed-business lookups.
export function buildQueries(config) {
  const queries = [...(config.searchTerms || [])];
  const area = config.targetArea || {};
  const areaSuffix = [area.primaryCity, area.state].filter(Boolean).join(' ');
  for (const seed of config.seedBusinesses || []) {
    queries.push(areaSuffix ? `${seed} ${areaSuffix}` : seed);
  }
  return [...new Set(queries)];
}

// Returns { leads, mode }. `mode` is 'places-api' or 'playwright-fallback'.
export async function runSearches(config, apiKey) {
  if (apiKey) {
    const leads = await searchWithPlacesApi(config, apiKey);
    return { leads, mode: 'places-api' };
  }
  const leads = await searchWithPlaywright(config);
  return { leads, mode: 'playwright-fallback' };
}
