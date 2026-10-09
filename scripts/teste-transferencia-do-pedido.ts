/**
 * "Enviar para outra loja" — a regra (lib/transferencia-do-pedido.ts).
 *
 *   npx tsx scripts/teste-transferencia-do-pedido.ts
 */
import { motivoQueImpede, confirmacaoValida, motivoDaRecusa, notaDaTransferencia } from "../src/lib/transferencia-do-pedido";

let ok = 0;
let falhou = 0;
function confere(nome: string, obtido: unknown, esperado: unknown) {
  if (JSON.stringify(obtido) === JSON.stringify(esperado)) ok++;
  else {
    falhou++;
    console.log(`❌ ${nome}\n   esperado: ${JSON.stringify(esperado)}\n   obtido:   ${JSON.stringify(obtido)}`);
  }
}

const LAGOMAR = "loja-lagomar";
const AEROPORTO = "loja-aeroporto";
const grupo = [LAGOMAR, AEROPORTO];
const base = { franchiseeId: LAGOMAR, status: "ACEITO", source: "ONLINE" };

// ── Pode ──
confere("pedido do site aceito vai", motivoQueImpede(base, { grupo, para: AEROPORTO }), null);
for (const s of ["NOVO", "PREPARANDO", "PRONTO"]) confere(`status ${s} vai`, motivoQueImpede({ ...base, status: s }, { grupo, para: AEROPORTO }), null);
for (const src of ["WHATSAPP_IA", "PRESENCIAL"]) confere(`canal ${src} vai`, motivoQueImpede({ ...base, source: src }, { grupo, para: AEROPORTO }), null);
confere("pago no caixa (sem gateway) vai", motivoQueImpede({ ...base, paymentPaidAt: new Date() } as any, { grupo, para: AEROPORTO }), null);
confere("só a pergunta, sem destino", motivoQueImpede(base, { grupo }), null);

// ── Não pode ──
confere("conta de uma loja só", motivoQueImpede(base, { grupo: [LAGOMAR], para: AEROPORTO }), "Esta conta tem uma loja só.");
confere("para a mesma loja", motivoQueImpede(base, { grupo, para: LAGOMAR }), "O pedido já é desta loja.");
confere("loja de fora do acesso", motivoQueImpede(base, { grupo, para: "loja-do-vizinho" }), "A loja escolhida não é deste acesso.");
confere("pedido de fora do acesso", motivoQueImpede({ ...base, franchiseeId: "outra" }, { grupo, para: AEROPORTO }), "O pedido não é de uma loja deste acesso.");
confere("saiu para entrega", motivoQueImpede({ ...base, status: "SAIU_ENTREGA" }, { grupo, para: AEROPORTO }), "O pedido já saiu para entrega.");
confere("entregue", motivoQueImpede({ ...base, status: "ENTREGUE" }, { grupo, para: AEROPORTO }), "O pedido já foi encerrado.");
confere("cancelado", motivoQueImpede({ ...base, status: "CANCELADO" }, { grupo, para: AEROPORTO }), "O pedido já foi encerrado.");
confere("rascunho do robô", (motivoQueImpede({ ...base, status: "CRIANDO_IA" }, { grupo, para: AEROPORTO }) || "").startsWith("O robô ainda"), true);
confere("mesa", motivoQueImpede({ ...base, tableSessionId: "m1" }, { grupo, para: AEROPORTO }), "Pedido de mesa fica com a conta da mesa.");
confere("iFood", (motivoQueImpede({ ...base, source: "IFOOD", ifoodOrderId: "x" }, { grupo, para: AEROPORTO }) || "").startsWith("Pedido de aplicativo"), true);
confere("99Food (source)", (motivoQueImpede({ ...base, source: "99FOOD" }, { grupo, para: AEROPORTO }) || "").startsWith("Pedido de aplicativo"), true);
confere("pago online pelo site", (motivoQueImpede({ ...base, gatewayProvider: "ASAAS" }, { grupo, para: AEROPORTO }) || "").startsWith("O pedido foi pago online"), true);
confere("NFC-e emitida", (motivoQueImpede({ ...base, fiscalStatus: "EMITTED" }, { grupo, para: AEROPORTO }) || "").startsWith("A nota fiscal"), true);

// ── Confirmação ──
confere("'transferir' confirma", confirmacaoValida("transferir"), true);
confere("caixa e espaço não importam", confirmacaoValida("  Transferir "), true);
confere("outra palavra não", confirmacaoValida("transfere"), false);
confere("vazio não", confirmacaoValida(""), false);

// ── Motivo da recusa ──
confere("motivo curto não vale", motivoDaRecusa("ok"), "");
confere("motivo com 3 letras vale", motivoDaRecusa("  sem   gás "), "sem gás");
confere("nota do pedido aceito", notaDaTransferencia("PIZZARIA 17", "Antônio"), "🏪 Transferido da loja PIZZARIA 17 (por Antônio)");

console.log(`\n${falhou === 0 ? "✅" : "❌"} transferência do pedido: ${ok} ok, ${falhou} falha(s)`);
process.exit(falhou === 0 ? 0 : 1);
