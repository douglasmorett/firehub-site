/**
 * Trava o relatório "Tempo por status e produção" (lib/relatorios/tempos.ts).
 *
 *   npx tsx scripts/teste-tempos.ts
 *
 * Os pedidos imitam o que os carimbos da NIK mostraram de 17 a 23/09/2026:
 * o iFood com `acceptedAt` recarimbado 6 s depois do pronto e o "entregue"
 * 4h30 depois (a conclusão automática do iFood), a mesa e o balcão que nascem
 * aceitos e entram no KDS sem `kdsProductionAt`, a retirada que o KDS dá por
 * pronta gravando SAIU_ENTREGA.
 *
 * E o que a revisão de 24/09/2026 achou: o Wabiz #29 da NIK (aceito pela loja
 * na chegada e regravado ao ir para "Em preparo"), o total que misturava
 * entrega e balcão, o PICKUP do site com 40 min contra os 45 do cartão, a
 * folga com fração contra os minutos inteiros do cartão, e a Coca Zero da
 * mesa #14 com "144 min de preparo".
 */
import {
  aceitoNaChegada, estatistica, etapasDoPedido, foiParaACozinha, faixaDoPrazo, fmtMin, limitesDoAlerta, prazoDoPedido, rotuloDoMedirAte, temposDoRelatorio,
  type ConfigDosTempos, type ItemParaTempos, type PedidoParaTempos, type TelaParaTempos,
} from "../src/lib/relatorios/tempos";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

const TZ = "America/Sao_Paulo";
/** "2026-09-23 20:00" no relógio da loja (−03:00). */
const h = (diaHora: string) => new Date(`${diaHora.replace(" ", "T")}:00-03:00`);
const mais = (base: Date, min: number) => new Date(base.getTime() + min * 60000);

let seq = 0;
function pedido(x: Partial<PedidoParaTempos> & { createdAt: Date }): PedidoParaTempos {
  seq++;
  return { id: `p${seq}`, status: "ENTREGUE", tipo: "DELIVERY", canal: "SITE", numero: seq, referencia: null, itens: [], ...x };
}
const item = (nome: string, categoria: string, quantidade: number, prontoEm: Date | null): ItemParaTempos =>
  ({ nome, categoria, chave: `${categoria}:${nome.toLowerCase()}`, produtoId: `id-${nome}`, quantidade, prontoEm });

const LIMITES = limitesDoAlerta(null);
const cfg = (x: Partial<ConfigDosTempos> = {}): ConfigDosTempos => ({ tz: TZ, limites: LIMITES, ...x });

console.log("\n1) Contas pequenas");
confere("estatística de [1,2,3,4,10]: mín, mediana, média, 90% em até, máx",
  estatistica([10, 1, 3, 2, 4]), { medidos: 5, minimo: 1, mediana: 3, media: 4, p90: 10, maximo: 10 });
confere("mediana de quantidade par é a média dos dois do meio", estatistica([1, 2, 3, 4]).mediana, 2.5);
confere("lista vazia não inventa zero", estatistica([]), { medidos: 0, minimo: null, mediana: null, media: null, p90: null, maximo: null });
confere("minutos na tela", [fmtMin(8.5), fmtMin(12), fmtMin(65), fmtMin(null)], ["8,5 min", "12 min", "1h05", "—"]);
confere("alertas sem configuração = os do painel (amarelo 10, vermelho 5)", LIMITES,
  { amareloAtivo: true, amareloMin: 10, vermelhoAtivo: true, vermelhoMin: 5 });
confere("alertas do Frangoso (vermelho 15, amarelo 20) e amarelo desligado",
  [limitesDoAlerta({ redEnabled: true, redMinutes: 15, yellowEnabled: true, yellowMinutes: 20 }).vermelhoMin,
    limitesDoAlerta({ yellowEnabled: false, yellowMinutes: 10 }).amareloAtivo], [15, false]);
confere("configuração salva sem 'ligado' = desligado, como o cartão lê (redEnabled && minutos > 0)",
  [limitesDoAlerta({ redMinutes: 15 }).vermelhoAtivo, limitesDoAlerta({ redEnabled: true, redMinutes: 0 }).vermelhoAtivo], [false, false]);

