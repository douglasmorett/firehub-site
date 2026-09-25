// E1 — Painel > Entrega (modo ROTA): cadastrar as 9 faixas da Divinos pela tela,
// com "Motoboy recebe" pelo atalho "taxa − R$ 1", conferindo que o cartão não
// troca de lugar enquanto se digita; validar km repetido e faixa sem repasse;
// salvar, recarregar e conferir no banco.
import { navegador, contextoPainel, entrarNoPainel, foto, BASE, dormir, banco, gravarResultado, TABELA, EMAIL, vigiarDialogos } from "./comum.mjs";

const prisma = banco();
const r = { passos: [], dialogos: [], trocas: [], erros: [] };
const b = await navegador();
const ctx = await contextoPainel(b);
const page = await ctx.newPage();
vigiarDialogos(page, r.dialogos);
page.on("pageerror", (e) => r.erros.push(String(e).slice(0, 300)));

const kmInputs = () => page.locator('input[aria-label="Até quantos km"]');
const feeInputs = () => page.locator('input[aria-label="Cliente paga (R$)"]');
const timeInputs = () => page.locator('input[aria-label="Tempo de entrega em minutos"]');
const motoInputs = () => page.locator('input[aria-label="Motoboy recebe (R$)"]');
const avisoDoPainel = () => page.locator(".fh-painel-aviso");

/** Digita tecla a tecla no km do cartão `i`, conferindo que o MESMO nó continua no índice `i` e focado. */
async function digitarKmSemPular(i, texto) {
  const alvo = kmInputs().nth(i);
  const handle = await alvo.elementHandle();
  await alvo.click();
  await page.keyboard.press("Control+A");
  for (const ch of texto) {
    await page.keyboard.type(ch);
    await dormir(120);
    const estado = await page.evaluate((el) => {
      const lista = Array.from(document.querySelectorAll('input[aria-label="Até quantos km"]'));
      return { indice: lista.indexOf(el), focado: document.activeElement === el, valor: el.value, total: lista.length };
    }, handle);
    r.trocas.push({ cartao: i, digitado: texto, tecla: ch, ...estado });
    if (estado.indice !== i || !estado.focado) r.passos.push(`PULOU: cartão ${i} foi para ${estado.indice} (focado=${estado.focado}) ao digitar "${ch}" de "${texto}"`);
  }
}

async function preencher(loc, valor) {
  await loc.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.type(String(valor));
}

