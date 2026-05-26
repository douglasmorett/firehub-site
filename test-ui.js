const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Log all network requests that fail
  page.on('response', response => {
    if (response.status() >= 400) {
      console.log(`[NETWORK ERROR] ${response.status()} ${response.url()}`);
    }
  });

  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log(`[BROWSER ERROR] ${msg.text()}`);
    }
  });

  page.on('dialog', async dialog => {
    console.log(`[DIALOG ALERT]: ${dialog.message()}`);
    await page.screenshot({ path: 'test-ui-alert.png' });
    await dialog.accept();
  });

  try {
    console.log("1. Navegando para login...");
    await page.goto('https://www.firehubfood.com.br/login');
    
    await page.fill('input[type="email"]', 'paulocoutinhocastilho@gmail.com');
    await page.fill('input[type="password"]', '123456');
    await page.click('button[type="submit"]');

    await page.waitForURL('**/store');
    console.log("-> Logado!");

    console.log("2. Clicando em Fazer Compras...");
    await page.waitForSelector('text=Fazer Compras');
    await page.click('text=Fazer Compras');
    await page.waitForURL('**/store/compras');

    console.log("3. Adicionando itens até atingir R$ 300...");
    await page.waitForSelector('text=Adicionar');
    const addButtons = await page.$$('text=Adicionar');
    
    for(let i = 0; i < 20; i++) {
      await addButtons[0].click();
      await page.waitForTimeout(400);
      
      // Checar se já podemos finalizar (sidebar)
      const btn = await page.$('text=Finalizar e Gerar Boleto');
      if (btn) {
        console.log("-> Valor mínimo atingido!");
        break;
      }
    }

    console.log("4. Indo para o carrinho...");
    await page.goto('https://www.firehubfood.com.br/store/cart');
    await page.waitForURL('**/store/cart');
    
    const isReady = await page.$('text=Finalizar e Gerar Boleto');
    if (isReady) {
       console.log("5. Clicando em Finalizar e Gerar Boleto...");
       await page.click('text=Finalizar e Gerar Boleto');
    } else {
       console.log("-> Não atingiu o mínimo ainda.");
       return;
    }

    console.log("6. Aguardando resultado (5s)...");
    await page.waitForTimeout(5000);

    const currentUrl = page.url();
    console.log("URL Atual após checkout:", currentUrl);
    
    const pageContent = await page.content();
    if (pageContent.includes('Pedido Confirmado')) {
      console.log("SUCESSO: A tela de Pedido Confirmado apareceu.");
    } else {
      console.log("ERRO: A tela de Pedido Confirmado NÃO apareceu.");
    }

    await page.screenshot({ path: 'test-ui-result.png' });

  } catch (err) {
    console.error("Erro no teste:", err);
  } finally {
    await browser.close();
  }
})();
