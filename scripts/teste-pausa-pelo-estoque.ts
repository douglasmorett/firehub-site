/**
 * Teste da regra "pausar sozinho o que usa um item quando ele acabar"
 * (src/lib/pausa-pelo-estoque.ts) — quem pausa, quem volta, quem fica. Rodar:
 * DATABASE_URL=postgresql://x@localhost:1/x npx tsx scripts/teste-pausa-pelo-estoque.ts
 */
import assert from "node:assert/strict";
import { decidirPausaPeloEstoque, insumoAcabou, type FichaDoProduto } from "../src/lib/pausa-pelo-estoque";

let casos = 0;
const caso = (nome: string, fn: () => void) => {
  fn();
  casos++;
  console.log(`ok   ${nome}`);
};

// Cardápio: X-Bacon (pão, carne, bacon), X-Burger (pão, carne), Batata (batata),
// Coca (sem ficha nenhuma, não aparece nas fichas).
const ficha = (produtoId: string, insumos: string[], ativo = true): FichaDoProduto => ({ produtoId, ativo, insumos });
const saldos = (o: Record<string, number>) => new Map(Object.entries(o));
const pausados = (d: ReturnType<typeof decidirPausaPeloEstoque>) => d.pausar.map((p) => p.produtoId).sort();

caso("insumoAcabou: ≤ 0 acabou; positivo e fora do mapa (arquivado) não", () => {
  const s = saldos({ a: 0, b: -3, c: 0.5 });
  assert.equal(insumoAcabou(s, "a"), true);
  assert.equal(insumoAcabou(s, "b"), true);
  assert.equal(insumoAcabou(s, "c"), false);
  assert.equal(insumoAcabou(s, "arquivado"), false);
});

caso("bacon zerou numa venda: pausa só o X-Bacon, com o bacon na etiqueta", () => {
  const d = decidirPausaPeloEstoque({
    saldos: saldos({ pao: 10, carne: 5, bacon: 0, batata: 3 }),
    fichas: [ficha("xbacon", ["pao", "carne", "bacon"]), ficha("xburger", ["pao", "carne"]), ficha("batata", ["batata"])],
    marcados: new Set(),
    tocados: new Set(["pao", "carne", "bacon"]),
  });
  assert.deepEqual(d.pausar, [{ produtoId: "xbacon", faltando: ["bacon"] }]);
  assert.deepEqual(d.reativar, []);
});

caso("carne zerou: pausa todo produto que usa carne", () => {
  const d = decidirPausaPeloEstoque({
    saldos: saldos({ pao: 10, carne: -0.2, bacon: 4 }),
    fichas: [ficha("xbacon", ["pao", "carne", "bacon"]), ficha("xburger", ["pao", "carne"]), ficha("batata", ["batata"])],
    marcados: new Set(),
    tocados: new Set(["carne"]),
  });
  assert.deepEqual(pausados(d), ["xbacon", "xburger"]);
});

caso("produto que o lojista já tinha pausado na mão não é tocado nem marcado", () => {
  const d = decidirPausaPeloEstoque({
    saldos: saldos({ carne: 0 }),
    fichas: [ficha("xburger", ["carne"], false), ficha("xsalada", ["carne"])],
    marcados: new Set(),
    tocados: new Set(["carne"]),
  });
  assert.deepEqual(pausados(d), ["xsalada"]);
});

caso("movimento de OUTRO item não repausa o que o lojista reativou com insumo zerado", () => {
  // Bacon está zerado, mas o lojista reativou o X-Bacon na mão (marca apagada).
  // Vendeu-se uma batata: o X-Bacon segue à venda.
  const d = decidirPausaPeloEstoque({
    saldos: saldos({ bacon: 0, batata: 2 }),
    fichas: [ficha("xbacon", ["bacon"]), ficha("batata", ["batata"])],
    marcados: new Set(),
    tocados: new Set(["batata"]),
  });
  assert.deepEqual(d.pausar, []);
});

