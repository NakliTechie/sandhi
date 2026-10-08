// Renders marketing/social.html to the 1280×640 social card: social.png (the site's og:image) and marketing/social.png (the repo's
// social preview). Not part of npm test.   node test/render-social.mjs
import { chromium } from 'playwright';
import { copyFileSync } from 'node:fs';
const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: 1 });
await p.goto(new URL('../marketing/social.html', import.meta.url).href);
await p.screenshot({ path: new URL('../social.png', import.meta.url).pathname, clip: { x: 0, y: 0, width: 1280, height: 640 } });
copyFileSync(new URL('../social.png', import.meta.url).pathname, new URL('../marketing/social.png', import.meta.url).pathname);
await b.close();
console.log('social.png and marketing/social.png: 1280x640');
