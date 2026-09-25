// Peças comuns do E2E da entrega por km (Divinos E2E, porta 3100, banco descartável).
import { chromium } from "playwright";
import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";

export const BASE = process.env.E2E_BASE || "http://localhost:3100";
export const SLUG = "divinos-e2e";
export const EMAIL = "e2e@teste.dev";
export const SENHA = "teste123";
export const LOJA = { lat: -22.854033, lng: -42.0296526 };
/** Tabela da Divinos: km de rua → [taxa, motoboy]. */
export const TABELA = [
  [1, 5, 4], [1.5, 8, 7], [2, 10, 9], [2.5, 12, 11], [3, 15, 14],
  [3.5, 17, 16], [4, 18, 17], [4.5, 19, 18], [5, 20, 19],
];
export function faixaDaTabela(km) {
  const d = Math.round(km * 100) / 100;
  for (let i = 0; i < TABELA.length; i++) {
    const [lim, taxa, moto] = TABELA[i];
    const folga = i === TABELA.length - 1 ? 0.05 : 0;
    if (d <= lim + folga) return { km: lim, taxa, moto };
  }
  return null;
}

export const SAIDA = process.env.E2E_SAIDA || path.join(process.cwd(), "scripts", "e2e-entrega", "saida");
fs.mkdirSync(SAIDA, { recursive: true });

export function banco() {
  const url = process.env.DATABASE_URL || "";
  if (!/localhost|127\.0\.0\.1/.test(url)) throw new Error("DATABASE_URL não é o banco descartável local — recusado.");
  return new PrismaClient();
}

export async function navegador() {
  return chromium.launch({ channel: "chrome", headless: process.env.E2E_HEADED ? false : true });
}

/** Contexto de celular (cardápio). Registra alertas e console. */
export async function contextoCelular(browser, extra = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 430, height: 900 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: "pt-BR",
    ...extra,
  });
  return ctx;
}

export async function contextoPainel(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: "pt-BR" });
  return ctx;
}

/** Guarda alerts/confirms e responde conforme `responder(msg)` (padrão: aceitar). */
export function vigiarDialogos(page, log, responder = () => true) {
  page.on("dialog", async (d) => {
    const msg = d.message();
    log.push({ tipo: d.type(), msg });
    try {
      if (d.type() === "confirm" && !responder(msg)) await d.dismiss();
      else await d.accept();
    } catch {}
  });
}

export function vigiarRede(page, filtro, log) {
  page.on("response", async (r) => {
    const u = r.url();
    if (!filtro(u)) return;
    let corpo = null;
    try { corpo = await r.json(); } catch {}
    log.push({ url: u, status: r.status(), metodo: r.request().method(), corpoEnviado: r.request().postData(), corpo, em: Date.now() });
  });
}

export async function entrarNoPainel(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', SENHA);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 }),
    page.click('button[type="submit"]'),
  ]);
}

export async function foto(page, nome) {
  const arq = path.join(SAIDA, `${nome}.png`);
  await page.screenshot({ path: arq, fullPage: false });
  return arq;
}

export const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

export function gravarResultado(nome, dados) {
  const arq = path.join(SAIDA, `${nome}.json`);
  fs.writeFileSync(arq, JSON.stringify(dados, null, 2));
  return arq;
}

export async function idDaLoja(prisma) {
  const u = await prisma.user.findUnique({ where: { email: EMAIL }, select: { id: true } });
  return u.id;
}

// ── CARDÁPIO NO CELULAR ─────────────────────────────────────────────────────

/** Só o que está visível (o checkout existe duas vezes: coluna e gaveta). */
export const vis = (page, sel) => page.locator(`${sel}:visible`);

