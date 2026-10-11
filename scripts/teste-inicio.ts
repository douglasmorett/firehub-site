/**
 * Trava os números da tela Início (src/lib/numeros-do-inicio.ts) — a auditoria
 * de 11/10/2026 achou o Início contando diferente dos Relatórios no MESMO
 * instante:
 *
 *   - o dia de operação (vira às 5h, no fuso DA LOJA) e os atalhos ("7 dias" =
 *     hoje e os 6 anteriores, não 8 dias de calendário);
 *   - o anterior cortado no mesmo horário (sábado 22h e domingo 01h30, a hora
 *     das provas da Ragnar Burger, fuso America/Belem);
 *   - vendas pela régua (a mesa conta uma vez, o acréscimo não é venda nova,
 *     rascunho do robô e totem sem pagamento fora), ticket = valor ÷ vendas;
 *   - o tipo de venda (a mesa não é "Retirada");
 *   - a forma de pagamento pela régua do relatório (Pix do iFood pago no app é
 *     "Pago online", mesa num grupo próprio, dividido por parte, "Deb Master");
 *   - clientes pelo telefone de verdade (o 0800 do iFood não é cliente);
 *   - vendas por hora em média por dia, a partir das 5h;
 *   - a atualização (o que relê e como junta).
 *
 *   npx tsx scripts/teste-inicio.ts
 */
import {
  chaveDoCliente, clientesDoInicio, desdeDaAtualizacao, formaDoPedidoNaLista, formasDoInicio, HORAS_DO_DIA, inicioDoDiaOperacional,
  janelaDosDias, juntarPedidos, naJanela, numeroDoPedidoNaLista, periodoDoFiltro, periodoDoInicio, precisaDesde, produtosDoInicio,
  tipoDoPedidoNaLista, variacao, vendasDoInicio, vendasPorHora,
  type PedidoDoInicio,
} from "../src/lib/numeros-do-inicio";
import { hojeNaLoja } from "../src/lib/relatorios/base";
import { resumoDeVendas } from "../src/lib/relatorios/vendas";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};
const iso = (d: Date) => d.toISOString();

