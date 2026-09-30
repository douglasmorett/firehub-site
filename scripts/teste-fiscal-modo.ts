/**
 * Trava "Como a nota é emitida" (lib/fiscal-modo): a escolha automática ×
 * manual, a lista de formas de cada integração, o CPF/CNPJ que o pedido pede,
 * a entrega sem documento, o porquê do pedido sem nota e o resumo em frases
 * que a tela mostra — e a gravação desses campos (lib/fiscal-config).
 *
 *   npx tsx scripts/teste-fiscal-modo.ts
 *
 * Tudo puro. A emissão de verdade com esses campos (gancho, varredura,
 * retentativa) está em scripts/teste-fiscal-retentativa.ts, seção 16.
 */
import {
  documentoNaEntrega,
  documentoNoPedido,
  documentoObrigatorioNoPedido,
  entregaSemDocumento,
  formasDoCanal,
  formasEmTexto,
  lerFormasPorIntegracao,
  modoDaEmissao,
  porQueSemNota,
  resumoDaEmissao,
  DOCUMENTO_NAO_PEDIDO,
} from "../src/lib/fiscal-modo";
import { aplicarFormularioFiscal, type ConfigFiscalGravada } from "../src/lib/fiscal-config";
import { rotuloDoCampoFiscal } from "../src/lib/textos-da-tela-fiscal";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

console.log("— O modo —");
confere("sem escolha gravada é automática (como era antes)", modoDaEmissao({}), "automatico");
confere("config nula é automática", modoDaEmissao(null), "automatico");
confere("manual, com qualquer grafia", [modoDaEmissao({ modoDaEmissao: "manual" }), modoDaEmissao({ modoDaEmissao: " MANUAL " })], ["manual", "manual"]);
confere("valor desconhecido não vira manual", modoDaEmissao({ modoDaEmissao: "talvez" }), "automatico");

console.log("\n— A lista de cada canal —");
const loja = { autoEmitPaymentMethods: ["PIX", "CREDIT_CARD"] };
confere("integração sem lista própria segue as vendas da loja", formasDoCanal(loja, "IFOOD"), ["PIX", "CREDIT_CARD"]);
confere("canal próprio segue as vendas da loja", [formasDoCanal(loja, "SITE"), formasDoCanal(loja, "PDV"), formasDoCanal(loja, "MESA")], [["PIX", "CREDIT_CARD"], ["PIX", "CREDIT_CARD"], ["PIX", "CREDIT_CARD"]]);
const comIfood = { ...loja, formasPorIntegracao: { IFOOD: ["ONLINE", "MONEY"] } };
confere("integração com lista própria usa a dela", formasDoCanal(comIfood, "IFOOD"), ["ONLINE", "MONEY"]);
confere("…e só ela: o 99Food continua com a da loja", formasDoCanal(comIfood, "99FOOD"), ["PIX", "CREDIT_CARD"]);
confere("lista própria VAZIA é \"nenhuma nota\", não \"igual à loja\"", formasDoCanal({ ...loja, formasPorIntegracao: { IFOOD: [] } }, "IFOOD"), []);
confere("a chave antiga CREDITO_ONLINE vale como ONLINE", formasDoCanal({ formasPorIntegracao: { WABIZ: ["CREDITO_ONLINE"] } }, "WABIZ"), ["ONLINE"]);
confere(
  "leitura: canal desconhecido e forma inventada saem",
  lerFormasPorIntegracao({ IFOOD: ["ONLINE", "LIXO", 3], OUTRO: ["PIX"], "99FOOD": "PIX", BRENDI: [] }),
  { IFOOD: ["ONLINE"], BRENDI: [] }
);

console.log("\n— O CPF/CNPJ no pedido —");
confere("emissão desligada: o pedido não pergunta", documentoNoPedido({ enabled: false, autoEmitPaymentMethods: ["PIX"] }), DOCUMENTO_NAO_PEDIDO);
confere("manual: o pedido não pergunta (o CPF é pedido na emissão)", documentoNoPedido({ enabled: true, modoDaEmissao: "manual", cpfNaEntrega: "obrigatorio" }), DOCUMENTO_NAO_PEDIDO);
confere(
  "automática, padrão: pergunta sem obrigar",
  documentoNoPedido({ enabled: true, autoEmitPaymentMethods: ["PIX"] }),
  { perguntar: true, obrigatorioNaEntrega: false, formas: ["PIX"] }
);
confere(
  "automática + obrigatório: obriga na entrega",
  documentoNoPedido({ enabled: true, autoEmitPaymentMethods: ["PIX"], cpfNaEntrega: "obrigatorio" }).obrigatorioNaEntrega,
  true
);
confere(
  "obrigatório sem nenhuma forma marcada não obriga ninguém (nenhuma nota sairia)",
  documentoNoPedido({ enabled: true, autoEmitPaymentMethods: [], cpfNaEntrega: "obrigatorio" }).obrigatorioNaEntrega,
  false
);
confere("CPF da entrega: só \"obrigatorio\" obriga", [documentoNaEntrega({}), documentoNaEntrega({ cpfNaEntrega: "OBRIGATORIO" }), documentoNaEntrega({ cpfNaEntrega: "x" })], ["opcional", "obrigatorio", "opcional"]);
const regra = documentoNoPedido({ enabled: true, autoEmitPaymentMethods: ["PIX", "ONLINE"], cpfNaEntrega: "obrigatorio" });
confere("entrega no Pix: obrigatório", documentoObrigatorioNoPedido(regra, { deliveryType: "DELIVERY", paymentMethod: "PIX" }), true);
confere("entrega no dinheiro (sem nota automática): não obriga", documentoObrigatorioNoPedido(regra, { deliveryType: "DELIVERY", paymentMethod: "DINHEIRO" }), false);
confere("retirada no Pix: não obriga (a nota sai sem destinatário)", documentoObrigatorioNoPedido(regra, { deliveryType: "RETIRADA", paymentMethod: "PIX" }), false);
confere("entrega paga pelo site (online): obrigatório", documentoObrigatorioNoPedido(regra, { deliveryType: "DELIVERY", paymentMethod: "CREDITO_ONLINE", gatewayPaymentId: "pay_1" }), true);
confere("sem regra (loja sem fiscal): nunca obriga", documentoObrigatorioNoPedido(null, { deliveryType: "DELIVERY", paymentMethod: "PIX" }), false);

