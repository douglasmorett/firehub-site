/**
 * "Finalizar pedido manualmente" — as regras puras (src/lib/finalizar-rascunho.ts).
 *
 *   npx tsx scripts/teste-finalizar-rascunho.ts
 */
import { lerFinalizacao, notasDaFinalizacao, statusDaFinalizacao, totalComATaxa, numeroDigitado, marcarAguardandoLoja, motivoDeAguardarLoja } from "../src/lib/finalizar-rascunho";

let ok = 0, falhas = 0;
function confere(nome: string, cond: boolean, detalhe?: unknown) {
  if (cond) ok++;
  else { falhas++; console.log(`✖ ${nome}${detalhe !== undefined ? ` — ${JSON.stringify(detalhe)}` : ""}`); }
}

const base = { tipo: "DELIVERY", customerName: "Amanda", customerAddress: "Travessa Pantanal, 130 - Jardim Esperança", taxa: "8,00", paymentMethod: "Cartão" };

// ── O caso da Divinos (25/09/2026) ─────────────────────────────────────────
const divinos = lerFinalizacao(base);
confere("entrega com endereço, taxa e pagamento passa", divinos.ok && divinos.dados.taxa === 8 && divinos.dados.tipo === "DELIVERY", divinos);
confere("cartão não guarda troco", divinos.ok && divinos.dados.troco === null);

// ── O que falta é dito, campo por campo ────────────────────────────────────
const semNome = lerFinalizacao({ ...base, customerName: " " });
confere("sem nome: pede o nome", !semNome.ok && semNome.campo === "customerName");
const semEndereco = lerFinalizacao({ ...base, customerAddress: "Rua" });
confere("entrega sem endereço: pede o endereço", !semEndereco.ok && semEndereco.campo === "customerAddress");
const semTaxa = lerFinalizacao({ ...base, taxa: "" });
confere("entrega sem taxa: pede a taxa (0 é valor, vazio não)", !semTaxa.ok && semTaxa.campo === "taxa");
confere("taxa 0 (grátis) vale", (() => { const r = lerFinalizacao({ ...base, taxa: "0" }); return r.ok && r.dados.taxa === 0; })());
confere("taxa acima do teto não passa", !lerFinalizacao({ ...base, taxa: "301" }).ok);
confere("taxa negativa não passa", !lerFinalizacao({ ...base, taxa: "-2" }).ok);
const semPagamento = lerFinalizacao({ ...base, paymentMethod: "" });
confere("sem pagamento: pede a forma", !semPagamento.ok && semPagamento.campo === "paymentMethod");

// ── Retirada ──────────────────────────────────────────────────────────────
const retirada = lerFinalizacao({ ...base, tipo: "PICKUP", customerAddress: "", taxa: "12" });
confere("retirada: sem endereço, taxa zerada", retirada.ok && retirada.dados.tipo === "RETIRADA" && retirada.dados.taxa === 0, retirada);

// ── Dinheiro e troco ──────────────────────────────────────────────────────
const dinheiro = lerFinalizacao({ ...base, paymentMethod: "Dinheiro", troco: "100" });
confere("dinheiro guarda o troco", dinheiro.ok && dinheiro.dados.troco === 100);
const pixComTroco = lerFinalizacao({ ...base, paymentMethod: "Pix", troco: "100" });
confere("pix não guarda troco", pixComTroco.ok && pixComTroco.dados.troco === null);

// ── Números do jeito que se digita ────────────────────────────────────────
confere("'5,50' → 5,5", numeroDigitado("5,50") === 5.5);
confere("'R$ 12,00' → 12", numeroDigitado("R$ 12,00") === 12);
confere("vazio → NaN", Number.isNaN(numeroDigitado("")));

// ── O total troca só a taxa ───────────────────────────────────────────────
confere("sem taxa no rascunho: itens + taxa nova", totalComATaxa(62.9, 0, 8) === 70.9);
confere("taxa do robô trocada pela da loja", totalComATaxa(74.9, 12, 8) === 70.9);
confere("nunca negativo", totalComATaxa(5, 12, 0) === 0);

// ── O status é o do fechamento pelo robô ──────────────────────────────────
confere("aceite automático do robô ligado → ACEITO", statusDaFinalizacao({ autoAcceptOrders: true }) === "ACEITO");
confere("sem aceite automático → NOVO", statusDaFinalizacao({}) === "NOVO" && statusDaFinalizacao(null) === "NOVO");

// ── A observação ──────────────────────────────────────────────────────────
const notas = notasDaFinalizacao(
  "🤖 Pedido sendo montado pela IA no WhatsApp · Obs: sem cebola",
  "Ana (funcionário)",
  "portão azul",
  ["[Conferir a entrega: endereço não localizado no mapa]"],
);
confere(
  "cabeçalho vira quem finalizou; o que o robô anotou continua; a obs da loja vai no fim",
  notas === "🤖 Montado pela IA no WhatsApp · 🧑‍💼 Finalizado à mão por Ana (funcionário) · Obs: sem cebola · [Conferir a entrega: endereço não localizado no mapa] · Obs. da loja: portão azul",
  notas,
);
confere("sem nada do robô", notasDaFinalizacao("", "Zé (dono)", "") === "🤖 Montado pela IA no WhatsApp · 🧑‍💼 Finalizado à mão por Zé (dono)");

// ── "Aguardando a loja": o robô segurou o pedido (regra do dono, 25/09/2026) ──
const doRobo = "🤖 Pedido sendo montado pela IA no WhatsApp · Obs: sem cebola";
const marcada = marcarAguardandoLoja(doRobo, "o robô não achou o endereço no mapa");
confere("a marca vai na frente, com o motivo, e o resto fica", marcada === "🙋 AGUARDANDO A LOJA: o robô não achou o endereço no mapa · 🤖 Pedido sendo montado pela IA no WhatsApp · Obs: sem cebola", marcada);
confere("marcar de novo troca o motivo (não empilha)",
  marcarAguardandoLoja(marcada, "o mapa só achou o endereço de forma aproximada — confira a taxa").startsWith("🙋 AGUARDANDO A LOJA: o mapa só achou") &&
  marcarAguardandoLoja(marcada, "x").split("AGUARDANDO A LOJA").length === 2);
confere("rascunho marcado: o painel lê o motivo", motivoDeAguardarLoja({ status: "CRIANDO_IA", notes: marcada }) === "o robô não achou o endereço no mapa");
confere("pedido já finalizado não abre aviso", motivoDeAguardarLoja({ status: "NOVO", notes: marcada }) === null);
confere("rascunho sem marca não abre aviso", motivoDeAguardarLoja({ status: "CRIANDO_IA", notes: doRobo }) === null);
const finalizada = notasDaFinalizacao(marcada, "Ana (funcionário)", "");
confere("finalizar tira a marca", !finalizada.includes("AGUARDANDO A LOJA") && finalizada.includes("Obs: sem cebola"), finalizada);

console.log(`${ok} ok, ${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);