try {
  await entrarNoPainel(page);
  await page.goto(`${BASE}/store/minha-loja#entrega`, { waitUntil: "domcontentloaded" });
  await page.getByText("Faixas por km percorrido", { exact: false }).first().waitFor({ timeout: 60_000 });
  await dormir(2500);
  r.passos.push(`abriu com ${await kmInputs().count()} faixas (exemplo)`);
  r.repasseAoAbrir = await page.getByRole("radio", { name: "Um valor por faixa" }).getAttribute("aria-checked");
  await page.getByRole("radio", { name: "Um valor por faixa" }).click();
  await dormir(300);

  // Faixas 1..3 reaproveitam os cartões de exemplo (1/3/5 km).
  const alvo = TABELA.map(([km, taxa], i) => ({ km, taxa, tempo: 30 + Math.floor(i / 2) * 5 }));
  for (let i = 0; i < 3; i++) {
    await digitarKmSemPular(i, String(alvo[i].km));
    await preencher(timeInputs().nth(i), alvo[i].tempo);
    await preencher(feeInputs().nth(i), alvo[i].taxa);
  }
  // Mais 6 pelo "Adicionar faixa", digitando o km com PONTO ("2.5").
  for (let i = 3; i < 9; i++) {
    await page.getByRole("button", { name: "Adicionar faixa" }).click();
    await dormir(300);
    const n = await kmInputs().count();
    const idx = n - 1;
    await digitarKmSemPular(idx, String(alvo[i].km));
    await preencher(timeInputs().nth(idx), alvo[i].tempo);
    await preencher(feeInputs().nth(idx), alvo[i].taxa);
  }
  // sai do último campo
  await page.getByText("Faixas por km percorrido", { exact: false }).first().click();
  await dormir(500);
  r.kmNaTela = await kmInputs().evaluateAll((els) => els.map((e) => e.value));
  r.passos.push(`km na tela depois de digitar: ${r.kmNaTela.join(" | ")}`);

  // Atalho "taxa − R$ 1"
  const desconto = page.locator('input[aria-label="Desconto sobre a taxa (R$)"]');
  r.descontoPadrao = await desconto.inputValue();
  await preencher(desconto, "1");
  await page.getByRole("button", { name: "Aplicar", exact: true }).click();
  await dormir(400);
  r.motoNaTela = await motoInputs().evaluateAll((els) => els.map((e) => e.value));
  r.passos.push(`motoboy depois do atalho: ${r.motoNaTela.join(" | ")}`);
  await foto(page, "e1-01-faixas-preenchidas");

  const antes = await prisma.user.findUnique({ where: { email: EMAIL }, select: { deliveryZones: true } });

  // ── Validação 1: km repetido (a de 5 km vira 4,5) ──
  await preencher(kmInputs().nth(8), "4.5");
  await page.getByText("Faixas por km percorrido", { exact: false }).first().click();
  await dormir(300);
  await page.locator(".fh-painel-topo button", { hasText: "Salvar" }).click();
  await dormir(1500);
  r.validacaoKmRepetido = (await avisoDoPainel().count()) ? await avisoDoPainel().innerText() : "(sem aviso)";
  await foto(page, "e1-02-km-repetido");
  const depoisRep = await prisma.user.findUnique({ where: { email: EMAIL }, select: { deliveryZones: true } });
  r.bancoMudouComKmRepetido = JSON.stringify(depoisRep.deliveryZones) !== JSON.stringify(antes.deliveryZones);
  // volta a 5 — o cartão que ficou com 4,5 pode ter ido para outra posição ao sair do campo
  const kmAgora = await kmInputs().evaluateAll((els) => els.map((e) => e.value));
  const idxRep = kmAgora.lastIndexOf("4,5");
  await preencher(kmInputs().nth(idxRep), "5");
  await page.getByText("Faixas por km percorrido", { exact: false }).first().click();
  await dormir(300);

  // ── Validação 2: faixa sem repasse (apaga o da 2,5 km) ──
  const kmOrdem = await kmInputs().evaluateAll((els) => els.map((e) => e.value));
  const idx25 = kmOrdem.indexOf("2,5");
  await motoInputs().nth(idx25).click();
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Backspace");
  await page.getByText("Faixas por km percorrido", { exact: false }).first().click();
  await dormir(300);
  await page.locator(".fh-painel-topo button", { hasText: "Salvar" }).click();
  await dormir(1500);
  r.validacaoSemRepasse = (await avisoDoPainel().count()) ? await avisoDoPainel().innerText() : "(sem aviso)";
  r.contadorSemRepasse = await page.getByText(/sem o valor do motoboy|Todas as faixas com valor/).first().innerText().catch(() => "");
  await foto(page, "e1-03-sem-repasse");
  const depoisSem = await prisma.user.findUnique({ where: { email: EMAIL }, select: { deliveryZones: true } });
  r.bancoMudouSemRepasse = JSON.stringify(depoisSem.deliveryZones) !== JSON.stringify(antes.deliveryZones);
  await preencher(motoInputs().nth(idx25), "11");
  await page.getByText("Faixas por km percorrido", { exact: false }).first().click();
  await dormir(300);

  // ── Salvar de verdade ──
  await page.locator(".fh-painel-topo button", { hasText: "Salvar" }).click();
  await page.waitForFunction(() => {
    const el = document.querySelector(".fh-painel-aviso");
    return el && /salva|Não salvei|não gravou|Não consegui/i.test(el.textContent || "");
  }, null, { timeout: 30_000 }).catch(() => {});
  await dormir(1000);
  r.avisoDoSalvar = (await avisoDoPainel().count()) ? await avisoDoPainel().innerText() : "(sem aviso)";
  await foto(page, "e1-04-salvo");

  const gravado = await prisma.user.findUnique({ where: { email: EMAIL }, select: { deliveryZones: true, deliveryZoneType: true, deliveryConfig: true, storeAddress: true, storeLatLng: true } });
  r.banco = gravado;

  // ── Recarregar e conferir ──
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByText("Faixas por km percorrido", { exact: false }).first().waitFor({ timeout: 60_000 });
  await dormir(3000);
  r.depoisDeRecarregar = {
    km: await kmInputs().evaluateAll((els) => els.map((e) => e.value)),
    taxa: await feeInputs().evaluateAll((els) => els.map((e) => e.value)),
    tempo: await timeInputs().evaluateAll((els) => els.map((e) => e.value)),
    moto: await motoInputs().evaluateAll((els) => els.map((e) => e.value)),
    repasse: await page.getByRole("radio", { name: "Um valor por faixa" }).getAttribute("aria-checked"),
    legenda: await page.locator(".fh-legenda-rota").innerText().catch(() => "(sem legenda)"),
  };
  await foto(page, "e1-05-recarregado");
} catch (e) {
  r.falha = String(e?.stack || e).slice(0, 1500);
  await foto(page, "e1-99-falha").catch(() => {});
} finally {
  gravarResultado("e1", r);
  console.log(JSON.stringify(r, null, 2));
  await b.close();
  await prisma.$disconnect();
}
