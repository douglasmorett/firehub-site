/**
 * As regras do perfil da loja (lib/perfil-da-loja/regras.ts): status da
 * atividade, estado de cada recurso, oportunidades, ativação e o relatório da
 * carteira. E o canal da linha agrupada do banco (lib/perfil-da-loja/no-banco.ts).
 *
 *   DATABASE_URL=postgresql://x@localhost:1/x npx tsx scripts/teste-perfil-da-loja.ts
 */
import {
  csvDaCarteira, montarPerfil, oportunidadesDaLoja, passosDaAtivacao, recursosDaLoja, relatorioDaCarteira, resumirPerfil, statusDaAtividade,
  type PrecosDeTabela, type SinaisDaLoja, type VendasDoCanal,
} from "../src/lib/perfil-da-loja/regras";
import { canalDaLinha, janelasDaLoja } from "../src/lib/perfil-da-loja/janelas";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — veio ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`}`);
};

const AGORA = new Date("2026-10-18T15:00:00.000Z");
const diasAtras = (d: number) => new Date(AGORA.getTime() - d * 86_400_000).toISOString();
const j = (vendas: number, valor = vendas * 50) => ({ vendas, valor });
const canal = (c: VendasDoCanal["canal"], d30: number, ant = d30, d7 = Math.round((d30 * 7) / 30)): VendasDoCanal =>
  ({ canal: c, d7: j(d7), d30: j(d30), d30Anterior: j(ant) });
const PRECOS: PrecosDeTabela = { bill: 49.9, appDaLoja: 149, totem: 100, trafego: 216.67, multimarcas: 97 };

function loja(extra: Partial<SinaisDaLoja> = {}): SinaisDaLoja {
  return {
    id: "l1", nome: "Loja Teste", dono: "Dono", cidade: "Curitiba", telefone: "41999990000", email: "a@b.c", slug: "loja", logo: null,
    criadaEm: diasAtras(200), testeAte: diasAtras(185), isenta: false, motivoDaIsencao: null, soDelivery: false,
    vendedor: null, embaixador: null, lojasNaConta: 0,
    vendasPorCanal: [], ultimaVendaEm: diasAtras(0),
    entregas30: 0, entregasComMotoboy30: 0, pagosOnlineNoCanalProprio30: 0, comCashback30: 0, comCupom30: 0, passaramNoKds30: 0, comNotaFiscal30: 0, impressos30: 0,
    produtos: 40, categorias: 6,
    roboConfigurado: false, respostasDoRobo30: 0, conversasDoRobo30: 0, usosDeIa30: 0,
    integracoes: { ifood: false, food99: false, keeta: false, cardapioweb: false, jotaja: false, brendi: false },
    mesas: 0, garcons: 0, contasDeMesa30: 0, kdsConfigurado: false, assistenteVistoEm: diasAtras(0), motoboys: 0, aparelhosDoEntregador: 0,
    contingenciaConfigurada: false, contingenciaUsada30: 0,
    caixas30: 0, lancamentosFinanceiros30: 0, itensDeEstoque: 0, fichasTecnicas: 0, movimentosDeEstoque30: 0, fiscalConfigurado: false,
    firecheckLigado: false, descartesDoFirecheck30: 0,
    fidelidade: { cashback: false, carimbos: false, trilha: false }, cuponsAtivos: 0, clientesNaBase: 0, avaliacoes30: 0,
    bill: { ativo: false, valorMensal: null, usos30: 0 },
    appDaLoja: { ativo: false, valorMensal: null, pedidos30: 0, aparelhos: 0 },
    totem: { licencasAtivas: 0, valorMensal: null },
    trafego: { ativo: false, valorMensal: null, campanhasAtivas: 0 },
    multimarcas: { ativo: false, valorMensal: null },
    disparo: { conectado: false, campanhas30: 0, saldo: null },
    pagamentoOnlineLigado: false, acompanhamentoIfood: false,
    mensalidade: { mes: "2026-10", valorDoMes: 120, situacaoDoMes: "em andamento", emAberto: null },
    ultimoSinalDoPainel: null,
    ...extra,
  };
}
const st = (e: Parameters<typeof statusDaAtividade>[0]) => statusDaAtividade(e, AGORA).status;
const base = { criadaEm: diasAtras(200), testeAte: diasAtras(185) };