console.log("\n2) iFood da NIK: aceite recarimbado e 'entregue' 4h30 depois");
const c1 = h("2026-09-23 20:00");
const ifood = pedido({
  canal: "IFOOD", referencia: "4231", createdAt: c1,
  kdsProductionAt: mais(c1, 0.5),
  kdsFinishingAt: mais(c1, 4.5), readyAt: mais(c1, 9), kdsFinishedAt: mais(c1, 9),
  acceptedAt: mais(c1, 9.1), // o evento "pronto" do iFood volta como PREPARANDO
  dispatchedAt: mais(c1, 16), deliveredAt: mais(c1, 16 + 270),
  scheduledDatetime: mais(c1, 40), // a previsão do iFood
  itens: [item("Esfiha de Carne", "Esfihas", 10, mais(c1, 4.5))],
});
const e1 = etapasDoPedido(ifood);
confere("aceite depois da primeira baixa = carimbo reescrito, não 9,1 min", e1.aceite, { aplica: true, minutos: null, motivo: "reescrito" });
confere("cozinha: da entrada no KDS (20:00:30) ao pronto (20:09) = 8,5 min", e1.cozinha, { aplica: true, minutos: 8.5 });
confere("pronto esperando saída: 7 min", e1.esperandoSaida, { aplica: true, minutos: 7 });
confere("na rua 270 min = conclusão do iFood, fora da curva (teto 2 h)", e1.rua, { aplica: true, minutos: null, motivo: "foraDaCurva" });
confere("o total da entrega herda: fora da curva, não 286 min", e1.totalEntrega, { aplica: true, minutos: null, motivo: "foraDaCurva" });
confere("entrega não tem 'total na loja'", e1.totalNaLoja, { aplica: false });
const f1 = faixaDoPrazo(ifood, LIMITES);
confere("prazo = a previsão do iFood (40 min): saiu com 24 min de folga, no prazo", [f1.faixa, f1.excedeu], ["noPrazo", -24]);

console.log("\n3) Site com aceite manual, sem KDS");
const c2 = h("2026-09-23 19:00");
const site = pedido({
  createdAt: c2, kdsProductionAt: c2, acceptedAt: mais(c2, 3), readyAt: mais(c2, 25), dispatchedAt: mais(c2, 30), deliveredAt: mais(c2, 50),
});
const e2 = etapasDoPedido(site);
confere("aceite 3, cozinha 25, esperando saída 5, rua 20, total da entrega 50, total na loja não se aplica",
  [e2.aceite, e2.cozinha, e2.esperandoSaida, e2.rua, e2.totalEntrega, e2.totalNaLoja].map((m) => (m.aplica ? m.minutos : "n/a")), [3, 25, 5, 20, 50, "n/a"]);
confere("sem hora prometida: prazo de 45 min, saiu aos 30 = 15 de folga, no prazo",
  [faixaDoPrazo(site, LIMITES).faixa, faixaDoPrazo(site, LIMITES).excedeu], ["noPrazo", -15]);

console.log("\n4) As faixas de alerta na saída");
const c3 = h("2026-09-23 21:00");
const saiuAos = (min: number) => pedido({ createdAt: c3, dispatchedAt: mais(c3, min) });
confere("saiu aos 38 (7 de folga) = amarelo; aos 42 (3) = vermelho; aos 52 = estourado 7 min",
  [38, 42, 52].map((m) => { const f = faixaDoPrazo(saiuAos(m), LIMITES); return [f.faixa, f.excedeu]; }),
  [["amarelo", -7], ["vermelho", -3], ["estourado", 7]]);
confere("vermelho de 15 (Frangoso): 12 de folga já é vermelho",
  faixaDoPrazo(saiuAos(33), limitesDoAlerta({ redEnabled: true, redMinutes: 15, yellowEnabled: true, yellowMinutes: 20 })).faixa, "vermelho");
// O cartão arredonda os minutos restantes para baixo: 5 min 30 s de folga é
// "5 min restantes", vermelho de 5; 10 min 30 s é "10 min", amarelo de 10.
confere("folga de 5,5 min = vermelho e de 10,5 = amarelo, como o cartão (minutos inteiros)",
  [39.5, 34.5].map((m) => faixaDoPrazo(saiuAos(m), LIMITES).faixa), ["vermelho", "amarelo"]);
confere("folga de 11 min já é 'no prazo'", faixaDoPrazo(saiuAos(34), LIMITES).faixa, "noPrazo");
confere("sem saída carimbada: não medido (falta não é 'no prazo')", faixaDoPrazo(pedido({ createdAt: c3 }), LIMITES).faixa, "semCarimbo");

console.log("\n5) Mesa: nasce aceita, entra no KDS sem kdsProductionAt, não tem prazo");
const c4 = h("2026-09-23 20:00");
const mesa = pedido({
  tipo: "MESA", canal: "MESA", createdAt: c4,
  acceptedAt: mais(c4, 3), // recarimbado na baixa da cozinha
  readyAt: mais(c4, 5), kdsFinishedAt: mais(c4, 5), dispatchedAt: mais(c4, 5),
  deliveredAt: mais(c4, 70), // a mesa fechou — não é "entrega"
  itens: [item("Pizza Grande", "Pizzas", 1, mais(c4, 3))],
});
const e4 = etapasDoPedido(mesa);
confere("sem aceite, cozinha 5 (desde o lançamento), sem saída/rua, total na loja 5 (até o pronto)",
  [e4.aceite.aplica, e4.cozinha.aplica && e4.cozinha.minutos, e4.esperandoSaida.aplica, e4.rua.aplica, e4.totalEntrega.aplica, e4.totalNaLoja.aplica && e4.totalNaLoja.minutos],
  [false, 5, false, false, false, 5]);
confere("mesa não tem prazo", faixaDoPrazo(mesa, LIMITES).faixa, "semPrazo");

