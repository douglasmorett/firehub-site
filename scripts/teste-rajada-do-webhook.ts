/**
 * A rajada do webhook do robô (lib/rajada-do-webhook.ts) com relógio de verdade
 * e janelas curtas: o mesmo roteiro que cada mensagem segue no webhook.
 * Roda sem banco: npx tsx scripts/teste-rajada-do-webhook.ts
 */
import assert from "node:assert/strict";
import { criarRajadas } from "../src/lib/fila-da-conversa";
import { esperarAVezDaRajada, type ItemDaRajada, type VezDaRajada } from "../src/lib/rajada-do-webhook";

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
let ok = 0;
const caso = async (nome: string, f: () => Promise<void>) => { await f(); ok++; console.log("ok -", nome); };

/** Uma mensagem chegando no webhook `aposMs` depois do início. */
function chega(r: ReturnType<typeof criarRajadas<ItemDaRajada>>, aposMs: number, item: Partial<ItemDaRajada> & { texto: string }, janelaMs = 60, tetoDaVezMs = 2000) {
  return espera(aposMs).then(() => esperarAVezDaRajada({
    rajadas: r, chave: "loja_cliente", item: { barreira: false, ...item }, janelaMs, tetoDaVezMs,
  }));
}
const carregou = (v: VezDaRajada) => (v.papel === "carrega" ? v : null);

(async () => {
  await caso("mensagem sozinha: carrega o próprio texto", async () => {
    const r = criarRajadas<ItemDaRajada>();
    const v = await chega(r, 0, { texto: "quero uma pizza" });
    assert.equal(v.papel, "carrega");
    assert.equal(carregou(v)!.texto, "quero uma pizza");
    assert.equal(carregou(v)!.quantas, 1);
    carregou(v)!.liberar();
    await espera(5); // a fila se limpa logo depois da liberação
    assert.equal(r.tamanho(), 0);
  });

  await caso("cliente escreve picado: UMA resposta com tudo, na ordem", async () => {
    const r = criarRajadas<ItemDaRajada>();
    const [a, b, c] = await Promise.all([
      chega(r, 0, { texto: "uma napolitana", mensagemAnteriorEm: 111 }),
      chega(r, 20, { texto: "e uma meia peperoni e meia brócolis", mensagemAnteriorEm: 222 }),
      chega(r, 40, { texto: "grande", mensagemAnteriorEm: 333 }),
    ]);
    assert.equal(a.papel, "juntada");
    assert.equal(b.papel, "juntada");
    assert.equal(c.papel, "carrega");
    assert.equal(carregou(c)!.texto, "uma napolitana\ne uma meia peperoni e meia brócolis\ngrande");
    assert.equal(carregou(c)!.quantas, 3);
    // "oi" + "quero pizza" juntos continuam sendo o primeiro oi do dia: vale o antes da PRIMEIRA.
    assert.equal(carregou(c)!.mensagemAnteriorEm, 111);
    carregou(c)!.liberar();
    await espera(5);
    assert.equal(r.tamanho(), 0);
  });

  await caso("mensagem repetida pelo gateway vira uma linha só", async () => {
    const r = criarRajadas<ItemDaRajada>();
    const [a, b] = await Promise.all([chega(r, 0, { texto: "oi" }), chega(r, 5, { texto: "oi" })]);
    assert.equal(a.papel, "juntada");
    assert.equal(carregou(b)!.texto, "oi");
    carregou(b)!.liberar();
  });

  await caso("áudio não é levado por texto: cada áudio tem a sua chamada", async () => {
    const r = criarRajadas<ItemDaRajada>();
    const [a1, a2] = await Promise.all([
      chega(r, 0, { texto: "[áudio 1]", barreira: true }, 30),
      chega(r, 10, { texto: "[áudio 2]", barreira: true }, 30),
    ].map((p, i) => p.then(async (v) => { if (v.papel === "carrega") { await espera(40); v.liberar(); } return v; })));
    assert.equal(a1.papel, "carrega");
    assert.equal(a2.papel, "carrega");
    assert.equal(carregou(a1)!.texto, "[áudio 1]");
    assert.equal(carregou(a2)!.texto, "[áudio 2]");
  });

  await caso("texto antes de um áudio vai junto com o áudio (o áudio carrega)", async () => {
    const r = criarRajadas<ItemDaRajada>();
    const [t, a] = await Promise.all([
      chega(r, 0, { texto: "olha meu pedido" }, 60),
      chega(r, 20, { texto: "[áudio]", barreira: true }, 20),
    ]);
    assert.equal(t.papel, "juntada");
    assert.equal(carregou(a)!.texto, "olha meu pedido\n[áudio]");
    carregou(a)!.liberar();
  });

  await caso("mensagem que chega durante a resposta espera a vez e vê a conversa andar", async () => {
    const r = criarRajadas<ItemDaRajada>();
    const ordem: string[] = [];
    const atende = async (v: VezDaRajada, ms: number) => {
      if (v.papel !== "carrega") return v;
      ordem.push("começa " + v.texto);
      await espera(ms);
      ordem.push("responde " + v.texto);
      v.liberar();
      return v;
    };
    await Promise.all([
      chega(r, 0, { texto: "quero uma pizza" }).then((v) => atende(v, 150)),
      chega(r, 100, { texto: "de calabresa" }).then((v) => atende(v, 10)),
    ]);
    // Sem a vez, "de calabresa" começaria antes de "quero uma pizza" ser respondida.
    assert.deepEqual(ordem, ["começa quero uma pizza", "responde quero uma pizza", "começa de calabresa", "responde de calabresa"]);
  });

  await caso("quem está na frente travou: a próxima passa depois do teto", async () => {
    const r = criarRajadas<ItemDaRajada>();
    const primeira = await chega(r, 0, { texto: "a" }, 10, 150);
    assert.equal(primeira.papel, "carrega"); // e nunca libera
    const inicio = Date.now();
    const segunda = await chega(r, 0, { texto: "b" }, 10, 150);
    assert.equal(carregou(segunda)!.texto, "b");
    assert.ok(Date.now() - inicio >= 140, "esperou o teto");
    carregou(segunda)!.liberar();
  });

  await caso("rajada enquanto a anterior responde: os pedaços que esperavam a vez saem numa resposta só", async () => {
    const r = criarRajadas<ItemDaRajada>();
    const primeira = await chega(r, 0, { texto: "oi" }, 10);
    const pendentes = Promise.all([
      chega(r, 0, { texto: "quero 2 x-tudo" }, 30),
      chega(r, 50, { texto: "e uma coca" }, 30),
    ]);
    await espera(120);
    carregou(primeira)!.liberar();
    const [x, y] = await pendentes;
    // A primeira dos dois esperava a vez: ao pegá-la, leva também a que chegou depois.
    const quemCarrega = [x, y].filter((v) => v.papel === "carrega");
    assert.equal(quemCarrega.length, 1);
    assert.equal(carregou(quemCarrega[0])!.texto, "quero 2 x-tudo\ne uma coca");
    assert.ok([x, y].some((v) => v.papel === "vazia" || v.papel === "juntada"));
    carregou(quemCarrega[0])!.liberar();
    await espera(5);
    assert.equal(r.tamanho(), 0);
  });

  console.log(`\n${ok} ok`);
})().catch((e) => { console.error(e); process.exit(1); });
