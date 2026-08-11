import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';

const root = new URL('.', import.meta.url).pathname;
const mimeTypes = {
  '.css': 'text/css',
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.wasm': 'application/wasm',
};

const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const relativePath = pathname === '/' ? 'examples/index.html' : pathname.slice(1);
    const filePath = normalize(join(root, relativePath));
    assert.ok(filePath.startsWith(root), 'request escaped repository root');
    const body = await readFile(filePath);
    response.writeHead(200, { 'content-type': mimeTypes[extname(filePath)] ?? 'application/octet-stream' });
    response.end(body);
  } catch (error) {
    response.writeHead(error?.code === 'ENOENT' ? 404 : 500);
    response.end(String(error));
  }
});

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});

const { port } = server.address();
const origin = `http://127.0.0.1:${port}`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });

async function openPage(pathname, { cdnPackage = false } = {}) {
  const page = await browser.newPage();
  const runtimeErrors = [];
  page.on('pageerror', (error) => runtimeErrors.push(error));

  await page.route('https://fonts.googleapis.com/**', (route) => route.abort());
  await page.route('https://fonts.gstatic.com/**', (route) => route.abort());
  await page.route('https://unpkg.com/lucide@latest/dist/umd/lucide.min.js', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: 'globalThis.lucide = { createIcons() {} };' }),
  );

  if (cdnPackage) {
    await page.route('https://unpkg.com/rayforce-wasm@0.2.1/dist/**', async (route) => {
      const filename = new URL(route.request().url()).pathname.split('/').at(-1);
      const filePath = join(root, 'dist', filename);
      await route.fulfill({
        contentType: mimeTypes[extname(filePath)] ?? 'application/octet-stream',
        body: await readFile(filePath),
      });
    });
  }

  await page.goto(`${origin}${pathname}`);
  return { page, runtimeErrors };
}

try {
  const main = await openPage('/examples/index.html');
  await main.page.waitForFunction(() => globalThis.rf?.version);

  const exampleButtons = main.page.locator('.example-btn');
  for (let index = 0; index < (await exampleButtons.count()); index += 1) {
    const before = await main.page.locator('.output-line').count();
    await exampleButtons.nth(index).click();
    const output = main.page.locator('.output-line').nth(before + 1);
    await output.waitFor();
    const classes = (await output.getAttribute('class'))?.split(/\s+/) ?? [];
    assert.ok(!classes.includes('error'), `expression example ${index + 1} failed: ${await output.textContent()}`);
  }

  const demos = [
    ['demoZeroCopy', '#demo-zerocopy-result', 'Zero-copy mutation successful'],
    ['demoTable', '#demo-table-result', 'Table created'],
    ['demoQuery', '#demo-query-result', 'Filtered (score > 90): 2 rows'],
    ['demoPerfTest', '#demo-perf-result', 'Benchmark complete'],
    ['demoTypeConversion', '#demo-typeconv-result', 'Type conversion successful'],
    ['demoAggregations', '#demo-aggr-result', 'sum:'],
  ];
  for (const [functionName, selector, expected] of demos) {
    await main.page.evaluate((name) => globalThis[name](), functionName);
    assert.match(await main.page.locator(selector).textContent(), new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  await main.page.evaluate(() => globalThis.createSampleTable());
  assert.equal(await main.page.locator('#table-display tbody tr').count(), 5);
  await main.page.evaluate(() => globalThis.filterTable());
  assert.match(await main.page.locator('#table-display').textContent(), /Filtered: 4 of 5 rows/);
  await main.page.evaluate(() => globalThis.createSampleTable());
  await main.page.evaluate(() => globalThis.addTableRow());
  assert.equal(await main.page.locator('#table-display tbody tr').count(), 6);
  await main.page.evaluate(() => globalThis.groupByTable());
  assert.match(await main.page.locator('#table-display').textContent(), /Grouped by department: 3 groups/);
  await main.page.evaluate(() => globalThis.aggregateTable());
  assert.match(await main.page.locator('#table-display').textContent(), /Row count:\s*6/);

  assert.deepEqual(main.runtimeErrors, [], `main example page errors: ${main.runtimeErrors.join('\n')}`);
  await main.page.close();

  const minimal = await openPage('/examples/minimal.html', { cdnPackage: true });
  await minimal.page.evaluate(() => globalThis.runDemo());
  const output = minimal.page.locator('#output');
  await minimal.page.waitForFunction(() => document.querySelector('#output')?.textContent.includes('= 49'));
  const minimalText = await output.textContent();
  assert.match(minimalText, /\(sum \[1 2 3 4 5\]\) = 15/);
  assert.match(minimalText, /\(\(fn \[x\] \(\* x x\)\) 7\) = 49/);
  assert.ok(!minimalText.includes('Error:'), minimalText);
  assert.deepEqual(minimal.runtimeErrors, [], `minimal example page errors: ${minimal.runtimeErrors.join('\n')}`);
  await minimal.page.close();

  console.log('15 expression examples, 11 interactive demos, and the CDN example passed in Chrome');
} finally {
  await browser.close();
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}
