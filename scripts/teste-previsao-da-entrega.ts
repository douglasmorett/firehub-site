/**
 * scripts/teste-previsao-da-entrega.ts — de onde sai o horário da PREVISÃO DE
 * ENTREGA que a comanda imprime no topo (lib/previsao-da-entrega.ts).
 *
 *   npx tsx scripts/teste-previsao-da-entrega.ts
 */
import { camposDaPrevisaoParaImpressao, previsaoDaEntrega, tempoDeEntregaParaGravar } from "../src/lib/previsao-da-entrega";
import { camposDeEntregaParaImpressao } from "../src/lib/entrega-parceira";

let falhas = 0;
const conferir = (nome: string, ok: boolean, detalhe?: unknown) => {
  if (ok) console.log(`  ok  ${nome}`);
  else { falhas++; console.log(`  FALHOU  ${nome}`, detalhe ?? ""); }
};

const criado = "2026-10-01T22:00:00.000Z";
const mais = (min: number) => new Date(Date.parse(criado) + min * 60_000).toISOString();

console.log("— Entrega da própria loja: criação + o tempo que o cliente viu —");
conferir("site com 40 min → 40 min depois",
  previsaoDaEntrega({ createdAt: criado, deliveryType: "DELIVERY", tempoEntregaMin: 40 })?.em === mais(40));
conferir("tipo ENTREGA",
  previsaoDaEntrega({ createdAt: criado, deliveryType: "DELIVERY", tempoEntregaMin: 40 })?.tipo === "ENTREGA");
conferir("createdAt como Date também serve",
  previsaoDaEntrega({ createdAt: new Date(criado), deliveryType: "DELIVERY", tempoEntregaMin: 40 })?.em === mais(40));
conferir("sem tempo gravado → sem linha (o papel não inventa prazo)",
  previsaoDaEntrega({ createdAt: criado, deliveryType: "DELIVERY" }) === null);
conferir("retirada não usa o tempo da área de ENTREGA",
  previsaoDaEntrega({ createdAt: criado, deliveryType: "PICKUP", tempoEntregaMin: 40 }) === null);
conferir("tempo absurdo (> 6 h) não vira prazo",
  previsaoDaEntrega({ createdAt: criado, deliveryType: "DELIVERY", tempoEntregaMin: 900 }) === null);

console.log("— Marketplace: o prazo do parceiro em scheduledDatetime —");
const ifood = previsaoDaEntrega({ createdAt: criado, deliveryType: "DELIVERY", scheduledDatetime: mais(50) });
conferir("iFood: o prazo do parceiro", ifood?.em === mais(50) && ifood?.tipo === "ENTREGA", ifood);
conferir("o prazo do parceiro vale mais que o tempo da área",
  previsaoDaEntrega({ createdAt: criado, deliveryType: "DELIVERY", scheduledDatetime: mais(50), tempoEntregaMin: 30 })?.em === mais(50));
const takeout = previsaoDaEntrega({ createdAt: criado, deliveryType: "TAKEOUT", scheduledDatetime: mais(20) });
conferir("retirada do iFood: RETIRADA", takeout?.tipo === "RETIRADA", takeout);
conferir("prazo antes da criação é lixo, não prazo",
  previsaoDaEntrega({ createdAt: criado, deliveryType: "DELIVERY", scheduledDatetime: mais(-60) }) === null);

console.log("— Agendamento de verdade: mais de 3 h depois da criação —");
const agendado = previsaoDaEntrega({ createdAt: criado, deliveryType: "DELIVERY", scheduledDatetime: mais(60 * 20) });
conferir("AGENDADO", agendado?.tipo === "AGENDADO" && agendado?.em === mais(60 * 20), agendado);

console.log("— O que não tem entrega —");
conferir("mesa", previsaoDaEntrega({ createdAt: criado, deliveryType: "MESA", tempoEntregaMin: 40 }) === null);
conferir("conta da mesa", previsaoDaEntrega({ createdAt: criado, deliveryType: "DELIVERY", tempoEntregaMin: 40, kind: "CONTA_DA_MESA" }) === null);
conferir("pedido sem data", previsaoDaEntrega({ deliveryType: "DELIVERY", tempoEntregaMin: 40 }) === null);
conferir("nada", previsaoDaEntrega(null) === null);

console.log("— Gravação do tempo —");
conferir("40 → 40", tempoDeEntregaParaGravar(40) === 40);
conferir("39,6 → 40", tempoDeEntregaParaGravar(39.6) === 40);
conferir("\"45\" → 45", tempoDeEntregaParaGravar("45") === 45);
conferir("0 → nulo", tempoDeEntregaParaGravar(0) === null);
conferir("nulo → nulo", tempoDeEntregaParaGravar(null) === null);
conferir("361 → nulo", tempoDeEntregaParaGravar(361) === null);

console.log("— O payload dos três trilhos —");
conferir("sem previsão, nem a chave (não apaga a da reimpressão no spread)",
  !("previsaoEntrega" in camposDaPrevisaoParaImpressao({ deliveryType: "DELIVERY" })));
const reimpressa = { deliveryType: "DELIVERY", previsaoEntrega: { em: mais(40), tipo: "ENTREGA" } };
conferir("reimpressão: a previsão do payload guardado sobrevive ao camposDeEntregaParaImpressao",
  ({ ...reimpressa, ...camposDeEntregaParaImpressao(reimpressa) }).previsaoEntrega?.em === mais(40));
conferir("fila da nuvem: camposDeEntregaParaImpressao leva a previsão",
  camposDeEntregaParaImpressao({ createdAt: criado, deliveryType: "DELIVERY", tempoEntregaMin: 40 }).previsaoEntrega?.em === mais(40));

console.log(falhas ? `\n${falhas} falharam` : "\nTUDO CERTO");
process.exit(falhas ? 1 : 0);