caso("ligar o interruptor (tocados = loja inteira) pausa tudo que usa item zerado", () => {
  const d = decidirPausaPeloEstoque({
    saldos: saldos({ bacon: 0, carne: 5, batata: 0 }),
    fichas: [ficha("xbacon", ["carne", "bacon"]), ficha("xburger", ["carne"]), ficha("batata", ["batata"])],
    marcados: new Set(),
    tocados: null,
  });
  assert.deepEqual(pausados(d), ["batata", "xbacon"]);
});

caso("bacon chegou: volta o X-Bacon que a regra pausou", () => {
  const d = decidirPausaPeloEstoque({
    saldos: saldos({ pao: 10, carne: 5, bacon: 2 }),
    fichas: [ficha("xbacon", ["pao", "carne", "bacon"], false)],
    marcados: new Set(["xbacon"]),
    tocados: new Set(["bacon"]),
  });
  assert.deepEqual(d.reativar, ["xbacon"]);
  assert.deepEqual(d.pausar, []);
});

caso("carne chegou mas o bacon ainda está zerado: X-Bacon continua pausado, X-Burger volta", () => {
  const d = decidirPausaPeloEstoque({
    saldos: saldos({ carne: 3, bacon: 0 }),
    fichas: [ficha("xbacon", ["carne", "bacon"], false), ficha("xburger", ["carne"], false)],
    marcados: new Set(["xbacon", "xburger"]),
    tocados: new Set(["carne"]),
  });
  assert.deepEqual(d.reativar, ["xburger"]);
  assert.deepEqual(d.pausar, []);
});

caso("reposição nunca reativa o que o lojista pausou na mão (sem marca)", () => {
  const d = decidirPausaPeloEstoque({
    saldos: saldos({ carne: 50 }),
    fichas: [ficha("xburger", ["carne"], false), ficha("xsalada", ["carne"], false)],
    marcados: new Set(["xsalada"]),
    tocados: new Set(["carne"]),
  });
  assert.deepEqual(d.reativar, ["xsalada"]);
});

caso("marcado que já está ativo (reativado por outro caminho) só perde a marca", () => {
  const d = decidirPausaPeloEstoque({
    saldos: saldos({ bacon: 0 }),
    fichas: [ficha("xbacon", ["bacon"], true)],
    marcados: new Set(["xbacon"]),
    tocados: new Set(["bacon"]),
  });
  assert.deepEqual(d.desmarcar, ["xbacon"]);
  assert.deepEqual(d.pausar, []);
  assert.deepEqual(d.reativar, []);
});

caso("item zerado saiu da ficha (ou foi arquivado): o marcado volta", () => {
  const semFicha = decidirPausaPeloEstoque({
    saldos: saldos({ carne: 4 }),
    fichas: [ficha("xbacon", ["carne"], false)], // bacon tirado da ficha
    marcados: new Set(["xbacon"]),
    tocados: new Set(),
  });
  assert.deepEqual(semFicha.reativar, ["xbacon"]);
  const arquivado = decidirPausaPeloEstoque({
    saldos: saldos({ carne: 4 }), // bacon arquivado: fora do mapa
    fichas: [ficha("xbacon", ["carne", "bacon"], false)],
    marcados: new Set(["xbacon"]),
    tocados: new Set(["bacon"]),
  });
  assert.deepEqual(arquivado.reativar, ["xbacon"]);
});

caso("tocados vazio (ficha salva) não pausa nada, só confere quem espera", () => {
  const d = decidirPausaPeloEstoque({
    saldos: saldos({ bacon: 0 }),
    fichas: [ficha("xbacon", ["bacon"])],
    marcados: new Set(),
    tocados: new Set(),
  });
  assert.deepEqual(d, { pausar: [], reativar: [], desmarcar: [] });
});

caso("marcado cujo produto sumiu (apagado) sai da lista de espera", () => {
  const d = decidirPausaPeloEstoque({ saldos: saldos({}), fichas: [], marcados: new Set(["apagado"]), tocados: null });
  assert.deepEqual(d.reativar, ["apagado"]);
});

console.log(`\n${casos} casos, todos passaram.`);
