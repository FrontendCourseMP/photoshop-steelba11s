import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.TEST_NODE_MODULES ? resolve(process.env.TEST_NODE_MODULES, 'playwright') : 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
await mkdir(resolve(root, 'artifacts'), { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, acceptDownloads: true });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const url = process.env.TEST_URL || 'http://localhost:5173';
let checks = 0;
async function ready() { await page.waitForFunction(() => !document.getElementById('save').disabled); }
async function load(name, count) {
  await page.locator('#file').setInputFiles(resolve(root, 'samples', name));
  await ready();
  assert.equal(await page.locator('.channel-row').count(), count, name);
  assert.equal(await page.locator('#error').isVisible(), false, name);
  checks++;
}
async function canvasPixels() {
  return page.locator('#canvas').evaluate(canvas => Array.from(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data));
}
async function exportAs(format, fileName) {
  await page.locator('#save').click();
  await page.locator('#export-format').selectOption(format);
  await page.locator('#export-name').fill(fileName);
  const downloadReady = page.waitForEvent('download');
  await page.locator('#export-submit').click();
  const download = await downloadReady;
  const path = resolve(root, 'artifacts', download.suggestedFilename());
  await download.saveAs(path);
  await page.waitForFunction(() => !document.getElementById('export-dialog').open);
  return path;
}
async function assertNoOverflow() {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, 'Horizontal page overflow');
  const overflowing = await page.locator('button, .panel-title, .channel-name, .image-info').evaluateAll(elements => elements.filter(e => e.clientWidth > 0 && e.scrollWidth > e.clientWidth + 1).map(e => e.textContent.trim()));
  assert.deepEqual(overflowing, [], 'Control text overflow');
}

