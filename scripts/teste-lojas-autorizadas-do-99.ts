/**
 * Teste da lista de lojas autorizadas do 99Food (listarLojasAutorizadas), com a
 * 99 simulada por um fetch falso — sem rede e sem credencial de verdade.
 *
 *   npx tsx scripts/teste-lojas-autorizadas-do-99.ts
 *
 * Confere: lê todas as páginas que a 99 diz ter (sem teto de 20), refaz a
 * mesma página quando ela dá 10001 "i/o timeout", e chamadas ao mesmo tempo
 * dividem uma busca só.
 */
export {};

process.env.FOOD99_APP_ID = "123";
process.env.FOOD99_APP_SECRET = "segredo-de-teste";

let ok = 0;
let falhou = 0;
function confere(nome: string, cond: boolean, detalhe = "") {
  if (cond) { ok++; console.log(`  ok  ${nome}`); } else { falhou++; console.log(`  FALHOU  ${nome} ${detalhe}`); }
}

const TOTAL_LOJAS = 245; // 25 páginas de 10 — passava do teto antigo (20 páginas)
let chamadas = 0;
let timeoutsDados = 0;
const tamanhosPedidos = new Set<number>();

(globalThis as any).fetch = async (_url: string, init: any) => {
  chamadas++;
  const corpo = JSON.parse(String(init?.body || "{}"));
  const pagina = Number(corpo.page_no);
  const tamanho = Number(corpo.page_size);
  tamanhosPedidos.add(tamanho);
  // A página 13 dá timeout na primeira vez.
  if (pagina === 13 && timeoutsDados === 0) {
    timeoutsDados++;
    return new Response(JSON.stringify({ errno: 10001, errmsg: "i/o timeout" }), { status: 200 });
  }
  const totalPaginas = Math.ceil(TOTAL_LOJAS / tamanho);
  const inicio = (pagina - 1) * tamanho;
  const shops = Array.from({ length: Math.max(0, Math.min(tamanho, TOTAL_LOJAS - inicio)) }, (_, i) => ({
    shop_id: 5000 + inicio + i,
    shop_name: `Loja ${inicio + i + 1}`,
    bound_flag: inicio + i + 1 === TOTAL_LOJAS ? 0 : 1, // a recém-autorizada é a última
  }));
  return new Response(
    JSON.stringify({ errno: 0, errmsg: "ok", data: { page_no: pagina, page_size: tamanho, total_page: totalPaginas, total_cnt: TOTAL_LOJAS, shops } }),
    { status: 200 },
  );
};

(async () => {
  const { listarLojasAutorizadas } = await import("../src/lib/food99-api");

  console.log("Lista com 25 páginas, timeout na página 13, 3 telas ao mesmo tempo:");
  const inicio = Date.now();
  const [a, b, c] = await Promise.all([listarLojasAutorizadas(), listarLojasAutorizadas(), listarLojasAutorizadas()]);
  const segundos = ((Date.now() - inicio) / 1000).toFixed(1);

  confere("deu certo", a.ok === true, JSON.stringify(a).slice(0, 200));
  confere(`trouxe as ${TOTAL_LOJAS} lojas (sem teto de páginas)`, a.ok && a.lojas.length === TOTAL_LOJAS, a.ok ? String(a.lojas.length) : "");
  confere("achou a loja recém-autorizada da última página", a.ok && a.lojas.some((l) => l.nome === `Loja ${TOTAL_LOJAS}` && !l.vinculada));
  confere("refez a página que deu timeout", timeoutsDados === 1);
  confere("pediu páginas de 10", tamanhosPedidos.size === 1 && tamanhosPedidos.has(10), [...tamanhosPedidos].join(","));
  confere("as 3 telas dividiram uma busca só (25 páginas + 1 refeita)", chamadas === 26, `chamadas=${chamadas}`);
  confere("as 3 receberam o mesmo resultado", a === b && b === c);

  const antes = chamadas;
  const d = await listarLojasAutorizadas();
  confere("logo depois responde do cache, sem chamar a 99", d.ok && chamadas === antes);

  console.log(`\n${ok} ok, ${falhou} falharam (${segundos}s)`);
  process.exit(falhou ? 1 : 0);
})();
