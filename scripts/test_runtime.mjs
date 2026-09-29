import { chromium } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

(async () => {
  const extensionPath = path.resolve(__dirname, '../extension/dist');
  const fixtureHtml = readFileSync(path.resolve(__dirname, '../fixtures/fp_01.html'));
  const fixtureServer = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(fixtureHtml);
  });
  await new Promise((resolve) => fixtureServer.listen(8766, '127.0.0.1', resolve));
  const fixturePath = 'http://127.0.0.1:8766/fixture';

  console.log(`Loading extension from: ${extensionPath}`);
  console.log(`Opening fixture: ${fixturePath}`);

  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    ],
    ignoreDefaultArgs: ['--disable-extensions']
  });

  const page = await context.newPage();
  page.on('console', msg => console.log(`[FIXTURE LOG] ${msg.type()}: ${msg.text()}`));
  page.on('pageerror', err => console.log(`[FIXTURE ERROR] ${err.name}`));

  context.on('page', (p) => {
    p.on('console', msg => console.log(`[PAGE LOG] ${msg.text()}`));
    p.on('pageerror', err => console.log(`[PAGE ERROR] ${err.message}`));
  });
  
  context.serviceWorkers().forEach(sw => {
    sw.on('console', msg => console.log(`[SW LOG] ${msg.text()}`));
  });
  context.on('serviceworker', sw => {
    sw.on('console', msg => console.log(`[SW LOG] ${msg.text()}`));
  });

  await page.goto(fixturePath);
  console.log('Opened fixture page.');

  // Find the extension ID
  let extensionId = '';
  const backgroundPages = context.backgroundPages();
  const serviceWorkers = context.serviceWorkers();
  
  if (serviceWorkers.length > 0) {
    const swUrl = serviceWorkers[0].url();
    extensionId = swUrl.split('/')[2];
  } else {
    // wait a bit for sw to register
    await new Promise(r => setTimeout(r, 2000));
    const sw = context.serviceWorkers()[0];
    if (sw) extensionId = sw.url().split('/')[2];
  }

  if (!extensionId) {
    console.log("Could not find extension ID");
    process.exit(1);
  }

  console.log(`Extension ID: ${extensionId}`);

  // Open the popup
  const popupPage = await context.newPage();
  popupPage.on('console', msg => console.log(`[POPUP LOG] ${msg.type()}: ${msg.text()}`));
  popupPage.on('pageerror', err => console.log(`[POPUP ERROR] ${err.name}`));
  await popupPage.goto(`chrome-extension://${extensionId}/popup.html`);
  console.log('Opened extension popup.');

  // Wait for the popup UI
  await popupPage.waitForSelector('#goal-input');
  
  // Enter the goal
  await popupPage.fill('#goal-input', 'Search for computer science scholarships and click the first result.');

  const injection = await popupPage.evaluate(async () => {
    const fixtureTabs = await chrome.tabs.query({ url: 'http://127.0.0.1:8766/*' });
    const target = fixtureTabs[0];
    if (target?.id === undefined) return { ready: false, elementCount: 0, errorCode: 'NO_FIXTURE_TAB' };
    for (let attempt = 0; attempt < 12; attempt += 1) {
      try {
        const response = await chrome.tabs.sendMessage(target.id, { type: 'EXTRACT_DOM_REQUEST' });
        if (response?.schema) return { ready: true, elementCount: response.schema.elements?.length ?? 0 };
      } catch (error) {
        if (attempt === 11) {
          const message = error instanceof Error ? error.message : '';
          return {
            ready: false,
            elementCount: 0,
            errorCode: message.includes('Receiving end does not exist') ? 'NO_CONTENT_SCRIPT' : 'TAB_ACCESS_DENIED',
          };
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return { ready: false, elementCount: 0, errorCode: 'NO_CONTENT_SCRIPT' };
  });
  console.log(`Fixture content script ready=${injection.ready}; visible elements=${injection.elementCount}; error=${injection.errorCode ?? 'none'}`);
  if (!injection.ready) {
    console.log('Content script was unavailable; aborting before starting the extension loop.');
    await context.close();
    await new Promise((resolve, reject) => fixtureServer.close((err) => err ? reject(err) : resolve()));
    process.exitCode = 1;
    return;
  }
  
  // Click Start
  // The popup is opened as a test tab, so bring the fixture back to the active
  // tab before requesting start. The service worker resolves the active tab
  // synchronously when it handles the start message.
  await popupPage.evaluate(async () => {
    const fixtureTabs = await chrome.tabs.query({ url: 'http://127.0.0.1:8766/*' });
    if (fixtureTabs[0]?.id !== undefined) {
      await chrome.tabs.update(fixtureTabs[0].id, { active: true });
    }
    document.querySelector('#start-btn')?.click();
  });
  
  console.log('Started AEGIS session. Waiting up to 45 seconds for a terminal state...');
  try {
    await popupPage.waitForFunction(() => {
      const status = document.querySelector('#agent-status')?.textContent?.trim();
      return status === 'Completed' || status === 'Failed';
    }, undefined, { timeout: 45000 });
    const status = await popupPage.locator('#agent-status').textContent();
    const step = await popupPage.locator('#step-counter').textContent();
    const fixtureResult = await page.locator('#results-container').getAttribute('data-status');
    const inputValue = await page.locator('#search-input').inputValue();
    const domSucceeded = status?.trim() === 'Completed' && fixtureResult === 'searched' && inputValue === 'Scholarship Portal';
    console.log(`Fixture run terminal status=${status}; step=${step}; result=${fixtureResult ?? 'not-submitted'}; dom_succeeded=${domSucceeded}`);
    if (!domSucceeded) process.exitCode = 1;
  } catch {
    console.log('Fixture run did not reach a terminal popup state within 45 seconds.');
  } finally {
    await context.close();
    await new Promise((resolve, reject) => fixtureServer.close((err) => err ? reject(err) : resolve()));
  }
})();