console.log("\n— A entrega sem documento —");
confere("entrega sem CPF: falta", entregaSemDocumento({ entregaEmDomicilio: true, documentoDoCliente: null }, {}), true);
confere("entrega com o 00000000000 do JotaJá: falta", entregaSemDocumento({ entregaEmDomicilio: true, documentoDoCliente: "00000000000" }, {}), true);
confere("entrega com CPF inválido NÃO é falta (vai à emissão e volta \"CPF inválido\")", entregaSemDocumento({ entregaEmDomicilio: true, documentoDoCliente: "12345678900" }, {}), false);
confere("entrega com CPF: não falta", entregaSemDocumento({ entregaEmDomicilio: true, documentoDoCliente: "52998224725" }, {}), false);
confere("retirada sem CPF: não falta", entregaSemDocumento({ entregaEmDomicilio: false, documentoDoCliente: null }, {}), false);
confere("loja que declara a entrega como presencial: não falta", entregaSemDocumento({ entregaEmDomicilio: true, documentoDoCliente: null }, { entregaComoPresencial: true }), false);

console.log("\n— Por que o pedido não tem nota —");
const auto = { enabled: true, autoEmitPaymentMethods: ["PIX"], formasPorIntegracao: { IFOOD: ["ONLINE"] }, momentoDaEmissao: "saida" };
const tipo = (config: any, pedido: any) => porQueSemNota(config, pedido)?.tipo ?? null;
confere("emissão desligada: nada a explicar", tipo({ ...auto, enabled: false }, { status: "ENTREGUE", paymentMethod: "Dinheiro" }), null);
confere("pedido cancelado: nada a explicar", tipo(auto, { status: "CANCELADO", paymentMethod: "Dinheiro" }), null);
confere("mesa: a nota é da conta", tipo(auto, { status: "ENTREGUE", tableSessionId: "s1", paymentMethod: "N/A" }), "mesa");
confere("manual", tipo({ ...auto, modoDaEmissao: "manual" }, { status: "ENTREGUE", paymentMethod: "Pix" }), "manual");
confere("dinheiro no balcão, fora da lista", tipo(auto, { status: "ENTREGUE", source: "BALCAO", paymentMethod: "Dinheiro" }), "forma");
confere(
  "a frase diz a forma e o canal",
  porQueSemNota(auto, { status: "ENTREGUE", source: "IFOOD", ifoodOrderId: "x", paymentMethod: "Pix (Cobrar na entrega)" })?.texto.startsWith("Pix não tem nota automática no iFood"),
  true
);
confere("entrega no Pix sem CPF: falta documento (mesmo antes de sair)", tipo(auto, { status: "PREPARANDO", source: "SITE", deliveryType: "DELIVERY", paymentMethod: "Pix" }), "falta_documento");
confere("entrega no Pix com CPF, na cozinha: aguardando a saída", porQueSemNota(auto, { status: "PREPARANDO", source: "SITE", deliveryType: "DELIVERY", paymentMethod: "Pix", customerCpfCnpj: "52998224725" }), { tipo: "aguardando", texto: "A nota sai sozinha quando o pedido sair para a entrega." });
confere("retirada no Pix, pronta: aguardando a conclusão", porQueSemNota(auto, { status: "PRONTO", source: "BALCAO", deliveryType: "RETIRADA", paymentMethod: "Pix" })?.texto, "A nota sai sozinha quando o pedido for concluído.");
confere("no aceite, pedido novo: aguardando o aceite", porQueSemNota({ ...auto, momentoDaEmissao: "aceite" }, { status: "NOVO", source: "BALCAO", paymentMethod: "Pix" })?.texto, "A nota sai sozinha quando a loja aceitar o pedido.");
const agora = Date.parse("2026-09-30T20:00:00-03:00");
const ligada = { ...auto, emissaoLigadaEm: "2026-09-30T18:00:00-03:00" };
const pronto = { status: "ENTREGUE", source: "BALCAO", deliveryType: "RETIRADA", paymentMethod: "Pix" };
confere(
  "retirada no Pix entregue há pouco: a automática ainda tenta (a cada 2 minutos)",
  porQueSemNota(ligada, { ...pronto, createdAt: "2026-09-30T19:30:00-03:00" }, agora),
  { tipo: "a_caminho", texto: "A nota automática ainda não saiu: o FireHub tenta de novo a cada 2 minutos. Se o cliente está esperando, emita agora." }
);
confere(
  "…há mais de 2 horas: só o fechamento do caixa confere de novo",
  porQueSemNota({ ...ligada, emissaoLigadaEm: "2026-09-30T12:00:00-03:00" }, { ...pronto, createdAt: "2026-09-30T15:00:00-03:00" }, agora)?.texto.includes("fechamento do caixa"),
  true
);
confere(
  "venda de antes de ligar a emissão: a automática não volta ao passado",
  porQueSemNota(ligada, { ...pronto, createdAt: "2026-09-30T17:59:00-03:00" }, agora)?.tipo,
  "antes_de_ligar"
);

