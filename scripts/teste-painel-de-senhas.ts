/**
 * Prova do Painel de senhas (lib/painel-de-senhas.ts) e da numeração
 * sorteada (lib/senha-aleatoria.ts).
 *
 *   npx tsx scripts/teste-painel-de-senhas.ts
 */
import { senhaDaPosicao } from "../src/lib/senha-aleatoria";
import {
  lerConfigDoPainel, separarSenhas, nomeNaTela, normalizarCodigo, novoCodigo, type PedidoDoPainel,
} from "../src/lib/painel-de-senhas";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

// ── Numeração sorteada ───────────────────────────────────────────────────────
const periodo = "loja1:fechamento:abc";
const primeiros900 = Array.from({ length: 900 }, (_, i) => senhaDaPosicao(i + 1, periodo));
confere("900 primeiros pedidos: nenhum número repetido", new Set(primeiros900).size, 900);
confere("900 primeiros pedidos: todos com 3 dígitos (100–999)", primeiros900.every((n) => n >= 100 && n <= 999), true);
confere("mesma posição e mesmo período = mesmo número", senhaDaPosicao(37, periodo), primeiros900[36]);
const seguintes = Array.from({ length: 2000 }, (_, i) => senhaDaPosicao(901 + i, periodo));
confere("do 901º em diante: 4 dígitos", seguintes.every((n) => n >= 1000 && n <= 9999), true);
confere("2.900 pedidos sem repetir", new Set([...primeiros900, ...seguintes]).size, 2900);
const outroPeriodo = Array.from({ length: 10 }, (_, i) => senhaDaPosicao(i + 1, "loja1:fechamento:def"));
confere("caixa novo embaralha diferente", JSON.stringify(outroPeriodo) !== JSON.stringify(primeiros900.slice(0, 10)), true);
const outraLoja = Array.from({ length: 10 }, (_, i) => senhaDaPosicao(i + 1, "loja2:fechamento:abc"));
confere("outra loja embaralha diferente", JSON.stringify(outraLoja) !== JSON.stringify(primeiros900.slice(0, 10)), true);
// Não dá para "contar" pela diferença entre senhas seguidas.
const difs = new Set(primeiros900.slice(1, 50).map((n, i) => n - primeiros900[i]));
confere("as diferenças entre senhas seguidas variam", difs.size > 40, true);
console.log(`   primeiras senhas: ${primeiros900.slice(0, 8).join(", ")}`);

// ── Configuração ─────────────────────────────────────────────────────────────
const vazia = lerConfigDoPainel(null);
confere("config vazia: só balcão, som ligado, 10 min, sem código", [vazia.balcao, vazia.mesa, vazia.delivery, vazia.som, vazia.prontoFicaMin, vazia.codigo], [true, false, false, true, 10, ""]);
confere("tempo fora do limite vira 60", lerConfigDoPainel({ prontoFicaMin: 500 }).prontoFicaMin, 60);
confere("cor inválida volta para a padrão", lerConfigDoPainel({ cor: "red" }).cor, "#22C55E");
confere("recado é cortado em 120", lerConfigDoPainel({ mensagem: "x".repeat(300) }).mensagem.length, 120);
confere("código digitado com espaço e minúscula", normalizarCodigo("k7p 2qx"), "K7P2QX");
confere("código curto não vale", normalizarCodigo("K7P"), "");
const codigos = new Set(Array.from({ length: 200 }, () => novoCodigo()));
confere("código novo: 6 letras sem 0/O/1/I/L", [...codigos].every((c) => /^[A-HJKMNP-Z2-9]{6}$/.test(c)), true);

// ── Nome na tela ─────────────────────────────────────────────────────────────
confere("primeiro nome", nomeNaTela("MARIA DA SILVA"), "Maria");
confere("nome com acento", nomeNaTela("joão pedro"), "João");
confere("nome genérico some", [nomeNaTela("Cliente Balcão"), nomeNaTela("Balcão"), nomeNaTela("Consumidor"), nomeNaTela("Mesa 4"), nomeNaTela("")], ["", "", "", "", ""]);

// ── Quem vai para Preparando e Pronto ────────────────────────────────────────
const agora = new Date("2026-10-13T23:00:00Z").getTime();
const min = (m: number) => new Date(agora - m * 60_000).toISOString();
const pedido = (id: string, n: number, status: string, extra: Partial<PedidoDoPainel> = {}): PedidoDoPainel => ({
  id, dailyOrderNumber: n, customerName: "Ana Souza", status, deliveryType: "RETIRADA",
  kdsStage: "PRODUCTION", readyAt: null, updatedAt: min(1), createdAt: min(10), ...extra,
});
const pedidos: PedidoDoPainel[] = [
  pedido("a", 347, "ACEITO", { createdAt: min(5) }),
  pedido("b", 812, "NOVO", { createdAt: min(8) }),
  pedido("c", 129, "SAIU_ENTREGA", { readyAt: min(2) }),           // pronto pelo KDS
  pedido("d", 560, "PRONTO", { readyAt: min(1) }),                 // pronto pelo quadro
  pedido("e", 233, "SAIU_ENTREGA", { readyAt: min(25) }),          // pronto há muito tempo
  pedido("f", 418, "ACEITO", { kdsStage: "FINISHED", readyAt: min(3) }), // finalizado no KDS, status ainda não andou
  pedido("g", 871, "ACEITO", { deliveryType: "DELIVERY" }),        // delivery desligado
  pedido("h", 95, "ACEITO", { deliveryType: "MESA" }),             // mesa desligada
  pedido("i", 700, "ACEITO", { dailyOrderNumber: null }),          // rascunho sem número
  pedido("j", 701, "ACEITO", { scheduledDatetime: new Date(agora + 3 * 3600_000).toISOString() }), // encomenda
];
const cfg = { ...lerConfigDoPainel({}), mostrarNome: true };
const r = separarSenhas(pedidos, cfg, agora);
confere("Preparando: o mais antigo primeiro", r.preparando.map((s) => s.numero), [812, 347]);
confere("Pronto: o mais recente primeiro; o de 25 min já saiu", r.prontos.map((s) => s.numero), [560, 129, 418]);
confere("primeiro nome vai junto", r.preparando[0].nome, "Ana");
const comTudo = separarSenhas(pedidos, { ...cfg, mesa: true, delivery: true }, agora);
confere("com mesa e delivery ligados", comTudo.preparando.map((s) => s.numero).sort(), [347, 812, 871, 95].sort());
const deliveryPronto = separarSenhas([pedido("k", 300, "SAIU_ENTREGA", { deliveryType: "DELIVERY", readyAt: min(1) })], { ...cfg, delivery: true }, agora);
confere("delivery que já saiu não fica em Pronto", deliveryPronto.prontos.length + deliveryPronto.preparando.length, 0);
const semNome = separarSenhas(pedidos, { ...cfg, mostrarNome: false }, agora);
confere("sem nome quando desligado", semNome.preparando[0].nome, "");

console.log(falhas ? `\n❌ ${falhas} falha(s)` : "\n✅ tudo certo");
process.exit(falhas ? 1 : 0);
