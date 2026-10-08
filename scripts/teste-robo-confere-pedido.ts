/**
 * "Conferir cada pedido do robô antes da cozinha" (chatbotConfig.conferirPedidoDoRobo).
 *
 *   npx tsx scripts/teste-robo-confere-pedido.ts
 *
 * Pizzaria 17, 08/10/2026: o robô atende e fecha o pedido, mas a loja aceita
 * cada um antes de ir para a cozinha. O fechamento grava o rascunho completo
 * com a marca abaixo; o painel abre o aviso roxo; aceitar tira a marca.
 */
import {
  conferePedidoDoRobo,
  esperandoConferencia,
  marcarAguardandoLoja,
  motivoDeAguardarLoja,
  MOTIVO_CONFERIR_PEDIDO,
  notasDaFinalizacao,
} from "../src/lib/finalizar-rascunho";
import { comandaDoRobo } from "../src/lib/comanda-do-robo";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

// ── a opção ──
confere("ausente = não confere (como era)", conferePedidoDoRobo({}), false);
confere("sem config = não confere", conferePedidoDoRobo(null), false);
confere("só true liga", conferePedidoDoRobo({ conferirPedidoDoRobo: "sim" }), false);
confere("ligada", conferePedidoDoRobo({ conferirPedidoDoRobo: true }), true);

// ── a marca no rascunho ──
const notas = marcarAguardandoLoja("🤖 Pedido finalizado via IA pelo WhatsApp · Obs: sem cebola", MOTIVO_CONFERIR_PEDIDO);
confere("marca na frente da observação", notas.startsWith("🙋 AGUARDANDO A LOJA: conferir o pedido do robô · "), true);
confere("rascunho marcado espera conferência", esperandoConferencia({ status: "CRIANDO_IA", notes: notas }), true);
confere("o motivo é o da conferência", motivoDeAguardarLoja({ status: "CRIANDO_IA", notes: notas }), MOTIVO_CONFERIR_PEDIDO);
confere("parado por endereço NÃO é conferência", esperandoConferencia({ status: "CRIANDO_IA", notes: marcarAguardandoLoja("", "o mapa não confirmou o endereço") }), false);
confere("já aceito não espera mais", esperandoConferencia({ status: "ACEITO", notes: notas }), false);
confere("remarcar não duplica a marca", marcarAguardandoLoja(notas, MOTIVO_CONFERIR_PEDIDO).split("AGUARDANDO A LOJA").length - 1, 1);

// ── aceitar tira a marca e mantém o que o robô anotou ──
const depois = notasDaFinalizacao(notas, "Ana (funcionário)", "", []);
confere("aceito sem a marca", depois.includes("AGUARDANDO A LOJA"), false);
confere("aceito com a obs do cliente", depois.includes("Obs: sem cebola"), true);

// ── o resumo que o cliente recebe enquanto a loja confere ──
const resumo = comandaDoRobo({
  numero: null,
  status: "CRIANDO_IA",
  itens: [{ quantity: 1, productName: "Pizza G Calabresa", price: 59.9, comboSelections: null, notes: null }],
  formaDePagamento: "Pix",
  trocoPara: null,
  entrega: true,
  taxaDeEntrega: 5,
  endereco: "Rua A, 10 - Centro",
  total: 64.9,
});
confere("título: assim que a loja aceitar", resumo.split("\n")[0], "✅ Recebemos seu pedido! Assim que a loja aceitar, ele entra em produção.");
confere("sem número do dia ainda", resumo.includes("Pedido nº"), false);

console.log(falhas ? `\n${falhas} falha(s)` : "\ntudo certo");
process.exit(falhas ? 1 : 0);