console.log("\n— Em frases —");
confere("formas na ordem da tela", formasEmTexto(["DEBIT_CARD", "PIX", "CREDIT_CARD"]), "Pix, Crédito e Débito");
confere("uma forma só", formasEmTexto(["ONLINE"]), "Pago online");
const manual = resumoDaEmissao({ modoDaEmissao: "manual" });
confere("manual: começa dizendo que nada sai sozinho", manual[0], "Nenhuma nota sai sozinha.");
const resumo = resumoDaEmissao({ autoEmitPaymentMethods: ["PIX", "CREDIT_CARD", "DEBIT_CARD"], formasPorIntegracao: { IFOOD: ["ONLINE"] } }, ["IFOOD", "WABIZ"]);
confere("automática: a linha da loja", resumo[0], "Vendas da loja (balcão, mesa, site, robô e totem): a nota sai sozinha em Pix, Crédito e Débito.");
confere("automática: o iFood com a lista dele, o Wabiz com a da loja", [resumo[1], resumo[2]], ["iFood: a nota sai sozinha em Pago online.", "Wabiz: a nota sai sozinha em Pix, Crédito e Débito."]);
confere("avisa que a forma sem nota fica sem nota", resumo.some((l) => l.startsWith("A venda numa forma sem nota automática")), true);
confere("fala do CPF opcional da entrega", resumo.some((l) => l.includes("não obriga")), true);
confere("fala do CPF das integrações", resumo.some((l) => l.startsWith("Integrações:")), true);
confere("nenhuma forma: diz que nada sai", resumoDaEmissao({ autoEmitPaymentMethods: [] })[0].includes("nenhuma nota sai sozinha"), true);
confere("obrigatório: a frase muda", resumoDaEmissao({ autoEmitPaymentMethods: ["PIX"], cpfNaEntrega: "obrigatorio" }).some((l) => l.includes("só fecha com o CPF/CNPJ")), true);

console.log("\n— A gravação (PUT /api/store/fiscal) —");
const gravar = (antes: Partial<ConfigFiscalGravada>, corpo: Record<string, unknown>, papel = "FRANQUEADO") => {
  const r = aplicarFormularioFiscal(antes, corpo, { papel, cifrar: (x) => `cifrado:${x}`, conferir: () => [] });
  if (!r.ok) throw new Error(`gravação recusada: ${JSON.stringify(r.corpo)}`);
  return r;
};
const titular = gravar({}, { modoDaEmissao: "Manual", cpfNaEntrega: "obrigatorio", formasPorIntegracao: { IFOOD: ["ONLINE", "LIXO"], INVENTADA: ["PIX"] } });
confere(
  "titular grava o modo, o CPF da entrega e as listas limpas",
  [titular.config.modoDaEmissao, titular.config.cpfNaEntrega, titular.config.formasPorIntegracao],
  ["manual", "obrigatorio", { IFOOD: ["ONLINE"] }]
);
const invalido = gravar({ modoDaEmissao: "manual" }, { modoDaEmissao: "às vezes" });
confere("modo inválido: fica o gravado, com aviso", [invalido.config.modoDaEmissao, invalido.avisos.length], ["manual", 1]);
const funcionario = gravar({}, { modoDaEmissao: "manual", cpfNaEntrega: "obrigatorio", formasPorIntegracao: { IFOOD: ["ONLINE"] } }, "STAFF");
confere("funcionário não muda nada disso", [funcionario.recusados, funcionario.config.modoDaEmissao ?? null], [["modoDaEmissao", "formasPorIntegracao", "cpfNaEntrega"], null]);
confere(
  "os campos têm rótulo na tela (volta em camposIgnorados)",
  ["modoDaEmissao", "formasPorIntegracao", "cpfNaEntrega"].map((c) => rotuloDoCampoFiscal(c) !== c),
  [true, true, true]
);

console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} falha(s).`);
if (falhas > 0) process.exit(1);