console.log("\n— Status da atividade —");
confere("em teste (trialEndsAt no futuro) = NOVA, mesmo vendendo", st({ ...base, testeAte: diasAtras(-5), ultimaVendaEm: diasAtras(0), d7: j(30), d30: j(80), d30Anterior: j(0) }), "NOVA");
confere("sem trialEndsAt e cadastro há 10 dias = NOVA", st({ criadaEm: diasAtras(10), testeAte: null, ultimaVendaEm: null, d7: j(0), d30: j(0), d30Anterior: j(0) }), "NOVA");
confere("sem trialEndsAt e cadastro há 20 dias, nunca vendeu = PARADA", st({ criadaEm: diasAtras(20), testeAte: null, ultimaVendaEm: null, d7: j(0), d30: j(0), d30Anterior: j(0) }), "PARADA");
confere("saiu do teste e nunca vendeu = PARADA", st({ ...base, ultimaVendaEm: null, d7: j(0), d30: j(0), d30Anterior: j(0) }), "PARADA");
confere("7 dias sem venda = PARADA", st({ ...base, ultimaVendaEm: diasAtras(7), d7: j(0), d30: j(40), d30Anterior: j(60) }), "PARADA");
confere("6 dias sem venda, loja pequena estável = ATIVA", st({ ...base, ultimaVendaEm: diasAtras(6), d7: j(1), d30: j(8), d30Anterior: j(8) }), "ATIVA");
confere("queda para 70% (70 contra 100) = ESFRIANDO", st({ ...base, ultimaVendaEm: diasAtras(0), d7: j(16), d30: j(70), d30Anterior: j(100) }), "ESFRIANDO");
confere("queda para 71% (71 contra 100) = ATIVA", st({ ...base, ultimaVendaEm: diasAtras(0), d7: j(17), d30: j(71), d30Anterior: j(100) }), "ATIVA");
confere("queda grande mas base < 20 (5 contra 19) = ATIVA", st({ ...base, ultimaVendaEm: diasAtras(1), d7: j(1), d30: j(5), d30Anterior: j(19) }), "ATIVA");
confere("semana fraca (7 vendas, média 14/semana) = ESFRIANDO", st({ ...base, ultimaVendaEm: diasAtras(0), d7: j(7), d30: j(60), d30Anterior: j(60) }), "ESFRIANDO");
confere("semana com 8 de média 14 = ATIVA", st({ ...base, ultimaVendaEm: diasAtras(0), d7: j(8), d30: j(60), d30Anterior: j(60) }), "ATIVA");
confere("vendia 3/dia e 3 dias sem venda = ESFRIANDO", st({ ...base, ultimaVendaEm: diasAtras(3), d7: j(20), d30: j(90), d30Anterior: j(90) }), "ESFRIANDO");
confere("vendia 1/dia e 3 dias sem venda = ATIVA", st({ ...base, ultimaVendaEm: diasAtras(3), d7: j(4), d30: j(30), d30Anterior: j(30) }), "ATIVA");
confere("motivo da queda diz a % e os números",
  statusDaAtividade({ ...base, ultimaVendaEm: diasAtras(0), d7: j(10), d30: j(50), d30Anterior: j(100) }, AGORA).motivo,
  "Vendas caíram 50% — 50 nos últimos 30 dias contra 100 nos 30 anteriores.");
confere("motivo de ATIVA traz a tendência", statusDaAtividade({ ...base, ultimaVendaEm: diasAtras(0), d7: j(30), d30: j(120), d30Anterior: j(100) }, AGORA).motivo,
  "120 vendas em 30 dias (+20% contra os 30 dias anteriores).");

console.log("\n— Recursos —");
const r = (s: SinaisDaLoja, chave: string) => recursosDaLoja(s, AGORA).find((x) => x.chave === chave)!;
confere("robô configurado sem resposta = PARADO", r(loja({ roboConfigurado: true }), "robo").estado, "PARADO");
confere("robô com respostas = USANDO, com a evidência",
  [r(loja({ roboConfigurado: true, respostasDoRobo30: 230, conversasDoRobo30: 41, vendasPorCanal: [canal("WHATSAPP_IA", 12)] }), "robo").estado,
   r(loja({ roboConfigurado: true, respostasDoRobo30: 230, conversasDoRobo30: 41, vendasPorCanal: [canal("WHATSAPP_IA", 12)] }), "robo").evidencia],
  ["USANDO", "Conectado · 41 conversas, 230 respostas enviadas e 12 vendas fechadas pelo robô em 30 dias."]);
