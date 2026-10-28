/**
 * Headless view capture for manual/visual regression.
 *
 *   node scripts/capture-views.mjs <baseUrl> <outDir>
 *
 * Uses playwright-core against an already-installed Chromium; point CHROME_PATH at
 * any Chromium/Chrome binary if auto-discovery fails.
 */

import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';

const baseUrl = process.argv[2] ?? 'http://127.0.0.1:5202/';
const outDir = process.argv[3] ?? 'docs/screenshots';

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const cache = `${homedir()}/Library/Caches/ms-playwright`;
  for (const dir of ['chromium_headless_shell-1217/chrome-headless-shell-mac-arm64/chrome-headless-shell', 'chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing']) {
    const candidate = `${cache}/${dir}`;
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

const executablePath = findChrome();
const browser = await chromium.launch({ executablePath, headless: true });
const page = await browser.newPage({ viewport: { width: 1680, height: 1050 }, deviceScaleFactor: 2 });

const problems = [];
page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error') problems.push(`console: ${message.text()}`);
});

await mkdir(outDir, { recursive: true });
await page.goto(baseUrl, { waitUntil: 'networkidle' });
await page.waitForSelector('.rack-face');
await page.screenshot({ path: `${outDir}/01-empty-elevation.png`, fullPage: true });

await page.getByRole('button', { name: 'auto-place plan' }).click();
await page.waitForSelector('.rack-face .unit');
const placed = await page.locator('.rack-face .unit').count();
await page.screenshot({ path: `${outDir}/02-front-elevation.png`, fullPage: true });

await page.getByRole('tab', { name: 'side cross-section' }).click();
await page.waitForSelector('.side-svg');
await page.screenshot({ path: `${outDir}/03-side-cross-section.png`, fullPage: true });

await page.getByRole('tab', { name: 'wiring diagram' }).click();
await page.waitForSelector('.wiring-svg');
await page.screenshot({ path: `${outDir}/04-wiring-diagram.png`, fullPage: true });

// Drag a tray unit onto a *free* part of the elevation (top of the rack, since the
// BOTTOM strategy fills from the floor up). The engine must accept it.
await page.getByRole('tab', { name: 'front elevation' }).click();
await page.waitForSelector('.rack-face .unit');
const before = await page.locator('.rack-face .unit').count();
const face = await page.locator('.rack-face').boundingBox();
const source = await page.locator('.tray-row >> nth=0').boundingBox();
let ghostCount = 0;
if (face && source) {
  await page.mouse.move(source.x + 30, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(face.x + 120, face.y + 30, { steps: 12 }); // near U42, kept free by BOTTOM
  await page.waitForTimeout(150);
  ghostCount = await page.locator('.drop-ghost').count();
  await page.screenshot({
    path: `${outDir}/05-drag-ghost.png`,
    clip: { x: Math.max(0, face.x - 20), y: Math.max(0, face.y - 60), width: face.width + 320, height: Math.min(face.height, 460) },
  });
  await page.mouse.up();
  await page.waitForTimeout(200);
}
await page.waitForTimeout(100);
const after = await page.locator('.rack-face .unit').count();
const notice = await page.locator('.notice').first().innerText().catch(() => '');

// Keyboard re-seating of the selected unit.
const selectedTopBefore = await page.locator('.unit.is-selected').first().boundingBox();
await page.locator('.rack-face').press('ArrowUp');
await page.waitForTimeout(150);
const selectedTopAfter = await page.locator('.unit.is-selected').first().boundingBox();

const report = {
  baseUrl,
  unitsAfterAutoPlace: placed,
  dragDrop: { before, after, accepted: after === before + 1, notice },
  ghostPreviewDuringDrag: ghostCount,
  keyboardNudge:
    selectedTopBefore && selectedTopAfter ? selectedTopAfter.y < selectedTopBefore.y : false,
  diagnostics: await page.locator('.diag').count(),
  diagnosticCodes: await page.locator('.diag-code').allInnerTexts(),
  errors: await page.locator('.diag.sev-error').count(),
  channelStrips: await page.locator('.channel-strip').count(),
  trayRowsRendered: await page.locator('.tray-row').count(),
  capacityMeters: await page.locator('.meter').allInnerTexts(),
  problems,
};

await page.screenshot({ path: `${outDir}/05-after-interaction.png`, fullPage: true });
console.log(JSON.stringify(report, null, 2));
await browser.close();