console.log("\n6) Balcão e retirada");
const c5 = h("2026-09-23 12:00");
const balcao = pedido({ tipo: "BALCAO", canal: "PDV", deliveryType: "RETIRADA", createdAt: c5, acceptedAt: mais(c5, 2), readyAt: mais(c5, 8), dispatchedAt: mais(c5, 8) });
const e5 = etapasDoPedido(balcao);
confere("balcão: sem aceite (nasce aceito), cozinha 8, prazo de 40 → no prazo",
  [e5.aceite.aplica, e5.cozinha.aplica && e5.cozinha.minutos, faixaDoPrazo(balcao, LIMITES).faixa], [false, 8, "noPrazo"]);
const retirada = pedido({ tipo: "RETIRADA", canal: "WABIZ", deliveryType: "RETIRADA", createdAt: c5, kdsProductionAt: c5, acceptedAt: mais(c5, 4), dispatchedAt: mais(c5, 11) });
confere("retirada sem readyAt: o SAIU_ENTREGA do KDS é o pronto (11 min)",
  etapasDoPedido(retirada).cozinha, { aplica: true, minutos: 11 });

// O prazo padrão é o do CARTÃO, que olha o tipo gravado: o balcão grava
// RETIRADA e o totem TAKEOUT (40 min); o PICKUP do site não é reconhecido e
// o cartão mostra "Entregar até" com 45 min. Pronto aos 43 min: o cartão diz
// "2 min restantes" — o relatório não pode dizer "estourou +3 min".
const pickup = pedido({ tipo: "RETIRADA", canal: "SITE", deliveryType: "PICKUP", createdAt: c5, readyAt: mais(c5, 43) });
confere("PICKUP do site sem promessa: 45 min como no cartão; pronto aos 43 = vermelho, não estourado",
  [faixaDoPrazo(pickup, LIMITES).faixa, faixaDoPrazo(pickup, LIMITES).excedeu], ["vermelho", -2]);
const prazoEm = (x: Partial<PedidoParaTempos>) =>
  (prazoDoPedido({ createdAt: c5, tipo: "RETIRADA", ...x })! - c5.getTime()) / 60000;
confere("40 min: RETIRADA, TAKEOUT (totem), marcador 'Retirada no balcão' na observação; 45: PICKUP, DELIVERY, 'retirada' solta no texto",
  [prazoEm({ deliveryType: "RETIRADA" }), prazoEm({ deliveryType: "TAKEOUT" }), prazoEm({ deliveryType: "PICKUP", notes: "Retirada no balcão" }),
    prazoEm({ deliveryType: "PICKUP" }), prazoEm({ deliveryType: "DELIVERY" }), prazoEm({ deliveryType: "PICKUP", notes: "não precisa esperar a retirada" })],
  [40, 40, 40, 45, 45, 45]);

console.log("\n7) Falta não é zero; carimbo fora de ordem e pedido esquecido");
const c6 = h("2026-09-23 18:00");
const semPronto = pedido({ createdAt: c6, kdsProductionAt: c6, acceptedAt: mais(c6, 1), dispatchedAt: mais(c6, 20) });
confere("sem pronto: cozinha 'sem carimbo', não 0", etapasDoPedido(semPronto).cozinha, { aplica: true, minutos: null, motivo: "semCarimbo" });
const foraDeOrdem = pedido({ createdAt: c6, readyAt: mais(c6, 20), dispatchedAt: mais(c6, 18) });
confere("saiu antes do pronto: fora da curva", etapasDoPedido(foraDeOrdem).esperandoSaida, { aplica: true, minutos: null, motivo: "foraDaCurva" });
const esquecido = pedido({ tipo: "RETIRADA", canal: "PDV", deliveryType: "RETIRADA", createdAt: c6, readyAt: mais(c6, 2819), dispatchedAt: mais(c6, 2819) });
confere("pronto 2 dias depois (finalizado no painel): cozinha e prazo fora da curva, não 'atrasado 46 h'",
  [etapasDoPedido(esquecido).cozinha, faixaDoPrazo(esquecido, LIMITES).faixa],
  [{ aplica: true, minutos: null, motivo: "foraDaCurva" }, "foraDaCurva"]);

console.log("\n8) O relatório inteiro: cancelado, agendado, madrugada, por dia, lista");
const agendado = pedido({
  canal: "IFOOD", createdAt: h("2026-09-23 10:00"), scheduledDatetime: h("2026-09-23 20:00"),
  kdsProductionAt: h("2026-09-23 10:00"), readyAt: h("2026-09-23 19:45"), dispatchedAt: h("2026-09-23 20:20"),
  itens: [item("Pizza Grande", "Pizzas", 1, h("2026-09-23 19:40"))],
});
const cancelado = pedido({ status: "CANCELADO", createdAt: h("2026-09-23 20:30"), dispatchedAt: h("2026-09-23 22:00") });
const madrugada = pedido({
  createdAt: h("2026-09-24 01:30"), kdsProductionAt: h("2026-09-24 01:30"), acceptedAt: h("2026-09-24 01:31"),
  readyAt: h("2026-09-24 01:50"), dispatchedAt: h("2026-09-24 02:00"), deliveredAt: h("2026-09-24 02:15"),
  itens: [item("Esfiha de Carne", "Esfihas", 5, h("2026-09-24 01:36")), item("Coca Cola 2l", "Bebidas", 1, null)],
});
const todos = [ifood, site, saiuAos(52), mesa, balcao, agendado, cancelado, madrugada];
const rel = temposDoRelatorio(todos, cfg({ periodo: { de: "2026-09-22", ate: "2026-09-23" } }));
confere("cancelado fica de fora; o agendado é contado à parte", [rel.pedidos, rel.agendados], [7, 1]);
confere("o pedido da 1h30 do dia 24 é do expediente do dia 23",
  rel.lista.find((l) => l.id === madrugada.id)?.dia, "2026-09-23");
