// Accessibility gate: axe-core on the page's four faces (main, splash, read dialog, a tour step), light and dark.
//   node test/a11y.mjs
// Fails on any serious or critical violation; prints moderate and minor ones as notes. axe checks what a machine can
// (contrast, names, roles, labels); it does not replace a person using a screen reader.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url));
const server = createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(html); });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch();
const views = {
  main: async () => {},
  splash: async (p) => { await p.keyboard.press('?'); await p.waitForFunction(() => document.querySelector('#splash').open); },
  reader: async (p) => { await p.click('[data-ui="read-open"]'); await p.check('#reader input[value="provider"]'); },
  tour: async (p) => { await p.evaluate(() => window.sandhi.ready); await p.keyboard.press('?'); await p.click('#splash [data-ui="tour"]'); await p.keyboard.press('ArrowRight'); await p.waitForTimeout(100); }
};
const found = [];
for (const scheme of ['light', 'dark']) {
  for (const [name, open] of Object.entries(views)) {
    const ctx = await browser.newContext({ colorScheme: scheme, viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript(() => { try { localStorage.setItem('sandhi:intro-seen', '1'); } catch { /* fine */ } delete window.LanguageModel; });
    const p = await ctx.newPage(); await p.goto(base); await p.evaluate(() => window.sandhi.ready);
    await open(p);
    await p.addScriptTag({ content: axeSource });
    const res = await p.evaluate(async () => { const r = await window.axe.run(document, { resultTypes: ['violations'] }); return r.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, targets: v.nodes.slice(0, 3).map(n => n.target.join(' ')) })); });
    for (const v of res) found.push({ scheme, view: name, ...v });
    await ctx.close();
  }
}
await browser.close(); server.close();
const blocking = found.filter(v => v.impact === 'serious' || v.impact === 'critical');
const receipt = { gate: 'a11y', engine: 'axe-core ' + require('axe-core/package.json').version, verdict: blocking.length ? 'fail' : 'pass', blocking: blocking.length, notes: found.length - blocking.length, violations: found };
mkdirSync(new URL('./receipts/', import.meta.url), { recursive: true });
writeFileSync(new URL('./receipts/a11y.json', import.meta.url), JSON.stringify(receipt, null, 1));
console.log(JSON.stringify(receipt, null, 1));
process.exit(blocking.length ? 1 : 0);