confere("robô nunca configurado = NUNCA", r(loja(), "robo").estado, "NUNCA");
confere("estoque vazio = NUNCA com 'nenhum item'", [r(loja(), "estoque").estado, r(loja(), "estoque").evidencia], ["NUNCA", "Nenhum item de estoque cadastrado."]);
confere("estoque com itens e sem movimento = PARADO", r(loja({ itensDeEstoque: 30 }), "estoque").estado, "PARADO");
confere("iFood ligado sem pedido = PARADO", r(loja({ integracoes: { ...loja().integracoes, ifood: true } }), "ifood").estado, "PARADO");
confere("iFood com pedido = USANDO", r(loja({ vendasPorCanal: [canal("IFOOD", 300)] }), "ifood").estado, "USANDO");
confere("cardápio sem produto = NUNCA", r(loja({ produtos: 0 }), "cardapio").estado, "NUNCA");
confere("cardápio com produto e sem venda no site = PARADO", r(loja(), "cardapio").estado, "PARADO");
confere("Assistente visto há 1 dia = USANDO", r(loja({ assistenteVistoEm: diasAtras(1) }), "impressao").estado, "USANDO");
confere("Assistente visto há 5 dias = PARADO", r(loja({ assistenteVistoEm: diasAtras(5) }), "impressao").estado, "PARADO");
confere("Assistente nunca = NUNCA", r(loja({ assistenteVistoEm: null }), "impressao").estado, "NUNCA");
confere("contingência preparada sem uso = LIGADO (não há o que medir)", r(loja({ contingenciaConfigurada: true }), "contingencia").estado, "LIGADO");
confere("Bill pago traz o valor", r(loja({ bill: { ativo: true, valorMensal: 49.9, usos30: 12 } }), "bill").pago, { contratado: true, valorMensal: 49.9 });
confere("27 recursos no perfil", recursosDaLoja(loja(), AGORA).length, 27);

console.log("\n— Oportunidades —");
const chaves = (s: SinaisDaLoja, status: "ATIVA" | "ESFRIANDO" | "PARADA" | "NOVA" = "ATIVA") =>
  oportunidadesDaLoja(s, status, recursosDaLoja(s, AGORA), PRECOS).map((o) => o.chave as string);

const ifoodPesado = loja({ vendasPorCanal: [canal("IFOOD", 300), canal("SITE", 0)], entregas30: 300 });
const opIfood = oportunidadesDaLoja(ifoodPesado, "ATIVA", recursosDaLoja(ifoodPesado, AGORA), PRECOS);
confere("300 no iFood e 0 no site → App da loja em 1º", opIfood[0].chave, "APP_DA_LOJA");
confere("…com o motivo nos números", opIfood[0].motivo, "Vende 300 pedidos/mês em marketplace (100%, mais no iFood) e só 0 no canal próprio.");
confere("…e o valor de tabela do App", opIfood[0].valorMensal, 149);
confere("…e também cardápio próprio, robô e app do entregador",
  ["CARDAPIO_PROPRIO", "ROBO", "APP_DO_ENTREGADOR"].every((c) => opIfood.some((o) => o.chave === c)), true);
confere("99 no iFood não chega no App (mínimo 100)", chaves(loja({ vendasPorCanal: [canal("IFOOD", 99)] })).includes("APP_DA_LOJA"), false);
confere("iFood 100 mas só 40% das vendas → sem App por marketplace",
  chaves(loja({ vendasPorCanal: [canal("IFOOD", 100), canal("PDV", 150)] })).includes("APP_DA_LOJA"), false);
confere("canal próprio forte (150 site+robô) → App",
  chaves(loja({ vendasPorCanal: [canal("SITE", 100), canal("WHATSAPP_IA", 50)], pagamentoOnlineLigado: true })).includes("APP_DA_LOJA"), true);
confere("já tem o App → não oferece de novo",
  chaves(loja({ vendasPorCanal: [canal("IFOOD", 300)], appDaLoja: { ativo: true, valorMensal: 149, pedidos30: 0, aparelhos: 3 } })).includes("APP_DA_LOJA"), false);