const cozinha = rel.etapas.find((e) => e.chave === "cozinha")!;
confere("cozinha: 5 medidos (iFood 8,5; site 25; mesa 5; balcão 8; madrugada 20), 1 sem carimbo, agendado fora",
  [cozinha.elegiveis, cozinha.medidos, cozinha.semCarimbo, cozinha.mediana, cozinha.maximo], [6, 5, 1, 8.5, 25]);
const aceite = rel.etapas.find((e) => e.chave === "aceite")!;
confere("aceite: iFood reescrito, mesa e balcão não entram; site 3 e madrugada 1",
  [aceite.elegiveis, aceite.medidos, aceite.reescritos, aceite.mediana], [4, 2, 1, 2]);
const rua = rel.etapas.find((e) => e.chave === "rua")!;
confere("rua: iFood fora da curva; site 20 e madrugada 15", [rua.medidos, rua.foraDaCurva, rua.mediana], [2, 1, 17.5]);
confere("prazo dos 'para agora': 1 estourado (7 min), mesa sem prazo, o da madrugada saiu com folga de 15",
  [rel.prazo.estourados, rel.prazo.semPrazo, rel.prazo.atrasoMediano, rel.prazo.noPrazo], [1, 1, 7, 4]);
confere("agendado: prazo é a hora marcada (20:00), saiu 20:20 = estourado 20 min",
  [rel.prazoDosAgendados.estourados, rel.prazoDosAgendados.maiorAtraso], [1, 20]);
confere("por dia: o dia 22 aparece mesmo sem pedido; o 23 tem os 6 'para agora'",
  rel.porDia.map((d) => [d.dia, d.pedidos, d.estourados]), [["2026-09-22", 0, 0], ["2026-09-23", 6, 1]]);
confere("mediana da cozinha no dia 23", rel.porDia[1].etapas.cozinha, { medidos: 5, mediana: 8.5 });
confere("por tipo: a entrega tem o total da entrega (50 e 45); balcão (8) e mesa (5) têm o total na loja",
  rel.porTipo.map((t) => [t.tipo, t.pedidos, t.etapas.totalEntrega.mediana, t.etapas.totalNaLoja.mediana]),
  [["DELIVERY", 4, 47.5, null], ["BALCAO", 1, null, 8], ["MESA", 1, null, 5]]);
confere("as etapas trazem os dois totais separados, sem um 'total' misturado",
  rel.etapas.map((e) => [e.chave, e.medidos, e.mediana]).filter(([k]) => String(k).startsWith("total")),
  [["totalEntrega", 2, 47.5], ["totalNaLoja", 2, 6.5]]);

const soAtrasados = temposDoRelatorio(todos, cfg({ apenasAtrasados: true }));
confere("'Mostrar apenas atrasados': só o que saiu depois do prazo (o agendado também)",
  soAtrasados.lista.map((l) => [l.agendado, l.excedeu]), [[true, 20], [false, 7]]);
confere("a lista corta no limite e avisa", (() => { const r = temposDoRelatorio(todos, cfg({ limiteDaLista: 2 })); return [r.lista.length, r.totalDaLista, r.listaCortada]; })(), [2, 7, true]);

// A NIK de 20 para 21/09/2026: o dia 20 só com entrega, o 21 com a mesma
// entrega e o balcão que passou a ter pronto. O "total" misturado caía de
// 50 para 8 min; separado, a entrega do dia 21 continua em 50.
const entregaDoDia = (dia: string) => {
  const c = h(`${dia} 20:00`);
  return pedido({ createdAt: c, kdsProductionAt: c, acceptedAt: mais(c, 1), readyAt: mais(c, 15), dispatchedAt: mais(c, 20), deliveredAt: mais(c, 50) });
};
const balcaoDoDia = (dia: string, min: number) => {
  const c = h(`${dia} 21:00`);
  return pedido({ tipo: "BALCAO", canal: "PDV", deliveryType: "RETIRADA", createdAt: c, readyAt: mais(c, min), dispatchedAt: mais(c, min) });
};
const mistura = temposDoRelatorio(
  [entregaDoDia("2026-09-20"), entregaDoDia("2026-09-21"), balcaoDoDia("2026-09-21", 7), balcaoDoDia("2026-09-21", 8), balcaoDoDia("2026-09-21", 9)],
  cfg({ periodo: { de: "2026-09-20", ate: "2026-09-21" } }));