try {
  await page.goto(url);
  await page.locator('#sample').click();
  await ready();
  await page.getByRole('button', { name: 'Пипетка', exact: true }).click();
  await page.locator('#canvas').click({ position: { x: 30, y: 30 } });
  await page.screenshot({ path: resolve(root, 'artifacts', 'desktop.png') });
  await assertNoOverflow();
  await load('rgb.png', 3);
  assert.match(await page.locator('#depth').innerText(), /24 бит/);
  assert.deepEqual((await canvasPixels()).slice(0, 12), [255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]);
  await page.locator('[data-channel="green"] input').uncheck();
  await ready();
  assert.deepEqual((await canvasPixels()).slice(4, 8), [0, 0, 0, 255]);
  await page.locator('[data-channel="green"] input').check();
  await ready();
  await page.locator('#canvas').click({ position: { x: 0.5, y: 0.5 } });
  assert.equal(await page.locator('#pixel-x').innerText(), '0');
  assert.equal(await page.locator('#pixel-y').innerText(), '0');
  assert.equal(await page.locator('#pixel-r').innerText(), '255');
  assert.equal(await page.locator('#pixel-l').innerText(), '53.24');
  checks += 4;

  const pngPath = await exportAs('png', 'roundtrip');
  await page.locator('#file').setInputFiles(pngPath); await ready();
  assert.deepEqual((await canvasPixels()).slice(0, 12), [255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]);
  const jpgPath = await exportAs('jpg', 'roundtrip');
  await writeFile(resolve(root, 'samples', 'rgb.jpg'), await readFile(jpgPath));
  await load('rgb.jpg', 3);
  assert.match(await page.locator('#depth').innerText(), /24 бит \(RGB\)/);
  const gbPath = await exportAs('gb7', 'roundtrip');
  await page.locator('#file').setInputFiles(gbPath); await ready();
  assert.equal(await page.locator('.channel-row').count(), 1);
  checks += 3;

  await load('rgba.png', 4);
  for (const channel of ['red', 'green', 'blue']) await page.locator(`[data-channel="${channel}"] input`).uncheck();
  await ready();
  assert.deepEqual((await canvasPixels()).slice(12), [128, 128, 128, 255, 0, 0, 0, 255, 64, 64, 64, 255]);
  for (const channel of ['red', 'green', 'blue']) await page.locator(`[data-channel="${channel}"] input`).check();
  await ready();
  const alphaPng = await exportAs('png', 'alpha');
  await page.locator('#file').setInputFiles(alphaPng); await ready();
  assert.equal((await canvasPixels())[15], 128);
  const whiteJpg = await exportAs('jpg', 'white-background');
  await page.locator('#file').setInputFiles(whiteJpg); await ready();
  assert.equal((await canvasPixels())[19], 255);
  await load('rgba.png', 4);
  const alphaGb = await exportAs('gb7', 'binary-alpha');
  const encoded = await readFile(alphaGb);
  assert.equal(encoded[5], 1);
  assert.equal(encoded[15] & 128, 128);
  assert.equal(encoded[16] & 128, 0);
  assert.equal(encoded[17] & 128, 0);
  checks += 4;

  for (const [file, count] of [['gray.png', 1], ['gray-alpha.png', 2], ['rgba-opaque.png', 4], ['rgb-gray-content.png', 3], ['gray.gb7', 1], ['mask.gb7', 2]]) await load(file, count);
  await load('gray-alpha.png', 2);
  assert.match(await page.locator('#depth').innerText(), /16 бит/);
  await load('transparent.png', 4);
  const clearJpg = await exportAs('jpg', 'fully-transparent');
  await page.locator('#file').setInputFiles(clearJpg); await ready();
  assert.deepEqual((await canvasPixels()).slice(0, 4), [255, 255, 255, 255]);
  checks += 2;
  const beforeError = await canvasPixels();
  await page.locator('#file').setInputFiles({ name: 'broken.gb7', mimeType: 'application/octet-stream', buffer: Buffer.from([71, 66, 55, 29]) });
  await page.locator('#error').waitFor({ state: 'visible' });
  assert.deepEqual(await canvasPixels(), beforeError);
  await page.locator('#error-close').click();
  checks++;

  await load('large-rgb.png', 3);
  assert.equal(await page.locator('#dimensions').innerText(), '3200 × 2400 px');
  const largeJpg = await exportAs('jpg', 'large');
  await writeFile(resolve(root, 'samples', 'large-rgb.jpg'), await readFile(largeJpg));
  await load('large-rgb.jpg', 3);
  for (const format of ['png', 'gb7']) await exportAs(format, `large-${format}`);
  await load('large-gray.gb7', 1);
  for (const format of ['png', 'jpg', 'gb7']) await exportAs(format, `large-gray-${format}`);
  await load('large-rgb.png', 3);
  const responsive = await page.evaluate(async () => {
    const input = document.querySelector('[data-channel="green"] input');
    input.checked = false;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return new Promise(resolve => setTimeout(() => resolve(document.getElementById('save').disabled), 0));
  });
  assert.equal(responsive, true, 'Browser receives control before large channel transformation finishes');
  await ready();
  await page.evaluate(() => {
    for (const [id, enabled] of [['red', false], ['red', true], ['green', true], ['blue', false], ['blue', true]]) {
      const input = document.querySelector(`[data-channel="${id}"] input`);
      input.checked = enabled;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  await ready();
  assert.deepEqual(await page.locator('#canvas').evaluate(c => Array.from(c.getContext('2d').getImageData(10, 20, 1, 1).data)), [10, 20, 30, 255]);
  checks += 2;
  const box = await page.locator('#canvas').boundingBox();
  const px = Math.floor(1000.5 * box.width / 3200 * 1000) / 1000;
  const py = Math.floor(900.5 * box.height / 2400 * 1000) / 1000;
  await page.mouse.click(box.x + px, box.y + py);
  assert.equal(await page.locator('#pixel-x').innerText(), '1000');
  assert.equal(await page.locator('#pixel-y').innerText(), '900');
  assert.equal(await page.locator('#pixel-r').innerText(), '232');
  await page.locator('#actual').click();
  await page.locator('#workspace').evaluate(e => { e.scrollLeft = 1000; e.scrollTop = 800; });
  const actualBox = await page.locator('#canvas').boundingBox();
  const workspaceBox = await page.locator('#workspace').boundingBox();
  const clickX = workspaceBox.x + 100, clickY = workspaceBox.y + 100;
  await page.mouse.click(clickX, clickY);
  assert.equal(Number(await page.locator('#pixel-x').innerText()), Math.floor(clickX - actualBox.x));
  assert.equal(Number(await page.locator('#pixel-y').innerText()), Math.floor(clickY - actualBox.y));
  await page.locator('#fit').click();
  checks += 8;

  for (const width of [1920, 1440, 900, 680, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await assertNoOverflow();
    const geometry = await page.locator('#canvas').boundingBox();
    assert.ok(geometry.width > 0 && geometry.height > 0);
    assert.equal(await page.locator('.thumbnail').first().isVisible(), true);
    checks++;
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: resolve(root, 'artifacts', 'mobile.png'), fullPage: true });
  await page.locator('#save').click();
  await assertNoOverflow();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#export-dialog').isVisible(), false);
  assert.deepEqual(errors, []);
  console.log(`Passed ${checks} browser checks. Screenshots: artifacts/desktop.png, artifacts/mobile.png`);
} finally { await browser.close(); }
