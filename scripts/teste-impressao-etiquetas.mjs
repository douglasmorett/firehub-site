/**
 * node scripts/teste-impressao-etiquetas.mjs
 *
 * Sem banco, impressora ou rede externa: executa o helper real no Chromium e
 * intercepta window.print. Para também testar o botão React na prévia LOCAL:
 * PREVIEW_ETIQUETAS_URL=http://localhost:3137 PREVIEW_ETIQUETAS_EMAIL=...
 * PREVIEW_ETIQUETAS_SENHA=... node scripts/teste-impressao-etiquetas.mjs
 * Use somente uma loja sintética em banco descartável: o teste gera lotes.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import ts from "typescript";

const pasta = new URL("../src/app/store/etiquetas/", import.meta.url);
const css = ts.transpileModule(await readFile(new URL("etiqueta-css.ts", pasta), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const helper = ts.transpileModule(await readFile(new URL("imprimir-etiquetas.ts", pasta), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const bundle = `(() => {
  const css = { exports: {} }; ((exports) => { ${css} })(css.exports);
  const helper = { exports: {} };
  ((exports, require) => { ${helper} })(helper.exports, () => css.exports);
  window.imprimirEtiquetas = helper.exports.imprimirEtiquetas;
})();`;
const pixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6VxAAAAAASUVORK5CYII=", "base64");
const browser = await chromium.launch({ headless: true });
let verificacoes = 0;
const confere = (condicao, texto) => { assert.ok(condicao, texto); verificacoes++; console.log(`✓ ${texto}`); };

const instrumentar = async (context) => {
  await context.addInitScript(() => {
    if (window === window.top) window.__impressoes = [];
    window.print = () => {
      if (window.top.__falharImpressao) throw new Error("Impressão indisponível no teste");
      window.top.__impressoes.push({
        html: document.documentElement.outerHTML,
        paginas: document.querySelectorAll(".label-page").length,
        imagens: Array.from(document.images, imagem => ({ completa: imagem.complete, largura: imagem.naturalWidth })),
        codigos: Array.from(document.querySelectorAll('[style*="monospace"]'), elemento => elemento.textContent),
      });
    };
  });
};

try {
  const context = await browser.newContext();
  await instrumentar(context);
  const page = await context.newPage();
  let liberarImagem;
  let imagemPedida;
  const pedida = new Promise(resolve => { imagemPedida = resolve; });
  const liberada = new Promise(resolve => { liberarImagem = resolve; });
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/lenta.png") {
      imagemPedida();
      await liberada;
      await route.fulfill({ contentType: "image/png", body: pixel });
    } else if (url.pathname === "/quebrada.png") {
      await route.fulfill({ status: 404, body: "imagem ausente" });
    } else if (url.pathname === "/") {
      await route.fulfill({ contentType: "text/html", body: "<!doctype html><html><body></body></html>" });
    } else await route.abort();
  });
  await page.goto("http://etiquetas.test/");
  await page.addScriptTag({ content: bundle });
  const iniciar = async html => page.evaluate(html => {
    // Template mantém as imagens inertes até o helper copiar para o iframe.
    const template = document.createElement("template");
    template.innerHTML = `<div>${html}</div>`;
    window.__resultado = "pendente";
    window.__operacao = window.imprimirEtiquetas(template.content.firstElementChild)
      .then(() => { window.__resultado = "ok"; })
      .catch(erro => { window.__resultado = erro.message; });
  }, html);
  const fechar = () => page.evaluate(() => {
    document.querySelector("#label-print-frame")?.contentWindow.dispatchEvent(new Event("afterprint"));
  });

  await iniciar('<div class="label-page">Etiqueta 1<img loading="lazy" src="/lenta.png"></div>');
  await pedida;
  confere(await page.evaluate(() => window.__impressoes.length === 0), "não imprime enquanto a imagem está carregando");
  liberarImagem();
  await page.waitForFunction(() => window.__resultado === "ok");
  confere(await page.evaluate(() => window.__impressoes.length === 1 && window.__impressoes[0].imagens.every(i => i.completa && i.largura > 0)), "print é chamado uma vez, com imagens carregadas");
  await page.waitForTimeout(2200);
  confere(await page.locator("#label-print-frame").count() === 1, "mantém o documento enquanto a escolha da impressora continua aberta");
  await fechar();
  confere(await page.locator("#label-print-frame").count() === 0, "afterprint remove o iframe ao imprimir ou cancelar");

  await iniciar('<div class="label-page">Etiqueta<img src="/quebrada.png"></div>');
  await page.waitForFunction(() => window.__resultado !== "pendente");
  confere(await page.evaluate(() => window.__resultado.includes("imagem") && window.__impressoes.length === 1), "imagem quebrada mostra erro e não envia etiqueta incompleta");
  confere(await page.locator("#label-print-frame").count() === 0, "falha de imagem limpa o documento temporário");

  await page.evaluate(() => { window.__falharImpressao = true; });
  await iniciar('<div class="label-page">Etiqueta</div>');
  await page.waitForFunction(() => window.__resultado !== "pendente");
  confere(await page.evaluate(() => window.__resultado.includes("indisponível") && !document.querySelector("#label-print-frame")), "falha de print é propagada e limpa o iframe");
  await page.evaluate(() => { window.__falharImpressao = false; });

  await iniciar([1, 2, 3].map(n => `<div class="label-page">Etiqueta ${n}</div>`).join(""));
  await page.waitForFunction(() => window.__resultado === "ok");
  const impresso = await page.evaluate(() => window.__impressoes.at(-1));
  confere(impresso.paginas === 3, "preserva todas as etiquetas na mesma impressão");
  const papel = await context.newPage();
  await papel.setContent(impresso.html);
  const pdf = (await papel.pdf({ preferCSSPageSize: true, printBackground: true })).toString("latin1");
  confere((pdf.match(/\/Type \/Page\b/g) || []).length === 3, "PDF tem três páginas sem folha extra");
  confere((pdf.match(/\/MediaBox \[0 0 288 432\]/g) || []).length === 3, "cada página mede 4 × 6 polegadas (288 × 432 pontos)");
  await fechar();
  await context.close();

  const preview = process.env.PREVIEW_ETIQUETAS_URL;
  if (preview) {
    const url = new URL(preview);
    assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && url.protocol === "http:", "A prévia precisa ser local e usar dados sintéticos");
    assert.ok(process.env.PREVIEW_ETIQUETAS_EMAIL && process.env.PREVIEW_ETIQUETAS_SENHA, "Informe a conta sintética da prévia por variáveis de ambiente");
    const real = await browser.newContext();
    await instrumentar(real);
    const tela = await real.newPage();
    const csrf = await (await real.request.get(`${url.origin}/api/auth/csrf`)).json();
    await real.request.post(`${url.origin}/api/auth/callback/credentials`, { form: {
      csrfToken: csrf.csrfToken,
      email: process.env.PREVIEW_ETIQUETAS_EMAIL,
      password: process.env.PREVIEW_ETIQUETAS_SENHA,
      callbackUrl: `${url.origin}/store/etiquetas`,
      json: "true",
    } });
    await tela.goto(`${url.origin}/store/etiquetas`, { timeout: 120000 });
    await tela.locator("#insumo").selectOption({ label: "Frango desfiado - teste" });
    await tela.locator('input[type="date"]').nth(0).fill("2026-10-20");
    await tela.locator('input[type="date"]').nth(1).fill("2026-10-23");
    await tela.getByRole("button", { name: "Imprimir etiqueta", exact: true }).click();
    await tela.waitForFunction(() => window.__impressoes.length === 1, undefined, { timeout: 30000 });
    confere(await tela.evaluate(() => window.__impressoes[0].paginas === 1 && window.__impressoes[0].imagens.length > 0 && !window.__impressoes[0].html.includes("LOLOLOLO") && window.__impressoes[0].imagens.every(i => i.completa && i.largura > 0)), "botão React abre impressão após gerar QR e renderizar a etiqueta");
    await tela.waitForFunction(() => window.__impressoes[0].codigos.every(codigo => !document.querySelector(".print-area").textContent.includes(codigo)));
    confere(await tela.locator(".print-area").innerText().then(texto => texto.includes("LOLOLOLO")), "prévia volta ao código de exemplo depois de copiar a etiqueta");
    await tela.evaluate(() => document.querySelector("#label-print-frame").contentWindow.dispatchEvent(new Event("afterprint")));
    // O checkbox de QR fica no mesmo bloco do texto e não depende de posição.
    await tela.getByRole("checkbox", { name: /Imprimir QR code na etiqueta/ }).uncheck();
    await tela.getByRole("button", { name: "Imprimir etiqueta", exact: true }).click();
    await tela.waitForFunction(() => window.__impressoes.length === 2, undefined, { timeout: 30000 });
    confere(await tela.evaluate(() => window.__impressoes[1].paginas === 1 && !window.__impressoes[1].html.includes("LOLOLOLO")), "botão React também imprime sem QR, sem cancelar seu próprio efeito");
    await real.close();
  }
  console.log(`${verificacoes} verificações aprovadas. Nenhuma impressão física foi enviada.`);
} finally {
  await browser.close();
}
