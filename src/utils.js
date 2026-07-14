// Shared helpers: logging, delays, user-agent rotation, string normalization.

const COLORS = {
  reset: '\x1b[0m',
  gray: '\x1b[90m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

function stamp() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

export const log = {
  info: (msg) => console.log(`${COLORS.gray}[${stamp()}]${COLORS.reset} ${msg}`),
  step: (msg) => console.log(`${COLORS.cyan}[${stamp()}] ▸ ${msg}${COLORS.reset}`),
  ok: (msg) => console.log(`${COLORS.green}[${stamp()}] ✓ ${msg}${COLORS.reset}`),
  warn: (msg) => console.log(`${COLORS.yellow}[${stamp()}] ! ${msg}${COLORS.reset}`),
  error: (msg) => console.log(`${COLORS.red}[${stamp()}] ✗ ${msg}${COLORS.reset}`),
};

// A small rotating pool of realistic desktop user agents for the fallback scraper.
export const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
];

export function randomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Random human-ish delay in [minMs, maxMs].
export function randomDelay(minMs, maxMs) {
  const ms = Math.floor(minMs + Math.random() * Math.max(0, maxMs - minMs));
  return sleep(ms);
}

// Lowercase, strip everything but alphanumerics — used for dedupe keys.
export function normalize(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '');
}

// Best-effort street address = the part before the first comma.
export function streetAddress(fullAddress) {
  return String(fullAddress || '').split(',')[0].trim();
}

export function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}