confere("por dia: a entrega fica em 50 nos dois dias mesmo com o balcão entrando no dia 21",
  mistura.porDia.map((d) => [d.dia, d.etapas.totalEntrega.mediana, d.etapas.totalNaLoja.mediana]),
  [["2026-09-20", 50, null], ["2026-09-21", 50, 8]]);

console.log("\n9) Produção por produto");
confere("Esfihas: 2 medições (4 min × 10 un e 6 min × 5 un), a Coca sem pronto não vira zero",
  (() => { const e = rel.producao.categorias.find((c) => c.nome === "Esfihas")!; return [e.medidos, e.quantidade, e.mediana, e.maximo]; })(), [2, 15, 5, 6]);
confere("Pizzas: só a da mesa (3 min) — a do agendado não entra", rel.producao.categorias.find((c) => c.nome === "Pizzas")?.mediana, 3);
confere("itens sem pronto contados à parte", rel.producao.semPronto, 1);
confere("por hora, na ordem do expediente: 20h antes da 1h da manhã",
  rel.producao.porHora.map((x) => [x.hora, x.medidos]), [[20, 2], [1, 1]]);

// NIK, mesa #14 de 22/09/2026: a Coca Zero ganhou pronto 144 min depois do
// lançamento e o pedido, 23 h depois (a tela largada e limpa depois).
const c7 = h("2026-09-23 19:00");
const mesaLargada = pedido({
  tipo: "MESA", canal: "MESA", deliveryType: "MESA", createdAt: c7, readyAt: mais(c7, 1393), kdsFinishedAt: mais(c7, 1393),
  itens: [item("Coca Cola Zero Lata", "Bebidas", 1, mais(c7, 144))],
});
const comMesaLargada = temposDoRelatorio([mesaLargada, madrugada], cfg());
confere("item de pedido com a cozinha fora da curva não vira '144 min de preparo'",
  [comMesaLargada.producao.categorias.map((c) => c.nome), comMesaLargada.producao.maximo, comMesaLargada.producao.foraDaCurva],
  [["Esfihas"], 6, 1]);

console.log("\n10) Filtro de categoria");
const soPizza = temposDoRelatorio(todos, cfg({ categorias: new Set(["Pizzas"]) }));
confere("só pedidos com pizza (a mesa e o agendado) e só a pizza na produção",
  [soPizza.pedidos, soPizza.agendados, soPizza.producao.categorias.map((c) => c.nome)], [2, 1, ["Pizzas"]]);

console.log("\n11) O pedido que a loja aceita sozinha");
// NIK, Wabiz #29 de 22/09/2026: a loja aceita sozinha (os outros Wabiz do dia
// com acceptedAt 0,1 s depois da criação); alguém arrastou para "Em preparo"
// aos 15,3 min, antes de qualquer baixa, e o PREPARANDO regravou o aceite.
const c8 = h("2026-09-22 19:16");
const wabiz29 = pedido({
  tipo: "RETIRADA", canal: "WABIZ", deliveryType: "RETIRADA", createdAt: c8, kdsProductionAt: c8,
  acceptedAt: mais(c8, 15.3), readyAt: mais(c8, 23.1), scheduledDatetime: mais(c8, 38.3),
  aceitoPelaLoja: aceitoNaChegada("WABIZ", c8, true),
});
confere("Wabiz com aceite automático: não esperou aceite (não 15,3 min)", etapasDoPedido(wabiz29).aceite, { aplica: false });
const soAceite = temposDoRelatorio([wabiz29, site], cfg());
confere("a etapa de aceite fica só com o site de aceite manual (3 min)",
  (() => { const a = soAceite.etapas.find((e) => e.chave === "aceite")!; return [a.elegiveis, a.medidos, a.maximo]; })(), [1, 1, 3]);
confere("quem a loja aceita sozinha: site, Wabiz, 99Food e totem — não iFood, Brendi, Jotajá",
  ["SITE", "WABIZ", "99FOOD", "TOTEM", "IFOOD", "BRENDI", "JOTAJA"].map((canal) => aceitoNaChegada(canal, c8, true)),
  [true, true, true, true, false, false, false]);
confere("aceite automático desligado: a espera é de verdade", aceitoNaChegada("WABIZ", c8, false), false);
confere("antes de 03/09/2026 16:21 a coluna não valia (era false para todo mundo)",
  [aceitoNaChegada("SITE", h("2026-09-03 12:00"), true), aceitoNaChegada("SITE", h("2026-09-03 19:24"), true)], [false, true]);

