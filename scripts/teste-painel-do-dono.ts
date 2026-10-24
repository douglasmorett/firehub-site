/**
 * Trava o robô no MODO DONO e o alerta de PEDIDO ATRASADO
 * (src/lib/resumo-do-dono.ts e src/lib/painel-do-dono.ts):
 *
 *   - as vendas do dia são as do "Vendas por período" (dia de operação desde as
 *     5h, rascunho do robô e totem sem pagamento fora, a mesa conta uma vez,
 *     ticket = valor ÷ vendas, canal com o nome dos Relatórios — PRESENCIAL
 *     separado em PDV e Mesa);
 *   - o texto que vai ao prompt diz "desde as 5h" e usa as palavras da régua;
 *   - mesa não é atraso; a retirada tem o prazo de 40 min e a frase dela.
 *
 *   npx tsx scripts/teste-painel-do-dono.ts
 */
import {
  inicioDoDiaEmTexto, linhasEmTexto, mensagemDosAtrasados, prazoDoAtraso, reaisEmTexto, rodapeDosAtrasados, tipoDoAtraso, vendasDoDiaDoDono,
  type AtrasadoNaMensagem,
} from "../src/lib/resumo-do-dono";
import { resumoDeVendas, type PedidoParaVendas } from "../src/lib/relatorios/vendas";
import { inicioDoDiaOperacional } from "../src/lib/numeros-do-inicio";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};
const contem = (oQue: string, texto: string, trecho: string) => confere(oQue, texto.includes(trecho) ? trecho : texto, trecho);
const naoContem = (oQue: string, texto: string, trecho: string) => confere(oQue, texto.includes(trecho), false);

