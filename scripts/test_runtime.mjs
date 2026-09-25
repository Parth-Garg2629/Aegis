import { chromium } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

(async () => {
  const extensionPath = path.resolve(__dirname, '../extension/dist');
  const fixturePath = 'file://' + path.resolve(__dirname, '../fixtures/fp_01.html').replace(/\\/g, '/');

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
  await popupPage.goto(`chrome-extension://${extensionId}/popup.html`);
  console.log('Opened extension popup.');

  // Wait for the popup UI
  await popupPage.waitForSelector('#goal-input');
  
  // Enter the goal
  await popupPage.fill('#goal-input', 'Search for computer science scholarships and click the first result.');
  
  // Click Start
  await popupPage.click('#start-btn');
  
  console.log('Started AEGIS session. Observing for 60 seconds...');
  
  // Wait to observe actions on the fixture page
  await new Promise(r => setTimeout(r, 60000));
  
  await context.close();
})();