async function main() {
  // ── O dia de operação é o dos Relatórios ─────────────────────────────────
  // servidor.ts puxa o Prisma (que exige a variável) e a sessão; nada aqui
  // conecta no banco.
  process.env.DATABASE_URL ||= "postgresql://127.0.0.1:1/teste"; // nunca conecta: só o import exige a variável
  const { inicioOperacional, janelaDoPeriodo } = await import("../src/lib/relatorios/servidor");
  const { inicioDaJanela } = await import("../src/lib/pedidos-do-inicio");

  let diferentes = 0;
  for (const tz of ["America/Sao_Paulo", "America/Belem", "America/Manaus", "America/Rio_Branco", "America/Noronha", null]) {
    for (let i = 0; i < 400; i += 7) {
      const dia = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
      if (inicioDoDiaOperacional(dia, tz).getTime() !== inicioOperacional(dia, tz).getTime()) diferentes++;
      const a = janelaDosDias(dia, dia, tz), b = janelaDoPeriodo(dia, dia, tz);
      if (a.inicio.getTime() !== b.inicio.getTime() || a.fim.getTime() !== b.fim.getTime()) diferentes++;
    }
  }
  confere("o começo do dia de operação é o mesmo de lib/relatorios/servidor.ts (6 fusos, 58 dias)", diferentes, 0);
  confere("10/10/2026 em São Paulo começa às 05:00 (08:00 UTC)", iso(inicioDoDiaOperacional("2026-10-10", "America/Sao_Paulo")), "2026-10-10T08:00:00.000Z");
  confere("10/10/2026 em Manaus começa às 05:00 de lá (09:00 UTC)", iso(inicioDoDiaOperacional("2026-10-10", "America/Manaus")), "2026-10-10T09:00:00.000Z");
  confere("10/10/2026 em Rio Branco começa às 05:00 de lá (10:00 UTC)", iso(inicioDoDiaOperacional("2026-10-10", "America/Rio_Branco")), "2026-10-10T10:00:00.000Z");

  // ── Os atalhos ───────────────────────────────────────────────────────────
  const HOJE = "2026-10-11";
  confere("Hoje", periodoDoFiltro("hoje", HOJE), { de: "2026-10-11", ate: "2026-10-11" });
  confere("Ontem", periodoDoFiltro("ontem", HOJE), { de: "2026-10-10", ate: "2026-10-10" });
  confere("7 dias = hoje e os 6 anteriores (eram 8 dias de calendário)", periodoDoFiltro("semana", HOJE), { de: "2026-10-05", ate: "2026-10-11" });
  confere("Mês = do dia 1º até hoje", periodoDoFiltro("mes", HOJE), { de: "2026-10-01", ate: "2026-10-11" });
  confere("Período com as datas trocadas vira de ≤ até", periodoDoFiltro("custom", HOJE, { de: "2026-10-09", ate: "2026-10-03" }), { de: "2026-10-03", ate: "2026-10-09" });
  confere("Período sem as datas = hoje", periodoDoFiltro("custom", HOJE, {}), { de: HOJE, ate: HOJE });

  // ── Sábado 22h e domingo 01h30 na Ragnar (America/Belem, UTC−3) ──────────
  const TZ = "America/Belem";
  const SABADO_22H = Date.parse("2026-10-11T01:00:00Z");
  const DOMINGO_0130 = Date.parse("2026-10-11T04:30:00Z");
  confere("sábado 22h: hoje é sábado 10/10", hojeNaLoja(TZ, new Date(SABADO_22H)), "2026-10-10");
  confere("domingo 01h30: hoje AINDA é sábado 10/10 (o dia vira às 5h; o Início virava à meia-noite)", hojeNaLoja(TZ, new Date(DOMINGO_0130)), "2026-10-10");

  for (const [nome, agora] of [["sábado 22h", SABADO_22H], ["domingo 01h30", DOMINGO_0130]] as const) {
    const hoje = hojeNaLoja(TZ, new Date(agora));
    const p = periodoDoInicio("2026-10-10", "2026-10-10", hoje, TZ, agora);
    confere(`${nome}, "Hoje": 10/10 das 05:00 às 05:00 do dia 11`, [iso(p.janela.inicio), iso(p.janela.fim)], ["2026-10-10T08:00:00.000Z", "2026-10-11T08:00:00.000Z"]);
    confere(`${nome}, "Hoje": o anterior é sexta 09/10 desde as 05:00 ATÉ ESTE MESMO HORÁRIO (era o ontem inteiro)`,
      [p.anterior?.de, iso(p.anterior!.janela.inicio), iso(p.anterior!.janela.fim), p.anterior?.ateEsteHorario],
      ["2026-10-09", "2026-10-09T08:00:00.000Z", new Date(agora - 86400e3).toISOString(), true]);
    const sete = periodoDoInicio("2026-10-04", "2026-10-10", hoje, TZ, agora);
    confere(`${nome}, "7 dias": 04 a 10/10 contra 27/09 a 03/10 até este horário (o anterior repetia o dia −7)`,
      [sete.dias, sete.anterior?.de, sete.anterior?.ate, iso(sete.anterior!.janela.fim)],
      [7, "2026-09-27", "2026-10-03", new Date(agora - 7 * 86400e3).toISOString()]);
    confere(`${nome}, "7 dias": o anterior termina antes de o período começar`, sete.anterior!.janela.fim.getTime() <= sete.janela.inicio.getTime(), true);
  }
  const ontem = periodoDoInicio("2026-10-09", "2026-10-09", "2026-10-10", TZ, SABADO_22H);
  confere("\"Ontem\" é dia fechado: o anterior vai inteiro", [ontem.anterior?.de, ontem.anterior?.ateEsteHorario, iso(ontem.anterior!.janela.fim)], ["2026-10-08", false, "2026-10-09T08:00:00.000Z"]);
  const longo = periodoDoInicio("2026-07-01", "2026-09-30", "2026-10-10", TZ, SABADO_22H);
  confere("Período de 92 dias abre sem comparação (o anterior passaria do teto)", [longo.dias, longo.anterior], [92, null]);
  confere("o Início precisa de pedidos desde o começo do anterior", iso(precisaDesde(periodoDoInicio("2026-10-04", "2026-10-10", "2026-10-10", TZ, SABADO_22H))), "2026-09-27T08:00:00.000Z");

  // A janela que vem com a página cobre os atalhos de todo dia (o "Mês" contra
  // os dias de antes do dia 1º é buscado à parte).
  for (const agora of ["2026-10-01T09:00:00Z", "2026-10-11T04:30:00Z", "2026-10-31T23:00:00Z", "2026-11-01T02:00:00Z"]) {
    const a = new Date(agora);
    const hoje = hojeNaLoja(TZ, a);
    const desde = inicioDaJanela(a, TZ).getTime();
    const cobre = (["hoje", "ontem", "semana", "mes"] as const).every((f) => {
      const d = periodoDoFiltro(f, hoje);
      const p = periodoDoInicio(d.de, d.ate, hoje, TZ, a.getTime());
      return (f === "mes" ? p.janela.inicio : precisaDesde(p)).getTime() >= desde;
    });
    confere(`a página carregada às ${agora} cobre Hoje, Ontem, 7 dias e o Mês (com o anterior, menos o do Mês)`, cobre, true);
  }

  // ── As vendas pela régua ─────────────────────────────────────────────────
  const item = (quantity: number, price: number, name = "X-Burguer") => ({ quantity, price, name, cost: null as number | null });
  let seq = 0;
  const p = (x: Partial<PedidoDoInicio> & { createdAt: string; totalAmount: number }): PedidoDoInicio =>
    ({ id: `p${++seq}`, status: "ENTREGUE", deliveryType: "DELIVERY", customerName: "Cliente", customerPhone: "", items: [item(1, x.totalAmount)], ...x }) as PedidoDoInicio;

  const PEDIDOS: PedidoDoInicio[] = [
    // iFood entregue, pago no app com Pix: é PAGO ONLINE, não o Pix da loja.
    p({ id: "if1", createdAt: "2026-10-10T15:10:00Z", totalAmount: 50, source: "IFOOD", ifoodOrderId: "x1", paymentMethod: "PIX", customerPhone: "0800 705 1020 ID: 32511427" }),
    // iFood retirada (TAKEOUT), crédito pago no app.
    p({ id: "if2", createdAt: "2026-10-10T15:40:00Z", totalAmount: 30, source: "IFOOD", ifoodOrderId: "x2", deliveryType: "TAKEOUT", paymentMethod: "Crédito (Pago Online)", customerPhone: "0800 705 1020 ID: 11112222" }),
    // iFood que a loja trocou para "Pix" (pago na porta): Pix da loja.
    p({ id: "if3", createdAt: "2026-10-10T16:00:00Z", totalAmount: 40, source: "IFOOD", ifoodOrderId: "x3", paymentMethod: "Pix", customerPhone: "0800 705 1020 ID: 99990000" }),
    // Acréscimo do if1 (a Coca a mais): soma no valor, não é venda nova.
    p({ id: "if1b", createdAt: "2026-10-10T15:20:00Z", totalAmount: 8, source: "IFOOD", ifoodOrderId: "x1b", parentOrderId: "if1", paymentMethod: "PIX" }),
    // Mesa s1: três rodadas = UMA venda; o lançamento grava "N/A".
    p({ id: "m1", createdAt: "2026-10-10T22:00:00Z", totalAmount: 60, tableSessionId: "s1", deliveryType: "MESA", source: "PRESENCIAL", paymentMethod: "N/A", status: "ACEITO", customerPhone: "00000000000" }),
    p({ id: "m2", createdAt: "2026-10-10T23:00:00Z", totalAmount: 45, tableSessionId: "s1", deliveryType: "MESA", source: "PRESENCIAL", paymentMethod: "N/A", status: "ACEITO", customerPhone: "00000000000" }),
    p({ id: "m3", createdAt: "2026-10-11T01:30:00Z", totalAmount: 15, tableSessionId: "s1", deliveryType: "MESA", source: "PRESENCIAL", paymentMethod: "N/A", status: "ACEITO", customerPhone: "00000000000" }),
    // Balcão (PDV) com pagamento dividido: Pix 60 + Dinheiro 40.
    p({ id: "b1", createdAt: "2026-10-10T19:00:00Z", totalAmount: 100, source: "PRESENCIAL", deliveryType: "RETIRADA", paymentMethod: "Dividido",
      paymentMethods: [{ method: "Pix", amount: 60 }, { method: "Dinheiro", amount: 40 }], customerPhone: "00000000000" }),
    // Site com entrega, pago no gateway.
    p({ id: "s1", createdAt: "2026-10-10T21:00:00Z", totalAmount: 70, source: "SITE", paymentMethod: "Pix", paymentPaidAt: "2026-10-10T21:01:00Z", gatewayProvider: "ASAAS", customerPhone: "(22) 99999-1234" }),
    // Wabiz, débito Mastercard escrito "Deb": débito, não "Outros".
    p({ id: "w1", createdAt: "2026-10-10T21:30:00Z", totalAmount: 35, source: "WABIZ", openDeliveryChannel: "WABIZ", paymentMethod: "Cartão Deb Master (Cobrar na Entrega)", customerPhone: "22 9999-1234" }),
    // Totem.
    p({ id: "t1", createdAt: "2026-10-10T20:00:00Z", totalAmount: 25, source: "TOTEM", deliveryType: "RETIRADA", totemLicenseId: "tot1", paymentMethod: "Cartão Crédito", customerPhone: "" }),
    // 99Food com o número real e o ramal deles pendurado.
    p({ id: "n1", createdAt: "2026-10-10T22:30:00Z", totalAmount: 20, source: "99FOOD", openDeliveryChannel: "99FOOD", paymentMethod: "Dinheiro (Cobrar na Entrega)", customerPhone: "+55 21995358507 (ramal 81513893)" }),
    // Fora da venda: cancelado, rascunho do robô e totem sem pagamento.
    p({ id: "c1", createdAt: "2026-10-10T18:00:00Z", totalAmount: 90, status: "CANCELADO", source: "SITE", customerPhone: "(21) 98888-7777" }),
    p({ id: "r1", createdAt: "2026-10-10T18:10:00Z", totalAmount: 55, status: "CRIANDO_IA", source: "WHATSAPP_IA", customerPhone: "(21) 97777-6666" }),
    p({ id: "a1", createdAt: "2026-10-10T18:20:00Z", totalAmount: 33, status: "AGUARDANDO_PAGAMENTO", source: "TOTEM", totemLicenseId: "tot1" }),
  ];

  const v = vendasDoInicio(PEDIDOS);
  const valorEsperado = 50 + 30 + 40 + 8 + 60 + 45 + 15 + 100 + 70 + 35 + 25 + 20;
  confere("valor vendido: sem cancelado, rascunho e totem sem pagamento", v.valor, valorEsperado);
  confere("vendas: a mesa de três rodadas é UMA, o acréscimo não é venda nova (9 vendas, 12 lançamentos)", [v.vendas, v.lancamentos, v.mesas], [9, 12, 1]);
  confere("ticket médio = valor ÷ vendas (não ÷ lançamentos: seria R$ 41,50)", v.ticket, Math.round((valorEsperado / 9) * 100) / 100);
  confere("cancelados e não concluídos à parte", [v.cancelados, v.naoConcluidos], [{ pedidos: 1, valor: 90 }, 2]);
  confere("é o MESMO resumoDeVendas do Vendas por período", [v.valor, v.vendas, v.lancamentos, v.ticket],
    (() => { const r = resumoDeVendas(PEDIDOS.map((x) => ({ ...x, franchiseeId: "L" })) as any); return [r.totalPedidos, r.atendimentos, r.pedidos, r.ticketMedio]; })());
  confere("por tipo: a mesa é Mesa (era \"Retirada\"), o PDV é Balcão, o TAKEOUT do iFood é Retirada, o totem é Totem",
    v.porTipo.map((t) => [t.rotulo, t.vendas, t.lancamentos, t.valor]),
    [["Entrega", 5, 6, 50 + 8 + 40 + 70 + 35 + 20], ["Retirada", 1, 1, 30], ["Balcão", 1, 1, 100], ["Mesa", 1, 3, 120], ["Totem", 1, 1, 25]]);
  confere("as linhas de tipo somam o valor vendido", Math.round(v.porTipo.reduce((s, t) => s + t.valor, 0) * 100) / 100, valorEsperado);

  // ── As formas de pagamento ───────────────────────────────────────────────
  const formas = formasDoInicio(PEDIDOS);
  confere("formas: dinheiro, Pix, crédito, débito, online e mesa — na ordem do caixa",
    formas.map((f) => [f.chave, f.valor, f.contas]),
    [["DINHEIRO", 40 + 20, 2], ["PIX", 40 + 60, 2], ["CREDITO", 25, 1], ["DEBITO", 35, 1], ["ONLINE", 50 + 8 + 30 + 70, 4], ["MESA", 120, 1]]);
  confere("o Pix pago no app do iFood NÃO é Pix da loja (vai para Pago online)", formas.find((f) => f.chave === "PIX")?.valor, 100);
  confere("a mesa tem grupo próprio (não cai em \"Outros\")", [formas.find((f) => f.chave === "MESA")?.rotulo, formas.some((f) => f.chave === "OUTROS")], ["Mesa (forma no fechamento da conta)", false]);
  confere("as linhas somam o valor vendido", Math.round(formas.reduce((s, f) => s + f.valor, 0) * 100) / 100, valorEsperado);
  confere("os % somam 100", Math.round(formas.reduce((s, f) => s + f.pct, 0)), 100);
  confere("na lista: dividido, mesa, iFood no app e Deb Master",
    ["b1", "m1", "if1", "w1"].map((id) => formaDoPedidoNaLista(PEDIDOS.find((x) => x.id === id)!)),
    ["Pix + Dinheiro", "Na conta da mesa", "Pago online", "Débito"]);
  confere("na lista: tipo de venda da régua", ["m1", "b1", "if2", "t1", "s1"].map((id) => tipoDoPedidoNaLista(PEDIDOS.find((x) => x.id === id)!)),
    ["Mesa", "Balcão", "Retirada", "Totem", "Entrega"]);
  confere("na lista: o número do dia, senão o do app", [numeroDoPedidoNaLista({ ...PEDIDOS[0], dailyOrderNumber: 42 }), numeroDoPedidoNaLista({ ...PEDIDOS[0], ifoodReference: "4231" })], ["#42", "#4231"]);

  // ── Clientes ─────────────────────────────────────────────────────────────
  confere("o 0800 do iFood com o localizador não é cliente", chaveDoCliente("0800 705 1020 ID: 32511427"), null);
  confere("o 00000000000 do balcão e da mesa não é cliente", chaveDoCliente("00000000000"), null);
  confere("o mesmo número com e sem o nono dígito é o mesmo cliente (DDD + 8)", [chaveDoCliente("(22) 99999-1234"), chaveDoCliente("22 9999-1234"), chaveDoCliente("+55 22 99999-1234")], ["2299991234", "2299991234", "2299991234"]);
  confere("o ramal do 99Food sai antes", chaveDoCliente("+55 21995358507 (ramal 81513893)"), "2195358507");
  confere("clientes identificados: 2 (site e Wabiz são o mesmo número; o 99Food é outro); 3 vendas com telefone de 9",
    clientesDoInicio(PEDIDOS), { clientes: 2, vendasComTelefone: 3, vendas: 9 });

  // ── Vendas por hora ──────────────────────────────────────────────────────
  confere("o eixo começa às 5h e termina às 4h", [HORAS_DO_DIA[0], HORAS_DO_DIA[18], HORAS_DO_DIA[19], HORAS_DO_DIA[23], HORAS_DO_DIA.length], [5, 23, 0, 4, 24]);
  const umDia = vendasPorHora(PEDIDOS, { de: "2026-10-10", ate: "2026-10-10", tz: TZ, agora: DOMINGO_0130 });
  const naHora = (lista: ReturnType<typeof vendasPorHora>, h: number) => lista.find((x) => x.hora === h)!;
  confere("a mesa conta UMA vez, às 19h (com o 99Food das 19h30); as rodadas das 20h e das 22h30 não são vendas", [naHora(umDia, 19).vendas, naHora(umDia, 20).vendas, naHora(umDia, 22).vendas], [2, 0, 0]);
  confere("às 12h: o if1 (12h10) e o if2 (12h40) — o acréscimo das 12h20 não é venda", naHora(umDia, 12).vendas, 2);
  confere("a soma das horas é o número de vendas", umDia.reduce((s, h) => s + h.vendas, 0), v.vendas);
  confere("às 01h30, as horas 2h, 3h e 4h do dia ainda não chegaram", [naHora(umDia, 1).dias, naHora(umDia, 2).dias, naHora(umDia, 4).dias], [1, 0, 0]);
  const semana = vendasPorHora([p({ createdAt: "2026-10-09T23:00:00Z", totalAmount: 10 }), p({ createdAt: "2026-10-10T23:00:00Z", totalAmount: 10 }), p({ createdAt: "2026-10-10T23:10:00Z", totalAmount: 10 })],
    { de: "2026-10-04", ate: "2026-10-10", tz: TZ, agora: SABADO_22H });
  confere("7 dias, sábado 22h: às 20h há 3 vendas em 7 dias = 0,43 por dia (era a soma da semana)", [naHora(semana, 20).vendas, naHora(semana, 20).dias, Math.round(naHora(semana, 20).media * 100) / 100], [3, 7, 0.43]);
  confere("7 dias, sábado 22h: a hora das 23h só chegou em 6 dos 7 dias", naHora(semana, 23).dias, 6);

  // ── Produtos ─────────────────────────────────────────────────────────────
  const top = produtosDoInicio([
    p({ createdAt: "2026-10-10T20:00:00Z", totalAmount: 30, items: [item(2, 10, "Coxinha"), item(0, 99, "Tirado na edição")] }),
    p({ createdAt: "2026-10-10T20:05:00Z", totalAmount: 10, status: "CANCELADO", items: [item(5, 10, "Coxinha")] }),
  ], (i) => i.name);
  confere("produtos: só venda e só item com quantidade", top.map((x) => [x.name, x.qty, x.total]), [["Coxinha", 2, 20]]);

  // ── Variação ─────────────────────────────────────────────────────────────
  confere("variação: ↑ 14,7% / sem anterior não compara", [variacao(14642.88, 12766.35), variacao(10, 0)], [14.7, null]);

  // ── A atualização ────────────────────────────────────────────────────────
  const velhos = [
    { id: "a", createdAt: "2026-10-10T07:00:00Z", status: "ENTREGUE" },
    { id: "b", createdAt: "2026-10-10T20:00:00Z", status: "NOVO" },
    { id: "c", createdAt: "2026-10-10T21:00:00Z", status: "NOVO" },
  ];
  const novos = [{ id: "b", createdAt: "2026-10-10T20:00:00Z", status: "CANCELADO" }, { id: "d", createdAt: "2026-10-10T22:00:00Z", status: "NOVO" }];
  confere("juntar: o que foi relido substitui (b cancelou), o que sumiu da releitura sai (c), o antigo fica (a)",
    juntarPedidos(velhos, novos, Date.parse("2026-10-10T08:00:00Z")).map((x) => `${x.id}:${x.status}`), ["d:NOVO", "b:CANCELADO", "a:ENTREGUE"]);
  confere("atualizar relê o dia de hoje desde as 5h",
    new Date(desdeDaAtualizacao({ hoje: "2026-10-10", tz: TZ, cobertoAte: SABADO_22H, cobertoDesde: Date.parse("2026-09-27T08:00:00Z") })).toISOString(), "2026-10-10T08:00:00.000Z");
  confere("na virada das 5h, relê desde um pouco antes do que já tinha (nada da madrugada se perde)",
    new Date(desdeDaAtualizacao({ hoje: "2026-10-11", tz: TZ, cobertoAte: Date.parse("2026-10-11T07:58:00Z"), cobertoDesde: Date.parse("2026-09-27T08:00:00Z") })).toISOString(), "2026-10-11T07:48:00.000Z");
  confere("e nunca antes do que a tela tem carregado",
    desdeDaAtualizacao({ hoje: "2026-10-10", tz: TZ, cobertoAte: SABADO_22H, cobertoDesde: Date.parse("2026-10-10T12:00:00Z") }), Date.parse("2026-10-10T12:00:00Z"));
  confere("janela [início, fim): o pedido das 05:00 em ponto é do dia; o das 04:59 é de ontem",
    [naJanela({ createdAt: "2026-10-10T08:00:00Z" }, janelaDosDias("2026-10-10", "2026-10-10", TZ)), naJanela({ createdAt: "2026-10-10T07:59:59Z" }, janelaDosDias("2026-10-10", "2026-10-10", TZ))], [true, false]);

  console.log(falhas ? `\n${falhas} falha(s).` : "\nTudo certo.");
  process.exit(falhas ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
