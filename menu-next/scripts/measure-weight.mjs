// How much a page weighs, measured the same way every time.
//
//   npm run measure:weight
//   npm run measure:weight -- --base http://localhost:3000 --pages /waiter /payment-test/1 --runs 3
//
// Requires the built site to be running: npm run build && npm start
//
// TWO numbers:
//   INITIAL PAYLOAD   loaded + 2.5 s of quiet (no new requests)
//   SETTLED FULL PAGE scrolled to bottom in steps, then 2.5 s quiet again
//
// Fresh context per run, cache disabled, service workers blocked.
// Excludes Next.js router prefetches (?_rsc=).
// Adapted from sonne_solutions/scripts/measure-weight.mjs.
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
};
const base   = opt('--base', 'http://localhost:3000');
const runs   = Number(opt('--runs', '3'));
const pagesAt = args.indexOf('--pages');
const pages  = pagesAt === -1
  ? ['/waiter', '/payment-test/1']
  : args.slice(pagesAt + 1).filter(a => a.startsWith('/'));
const QUIET_MS = 2500;
const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function weigh(browser, url, width) {
  const ctx = await browser.newContext({
    viewport: { width, height: 900 },
    reducedMotion: 'reduce',
    isMobile: width < 500,
    hasTouch: width < 500,
    serviceWorkers: 'block',
  });
  const page = await ctx.newPage();
  const cdp  = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });

  let bytes = 0, prefetch = 0, last = Date.now();
  const open = new Set();
  const urls = new Map();
  cdp.on('Network.requestWillBeSent', e => { urls.set(e.requestId, e.request.url); open.add(e.requestId); last = Date.now(); });
  cdp.on('Network.loadingFinished',   e => { if ((urls.get(e.requestId) ?? '').includes('_rsc=')) prefetch += e.encodedDataLength; else bytes += e.encodedDataLength; open.delete(e.requestId); last = Date.now(); });
  cdp.on('Network.loadingFailed',     e => { open.delete(e.requestId); last = Date.now(); });

  const quiet = async () => {
    for (;;) {
      await sleep(250);
      if (open.size === 0 && Date.now() - last > QUIET_MS) return;
      if (Date.now() - last > 30000) return;
    }
  };

  await page.goto(url, { waitUntil: 'load' });
  await quiet();
  const initial = bytes;

  await page.evaluate(async () => {
    const h = () => document.documentElement.scrollHeight;
    for (let y = 0; y < h(); y += 400) { scrollTo(0, y); await new Promise(r => setTimeout(r, 150)); }
    scrollTo(0, h());
  });
  await quiet();
  await ctx.close();
  return { initialKb: initial / 1024, settledKb: bytes / 1024, prefetchKb: prefetch / 1024 };
}

const browser = await chromium.launch({ channel: 'chrome' });
const fmt    = xs => xs.map(x => x.toFixed(1)).join(' / ');
const spread = xs => (Math.max(...xs) - Math.min(...xs)).toFixed(1);

for (const p of pages) {
  for (const w of [390, 1440]) {
    const r = [];
    for (let i = 0; i < runs; i++) r.push(await weigh(browser, base + p, w));
    const ini = r.map(x => x.initialKb), set = r.map(x => x.settledKb);
    console.log(`${p} @${w}: initial ${fmt(ini)} KB (spread ${spread(ini)}) | settled ${fmt(set)} KB (spread ${spread(set)}) | prefetch ~${r[0].prefetchKb.toFixed(0)} KB`);
  }
}
await browser.close();
