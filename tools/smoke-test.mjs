/*
 * Optional developer smoke test. Needs Playwright and a Chromium build.
 *   node tools/smoke-test.mjs
 * It serves a fake LinkedIn profile (with a fake Apollo panel) at the real
 * linkedin.com URL, loads the unpacked extension, and checks that the panel
 * mounts, the email is picked up and a draft round trips to a stubbed API.
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// Playwright may be installed locally or globally; accept either, and either
// module shape.
const playwright = await import('playwright').catch(() =>
  import(process.env.PLAYWRIGHT_PATH || '/opt/node-tools/node_modules/playwright/index.js')
);
const { chromium } = playwright.chromium ? playwright : playwright.default;

const PROFILE_HTML = `<!doctype html><html><head><title>Ada Lovelace | LinkedIn</title></head>
<body>
  <main>
    <h1>Ada Lovelace</h1>
    <div class="text-body-medium break-words">Head of Platform at Analytical Engines</div>
    <span class="text-body-small inline t-black--light break-words">London, England</span>
    <a href="/company/analytical-engines/">Analytical Engines</a>
    <section><h2>About</h2><p>I work on compilers and developer tooling. Previously at Babbage Labs.</p></section>
    <section><h2>Experience</h2><p>Head of Platform, Analytical Engines, 2021 to present</p></section>
  </main>
  <div id="apollo-root">
    <div class="zp_abc123">Email</div>
    <div class="zp_abc123">ada@analyticalengines.com</div>
  </div>
  <footer>press@linkedin.com</footer>
</body></html>`;

const fail = (message) => { console.error(`FAIL  ${message}`); process.exitCode = 1; };
const pass = (message) => console.log(`ok    ${message}`);

const context = await chromium.launchPersistentContext('', {
  headless: true,
  channel: 'chromium',
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`],
  serviceWorkers: 'allow'
});

try {
  await context.route('https://www.linkedin.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: PROFILE_HTML })
  );
  await context.route('https://api.anthropic.com/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        model: 'claude-opus-5-5',
        stop_reason: 'end_turn',
        content: [
          { type: 'thinking', thinking: '' },
          { type: 'text', text: 'Subject: compilers at analytical engines\n\nHi Ada,\n\nSaw you lead platform at Analytical Engines.\n\nWorth fifteen minutes?' }
        ],
        usage: { input_tokens: 1200, output_tokens: 90 }
      })
    })
  );

  await context.route('https://mail.google.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Gmail stub</title>' })
  );

  // Seed settings the way the options page would.
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;
  await worker.evaluate(() =>
    chrome.storage.local.set({
      apiKey: 'sk-ant-test',
      senderName: 'Tester',
      senderRole: 'building things',
      signature: 'Best,\nTester'
    })
  );

  const page = await context.newPage();
  await page.goto('https://www.linkedin.com/in/ada-lovelace/');

  const host = page.locator('#shootme-host');
  await host.waitFor({ state: 'attached', timeout: 10000 });
  pass('content script mounted');

  const launcher = page.locator('#shootme-host button.launcher');
  await launcher.waitFor({ timeout: 10000 });
  pass('launcher button rendered');
  await launcher.click();

  const to = page.locator('#shootme-host #to');
  await to.waitFor({ timeout: 5000 });
  const detected = await to.inputValue();
  detected === 'ada@analyticalengines.com'
    ? pass(`apollo email detected (${detected})`)
    : fail(`expected ada@analyticalengines.com, got "${detected}"`);

  const heading = await page.locator('#shootme-host .head h2').innerText();
  heading.includes('Ada Lovelace') ? pass('profile name scraped') : fail(`heading was "${heading}"`);

  await page.locator('#shootme-host #generate').click();
  const subject = page.locator('#shootme-host #subject');
  await page.waitForFunction(
    () => {
      const input = document.querySelector('#shootme-host').shadowRoot.querySelector('#subject');
      return input && input.value.length > 0;
    },
    null,
    { timeout: 15000 }
  );
  const subjectValue = await subject.inputValue();
  subjectValue === 'compilers at analytical engines'
    ? pass(`subject parsed (${subjectValue})`)
    : fail(`subject was "${subjectValue}"`);

  const bodyValue = await page.locator('#shootme-host #bodyText').inputValue();
  bodyValue.startsWith('Hi Ada,') ? pass('body parsed') : fail(`body started "${bodyValue.slice(0, 40)}"`);
  bodyValue.trimEnd().endsWith('Best,\nTester') ? pass('signature appended') : fail('signature missing');

  const gmailRequest = new Promise((resolve) => {
    const onRequest = (request) => {
      if (request.url().startsWith('https://mail.google.com/')) {
        context.off('request', onRequest);
        resolve(request.url());
      }
    };
    context.on('request', onRequest);
  });
  await page.locator('#shootme-host #gmail').click();
  const gmailUrl = await Promise.race([
    gmailRequest,
    new Promise((_, reject) => setTimeout(() => reject(new Error('no gmail request')), 10000))
  ]);
  gmailUrl.startsWith('https://mail.google.com/mail/u/0/?view=cm')
    ? pass('gmail compose opened')
    : fail(`gmail url was ${gmailUrl}`);
  decodeURIComponent(gmailUrl).includes('to=ada@analyticalengines.com')
    ? pass('recipient in gmail url')
    : fail('recipient missing from gmail url');

  console.log(`\nextension id: ${extensionId}`);
} finally {
  await context.close();
}