const faturaAlto = loja({ vendasPorCanal: [canal("PDV", 400)].map((c) => ({ ...c, d30: j(400, 32_000), d30Anterior: j(400, 32_000) })) });
confere("fatura R$ 32 mil sem estoque → ESTOQUE e BILL",
  ["ESTOQUE", "BILL"].every((c) => chaves(faturaAlto).includes(c)), true);
confere("fatura R$ 32 mil, já com estoque e financeiro em uso → sem BILL nem ESTOQUE",
  chaves({ ...faturaAlto, itensDeEstoque: 50, movimentosDeEstoque30: 200, lancamentosFinanceiros30: 15 }).some((c) => c === "BILL" || c === "ESTOQUE"), false);
confere("Bill já assinado → não oferece", chaves({ ...faturaAlto, bill: { ativo: true, valorMensal: 49.9, usos30: 3 } }).includes("BILL"), false);
confere("60 vendas sem fidelidade → FIDELIDADE", chaves(loja({ vendasPorCanal: [canal("PDV", 60)] })).includes("FIDELIDADE"), true);
confere("60 vendas com cashback → sem FIDELIDADE",
  chaves(loja({ vendasPorCanal: [canal("PDV", 60)], fidelidade: { cashback: true, carimbos: false, trilha: false } })).includes("FIDELIDADE"), false);
confere("300 clientes na base → DISPARO", chaves(loja({ clientesNaBase: 300 })).includes("DISPARO"), true);
confere("299 clientes → sem DISPARO", chaves(loja({ clientesNaBase: 299 })).includes("DISPARO"), false);
confere("200 de balcão → TOTEM", chaves(loja({ vendasPorCanal: [canal("PDV", 200)] })).includes("TOTEM"), true);
confere("200 de balcão mas só delivery → sem TOTEM", chaves(loja({ soDelivery: true, vendasPorCanal: [canal("PDV", 200)] })).includes("TOTEM"), false);
confere("2 lojas na conta → MULTIMARCAS", chaves(loja({ lojasNaConta: 1 })).includes("MULTIMARCAS"), true);
confere("2 lojas na conta com App completo (197, cortesia) → sem MULTIMARCAS", chaves(loja({ lojasNaConta: 1, appDaLoja: { ativo: true, valorMensal: 197, pedidos30: 0, aparelhos: 0 } })).includes("MULTIMARCAS"), false);
confere("40 entregas sem app do entregador → APP_DO_ENTREGADOR", chaves(loja({ entregas30: 40 })).includes("APP_DO_ENTREGADOR"), true);
confere("40 entregas com motoboy no app → nada", chaves(loja({ entregas30: 40, aparelhosDoEntregador: 2 })).includes("APP_DO_ENTREGADOR"), false);
confere("CardápioWeb vendendo e 0 no site → CARDAPIO_PROPRIO com o motivo do CardápioWeb",
  oportunidadesDaLoja(loja({ vendasPorCanal: [canal("CARDAPIOWEB", 80)] }), "ATIVA", recursosDaLoja(loja({ vendasPorCanal: [canal("CARDAPIOWEB", 80)] }), AGORA), PRECOS)
    .find((o) => o.chave === "CARDAPIO_PROPRIO")!.motivo,
  "Vende 80 pedidos/mês pelo CardápioWeb e nenhum pelo cardápio do FireHub.");
confere("site vende 25 e loja esfriando → TRAFEGO", chaves(loja({ vendasPorCanal: [canal("SITE", 25)] }), "ESFRIANDO").includes("TRAFEGO"), true);
confere("loja PARADA não recebe oferta", chaves(ifoodPesado, "PARADA"), []);
confere("loja NOVA só recebe adoção", oportunidadesDaLoja(ifoodPesado, "NOVA", recursosDaLoja(ifoodPesado, AGORA), PRECOS).every((o) => o.tipo === "ADOCAO"), true);
confere("lista sai ordenada por prioridade", opIfood.map((o) => o.prioridade).every((p, i, a) => i === 0 || a[i - 1] >= p), true);

console.log("\n— Ativação (teste) —");
const nova = loja({ testeAte: diasAtras(-6), produtos: 3, assistenteVistoEm: null, vendasPorCanal: [canal("SITE", 2)] });
confere("passos feitos/faltando", passosDaAtivacao(nova, AGORA).map((p) => `${p.chave}:${p.feito ? 1 : 0}`), ["cardapio:0", "canal:0", "impressao:0", "primeira:1", "ativada:0"]);
const pNova = montarPerfil(nova, PRECOS, AGORA);
confere("perfil da NOVA traz a ativação e o resumo o que falta", [pNova.atividade.status, resumirPerfil(pNova).ativacaoFalta.length], ["NOVA", 4]);