async function main() {
  const TZ = "America/Belem";
  const DIA = "2026-10-10";
  const DESDE = inicioDoDiaOperacional(DIA, TZ);

  // ── As vendas do dia ─────────────────────────────────────────────────────
  let seq = 0;
  const p = (x: Partial<PedidoParaVendas> & { totalAmount: number; createdAt: string }): PedidoParaVendas =>
    ({ id: `p${++seq}`, franchiseeId: "L", status: "ENTREGUE", deliveryType: "DELIVERY", items: [{ quantity: 1, price: x.totalAmount }], ...x }) as PedidoParaVendas;
  const PEDIDOS: PedidoParaVendas[] = [
    p({ createdAt: "2026-10-10T20:00:00Z", totalAmount: 50, source: "IFOOD", ifoodOrderId: "i1" }),
    p({ createdAt: "2026-10-10T21:00:00Z", totalAmount: 70, source: "IFOOD", ifoodOrderId: "i2" }),
    // Mesa de duas rodadas, lançada pelo PRESENCIAL: UMA venda, canal Mesa.
    p({ createdAt: "2026-10-10T22:00:00Z", totalAmount: 60, source: "PRESENCIAL", deliveryType: "MESA", tableSessionId: "s1", status: "ACEITO" }),
    p({ createdAt: "2026-10-10T23:30:00Z", totalAmount: 40, source: "PRESENCIAL", deliveryType: "MESA", tableSessionId: "s1", status: "ACEITO" }),
    // Balcão, também PRESENCIAL: canal PDV, tipo Balcão.
    p({ createdAt: "2026-10-11T02:00:00Z", totalAmount: 30, source: "PRESENCIAL", deliveryType: "RETIRADA" }),
    // Fora: cancelado, rascunho do robô, totem sem pagamento.
    p({ createdAt: "2026-10-10T19:00:00Z", totalAmount: 45, status: "CANCELADO", source: "SITE" }),
    p({ createdAt: "2026-10-10T19:30:00Z", totalAmount: 99, status: "CRIANDO_IA", source: "WHATSAPP_IA" }),
    p({ createdAt: "2026-10-10T19:40:00Z", totalAmount: 33, status: "AGUARDANDO_PAGAMENTO", source: "TOTEM", totemLicenseId: "t1" }),
  ];
  const v = vendasDoDiaDoDono(PEDIDOS, DIA, DESDE);
  confere("valor vendido: sem cancelado, rascunho do robô e totem sem pagamento (o robô somava R$ 381,00)", v.valor, 250);
  confere("vendas = 4 (a mesa de duas rodadas é uma), 5 lançamentos", [v.vendas, v.lancamentos], [4, 5]);
  confere("ticket = valor ÷ vendas (o robô dividia por lançamentos)", v.ticket, 62.5);
  confere("cancelados e não concluídos à parte", [v.cancelados, v.naoConcluidos], [{ pedidos: 1, valor: 45 }, 2]);
  const r = resumoDeVendas(PEDIDOS);
  confere("é o mesmo resumoDeVendas do Vendas por período", [v.valor, v.vendas, v.ticket], [r.totalPedidos, r.atendimentos, r.ticketMedio]);
  confere("por canal com os nomes dos Relatórios — PRESENCIAL vira Mesa e PDV", v.porCanal.map((c) => [c.nome, c.vendas, c.lancamentos, c.valor]),
    [["iFood", 2, 2, 120], ["Mesa", 1, 2, 100], ["PDV", 1, 1, 30]]);
  confere("por tipo de venda", v.porTipo.map((t) => [t.nome, t.vendas, t.valor]), [["Entrega", 2, 120], ["Balcão", 1, 30], ["Mesa", 1, 100]]);
  confere("linhas em texto", linhasEmTexto(v.porCanal), "iFood 2 vendas (R$ 120,00), Mesa 1 venda — 2 lançamentos (R$ 100,00), PDV 1 venda (R$ 30,00)");
  confere("dinheiro com milhar e sem espaço inseparável", [reaisEmTexto(14642.88), reaisEmTexto(0)], ["R$ 14.642,88", "R$ 0,00"]);
  confere("o começo do dia em texto (o dono lê \"desde 05:00 de sábado\")", inicioDoDiaEmTexto(v, TZ), "desde 05:00 de sábado, 10/10");

  // ── O texto que vai ao prompt ────────────────────────────────────────────
  process.env.DATABASE_URL ||= "postgresql://127.0.0.1:1/teste"; // nunca conecta: só o import exige a variável
  const { resumoEmTexto, prazoDeEntregaMin } = await import("../src/lib/painel-do-dono");
  const texto = resumoEmTexto({
    prazoMin: 50, caixaAberto: true, vendasDoDia: v, emAberto: 3,
    atrasados: [{ id: "x", numero: "#12", cliente: "Ana", entrouEm: new Date("2026-10-10T23:00:00Z"), minutosDeVida: 52, prazoMin: 40, minutosDeAtraso: 12, status: "PREPARANDO", canal: "PDV", tipo: "RETIRADA" }],
    contasVencidas: { qtd: 1, total: 1234.5 }, contasHoje: { qtd: 0, total: 0 }, contasSemana: { qtd: 2, total: 300 },
    insumosAbaixoDoMinimo: [],
  }, TZ);
  contem("o prompt diz que \"hoje\" começou às 5h", texto, "\"Hoje\" é o DIA DE OPERAÇÃO: desde 05:00 de sábado, 10/10 até agora");
  contem("valor vendido com milhar", texto, "Valor vendido hoje: R$ 250,00");
  contem("vendas, lançamentos e ticket pela régua", texto, "Vendas hoje: 4 (a mesa conta uma vez; 5 lançamentos) — ticket médio R$ 62,50 (valor vendido ÷ vendas)");
  contem("canal com nome dos Relatórios", texto, "Por canal hoje: iFood 2 vendas (R$ 120,00), Mesa 1 venda — 2 lançamentos (R$ 100,00), PDV 1 venda (R$ 30,00)");
  naoContem("nenhum código cru de canal", texto, "PRESENCIAL");
  contem("o atrasado de retirada com a frase dele", texto, "#12 (\"Ana\", PDV, retirada): entrou 20:00, prazo 40 min, já são 52 min — 12 min ALÉM do prazo; ainda não ficou pronto para retirada.");
  contem("os prazos, inclusive o da retirada e a mesa sem prazo", texto, "entrega 50 minutos (a área de entrega mais longa); retirada e balcão 40 minutos");
  contem("contas com milhar", texto, "Vencidas: 1 conta(s), R$ 1.234,50");
  confere("prazo de entrega: a área mais longa; sem área, 45 min", [prazoDeEntregaMin([{ time: 30 }, { time: "50" }]), prazoDeEntregaMin(null)], [50, 45]);

  // ── O pedido atrasado ────────────────────────────────────────────────────
  confere("mesa com conta não tem prazo (não é atraso)", tipoDoAtraso({ tableSessionId: "s1", deliveryType: "MESA", source: "PRESENCIAL", status: "ACEITO" }), null);
  confere("mesa antiga do PDV (deliveryType MESA, sem conta) também não", tipoDoAtraso({ deliveryType: "MESA", source: "PDV", status: "ACEITO" }), null);
  confere("entrega", tipoDoAtraso({ deliveryType: "DELIVERY", source: "IFOOD", ifoodOrderId: "i" }), "ENTREGA");
  confere("retirada do iFood (TAKEOUT), balcão e totem esperam na loja", [
    tipoDoAtraso({ deliveryType: "TAKEOUT", source: "IFOOD", ifoodOrderId: "i" }),
    tipoDoAtraso({ deliveryType: "RETIRADA", source: "PRESENCIAL" }),
    tipoDoAtraso({ deliveryType: "TAKEOUT", source: "TOTEM" }),
  ], ["RETIRADA", "RETIRADA", "RETIRADA"]);
  confere("prazo: o da entrega na entrega; 40 min (o do cartão do painel) na retirada", [prazoDoAtraso("ENTREGA", 60), prazoDoAtraso("RETIRADA", 60)], [60, 40]);
  confere("fecho: só entrega", [rodapeDosAtrasados(["ENTREGA"]), rodapeDosAtrasados(["ENTREGA", "ENTREGA"])], ["Ele ainda não saiu para entrega.", "Nenhum deles saiu para entrega ainda."]);
  confere("fecho: só retirada (era \"Nenhum deles saiu para entrega\")", [rodapeDosAtrasados(["RETIRADA"]), rodapeDosAtrasados(["RETIRADA", "RETIRADA"])],
    ["Ele ainda não ficou pronto para o cliente retirar.", "Nenhum deles ficou pronto para retirada ainda."]);
  confere("fecho: os dois", [rodapeDosAtrasados(["ENTREGA", "RETIRADA"]), rodapeDosAtrasados(["ENTREGA", "ENTREGA", "RETIRADA", "RETIRADA"])],
    ["O de entrega ainda não saiu e o de retirada ainda não ficou pronto.", "Os de entrega ainda não saíram e os de retirada ainda não ficaram prontos."]);

  const atrasado = (numero: string, tipo: "ENTREGA" | "RETIRADA", prazoMin: number, minutosDeVida: number): AtrasadoNaMensagem =>
    ({ numero, cliente: "Bia", entrouEm: new Date("2026-10-10T23:10:00Z"), prazoMin, minutosDeVida, minutosDeAtraso: minutosDeVida - prazoMin, tipo });
  const msg = mensagemDosAtrasados("Ragnar Burger", [atrasado("#7", "ENTREGA", 50, 61), atrasado("#8", "RETIRADA", 40, 44)], TZ);
  confere("a mensagem do alerta", msg,
    "⏰ *2 pedidos atrasados* — Ragnar Burger\n\n" +
    "• *#7* — Bia · entrega\n  entrou 20:10 · prazo 50 min · já são 61 min (*11 min além do prazo*)\n" +
    "• *#8* — Bia · retirada\n  entrou 20:10 · prazo 40 min · já são 44 min (*4 min além do prazo*)\n\n" +
    "O de entrega ainda não saiu e o de retirada ainda não ficou pronto.");
  const muitos = mensagemDosAtrasados(null, Array.from({ length: 10 }, (_, i) => atrasado(`#${i}`, "ENTREGA", 45, 50)), TZ);
  contem("mais de 8: lista 8 e diz quantos sobraram", muitos, "+ 2 pedido(s) também atrasado(s).");
  contem("sem nome de loja", muitos, "— sua loja");

  console.log(falhas ? `\n${falhas} falha(s).` : "\nTudo certo.");
  process.exit(falhas ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
