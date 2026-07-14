// airtable.js — optional push of qualified leads to Airtable via the REST API.
// Enabled with the --sync-airtable flag and AIRTABLE_API_KEY / AIRTABLE_BASE_ID.

import { log, sleep } from './utils.js';

function leadToFields(lead) {
  return {
    'Business Name': lead.business_name || '',
    Category: lead.category || '',
    'Full Address': lead.full_address || '',
    Phone: lead.phone || '',
    Website: lead.website_url || '',
    'Has Website': Boolean(lead.has_website),
    'Google Rating': lead.google_rating ?? null,
    'Review Count': lead.review_count ?? 0,
    'Maps URL': lead.maps_url || '',
    'Place ID': lead.place_id || '',
    'Last Review Date': lead.last_review_snippet_date || '',
    'Digital Maturity Score': lead.digital_maturity_score ?? null,
    'Opportunity Score': lead.opportunity_score ?? null,
  };
}

export async function syncToAirtable(leads, env) {
  const apiKey = env.AIRTABLE_API_KEY;
  const baseId = env.AIRTABLE_BASE_ID;
  const tableName = env.AIRTABLE_TABLE_NAME || 'Leads';

  if (!apiKey || !baseId) {
    log.warn('--sync-airtable set but AIRTABLE_API_KEY / AIRTABLE_BASE_ID missing. Skipping.');
    return { synced: 0, skipped: true };
  }

  const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`;
  log.step(`Syncing ${leads.length} leads to Airtable table "${tableName}"`);

  let synced = 0;
  // Airtable accepts up to 10 records per create request.
  for (let i = 0; i < leads.length; i += 10) {
    const batch = leads.slice(i, i + 10);
    const body = {
      records: batch.map((l) => ({ fields: leadToFields(l) })),
      typecast: true,
    };

    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      log.error(`Airtable request failed: ${err.message}`);
      break;
    }

    if (res.status === 429) {
      log.warn('Airtable rate limit hit; backing off 30s.');
      await sleep(30000);
      i -= 10; // retry this batch
      continue;
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      log.error(`Airtable ${res.status}: ${detail.slice(0, 200)}`);
      break;
    }

    synced += batch.length;
    log.info(`Airtable: synced ${synced}/${leads.length}`);
    await sleep(250); // stay under ~5 req/s
  }

  log.ok(`Airtable sync complete: ${synced} records`);
  return { synced, skipped: false };
}