console.log("\n12) Produção por hora: média, o mais rápido e o mais demorado");
// NIK, áudio de 30/09/2026: "de hora em hora, a média, qual pedido foi o
// maior tempo e qual o menor — e ver qual pedido, qual sabor, qual horário".
const c9 = h("2026-09-24 20:05");
const c10 = h("2026-09-24 20:40");
const c11 = h("2026-09-24 21:10");
const rapido = pedido({ createdAt: c9, kdsProductionAt: c9, itens: [item("Esfiha Carne", "Esfihas", 6, mais(c9, 4))] });
const lento = pedido({
  createdAt: c10, kdsProductionAt: c10,
  itens: [
    { ...item("Pizza Grande", "Pizzas", 1, mais(c10, 18)), escolhas: "Calabresa, Portuguesa, Borda Catupiry" },
    item("Esfiha Queijo", "Esfihas", 2, mais(c10, 6)),
  ],
});
const outraHora = pedido({ createdAt: c11, kdsProductionAt: c11, itens: [item("Esfiha Carne", "Esfihas", 1, mais(c11, 7))] });
const porHora = temposDoRelatorio([rapido, lento, outraHora], cfg()).producao.porHora;
const as20 = porHora.find((x) => x.hora === 20)!;
confere("duas horas, na ordem do expediente", porHora.map((x) => x.hora), [20, 21]);
confere("o tempo do pedido é o do ÚLTIMO item pronto (18, não 6); média dos pedidos = 11",
  [as20.pedidos, as20.mediaDoPedido, as20.maisDemorado?.minutos, as20.maisRapido?.minutos], [2, 11, 18, 4]);
confere("o mais demorado diz qual pedido, a hora e o sabor",
  [as20.maisDemorado?.numero, as20.maisDemorado?.entrada, as20.maisDemorado?.itens[0].escolhas],
  [lento.numero, "20:40", "Calabresa, Portuguesa, Borda Catupiry"]);
confere("a lista vem do mais demorado ao mais rápido", as20.lista.map((p) => p.id), [lento.id, rapido.id]);
const soEsfiha = temposDoRelatorio([lento], cfg({ categorias: new Set(["Esfihas"]) })).producao.porHora[0];
confere("com filtro de categoria, o pedido conta só os itens do filtro (a esfiha, 6 min)", soEsfiha.maisDemorado?.minutos, 6);
confere("limite por hora: a lista corta, o mais rápido continua", (() => {
  const x = temposDoRelatorio([rapido, lento], cfg({ limitePorHora: 1 })).producao.porHora[0];
  return [x.lista.length, x.maisRapido?.id];
})(), [1, rapido.id]);

console.log("\n13) Produção e finalização: a montagem e o forno (NIK, 09/10/2026)");
// NIK #125 de 09/10/2026: entrou 04:54:57, montagem pronta 04:57:03 (o
// prontoEm do item), forno — a baixa da tela de finalização — 05:00:09
// (readyAt/kdsFinishedAt). O relatório mostrava os 2 min da montagem como se
// fossem o preparo inteiro: "esses tempos aí está só de montagem".
const c12 = h("2026-10-09 04:54");
const nik125 = pedido({
  canal: "IFOOD", createdAt: c12, kdsProductionAt: c12, kdsFinishingAt: mais(c12, 2.1), readyAt: mais(c12, 5.2), kdsFinishedAt: mais(c12, 5.2),
  telasProntas: ["fim-esfiha"],
  itens: [{ ...item("Combo 1", "Combos Esfihas", 1, mais(c12, 2.1)), id: "i-combo" }],
});
const e12 = etapasDoPedido(nik125);
confere("cozinha 5,2 = produção 2,1 (até o último pronto) + finalização 3,1 (até a baixa do forno)",
  [e12.cozinha, e12.producao, e12.finalizacao], [{ aplica: true, minutos: 5.2 }, { aplica: true, minutos: 2.1 }, { aplica: true, minutos: 3.1 }]);
confere("pedido que não passou pelo KDS (pronto pelo painel) não tem produção nem finalização",
  [etapasDoPedido(site).producao, etapasDoPedido(site).finalizacao], [{ aplica: false }, { aplica: false }]);
const soMontado = pedido({ createdAt: c12, kdsProductionAt: c12, itens: [{ ...item("Esfiha Carne", "Esfihas", 2, mais(c12, 3)), id: "i-x" }] });
confere("montado e ainda não finalizado: produção 3, finalização sem carimbo (não zero)",
  [etapasDoPedido(soMontado).producao, etapasDoPedido(soMontado).finalizacao], [{ aplica: true, minutos: 3 }, { aplica: true, minutos: null, motivo: "semCarimbo" }]);
confere("no relatório: produção e finalização só com quem passou pelo KDS (iFood 4/4,5; mesa 3/2; madrugada 6/14)",
  rel.etapas.filter((e) => e.chave === "producao" || e.chave === "finalizacao").map((e) => [e.chave, e.elegiveis, e.medidos, e.mediana, e.maximo, e.dentroDaCozinha]),
  [["producao", 3, 3, 4, 6, true], ["finalizacao", 3, 3, 4.5, 14, true]]);

