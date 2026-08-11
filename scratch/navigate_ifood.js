const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  console.log('🚀 Iniciando navegador Chrome/Edge para developer.ifood.com.br...');

  // Launch browser in headed mode so it appears on user screen
  const browser = await chromium.launch({
    headless: false,
    channel: 'msedge', // Default to Edge on Windows
    args: ['--start-maximized']
  }).catch(async () => {
    return await chromium.launch({ headless: false, args: ['--start-maximized'] });
  });

  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();

  console.log('🌐 Navegando para https://developer.ifood.com.br ...');
  await page.goto('https://developer.ifood.com.br', { waitUntil: 'domcontentloaded', timeout: 60000 });

  await page.waitForTimeout(4000);

  console.log('📌 URL Atual:', page.url());
  console.log('📌 Título:', await page.title());

  // Save screenshot to inspect state
  const screenshotPath = path.join(__dirname, 'ifood_portal_state.png');
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log('📸 Screenshot salva em:', screenshotPath);

  // Keep script active so browser stays open for user or for actions
  console.log('⌛ Mantendo o navegador aberto por 5 minutos...');
  await page.waitForTimeout(300000);

  await browser.close();
})();