/** Abre o cardápio, põe `itens` (nomes) na sacola e vai para "Finalizar Pedido" com entrega. */
export async function irParaOCheckout(page, { itens = ["X-Burger"], nome = "Cliente E2E", fone = "(22) 99888-7766" } = {}) {
  await page.goto(`${BASE}/loja/${SLUG}`, { waitUntil: "domcontentloaded" });
  await page.getByText(itens[0], { exact: true }).first().waitFor({ timeout: 60_000 });
  await page.waitForLoadState("networkidle").catch(() => {});
  // A sacola entra pelo localStorage (a mesma chave que o cardápio grava,
  // fh_cart_<slug>). Pelo clique não dá em `next dev`: o ComboModal empilha
  // uma entrada no history e, no StrictMode (efeitos rodam duas vezes), a
  // limpeza do primeiro efeito dá history.back() e o popstate fecha o modal
  // no mesmo instante. Em produção o efeito roda uma vez só.
  const prisma = banco();
  const produtos = await prisma.menuProduct.findMany({ where: { name: { in: itens }, franchisee: { slug: SLUG } } });
  await prisma.$disconnect();
  const linhas = itens.map((n) => {
    const p = produtos.find((x) => x.name === n);
    return { id: p.id, productId: p.id, name: p.name, description: p.description, price: p.price, category: p.category, imageUrl: p.imageUrl, isCombo: false, quantity: 1 };
  });
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [`fh_cart_${SLUG}`, JSON.stringify({ at: Date.now(), items: linhas })]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByText(/Ver sacola/).first().waitFor({ timeout: 30_000 });
  await page.getByText(/Ver sacola/).first().click();
  await page.getByRole("button", { name: /Continuar pedido/ }).first().click();
  await vis(page, 'input[placeholder="Ex: Maria Silva"]').first().waitFor({ timeout: 15_000 });
  const entrega = vis(page, "button.checkout-type-btn").filter({ hasText: "Entrega (Delivery)" });
  if (await entrega.count()) await entrega.first().click();
  await vis(page, 'input[placeholder="Ex: Maria Silva"]').first().fill(nome);
  await vis(page, 'input[placeholder="Ex: (11) 99999-9999"]').first().fill(fone);
  const dinheiro = vis(page, "button.checkout-type-btn").filter({ hasText: "Dinheiro" });
  if (await dinheiro.count()) await dinheiro.first().click();
}

export const campoRua = (page) => vis(page, 'input[placeholder="Ex: Rua São Paulo, Av. Brasil"]').first();
export const campoNumero = (page) => vis(page, 'input[placeholder="Ex: 98 ou S/N"]').first();
export const campoBairro = (page) => vis(page, 'input[placeholder="Ex: Centro"]').first();
export const campoComplemento = (page) => vis(page, 'input[placeholder="Ex: Apto 12, Bloco B, Próximo à padaria"]').first();
export const painelDaEntrega = (page) => vis(page, "[data-painel-da-entrega]").first();
export const botaoFinalizar = (page) => vis(page, "button").filter({ hasText: /Finalizar Pedido|Enviando pedido|Loja fechada/ }).first();

export async function digitarEndereco(page, { rua, numero, bairro, complemento }) {
  await campoRua(page).fill(rua);
  await campoNumero(page).fill(numero);
  await campoBairro(page).fill(bairro);
  if (complemento != null) await campoComplemento(page).fill(complemento);
  await campoBairro(page).press("Tab");
}

/** Espera o painel da entrega sair de "calculando" e devolve o texto. */
export async function esperarPainel(page, { ms = 30_000, contem = null } = {}) {
  const t0 = Date.now();
  let texto = "";
  while (Date.now() - t0 < ms) {
    texto = await painelDaEntrega(page).innerText().catch(() => "");
    const calculando = /Calculando|calculando|Medindo|⏳/.test(texto);
    if (!calculando && texto && (!contem || contem.test(texto))) return texto;
    await dormir(400);
  }
  return texto;
}

/** O último pedido da loja (com itens). */
export async function ultimoPedido(prisma, lojaId) {
  return prisma.customerOrder.findFirst({ where: { franchiseeId: lojaId }, orderBy: { createdAt: "desc" }, include: { items: true } });
}