console.log("\n14) Medir até: o percurso completo e cada tela (a montagem e o forno por produto)");
const MONT = "mont-esfiha", FORNO = "forno-esfiha", FORNO_PIZZA = "forno-pizza";
// As telas da NIK: montagem e forno, de esfiha e de pizza. A bebida não está em nenhuma.
const TELAS: TelaParaTempos[] = [
  { chave: MONT, estagio: "production", categorias: ["Esfihas"] },
  { chave: "mont-pizza", estagio: "production", categorias: ["Pizzas"] },
  { chave: FORNO, estagio: "finishing", categorias: ["Esfihas"] },
  { chave: FORNO_PIZZA, estagio: "finishing", categorias: ["Pizzas"] },
];
const c13 = h("2026-10-09 20:00");
const misto = pedido({
  createdAt: c13, kdsProductionAt: c13, readyAt: mais(c13, 15), kdsFinishedAt: mais(c13, 15), telasProntas: [FORNO, FORNO_PIZZA],
  itens: [
    { ...item("Esfiha Carne", "Esfihas", 10, mais(c13, 3)), id: "e1" },
    { ...item("Pizza Grande", "Pizzas", 1, mais(c13, 8)), id: "p1" },
    { ...item("Coca Cola 2l", "Bebidas", 1, null), id: "b1" },
  ],
  baixas: [
    { tela: MONT, estagio: "production", em: mais(c13, 3), itens: ["e1"] },
    { tela: "mont-pizza", estagio: "production", em: mais(c13, 8), itens: ["p1"] },
    { tela: FORNO, estagio: "finishing", em: mais(c13, 10), itens: ["e1"] },
    { tela: FORNO_PIZZA, estagio: "finishing", em: mais(c13, 15), itens: ["p1"] },
  ],
});
const producaoAte = (medirAte: ConfigDosTempos["medirAte"], pedidos: PedidoParaTempos[] = [misto], telas: TelaParaTempos[] = TELAS) =>
  temposDoRelatorio(pedidos, cfg({ medirAte, telas })).producao;
const COMPLETO: ConfigDosTempos["medirAte"] = { tipo: "completo" };
const porCategoria = (pr: ReturnType<typeof producaoAte>) => pr.categorias.map((c) => [c.nome, c.mediana]);
const fornoEsfiha: ConfigDosTempos["medirAte"] = { tipo: "tela", chave: FORNO, nome: "Forno Esfiha", estagio: "finishing", categorias: ["Esfihas"] };
const montagem: ConfigDosTempos["medirAte"] = { tipo: "tela", chave: MONT, nome: "Montagem", estagio: "production", categorias: ["Esfihas"] };
confere("pronto da produção (o padrão): esfiha 3, pizza 8, a coca sem pronto",
  [porCategoria(producaoAte(undefined)), producaoAte(undefined).semPronto], [[["Esfihas", 3], ["Pizzas", 8]], 1]);
confere("percurso completo: a esfiha até o forno dela (10), a pizza até o dela (15); a coca, que nenhuma tela mostrou, fica de fora",
  (() => { const pr = producaoAte(COMPLETO); return [porCategoria(pr), pr.semPronto]; })(), [[["Esfihas", 10], ["Pizzas", 15]], 1]);
confere("a tela do forno da esfiha: só a esfiha, até a baixa dela (10)", porCategoria(producaoAte(fornoEsfiha)), [["Esfihas", 10]]);
confere("a tela da montagem: só o que ela mostrou (a esfiha, 3)", porCategoria(producaoAte(montagem)), [["Esfihas", 3]]);
confere("tela que não deu baixa neste pedido: nada medido",
  porCategoria(producaoAte({ tipo: "tela", chave: "outra", nome: "Outra", estagio: "finishing", categorias: [] })), []);
confere("por hora, o pedido vai até o último item no modo escolhido (15 na finalização, 8 na produção)",
  [producaoAte(COMPLETO).porHora[0].maisDemorado?.minutos, producaoAte(undefined).porHora[0].maisDemorado?.minutos], [15, 8]);
confere("o pedido mostra cada tela com os minutos desde a entrada, e a montagem separada (8 de 15)",
  (() => { const x = producaoAte(COMPLETO).porHora[0]; return [x.maisDemorado?.passos.map((s) => `${s.estagio}:${s.minutos}`), x.maisDemorado?.producao, x.mediaDaProducao]; })(),
  [["production:3", "production:8", "finishing:10", "finishing:15"], 8, 8]);

// Antes do registro das baixas (até 09/10/2026) só há o pronto do item e a
// hora em que o pedido foi finalizado.
const antigoSo = pedido({
  createdAt: c13, kdsProductionAt: c13, readyAt: mais(c13, 6), kdsFinishedAt: mais(c13, 6), telasProntas: [FORNO],
  itens: [{ ...item("Esfiha Carne", "Esfihas", 10, mais(c13, 3)), id: "e2" }],
});
const antigoMisto = pedido({
  createdAt: c13, kdsProductionAt: c13, readyAt: mais(c13, 15), kdsFinishedAt: mais(c13, 15), telasProntas: [FORNO, FORNO_PIZZA],
  itens: [{ ...item("Esfiha Carne", "Esfihas", 10, mais(c13, 3)), id: "e3" }, { ...item("Pizza Grande", "Pizzas", 1, mais(c13, 8)), id: "p3" }],
});
confere("sem o registro: a finalização é a do pedido inteiro (esfihas 6 e 15 → mediana 10,5; pizza 15)",
  porCategoria(producaoAte(COMPLETO, [antigoSo, antigoMisto])), [["Esfihas", 10.5], ["Pizzas", 15]]);
