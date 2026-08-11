const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  console.log('🚀 Iniciando Playwright usando Edge do sistema...');

  const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const executablePath = fs.existsSync(edgePath) ? edgePath : chromePath;

  const browser = await chromium.launch({
    executablePath,
    headless: false,
    args: ['--start-maximized']
  });

  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();

  try {
    console.log('🌐 Navegando para https://developer.ifood.com.br ...');
    await page.goto('https://developer.ifood.com.br', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    const screenshot1 = path.join(__dirname, 'step1_portal.png');
    await page.screenshot({ path: screenshot1, fullPage: true });
    console.log('📸 Passo 1 salvo:', screenshot1);

    console.log('📌 URL Atual:', page.url());
    console.log('📌 Título:', await page.title());

    // Click Login button if present
    const loginLink = await page.$('a:has-text("Faça login"), button:has-text("Faça login")');
    if (loginLink) {
      console.log('🔑 Clicando em "Faça login"...');
      await loginLink.click();
      await page.waitForTimeout(4000);
      const screenshotLogin = path.join(__dirname, 'step2_login_page.png');
      await page.screenshot({ path: screenshotLogin, fullPage: true });
      console.log('📸 Passo 2 (Login) salvo:', screenshotLogin);
      console.log('📌 URL após Login click:', page.url());
    }

    // Keep browser open for 60 seconds
    console.log('⌛ Navegador aberto na tela para prosseguir...');
    await page.waitForTimeout(60000);

  } catch (err) {
    console.error('❌ Erro:', err.message);
  } finally {
    await browser.close();
  }
})();
