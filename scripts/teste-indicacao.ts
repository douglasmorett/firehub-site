/**
 * Indique e Ganhe do cliente final (17/10/2026).
 *
 *   npx tsx scripts/teste-indicacao.ts
 *
 * Prova, sem banco (lib/indicacao.ts + o saldo de lib/cashback.ts):
 * 1) leitura da config (zero vale zero; desligado = nada) e do `?ref=`;
 * 2) o amigo: só no 1º pedido (cancelado/Pix abandonado não contam), mínimo,
 *    auto-indicação, desconto até os produtos a pagar, cupom de 1º pedido não soma;
 * 3) quem indicou: credita só com o pedido do amigo CONCLUÍDO, cancelado não
 *    credita (e estorna se cancelar depois), uma vez por amigo;
 * 4) o crédito entra no saldo do cashback (extrato "indicacao") e vence pela validade;
 * 5) a loja só com indicação deixa usar o saldo no site, sem gerar cashback;
 * 6) etiqueta da comanda.
 */
import {
  avaliarIndicacao,
  creditosDaIndicacao,
  etiquetaDaIndicacao,
  gerarCodigo,
  indicacoesDoIndicador,
  lerIndicacao,
  lerReferencia,
  lerResgateDaIndicacao,
  primeiroNome,
  regraParaUsarOSaldo,
  ALFABETO_DO_CODIGO,
  type PedidoIndicado,
} from "../src/lib/indicacao";
import { extratoDoCashback, lerCashback, saldoDoCashback } from "../src/lib/cashback";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : `\n     obtido:   ${JSON.stringify(obtido)}\n     esperado: ${JSON.stringify(esperado)}`}`);
};

// ── 1) Config e referência ──────────────────────────────────────────────────
const loja = { referralActive: true, friendDiscount: 10, referrerReward: 15, referralMinOrder: 35 };
const regra = lerIndicacao(loja);
confere("config lida", regra, { ativo: true, descontoDoAmigo: 10, recompensa: 15, minimo: 35 });
confere("desligada = inativa", lerIndicacao({ ...loja, referralActive: false }).ativo, false);
confere("sem storeLoyalty = inativa", lerIndicacao(null).ativo, false);
confere("desconto e recompensa zero = inativa", lerIndicacao({ referralActive: true, friendDiscount: 0, referrerReward: 0 }).ativo, false);
confere("só recompensa já vale", lerIndicacao({ referralActive: true, friendDiscount: 0, referrerReward: 5 }).ativo, true);
confere("mínimo zero vale zero", lerIndicacao({ ...loja, referralMinOrder: 0 }).minimo, 0);
confere("ref código", lerReferencia(" k7m2qx "), { tipo: "codigo", codigo: "K7M2QX" });
confere("ref telefone (link antigo)", lerReferencia("(11) 99999-1234"), { tipo: "telefone", final: "99991234" });
confere("ref lixo", [lerReferencia(""), lerReferencia("amigo"), lerReferencia("x".repeat(50))], [null, { tipo: "codigo", codigo: "AMIGO" }, null]);
confere("ref curta demais", lerReferencia("AB"), null);
const cod = gerarCodigo();
confere("código tem 6 do alfabeto sem ambíguos", cod.length === 6 && [...cod].every((c) => ALFABETO_DO_CODIGO.includes(c)), true);
confere("primeiro nome", [primeiroNome("maria da silva"), primeiroNome("Cliente"), primeiroNome("")], ["maria", null, null]);

// ── 2) O amigo ──────────────────────────────────────────────────────────────
const indicador = { final: "99991234", telefone: "11999991234", nome: "Maria" };
const base = {
  regra,
  codigo: "K7M2QX",
  telefoneDoAmigo: "21988887777",
  indicador,
  pedidosAnteriores: [] as { status: string }[],
  produtos: 50,
  produtosAPagar: 50,
};
const ok = avaliarIndicacao(base);
confere("1º pedido ≥ mínimo ganha R$ 10", ok.ok && ok.desconto, 10);
confere("resgate gravado", ok.ok && ok.resgate, {
  programa: "indicacao", codigo: "K7M2QX", indicador: "99991234", indicadorTelefone: "11999991234",
  indicadorNome: "Maria", amigo: "88887777", desconto: 10, recompensa: 15,
});
confere("loja desligada: nada", avaliarIndicacao({ ...base, regra: lerIndicacao({ ...loja, referralActive: false }) }), { ok: false, motivo: "desligada" });
confere("código que não existe", avaliarIndicacao({ ...base, indicador: null }), { ok: false, motivo: "sem_indicador" });
confere("indicar a si mesmo (mesmo telefone, com ou sem 55/9)", avaliarIndicacao({ ...base, telefoneDoAmigo: "+55 11 99999-1234" }), { ok: false, motivo: "a_si_mesmo" });
confere("já pediu antes: não é 1º", avaliarIndicacao({ ...base, pedidosAnteriores: [{ status: "ENTREGUE" }] }), { ok: false, motivo: "nao_e_primeiro" });
confere("já pediu no balcão/robô também conta", avaliarIndicacao({ ...base, pedidosAnteriores: [{ status: "PRONTO" }] }), { ok: false, motivo: "nao_e_primeiro" });
confere(
  "anterior cancelado, recusado, Pix abandonado ou rascunho do robô não contam",
  avaliarIndicacao({ ...base, pedidosAnteriores: [{ status: "CANCELADO" }, { status: "RECUSADO" }, { status: "AGUARDANDO_PAGAMENTO" }, { status: "CRIANDO_IA" }] }).ok,
  true,
);
confere("abaixo do mínimo", avaliarIndicacao({ ...base, produtos: 34.9, produtosAPagar: 34.9 }), { ok: false, motivo: "abaixo_do_minimo" });
confere("no mínimo exato vale", avaliarIndicacao({ ...base, produtos: 35, produtosAPagar: 35 }).ok, true);
const pouco = avaliarIndicacao({ ...base, produtosAPagar: 6 });
confere("desconto até o que falta pagar dos produtos (não vira troco)", pouco.ok && pouco.desconto, 6);
const comCupom = avaliarIndicacao({ ...base, comCupomDePrimeiroPedido: true });
confere("com cupom de 1º pedido: desconto zero, indicação gravada", comCupom.ok && [comCupom.desconto, comCupom.resgate.semDesconto], [0, "cupom_de_primeiro_pedido"]);
confere("etiqueta da comanda", ok.ok && etiquetaDaIndicacao(ok.resgate), "[Indicação de Maria: -R$ 10,00]");
confere("etiqueta sem nome", ok.ok && etiquetaDaIndicacao({ ...ok.resgate, indicadorNome: null }), "[Indicação de cliente final 1234: -R$ 10,00]");
confere("etiqueta com cupom", comCupom.ok && etiquetaDaIndicacao(comCupom.resgate), "[Indicação de Maria — não soma com o cupom de primeiro pedido]");
confere("lerResgate devolve o gravado", ok.ok && lerResgateDaIndicacao(JSON.parse(JSON.stringify(ok.resgate))), ok.ok && ok.resgate);
confere("lerResgate recusa outra coisa", [lerResgateDaIndicacao(null), lerResgateDaIndicacao({ programa: "carimbos" })], [null, null]);

// ── 3) Quem indicou ─────────────────────────────────────────────────────────
const resgatePara = (amigo: string) => ({ ...(ok.ok ? ok.resgate : ({} as any)), amigo });
const pedido = (id: string, amigo: string, status: string, dia: number, extra: Partial<PedidoIndicado> = {}): PedidoIndicado => ({
  id, status, deliveryType: "DELIVERY", createdAt: new Date(2026, 9, dia, 20), deliveredAt: status === "ENTREGUE" ? new Date(2026, 9, dia, 21) : null,
  dailyOrderNumber: Number(id.replace(/\D/g, "")) || null, customerName: "João Souza", indicacao: resgatePara(amigo), ...extra,
});
const fim = "99991234";
confere("pedido do amigo em andamento: a receber, não credita", indicacoesDoIndicador([pedido("p1", "88887777", "ACEITO", 1)], fim).map((f) => f.situacao), ["a_receber"]);
confere("concluído: credita", indicacoesDoIndicador([pedido("p1", "88887777", "ENTREGUE", 1)], fim).map((f) => f.situacao), ["creditado"]);
confere("retirada parada em Pronto conta como concluída", indicacoesDoIndicador([pedido("p1", "88887777", "PRONTO", 1, { deliveryType: "PICKUP" })], fim).map((f) => f.situacao), ["creditado"]);
confere("cancelado: não credita", indicacoesDoIndicador([pedido("p1", "88887777", "CANCELADO", 1)], fim).map((f) => f.situacao), ["cancelado"]);
confere("Pix ainda não pago fica fora", indicacoesDoIndicador([pedido("p1", "88887777", "AGUARDANDO_PAGAMENTO", 1)], fim), []);
const doisDoMesmo = indicacoesDoIndicador([pedido("p1", "88887777", "ENTREGUE", 1), pedido("p2", "88887777", "ENTREGUE", 3)], fim);
confere("crédito UMA vez por amigo", [doisDoMesmo.length, doisDoMesmo[0].pedidoId], [1, "p1"]);
const cancelouEVoltou = indicacoesDoIndicador([pedido("p1", "88887777", "CANCELADO", 1), pedido("p2", "88887777", "ENTREGUE", 3)], fim);
confere("1º cancelado, o seguinte credita (uma vez)", cancelouEVoltou.map((f) => [f.pedidoId, f.situacao]), [["p2", "creditado"]]);
const dois = indicacoesDoIndicador([pedido("p1", "88887777", "ENTREGUE", 1), pedido("p2", "77776666", "ENTREGUE", 2)], fim);
confere("dois amigos, dois créditos", creditosDaIndicacao(dois).creditos.map((c) => c.valor), [15, 15]);
confere("pedido de outro indicador não entra", indicacoesDoIndicador([pedido("p1", "88887777", "ENTREGUE", 1, { indicacao: { ...resgatePara("88887777"), indicador: "11112222" } })], fim), []);
confere("ficha mostra o amigo pelo primeiro nome e final", indicacoesDoIndicador([pedido("p1", "88887777", "ENTREGUE", 1)], fim).map((f) => [f.amigoNome, f.amigoFinal]), [["João", "7777"]]);

// ── 4) No saldo do cashback ─────────────────────────────────────────────────
const regraCb = lerCashback({ cashbackActive: true, rate: 5, expiresInDays: 30 });
const agora = new Date(2026, 9, 10, 12);
const entregue = creditosDaIndicacao(indicacoesDoIndicador([pedido("p1", "88887777", "ENTREGUE", 1)], fim));
confere("saldo recebe R$ 15 da indicação", saldoDoCashback(regraCb, [], agora, [], entregue).saldo, 15);
const extrato = extratoDoCashback(regraCb, [], [], agora, entregue);
confere("extrato tem o movimento 'indicacao'", extrato.movimentos.map((m) => [m.tipo, m.valor, m.pedidoNumero]), [["indicacao", 15, 1]]);
const emAndamento = creditosDaIndicacao(indicacoesDoIndicador([pedido("p1", "88887777", "SAIU_PARA_ENTREGA", 1)], fim));
confere("em andamento: saldo 0 e R$ 15 a receber", [saldoDoCashback(regraCb, [], agora, [], emAndamento).saldo, extratoDoCashback(regraCb, [], [], agora, emAndamento).aReceber], [0, 15]);
const cancelouDepois = creditosDaIndicacao(indicacoesDoIndicador([pedido("p1", "88887777", "CANCELADO", 1, { deliveredAt: new Date(2026, 9, 1, 21) })], fim));
confere("entregue e depois cancelado: o crédito some (estorno)", saldoDoCashback(regraCb, [], agora, [], cancelouDepois).saldo, 0);
confere("vence pela validade da loja", saldoDoCashback(regraCb, [], new Date(2026, 10, 5), [], entregue).saldo, 0);
const usou = [{ id: "u1", source: "SITE", status: "ENTREGUE", createdAt: new Date(2026, 9, 5), cashbackUsed: 10 }];
confere("usar parte do saldo da indicação", saldoDoCashback(regraCb, usou as any, agora, [], entregue).saldo, 5);

// ── 5) Loja só com indicação ────────────────────────────────────────────────
const soIndicacao = { referralActive: true, friendDiscount: 10, referrerReward: 15, maxRedeemPercent: 50 };
const r = regraParaUsarOSaldo(soIndicacao, "site");
confere("só indicação: site usa o saldo, sem gerar cashback", [r.ativo, r.taxa, r.maxResgatePct], [true, 0, 50]);
confere("só indicação: robô não usa (a indicação é do site)", regraParaUsarOSaldo(soIndicacao, "whatsapp").ativo, false);
confere("nada ligado: não usa", regraParaUsarOSaldo({}, "site").ativo, false);
confere("cashback ligado: a regra do cashback", regraParaUsarOSaldo({ cashbackActive: true, rate: 5 }, "site").taxa, 5);
confere("indicação só com desconto (recompensa 0) não abre o saldo", regraParaUsarOSaldo({ referralActive: true, friendDiscount: 10, referrerReward: 0 }, "site").ativo, false);

console.log(falhas ? `\n❌ ${falhas} falha(s)` : "\n✅ tudo certo");
process.exit(falhas ? 1 : 0);