confere("sem o registro e sem as telas da loja: quem entrou na finalização vai até ela; quem não entrou, até a montagem",
  porCategoria(producaoAte(COMPLETO, [{ ...antigoSo, kdsFinishingAt: mais(c13, 3) }, { ...antigoMisto, id: "sem-fin" }], [])),
  [["Esfihas", 4.5], ["Pizzas", 8]]);
confere("sem o registro: a tela de finalização só é medida no pedido em que foi a única a dar baixa (6); no misto, ninguém",
  (() => { const pr = producaoAte(fornoEsfiha, [antigoSo, antigoMisto]); return [porCategoria(pr), pr.semPronto]; })(), [[["Esfihas", 6]], 2]);
confere("sem o registro: a tela de produção mede pelo pronto do item, só nas categorias dela (esfiha 3, pizza fora)",
  (() => { const pr = producaoAte(montagem, [antigoMisto]); return [porCategoria(pr), pr.semPronto]; })(), [[["Esfihas", 3]], 1]);
confere("o rótulo do 'medir até'", [rotuloDoMedirAte(undefined), rotuloDoMedirAte(COMPLETO), rotuloDoMedirAte(fornoEsfiha)],
  ["o pronto da produção (só a montagem)", "a última tela do KDS (o percurso completo: montagem + finalização)", "a baixa da tela «Forno Esfiha»"]);

console.log("\n15) O percurso completo não inventa (NIK, 09/10/2026)");
// #166: duas pizzas GRANDE, montagem às 23:11 (10,4 min), e o pedido saiu
// pelo painel às 23:24 sem a baixa do forno. A montagem não é o percurso inteiro.
const c15 = h("2026-10-09 23:00");
const nik166 = pedido({
  createdAt: c15, kdsProductionAt: c15, kdsFinishingAt: mais(c15, 10.4), dispatchedAt: mais(c15, 24),
  itens: [{ ...item("GRANDE (8 PEDAÇOS)", "Pizzas", 1, mais(c15, 10.4)), id: "g1" }, { ...item("Coca Cola Zero 2l", "Bebidas", 1, null), id: "c1" }],
  baixas: [{ tela: "mont-pizza", nome: "Produção Pizza", estagio: "production", em: mais(c15, 10.4), itens: ["g1"] }],
});
confere("pizza que saiu sem a baixa do forno: 10,4 na montagem, sem medição no percurso completo",
  [porCategoria(producaoAte(undefined, [nik166])), porCategoria(producaoAte(COMPLETO, [nik166])), producaoAte(COMPLETO, [nik166]).semPronto],
  [[["Pizzas", 10.4]], [], 2]);
confere("loja sem forno para a esfiha: o percurso completo dela acaba na montagem",
  porCategoria(producaoAte(COMPLETO, [pedido({ createdAt: c15, kdsProductionAt: c15, itens: [{ ...item("Esfiha", "Esfihas", 1, mais(c15, 4)), id: "e9" }],
    baixas: [{ tela: MONT, estagio: "production", em: mais(c15, 4), itens: ["e9"] }] })], [TELAS[0]])),
  [["Esfihas", 4]]);
// #83, #137, #138: Coca, água e "Cx 25 cm" no balcão, dados por prontos no
// painel 50 a 65 min depois — eram o "mais demorado" da hora no percurso completo.
const soCoca = pedido({ tipo: "RETIRADA", canal: "PDV", createdAt: c15, readyAt: mais(c15, 50), itens: [{ ...item("Coca Cola Zero 1,5l", "Bebidas", 1, null), id: "c2" }] });
const soCaixa = pedido({ tipo: "RETIRADA", canal: "PDV", createdAt: c15, readyAt: mais(c15, 65), itens: [{ ...item("Cx 25 cm", "Embalagens", 1, null), id: "x1" }] });
confere("pedido que nenhuma tela mostraria não foi para a cozinha (sem 'na cozinha'; o total na loja continua)",
  [foiParaACozinha(soCoca, TELAS), etapasDoPedido(soCoca, TELAS).cozinha, etapasDoPedido(soCoca, TELAS).totalNaLoja],
  [false, { aplica: false }, { aplica: true, minutos: 50 }]);
confere("…e não entra na produção, nem na etapa 'na cozinha'",
  [producaoAte(COMPLETO, [soCoca, soCaixa]).porHora.length, temposDoRelatorio([soCoca, soCaixa], cfg({ telas: TELAS })).etapas.find((e) => e.chave === "cozinha")?.elegiveis], [0, 0]);
confere("sem as telas da loja, o pronto do painel continua valendo como cozinha",
  [foiParaACozinha(soCoca, []), etapasDoPedido(soCoca).cozinha], [true, { aplica: true, minutos: 50 }]);
confere("item sem categoria aparece em toda tela: o pedido foi para a cozinha",
  foiParaACozinha(pedido({ createdAt: c15, itens: [{ ...item("Coisa do iFood", "Outros", 1, null), semCategoria: true }] }), TELAS), true);

console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