console.log("\n— Perfil e carteira —");
const ativa = montarPerfil(loja({ id: "a", nome: "Ativa", vendasPorCanal: [canal("IFOOD", 300, 280), canal("SITE", 40, 40)], entregas30: 340 }), PRECOS, AGORA);
confere("canais em % (somam 100)", ativa.atividade.canais.map((c) => [c.nome, c.pct]), [["iFood", 88.2], ["Cardápio digital", 11.8]]);
confere("tendência +6%", ativa.atividade.tendenciaPct, 6);
confere("ticket médio = valor ÷ vendas", ativa.atividade.ticketMedio30, 50);
const esfriando = montarPerfil(loja({ id: "e", nome: "Esfriando", vendasPorCanal: [canal("SITE", 50, 120)] }), PRECOS, AGORA);
const parada = montarPerfil(loja({ id: "p", nome: "Parada", ultimaVendaEm: diasAtras(12), vendasPorCanal: [canal("IFOOD", 0, 200, 0)] }), PRECOS, AGORA);
const nunca = montarPerfil(loja({ id: "n", nome: "Nunca", ultimaVendaEm: null, vendasPorCanal: [] }), PRECOS, AGORA);
const rel = relatorioDaCarteira([ativa, esfriando, parada, nunca, pNova].map(resumirPerfil));
confere("status da carteira", rel.porStatus, { ATIVA: 1, ESFRIANDO: 1, PARADA: 2, NOVA: 1 });
confere("risco: a maior perda primeiro, nunca vendeu no fim", rel.emRisco.map((l) => l.id), ["p", "e", "n"]);
confere("ranking por faturamento", rel.ranking.map((l) => l.id), ["a", "e", "l1"]);
const app = rel.oportunidadesPorProduto.find((g) => g.chave === "APP_DA_LOJA");
confere("oportunidade agrupada por produto, com potencial", app && [app.lojas, app.potencialMensal], [1, 149]);
confere("serviços de venda antes dos de adoção", rel.oportunidadesPorProduto[0].tipo, "VENDA");
const csv = csvDaCarteira([ativa, nunca].map(resumirPerfil));
confere("CSV com BOM, ; e vírgula decimal", [csv.charCodeAt(0) === 0xfeff, csv.split("\r\n").length, csv.split("\r\n")[1].includes(";17000,00;")], [true, 3, true]);

console.log("\n— Canal da linha agrupada (banco) —");
const lin = (src: string, extra: Partial<{ od: string; ifood: boolean; tem_od: boolean; cw: boolean }> = {}) =>
  canalDaLinha({ src, od: "", ifood: false, tem_od: false, cw: false, ...extra });
confere("mesa", lin("MESA"), "MESA");
confere("iFood pelo id", lin("ONLINE", { ifood: true }), "IFOOD");
confere("99 pelo canal do Open Delivery", lin("OPEN_DELIVERY", { od: "99FOOD", tem_od: true }), "99FOOD");
confere("CardápioWeb pelo prefixo do id", lin("", { tem_od: true, cw: true }), "CARDAPIOWEB");
confere("balcão (PRESENCIAL)", lin("PRESENCIAL"), "PDV");
confere("site (ONLINE)", lin("ONLINE"), "SITE");
confere("robô", lin("WHATSAPP_IA"), "WHATSAPP_IA");

console.log("\n— Janelas (dia operacional) —");
const jj = janelasDaLoja("America/Sao_Paulo", AGORA);
confere("30 dias = 30 dias operacionais, virando às 5h de Brasília (08:00Z)", [jj.i30.toISOString(), jj.fim.toISOString()], ["2026-09-19T08:00:00.000Z", "2026-10-19T08:00:00.000Z"]);
confere("30 anteriores começam 30 dias antes", jj.iAnt.toISOString(), "2026-08-20T08:00:00.000Z");
confere("7 dias", jj.i7.toISOString(), "2026-10-12T08:00:00.000Z");

console.log(falhas ? `\n❌ ${falhas} falha(s)` : "\n✅ Tudo certo");
process.exit(falhas ? 1 : 0);
