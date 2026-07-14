// main.js — TechOps Lead Finder pipeline entry point.
//
// Pipeline:
//   1. Run all configured Maps searches (Places API, or Playwright fallback).
//   2. Enrich each result with website analysis.
//   3. Score + filter to qualified/active leads.
//   4. Deduplicate.
//   5. Export /output/leads.csv and /output/leads.json.
//   6. Generate /output/market-analysis.md.
//   7. (Optional) Sync to Airtable with --sync-airtable.
//
// Usage:  node main.js [--sync-airtable] [--config ./config.json]

import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { log } from './src/utils.js';
import { runSearches } from './src/search.js';
import { enrichLeads } from './src/enrich.js';
import { filterQualified, scoreLeads, deduplicate } from './src/score.js';
import { exportResults, generateMarketAnalysis } from './src/export.js';
import { syncToAirtable } from './src/airtable.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = { syncAirtable: false, configPath: path.join(__dirname, 'config.json') };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--sync-airtable') args.syncAirtable = true;
    else if (arg === '--config') args.configPath = path.resolve(argv[++i]);
    else if (arg.startsWith('--config=')) args.configPath = path.resolve(arg.split('=')[1]);
  }
  return args;
}

async function loadConfig(configPath) {
  const raw = await readFile(configPath, 'utf8');
  return JSON.parse(raw);
}

async function main() {
  const startedAt = Date.now();
  const args = parseArgs(process.argv);

  log.step('TechOps Lead Finder starting');
  const config = await loadConfig(args.configPath);
  const outputDir = path.join(__dirname, 'output');
  const apiKey = process.env.GOOGLE_PLACES_API_KEY?.trim() || null;
  const targetArea = [
    config.targetArea?.primaryCity,
    config.targetArea?.state,
  ]
    .filter(Boolean)
    .join(', ');

  // 1. Search
  const { leads: rawLeads, mode } = await runSearches(config, apiKey);
  log.ok(`Collected ${rawLeads.length} raw results via ${mode}`);
  if (rawLeads.length === 0) {
    log.warn('No results collected — nothing to enrich or export. Exiting.');
    return;
  }

  // 2. Enrich (website analysis)
  await enrichLeads(rawLeads, config);

  // 3. Score + qualify filter
  scoreLeads(rawLeads);
  const qualified = filterQualified(rawLeads, config);

  // 4. Deduplicate
  const deduped = deduplicate(qualified);

  if (deduped.length === 0) {
    log.warn('No qualified leads after filtering. Writing empty outputs.');
  }

  // 5 + 6. Export
  const { ranked } = await exportResults(deduped, outputDir);
  await generateMarketAnalysis(deduped, outputDir, { mode, targetArea });

  // 7. Optional Airtable sync
  if (args.syncAirtable) {
    await syncToAirtable(ranked, process.env);
  }

  // Final summary
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  const noWebsite = deduped.filter((l) => !l.has_website).length;
  const noBooking = deduped.filter((l) => !l.website_analysis?.has_booking_tool).length;
  log.step('──────── SUMMARY ────────');
  log.info(`Data source        : ${mode}`);
  log.info(`Raw results        : ${rawLeads.length}`);
  log.info(`Qualified + unique : ${deduped.length}`);
  log.info(`No website         : ${noWebsite}`);
  log.info(`No booking tool    : ${noBooking}`);
  if (ranked[0]) {
    log.info(`Top opportunity    : ${ranked[0].business_name} (score ${ranked[0].opportunity_score})`);
  }
  log.info(`Output directory   : ${outputDir}`);
  log.info(`Elapsed            : ${elapsed}s`);
  log.ok('Done.');
}

main().catch((err) => {
  log.error(`Fatal: ${err.stack || err.message}`);
  process.exit(1);
});
