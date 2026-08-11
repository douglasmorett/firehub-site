const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  console.log('Launching browser...');
  // Try launching with system chromium / edge if possible or default chromium
  let browser;
  try {
    browser = await chromium.launch({
      headless: false,
      channel: 'msedge' // Try Edge first since Windows usually has Edge
    });
  } catch (e) {
    console.log('Edge not found or launch failed, falling back to default chromium:', e.message);
    browser = await chromium.launch({ headless: false });
  }

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 }
  });
  const page = await context.newPage();

  console.log('Navigating to https://developer.ifood.com.br ...');
  await page.goto('https://developer.ifood.com.br', { waitUntil: 'networkidle', timeout: 30000 });

  await page.waitForTimeout(3000);

  const url = page.url();
  const title = await page.title();
  console.log('Current URL:', url);
  console.log('Page Title:', title);

  const screenshotPath = path.join(__dirname, 'screenshot1.png');
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log('Screenshot saved to:', screenshotPath);

  // Keep open or close depending on test
  await page.waitForTimeout(5000);
  await browser.close();
})();
