// export.js — writes leads.csv, leads.json, and market-analysis.md to /output.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { log } from './utils.js';

// The ordered, flat set of columns captured per business.
const CSV_COLUMNS = [
  'business_name',
  'category',
  'full_address',
  'phone',
  'website_url',
  'has_website',
  'google_rating',
  'review_count',
  'maps_url',
  'place_id',
  'last_review_snippet_date',
  'digital_maturity_score',
  'opportunity_score',
];

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function toCsv(leads) {
  const header = CSV_COLUMNS.join(',');
  const rows = leads.map((l) => CSV_COLUMNS.map((c) => csvCell(l[c])).join(','));
  return [header, ...rows].join('\n') + '\n';
}

// Slim public record for JSON/CSV — includes analysis details JSON side only.
function publicRecord(lead) {
  const record = {};
  for (const c of CSV_COLUMNS) record[c] = lead[c] ?? null;
  return record;
}

export async function exportResults(leads, outputDir) {
  await mkdir(outputDir, { recursive: true });

  const ranked = [...leads].sort(
    (a, b) => (b.opportunity_score || 0) - (a.opportunity_score || 0)
  );

  const csvPath = path.join(outputDir, 'leads.csv');
  const jsonPath = path.join(outputDir, 'leads.json');

  await writeFile(csvPath, toCsv(ranked), 'utf8');

  const jsonRecords = ranked.map((l) => ({
    ...publicRecord(l),
    source_search_terms: l.source_search_terms || [],
    website_analysis: l.website_analysis || null,
    opportunity_reasons: l.opportunity_reasons || [],
  }));
  await writeFile(jsonPath, JSON.stringify(jsonRecords, null, 2), 'utf8');

  log.ok(`Wrote ${ranked.length} leads → ${csvPath}`);
  log.ok(`Wrote ${ranked.length} leads → ${jsonPath}`);
  return { csvPath, jsonPath, ranked };
}

function pct(part, total) {
  if (!total) return '0%';
  return `${Math.round((part / total) * 100)}%`;
}

function avg(nums) {
  const valid = nums.filter((n) => typeof n === 'number' && !Number.isNaN(n));
  if (!valid.length) return 0;
  return valid.reduce((s, n) => s + n, 0) / valid.length;
}

export async function generateMarketAnalysis(leads, outputDir, meta = {}) {
  await mkdir(outputDir, { recursive: true });
  const mdPath = path.join(outputDir, 'market-analysis.md');

  const total = leads.length;
  const noWebsite = leads.filter((l) => !l.has_website).length;
  const noBooking = leads.filter(
    (l) => !l.website_analysis?.has_booking_tool
  ).length;
  const avgRating = avg(leads.map((l) => l.google_rating));
  const avgReviews = avg(leads.map((l) => l.review_count));

  // Breakdown by category.
  const byCategory = {};
  for (const l of leads) {
    byCategory[l.category] = (byCategory[l.category] || 0) + 1;
  }

  const ranked = [...leads].sort(
    (a, b) =>
      (b.opportunity_score || 0) - (a.opportunity_score || 0) ||
      (b.review_count || 0) - (a.review_count || 0)
  );
  const top15 = ranked.slice(0, 15);

  const lines = [];
  lines.push('# TechOps — Local Lead Market Analysis');
  lines.push('');
  lines.push(`_Generated: ${new Date().toISOString().slice(0, 10)}_`);
  if (meta.mode) lines.push(`_Data source: **${meta.mode}**_`);
  if (meta.targetArea) lines.push(`_Target area: ${meta.targetArea}_`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- **Total qualified leads:** ${total}`);
  lines.push(`- **With no website:** ${noWebsite} (${pct(noWebsite, total)})`);
  lines.push(`- **With no online booking tool:** ${noBooking} (${pct(noBooking, total)})`);
  lines.push(`- **Average rating:** ${avgRating.toFixed(2)}`);
  lines.push(`- **Average review count:** ${Math.round(avgReviews)}`);
  lines.push('');
  lines.push('## Breakdown by Category');
  lines.push('');
  lines.push('| Category | Qualified Leads | Share |');
  lines.push('| --- | ---: | ---: |');
  for (const [cat, count] of Object.entries(byCategory).sort((a, b) => b[1] - a[1])) {
    lines.push(`| ${cat} | ${count} | ${pct(count, total)} |`);
  }
  lines.push('');
  lines.push('## Top 15 Highest-Opportunity Leads');
  lines.push('');
  lines.push(
    '| # | Business | Category | Opp. Score | Rating | Reviews | Website | Booking |'
  );
  lines.push('| ---: | --- | --- | ---: | ---: | ---: | --- | --- |');
  top15.forEach((l, i) => {
    const website = l.has_website ? 'yes' : 'no';
    const booking = l.website_analysis?.has_booking_tool ? 'yes' : 'no';
    lines.push(
      `| ${i + 1} | ${mdCell(l.business_name)} | ${l.category} | ${l.opportunity_score} | ` +
        `${l.google_rating ?? '—'} | ${l.review_count ?? 0} | ${website} | ${booking} |`
    );
  });
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('### Scoring reference');
  lines.push('');
  lines.push('- `opportunity_score` starts at 5.');
  lines.push('- `+2` no website · `+2` website but no booking widget · `+1` outdated site.');
  lines.push('- `-3` already uses strong modern tooling (booking + responsive + recent).');
  lines.push('- Clamped to the range 1–10.');
  lines.push('');

  await writeFile(mdPath, lines.join('\n'), 'utf8');
  log.ok(`Wrote market analysis → ${mdPath}`);
  return { mdPath };
}

function mdCell(value) {
  return String(value ?? '').replace(/\|/g, '\\|');
}
