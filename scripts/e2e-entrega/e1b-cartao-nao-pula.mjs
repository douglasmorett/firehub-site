// E1b — prova mais forte de "o cartão não troca de lugar enquanto digita":
// no ÚLTIMO cartão (5 km) digita "0.8" tecla a tecla. Se a lista ordenasse a
// cada tecla, o "0" já o mandaria para o topo. Depois sai do campo (clicando no
// tempo de OUTRO cartão): aí sim ele vai para o topo, e o foco fica onde se
// clicou. Não salva — recarrega no fim.
import { navegador, contextoPainel, entrarNoPainel, foto, BASE, dormir, gravarResultado } from "./comum.mjs";

const r = { teclas: [] };
const b = await navegador();
const page = await (await contextoPainel(b)).newPage();
page.on("dialog", (d) => d.accept());
try {
  await entrarNoPainel(page);
  await page.goto(`${BASE}/store/minha-loja#entrega`, { waitUntil: "domcontentloaded" });
  await page.getByText("Faixas por km percorrido", { exact: false }).first().waitFor({ timeout: 60_000 });
  await dormir(2500);
  const km = page.locator('input[aria-label="Até quantos km"]');
  const n = await km.count();
  const handle = await km.nth(n - 1).elementHandle();
  await km.nth(n - 1).click();
  await page.keyboard.press("Control+A");
  for (const ch of "0.8") {
    await page.keyboard.type(ch);
    await dormir(200);
    r.teclas.push(await page.evaluate((el) => {
      const lista = Array.from(document.querySelectorAll('input[aria-label="Até quantos km"]'));
      const cartao = el.closest("div[style*='border-radius: 12px']");
      return { indice: lista.indexOf(el), focado: document.activeElement === el, valor: el.value, titulo: cartao?.querySelector("b")?.textContent };
    }, handle));
  }
  await foto(page, "e1b-01-digitando");
  // sai do campo clicando no TEMPO do segundo cartão
  const alvoDoClique = page.locator('input[aria-label="Tempo de entrega em minutos"]').nth(1);
  const handleTempo = await alvoDoClique.elementHandle();
  await alvoDoClique.click();
  await dormir(600);
  r.depoisDeSair = await page.evaluate(([el, tempo]) => {
    const lista = Array.from(document.querySelectorAll('input[aria-label="Até quantos km"]'));
    return { indice: lista.indexOf(el), valores: lista.map((x) => x.value), focoNoTempoClicado: document.activeElement === tempo };
  }, [handle, handleTempo]);
  await foto(page, "e1b-02-depois-de-sair");
} catch (e) {
  r.falha = String(e?.stack || e).slice(0, 1200);
} finally {
  gravarResultado("e1b", r);
  console.log(JSON.stringify(r, null, 2));
  await b.close();
}
