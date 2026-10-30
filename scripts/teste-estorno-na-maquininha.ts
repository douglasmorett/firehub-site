/**
 * Prova da regra do estorno automático na maquininha Cielo
 * (lib/estorno-na-maquininha-regras.ts): quando o cancelamento manda estorno,
 * o que vai no deeplink, a idempotência do resultado e o texto do card.
 *
 *   npx tsx scripts/teste-estorno-na-maquininha.ts
 *
 * A leitura da resposta da Cielo é do app (CobradorCielo.interpretarEstorno);
 * aqui está a metade do servidor.
 */
import {
  appFazEstorno,
  dadosDoEstorno,
  ENTREGAS_ATE_DESISTIR,
  estornoAutomatico,
  ehRespostaDoApp,
  proximaSituacao,
  SITUACOES_DO_ESTORNO as S,
  textoDoEstorno,
} from "../src/lib/estorno-na-maquininha-regras";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

const pagoNaCielo = {
  gatewayProvider: "CIELO_APP", paymentPaidAt: new Date(), paymentMethod: "Cartão CREDITO (maquininha)",
};

console.log("\n— Quando o cancelamento manda o estorno —");
confere("totem pago na maquininha Cielo: estorna sozinho", estornoAutomatico(pagoNaCielo), true);
confere("pago na Stone: não (aviso manual)", estornoAutomatico({ ...pagoNaCielo, gatewayProvider: "STONE_APP" }), false);
confere("Cielo sem o carimbo de pago: não (nada foi cobrado)", estornoAutomatico({ ...pagoNaCielo, paymentPaidAt: null }), false);
confere("Pix pelo site (Asaas): não, é o estorno do Asaas", estornoAutomatico({ ...pagoNaCielo, gatewayProvider: "asaas" }), false);
confere("cartão a cobrar no balcão: não", estornoAutomatico({ gatewayProvider: null, paymentPaidAt: null, paymentMethod: "Cartão Crédito" }), false);
confere("app 1.0.6 estorna", appFazEstorno("1.0.6"), true);
confere("app 1.1.0 estorna", appFazEstorno("1.1.0"), true);
confere("app 1.0.5 não (ignora o campo)", appFazEstorno("1.0.5"), false);
confere("sem versão gravada: não", appFazEstorno(null), false);
confere("versão ilegível: não", appFazEstorno("dev"), false);

console.log("\n— O que vai no deeplink (do comprovante do aprovado) —");
const comprovante = {
  terminal: "Totem do balcão", provedor: "CIELO_APP", autorizacao: "123456", nsu: "999",
  idsDaAdquirente: { cieloCode: "CC77", orderId: "ord-cielo-1", produto: "CREDITO" },
};
confere("ordem, cieloCode, autorização e valor em centavos", dadosDoEstorno(comprovante, 54.9), {
  ok: true, dados: { valorCentavos: 5490, ordem: "ord-cielo-1", cieloCode: "CC77", autorizacao: "123456" },
});
confere("centavo quebrado arredonda (19,99)", (dadosDoEstorno(comprovante, 19.99) as any).dados.valorCentavos, 1999);
confere("sem o id da ordem da Cielo: não dá, com motivo",
  dadosDoEstorno({ ...comprovante, idsDaAdquirente: { cieloCode: "CC77" } }, 10),
  { ok: false, motivo: "a maquininha não guardou o código da venda na Cielo" });
confere("comprovante vazio: não dá", dadosDoEstorno(null, 10).ok, false);

console.log("\n— O resultado do app (idempotente) —");
confere("na maquininha + ESTORNADO = feito", proximaSituacao(S.noTerminal, "ESTORNADO", 1), S.estornado);
confere("na maquininha + RECUSADO = recusado", proximaSituacao(S.noTerminal, "RECUSADO", 1), S.recusado);
confere("na maquininha + INCERTO = incerto", proximaSituacao(S.noTerminal, "INCERTO", 1), S.incerto);
confere("app repete o ESTORNADO: nada muda", proximaSituacao(S.estornado, "ESTORNADO", 1), null);
confere("estornado e chega um RECUSADO atrasado: continua feito", proximaSituacao(S.estornado, "RECUSADO", 1), null);
confere("app repete o RECUSADO: nada muda", proximaSituacao(S.recusado, "RECUSADO", 1), null);
confere("incerto e depois a prova do estorno: vira feito", proximaSituacao(S.incerto, "ESTORNADO", 2), S.estornado);
confere("incerto e depois recusado: fica incerto (sem prova, sem trocar)", proximaSituacao(S.incerto, "RECUSADO", 2), null);
confere("Cielo não abriu: volta para a fila", proximaSituacao(S.noTerminal, "NAO_ABRIU", 1), S.aguardando);
confere(`não abriu na ${ENTREGAS_ATE_DESISTIR}ª entrega: desiste (faça na maquininha)`,
  proximaSituacao(S.noTerminal, "NAO_ABRIU", ENTREGAS_ATE_DESISTIR), S.recusado);
confere("NAO_ABRIU repetido com o estorno já na fila: nada muda", proximaSituacao(S.aguardando, "NAO_ABRIU", 1), null);
confere("situação desconhecida do app é recusada na rota", ehRespostaDoApp("TALVEZ"), false);
confere("ESTORNADO é resposta válida", ehRespostaDoApp("ESTORNADO"), true);

console.log("\n— O card do pedido cancelado —");
confere("enviado", textoDoEstorno({ situacao: S.aguardando, terminal: "Totem 1" }),
  { texto: "↩ Estorno enviado para a maquininha (Totem 1) — aguardando", tom: "andando" });
confere("feito", textoDoEstorno({ situacao: S.estornado, terminal: "Totem 1" }).texto, "✓ Estorno feito na maquininha (Totem 1)");
confere("recusado diz o motivo e manda fazer na maquininha",
  textoDoEstorno({ situacao: S.recusado, motivo: "CANCELADO PELO USUÁRIO", terminal: "Totem 1" }).texto,
  "✕ Estorno não feito: CANCELADO PELO USUÁRIO. Faça o cancelamento da venda na maquininha (Totem 1).");
confere("incerto nunca diz que estornou", textoDoEstorno({ situacao: S.incerto }).texto.includes("feito"), false);
confere("incerto é tom de erro", textoDoEstorno({ situacao: S.incerto }).tom, "erro");

console.log(falhas ? `\n❌ ${falhas} falha(s)` : "\n✅ Tudo certo");
process.exit(falhas ? 1 : 0);
