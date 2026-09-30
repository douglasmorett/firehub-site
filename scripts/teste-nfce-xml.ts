/**
 * Emissor próprio de NFC-e: o XML da nota.
 *
 *   npx tsx scripts/teste-nfce-xml.ts
 *
 * Cada pedido passa pelo caminho de produção inteiro, sem rede:
 *   montarCorpoDaNfce (regras de negócio, lib/fiscal-emissao)
 *   → montarXmlDaNfce (tradutor) → assinatura → QR Code → infNFeSupl
 * e o XML final é VALIDADO contra o schema oficial (PL_010f, nfe_v4.00.xsd)
 * com lxml. A assinatura é conferida por dois caminhos: o xml-crypto e o
 * digest C14N calculado pelo lxml (independente), que tem de bater com o
 * DigestValue.
 *
 * Os pedidos são os da NIK (Brasília-DF, Simples Nacional): balcão em
 * dinheiro, entrega com CPF e endereço, iFood pago online com intermediador,
 * Pix, cartão, dividido com troco, combo, desconto e taxa rateados, 99Food
 * com cupom da plataforma — e 200 pedidos sorteados.
 *
 * O transporte (grupo X) é conferido também pelo que o XSD não pega: em TODA
 * nota montada, entrega (indPres 4) tem o transportador (X03-20, 786) e o
 * resto não tem (X03-10, 754) e vai com modFrete 9 (X02-10, 753).
 */
import { createHash } from "node:crypto";
import { montarCorpoDaNfce, type ConfiguracaoFiscal, type ItemDaNota, type PedidoParaNota } from "../src/lib/fiscal-emissao";
import { pedidoParaNota } from "../src/lib/fiscal-itens";
import { digestValueDoXml, verificarAssinatura, type CertificadoCarregado } from "../src/lib/nfce/assinatura";
import { chaveValida, lerChave } from "../src/lib/nfce/chave";
import { prepararNotaAssinada, type ContextoDoEmissor } from "../src/lib/nfce/emissor";
import { digestEmHex } from "../src/lib/nfce/qrcode";
import { ITEM_EM_HOMOLOGACAO, NOME_EM_HOMOLOGACAO, dataHoraNoFuso, montarXmlDaNfce } from "../src/lib/nfce/xml-da-nota";
import { elementos, lerXml, primeiro, textoDaSefaz } from "../src/lib/nfce/xml";
import { CONFIG_NIK, CPF, certificadoDeTeste, confere, terminar, validarNoXsd, verdade } from "./nfce-teste-apoio";

const AGORA = new Date("2026-09-29T15:00:00Z"); // 12:00 em Brasília
const cert: CertificadoCarregado = certificadoDeTeste();
const MERCHANT = "0b6a0f4e-1d4c-4d9b-9f55-4a3e2f1c0d11";

const CTX: Omit<ContextoDoEmissor, "certificado"> = {
  uf: "DF",
  ambiente: 2,
  serie: 1,
  numero: 1,
  qrCode: { versao: 2, idCsc: "000001", csc: "0123456789ABCDEF0123456789ABCDEF" },
  emitente: { telefone: "(61) 3333-4444", complemento: "Loja 2" },
};

const item = (descricao: string, valorUnitario: number, quantidade = 1, extra: Partial<ItemDaNota> = {}): ItemDaNota => ({
  codigo: descricao.toLowerCase().replace(/\W+/g, "-"),
  descricao,
  ncm: "21069090",
  cfop: "5102",
  unidadeComercial: "UN",
  quantidade,
  valorUnitario,
  valorTotal: Number((valorUnitario * quantidade).toFixed(2)),
  origem: 0,
  csosn: "102",
  ...extra,
});
const pedido = (x: Partial<PedidoParaNota>): PedidoParaNota => ({
  id: "p1",
  numero: 42,
  itens: [item("Esfiha de carne", 3.9, 4)],
  valorTotal: 15.6,
  formaDePagamento: "Dinheiro",
  ...x,
});

type Emitida = { nome: string; xml: string; chave: string; digest: string };
const emitidas: Emitida[] = [];
let numero = 100;

/** Pedido → corpo → XML assinado com QR. Guarda para a validação em lote no XSD. */
function emitir(nome: string, p: PedidoParaNota, opcoes: { config?: ConfiguracaoFiscal; ctx?: Partial<typeof CTX>; tipoDeEmissao?: 1 | 9 } = {}) {
  const m = montarCorpoDaNfce(p, opcoes.config ?? CONFIG_NIK, AGORA);
  if (!m.ok) {
    verdade(`${nome}: corpo montou`, false, JSON.stringify(m.pendencias));
    return null;
  }
  const tipo = opcoes.tipoDeEmissao ?? 1;
  const r = prepararNotaAssinada(m.corpo, { ...CTX, numero: ++numero, ...opcoes.ctx }, cert, {
    tipoDeEmissao: tipo,
    agora: AGORA,
    ...(tipo === 9 ? { contingencia: { entradaEm: AGORA, justificativa: "SEFAZ sem resposta na autorizacao (teste)" } } : {}),
  });
  if (!r.ok) {
    verdade(`${nome}: XML montou`, false, JSON.stringify(r.pendencias));
    return null;
  }
  emitidas.push({ nome, xml: r.nota.xml, chave: r.nota.chave, digest: digestValueDoXml(r.nota.xml) });
  return { corpo: m.corpo, nota: r.nota, doc: lerXml(r.nota.xml) };
}

const txt = (doc: Node, nome: string) => primeiro(doc, nome)?.textContent ?? null;
const todos = (doc: Node, nome: string) => elementos(doc, nome).map((e) => e.textContent);

// ─── 1. Balcão, dinheiro com troco ──────────────────────────────────────────
console.log("\n— Balcão, dinheiro com troco (CSOSN 102 e 500) —");
{
  const e = emitir("balcão dinheiro", pedido({ canal: "PDV", itens: [item("Esfiha", 3.9, 4), item("Refrigerante lata", 6.4, 1, { csosn: "500", cfop: "5405" })], valorTotal: 22, trocoPara: 50 }));
  if (e) {
    const { doc, nota } = e;
    confere("ide: cUF 53, mod 65, série 1, tpImp 4, tpEmis 1, tpAmb 2, indPres 1, indIntermed 0", [txt(doc, "cUF"), txt(doc, "mod"), txt(doc, "serie"), txt(doc, "tpImp"), txt(doc, "tpEmis"), txt(doc, "tpAmb"), txt(doc, "indPres"), txt(doc, "indIntermed")], ["53", "65", "1", "4", "1", "2", "1", "0"]);
    confere("dhEmi em Brasília com offset", txt(doc, "dhEmi"), "2026-09-29T12:00:00-03:00");
    confere("chave: AAMM 2609, CNPJ da NIK, cDV = último dígito", [nota.chave.slice(2, 6), nota.chave.slice(6, 20), txt(doc, "cDV")], ["2609", "64568087000180", nota.chave.slice(-1)]);
    verdade("chave válida e Id = NFe+chave", chaveValida(nota.chave) && primeiro(doc, "infNFe")?.getAttribute("Id") === `NFe${nota.chave}`);
    confere("cNF do XML = cNF da chave", txt(doc, "cNF"), lerChave(nota.chave).codigoNumerico);
    confere("emitente: IE só dígitos, CRT 1, CEP, fone, complemento", [txt(doc, "IE"), txt(doc, "CRT"), txt(doc, "CEP"), txt(doc, "fone"), txt(doc, "xCpl")], ["0712345600123", "1", "71950770", "6133334444", "Loja 2"]);
    confere("homologação: 1º item com a literal (regra I04-10, 373)", todos(doc, "xProd"), [ITEM_EM_HOMOLOGACAO, "Refrigerante lata"]);
    confere("ICMS por CSOSN: SN102 e SN500", [elementos(doc, "ICMSSN102").length, elementos(doc, "ICMSSN500").length], [1, 1]);
    confere("CFOP 5102 e 5405", todos(doc, "CFOP"), ["5102", "5405"]);
    confere("PIS/COFINS 49 → Outr zerado", [elementos(doc, "PISOutr").length, elementos(doc, "COFINSOutr").length, todos(doc, "vPIS")], [2, 2, ["0.00", "0.00", "0.00"]]);
    confere("dinheiro declara o que o cliente entregou (50) e o troco (28)", [txt(doc, "tPag"), txt(doc, "vPag"), txt(doc, "vTroco")], ["01", "50.00", "28.00"]);
    confere("total: vProd 22,00, vNF 22,00, sem desconto", [txt(primeiro(doc, "ICMSTot")!, "vProd"), txt(primeiro(doc, "ICMSTot")!, "vDesc"), txt(doc, "vNF")], ["22.00", "0.00", "22.00"]);
    confere("sem destinatário", elementos(doc, "dest").length, 0);
    confere("modFrete 9", txt(doc, "modFrete"), "9");
    confere("infCpl com o número do pedido", txt(doc, "infCpl"), "Pedido #42");
    const qr = txt(doc, "qrCode") ?? "";
    verdade("QR v2 online do DF", qr.startsWith(`http://www.fazenda.df.gov.br/nfce/qrcode?p=${nota.chave}|2|2|1|`), qr);
    confere("urlChave do DF", txt(doc, "urlChave"), "www.fazenda.df.gov.br/nfce/consulta");
    confere("ordem: infNFe, infNFeSupl, Signature", Array.from(lerXml(nota.xml).documentElement.childNodes).map((n: any) => n.localName), ["infNFe", "infNFeSupl", "Signature"]);
    verdade("sem espaço entre tags e sem tag vazia", !/>\s+</.test(nota.xml) && !/<(\w+)[^>]*><\/\1>/.test(nota.xml));
    verdade("assinatura confere (xml-crypto)", verificarAssinatura(nota.xml).ok);
  }
}

// ─── 2. Entrega com CPF e endereço ──────────────────────────────────────────
console.log("\n— Entrega do site com CPF e endereço (Brasília) —");
{
  const e = emitir(
    "entrega CPF",
    pedido({
      canal: "SITE",
      itens: [item("Pizza grande", 59.9)],
      taxaEntrega: 5,
      valorTotal: 64.9,
      formaDePagamento: "PIX_ENTREGA",
      documentoDoCliente: "529.982.247-25",
      nomeDoCliente: "Maria Souza",
      entregaEmDomicilio: true,
      enderecoDoCliente: "QS 7 Rua 800, 12 - Areal (Casa 3)",
    })
  );
  if (e) {
    const { doc, corpo } = e;
    confere("indPres 4 (entrega)", txt(doc, "indPres"), "4");
    const dest = primeiro(doc, "dest")!;
    confere("dest: CPF, nome de homologação, indIEDest 9", [txt(dest, "CPF"), txt(dest, "xNome"), txt(dest, "indIEDest")], [CPF, NOME_EM_HOMOLOGACAO, "9"]);
    confere(
      "enderDest em campos, cMun de Brasília",
      [txt(dest, "xLgr"), txt(dest, "nro"), txt(dest, "xCpl"), txt(dest, "xBairro"), txt(dest, "cMun"), txt(dest, "UF"), txt(dest, "cPais")],
      [corpo.logradouro_destinatario, corpo.numero_destinatario, corpo.complemento_destinatario ?? null, corpo.bairro_destinatario, "5300108", "DF", "1058"]
    );
    confere("taxa de entrega em vOutro do item e do total", [txt(primeiro(doc, "prod")!, "vOutro"), txt(primeiro(doc, "ICMSTot")!, "vOutro"), txt(doc, "vNF")], ["5.00", "5.00", "64.90"]);
    confere("Pix: tPag 17 com card tpIntegra 2", [txt(doc, "tPag"), txt(doc, "tpIntegra"), txt(doc, "vPag")], ["17", "2", "64.90"]);
    // X03-20 (786): entrega sem transportador é rejeitada. Motoboy da loja =
    // o próprio emitente, com modFrete 3 (transporte próprio do remetente).
    const transporta = primeiro(doc, "transporta");
    confere(
      "entrega: modFrete 3 e transporta = o emitente (CNPJ, razão social, IE, endereço, município, UF)",
      [txt(doc, "modFrete"), transporta && txt(transporta, "CNPJ"), transporta && txt(transporta, "xNome"), transporta && txt(transporta, "IE"), transporta && txt(transporta, "xEnder"), transporta && txt(transporta, "xMun"), transporta && txt(transporta, "UF")],
      ["3", "64568087000180", "NIK COMERCIO DE ALIMENTOS LTDA", "0712345600123", "QS 1 Rua 210, Lote 40 - Taguatinga Sul", "Brasília", "DF"]
    );
    confere("entrega: a taxa continua em vOutro, vFrete zerado", txt(primeiro(doc, "ICMSTot")!, "vFrete"), "0.00");
  }
  // Em PRODUÇÃO o nome do cliente e a descrição do item vão como são.
  const prod = emitir(
    "entrega CPF (produção)",
    pedido({
      canal: "SITE",
      itens: [item("Pizza “Calabresa” – grande 🍕", 59.9)],
      taxaEntrega: 5,
      valorTotal: 64.9,
      formaDePagamento: "PIX_ENTREGA",
      documentoDoCliente: CPF,
      nomeDoCliente: "Maria Souza",
      entregaEmDomicilio: true,
      enderecoDoCliente: "QS 7 Rua 800, 12 - Areal",
    }),
    { config: { ...CONFIG_NIK, ambiente: 1 }, ctx: { ambiente: 1 } }
  );
  if (prod) {
    confere("produção: nome real do cliente", txt(primeiro(prod.doc, "dest")!, "xNome"), "Maria Souza");
    confere("produção: aspas curvas e travessão viram Latin-1, emoji sai", txt(prod.doc, "xProd"), 'Pizza "Calabresa" - grande');
    confere("produção: tpAmb 1 e QR de produção", [txt(prod.doc, "tpAmb"), (txt(prod.doc, "qrCode") ?? "").includes("|2|1|1|")], ["1", true]);
  }
}

// ─── 3. iFood pago online com intermediador ────────────────────────────────
console.log("\n— iFood pago online: intermediador e cupom pago pelo iFood —");
{
  const pedidoIfood = {
    id: "cm-ifood",
    dailyOrderNumber: 17,
    source: "IFOOD",
    ifoodOrderId: "ifood-1",
    ifoodReference: "7JXH",
    deliveryType: "DELIVERY",
    deliveryBy: "MERCHANT",
    totalAmount: 10.89,
    deliveryFee: 5.99,
    discountTotal: 20.99,
    discountIfood: 10.01,
    discountMerchant: 10.98,
    discountDetails: [{ target: "ITEM", value: 20.99, ifood: 10.01, merchant: 10.98, description: "Cupom" }],
    paymentMethod: "Pix (Pago Online)",
    customerCpfCnpj: CPF,
    customerName: "João Lima",
    customerAddress: "QNL 12 Conjunto B, 5 - Comp: casa 1 - Ref: perto da feira - Taguatinga Norte - Brasília",
    items: [{ id: "i1", productName: "Pizza broto", quantity: 1, price: 24.9, menuProduct: { id: "pb", name: "Pizza broto", ncm: "19059090", cfop: "5102", csosn: "102", origem: "0" } }],
  };
  const e = emitir("iFood online", pedidoParaNota(pedidoIfood, { loja: { ifoodMerchantId: MERCHANT } }));
  if (e) {
    const { doc } = e;
    confere("indIntermed 1 + infIntermed (CNPJ iFood + merchant)", [txt(doc, "indIntermed"), txt(primeiro(doc, "infIntermed")!, "CNPJ"), txt(doc, "idCadIntTran")], ["1", "14380200000121", MERCHANT]);
    confere("vProd 24,90 − vDesc 10,98 + vOutro 5,99 = 19,91", [txt(primeiro(doc, "ICMSTot")!, "vProd"), txt(primeiro(doc, "ICMSTot")!, "vDesc"), txt(primeiro(doc, "ICMSTot")!, "vOutro"), txt(doc, "vNF")], ["24.90", "10.98", "5.99", "19.91"]);
    confere(
      "dois pagamentos 99 com xPag (app + cupom do iFood)",
      elementos(doc, "detPag").map((d) => [txt(d, "tPag"), txt(d, "xPag"), txt(d, "vPag")]),
      [["99", "Pago no app iFood (Pix)", "9.90"], ["99", "Cupom pago pelo iFood", "10.01"]]
    );
    confere("99 sem grupo de cartão", elementos(doc, "card").length, 0);
    confere("endereço do iFood no DF: bairro e cMun 5300108", [txt(primeiro(doc, "dest")!, "xBairro"), txt(primeiro(doc, "dest")!, "cMun")], ["Taguatinga Norte", "5300108"]);
    verdade("infCpl explica o cupom do iFood", (txt(doc, "infCpl") ?? "").includes("pago pelo iFood, não pela loja"));
    confere("iFood entregue pelo motoboy da loja (deliveryBy MERCHANT): transportador = a loja, modFrete 3", [txt(doc, "modFrete"), txt(primeiro(doc, "transporta")!, "CNPJ")], ["3", "64568087000180"]);
  }

  // Entrega Parceira: o entregador é do iFood — o transportador é o iFood
  // (o CNPJ do infIntermed), com modFrete 2 (frete por conta de terceiros).
  const parceira = emitir("iFood Entrega Parceira", pedidoParaNota({ ...pedidoIfood, id: "cm-ifood-parceira", deliveryBy: "IFOOD" }, { loja: { ifoodMerchantId: MERCHANT } }));
  if (parceira) {
    const t = primeiro(parceira.doc, "transporta")!;
    confere(
      "Entrega Parceira: modFrete 2, transporta = iFood (CNPJ do intermediador e razão social), sem IE nem UF",
      [txt(parceira.doc, "modFrete"), txt(t, "CNPJ"), txt(t, "xNome"), txt(t, "IE"), txt(t, "UF"), txt(primeiro(parceira.doc, "infIntermed")!, "CNPJ")],
      ["2", "14380200000121", "IFOOD.COM AGENCIA DE RESTAURANTES ONLINE S.A.", null, null, "14380200000121"]
    );
    confere("Entrega Parceira: a taxa do iFood fica fora (vOutro 0)", txt(primeiro(parceira.doc, "ICMSTot")!, "vOutro"), "0.00");
  }
}

// ─── 3b. Transporte (grupo X): as regras 786, 754 e 753 ────────────────────
console.log("\n— Transporte: entrega leva o transportador; balcão e retirada não —");
{
  const noventaENove = emitir(
    "99Food entregue pelo 99",
    pedidoParaNota({
      id: "cm-99-entrega", source: "99FOOD", openDeliveryChannel: "99FOOD", openDeliveryReference: "266010", food99AppShopId: "5764607523034234880",
      deliveryType: "DELIVERY", deliveryBy: "99FOOD", totalAmount: 41.9, deliveryFee: 0,
      paymentMethod: "Pago Online (99Food)", customerCpfCnpj: CPF, customerName: "Ana",
      customerAddress: "q 8 cj e, Quadra 08 Conjunto E Lote 34 - Sobradinho, Brasília - DF, sobradinho 1",
      items: [{ id: "i1", productName: "Pizza família", quantity: 1, price: 41.9, menuProduct: { id: "pf", ncm: "19059090", cfop: "5102", csosn: "102" } }],
    })
  );
  if (noventaENove) {
    confere("entregador do 99 (deliveryBy 99FOOD): transporta = 99Food, modFrete 2", [txt(noventaENove.doc, "modFrete"), txt(primeiro(noventaENove.doc, "transporta")!, "CNPJ"), txt(primeiro(noventaENove.doc, "transporta")!, "xNome")], ["2", "60112920000123", "99 FOOD LTDA."]);
  }
  const balcao = emitir("balcão sem transporte", pedido({ canal: "PDV" }));
  if (balcao) confere("balcão: modFrete 9, sem transporta (X03-10 → 754; X02-10 → 753)", [txt(balcao.doc, "modFrete"), elementos(balcao.doc, "transporta").length], ["9", 0]);
  const retirada = emitir(
    "retirada do iFood",
    pedidoParaNota(
      {
        id: "cm-ifood-retirada", dailyOrderNumber: 18, source: "IFOOD", ifoodOrderId: "ifood-2", ifoodReference: "8KQZ",
        deliveryType: "RETIRADA", deliveryBy: "MERCHANT", totalAmount: 25.89, deliveryFee: 0, paymentMethod: "Pix (Pago Online)", customerName: "João Lima",
        items: [{ id: "i1", productName: "Pizza broto", quantity: 1, price: 24.9, menuProduct: { id: "pb", name: "Pizza broto", ncm: "19059090", cfop: "5102", csosn: "102", origem: "0" } }],
      },
      { loja: { ifoodMerchantId: MERCHANT } }
    )
  );
  if (retirada) confere("retirada do iFood (indPres 1): modFrete 9, sem transporta, com intermediador", [txt(retirada.doc, "indPres"), txt(retirada.doc, "modFrete"), elementos(retirada.doc, "transporta").length, txt(retirada.doc, "indIntermed")], ["1", "9", 0, "1"]);
  // A UF que recusa entrega (785) emite a entrega como presencial: sem transportador.
  const presencial = emitir(
    "entrega como presencial",
    pedido({ canal: "SITE", taxaEntrega: 5, valorTotal: 20.6, entregaEmDomicilio: true }),
    { config: { ...CONFIG_NIK, entregaComoPresencial: true } }
  );
  if (presencial) confere("entregaComoPresencial: indPres 1, modFrete 9, sem transporta", [txt(presencial.doc, "indPres"), txt(presencial.doc, "modFrete"), elementos(presencial.doc, "transporta").length], ["1", "9", 0]);
}

// ─── 3c. CFOP 5910 (bonificação/brinde) e série ───────────────────────────
console.log("\n— CFOP 5910 (NT 2026.002) e a série até 889 —");
{
  const brinde = emitir("brinde 5910", pedido({ canal: "PDV", itens: [item("Esfiha", 3.9, 4), item("Brinde refrigerante", 1, 1, { csosn: "500", cfop: "5910", cest: "0300700" })], valorTotal: 16.6 }));
  if (brinde) confere("5910 na NFC-e (I08-150, N12a-40/44 desde 03/08/2026): monta com o CFOP", todos(brinde.doc, "CFOP"), ["5102", "5910"]);
  const serie889 = emitir("série 889", pedido({ canal: "PDV" }), { config: { ...CONFIG_NIK, serie: 889 }, ctx: { serie: 889 } });
  if (serie889) confere("série 889 (a última da faixa do contribuinte) monta", txt(serie889.doc, "serie"), "889");
}

// ─── 4. Pix, cartão e vale ──────────────────────────────────────────────────
console.log("\n— Pix, cartão com bandeira, vale-refeição —");
{
  const pix = emitir("Pix balcão", pedido({ canal: "PDV", formaDePagamento: "PIX" }));
  if (pix) confere("Pix: 17 + card/tpIntegra 2, sem tBand", [txt(pix.doc, "tPag"), txt(pix.doc, "tpIntegra"), txt(pix.doc, "tBand")], ["17", "2", null]);
  const elo = emitir("crédito Elo", pedido({ canal: "PDV", formaDePagamento: "Cartão Elo Credito" }));
  if (elo) confere("crédito Elo: 03 + card tpIntegra 2 + tBand 06", [txt(elo.doc, "tPag"), txt(elo.doc, "tpIntegra"), txt(elo.doc, "tBand")], ["03", "2", "06"]);
  const deb = emitir("débito", pedido({ canal: "PDV", formaDePagamento: "Cartão Débito" }));
  if (deb) confere("débito: 04 + card", [txt(deb.doc, "tPag"), txt(deb.doc, "tpIntegra")], ["04", "2"]);
  const vr = emitir("vale-refeição", pedido({ canal: "PDV", formaDePagamento: "VOUCHER_Ticket" }));
  if (vr) confere("vale-refeição: 11 sem card", [txt(vr.doc, "tPag"), elementos(vr.doc, "card").length], ["11", 0]);
}

// ─── 5. Dividido com troco ──────────────────────────────────────────────────
console.log("\n— Pagamento dividido com troco —");
{
  const e = emitir(
    "dividido",
    pedido({ canal: "PDV", itens: [item("Pizza", 45)], valorTotal: 45, formaDePagamento: "Dividido: PIX R$ 20,00 + Dinheiro R$ 25,00", pagamentos: [{ forma: "PIX", valor: 20 }, { forma: "Dinheiro", valor: 25 }], trocoPara: 50 })
  );
  if (e) {
    confere("Pix 20 + dinheiro 50, troco 25", [elementos(e.doc, "detPag").map((d) => [txt(d, "tPag"), txt(d, "vPag")]), txt(e.doc, "vTroco")], [[["17", "20.00"], ["01", "50.00"]], "25.00"]);
  }
  const tres = emitir("dividido em três", pedido({ canal: "MESA", itens: [item("Rodízio", 130.9)], valorTotal: 130.9, formaDePagamento: "Dividido: Dinheiro R$ 43,64 + Cartão Débito R$ 43,63 + Cartão Crédito R$ 43,63" }));
  if (tres) confere("três formas, soma = vNF", elementos(tres.doc, "detPag").map((d) => txt(d, "vPag")), ["43.64", "43.63", "43.63"]);
}

// ─── 6. Combo, desconto e taxa rateados ─────────────────────────────────────
console.log("\n— Combo aberto, desconto e taxa rateados nos itens —");
{
  const combo = {
    id: "combo1", name: "Combo Esfiha + Refri", isCombo: true, ncm: "21069090", cfop: "5102", csosn: "102",
    fiscalBreakdown: [
      { name: "Esfihas (6un)", price: 25, ncm: "19059090", csosn: "102", cfop: "5102" },
      { name: "Refrigerante 350ml", price: 8, ncm: "22021000", csosn: "500", cfop: "5405", cest: "0300700" },
    ],
  };
  const p = pedidoParaNota({
    id: "cb", source: "PRESENCIAL", deliveryType: "RETIRADA", totalAmount: 2 * 29.9 + 7.77 - 3.33 + 4.99, deliveryFee: 4.99, discountTotal: 3.33,
    paymentMethod: "Cartão Crédito",
    items: [
      { id: "i1", productName: "Combo Esfiha + Refri", quantity: 2, price: 29.9, menuProduct: combo },
      { id: "i2", productName: "Suco", quantity: 1, price: 7.77, menuProduct: { id: "sc", ncm: "20098990", cfop: "5102", csosn: "102" } },
    ],
  });
  const e = emitir("combo + rateio", p);
  if (e) {
    const { doc, corpo } = e;
    const dets = elementos(doc, "det");
    confere("3 linhas (combo aberto em 2 + suco), nItem 1..3", dets.map((d) => d.getAttribute("nItem")), ["1", "2", "3"]);
    confere("vDesc por item = rateio do corpo", dets.map((d) => txt(d, "vDesc")), (corpo.items as any[]).map((i) => (i.valor_desconto ? Number(i.valor_desconto).toFixed(2) : null)));
    confere("vOutro por item = rateio do corpo", dets.map((d) => txt(d, "vOutro")), (corpo.items as any[]).map((i) => (i.valor_outras_despesas ? Number(i.valor_outras_despesas).toFixed(2) : null)));
    confere("totais", [txt(primeiro(doc, "ICMSTot")!, "vProd"), txt(primeiro(doc, "ICMSTot")!, "vDesc"), txt(primeiro(doc, "ICMSTot")!, "vOutro"), txt(doc, "vNF")], ["67.57", "3.33", "4.99", "69.23"]);
    confere("CEST do refrigerante do combo", todos(doc, "CEST"), ["0300700"]);
    // qCom × vUnCom tem de dar o vProd (regra I11-10, rejeição 629).
    const fecha = dets.every((d) => Math.round(Number(txt(d, "qCom")) * Number(txt(d, "vUnCom")) * 100) === Math.round(Number(txt(d, "vProd")) * 100));
    verdade("qCom × vUnCom = vProd em todas as linhas (629)", fecha, dets.map((d) => `${txt(d, "qCom")}×${txt(d, "vUnCom")}=${txt(d, "vProd")}`).join(" "));
  }
}

// ─── 7. 99Food com cupom da plataforma ──────────────────────────────────────
console.log("\n— 99Food: cupom de 50 pago pela 99, endereço de Sobradinho —");
{
  const e = emitir(
    "99Food",
    pedidoParaNota({
      id: "cm-99", source: "99FOOD", openDeliveryChannel: "99FOOD", openDeliveryReference: "266009", food99AppShopId: "5764607523034234880",
      deliveryType: "DELIVERY", deliveryBy: "MERCHANT", totalAmount: 44, deliveryFee: 0, discountTotal: 50, discountIfood: 50,
      paymentMethod: "Pago Online (99Food)", customerCpfCnpj: CPF, customerName: "Ana",
      customerAddress: "q 8 cj e, Quadra 08 Conjunto E Lote 34 - Sobradinho, Brasília - DF, sobradinho 1",
      items: [{ id: "i1", productName: "Pizza família", quantity: 1, price: 91.9, menuProduct: { id: "pf", ncm: "19059090", cfop: "5102", csosn: "102" } }],
    })
  );
  if (e) {
    confere("intermediador 99Food", [txt(primeiro(e.doc, "infIntermed")!, "CNPJ"), txt(e.doc, "idCadIntTran")], ["60112920000123", "5764607523034234880"]);
    confere("vNF 91,90 = 41,90 app + 50,00 cupom", [txt(e.doc, "vNF"), elementos(e.doc, "detPag").map((d) => txt(d, "vPag"))], ["91.90", ["41.90", "50.00"]]);
    confere("Sobradinho/DF → cMun 5300108", txt(primeiro(e.doc, "dest")!, "cMun"), "5300108");
  }
}

// ─── 8. Contingência off-line e QR v3 ───────────────────────────────────────
console.log("\n— Contingência off-line (tpEmis 9) e QR v3 —");
{
  const e = emitir("contingência v2", pedido({ canal: "PDV", formaDePagamento: "Dinheiro" }), { tipoDeEmissao: 9 });
  if (e) {
    const { doc, nota } = e;
    confere("tpEmis 9 no XML e na chave", [txt(doc, "tpEmis"), lerChave(nota.chave).tipoDeEmissao], ["9", 9]);
    confere("dhCont e xJust (B28/B29)", [txt(doc, "dhCont"), txt(doc, "xJust")], ["2026-09-29T12:00:00-03:00", "SEFAZ sem resposta na autorizacao (teste)"]);
    const qr = txt(doc, "qrCode") ?? "";
    const partes = qr.split("?p=")[1].split("|");
    const digest = digestValueDoXml(nota.xml);
    confere("QR offline: chave|2|2|dia|vNF|digVal|idCSC|hash", [partes[0], partes[1], partes[2], partes[3], partes[4], partes[5], partes[6]], [nota.chave, "2", "2", "29", "15.60", digestEmHex(digest), "1"]);
    confere("hash offline = SHA1(parâmetros 1–7 + CSC)", partes[7], createHash("sha1").update(partes.slice(0, 7).join("|") + "0123456789ABCDEF0123456789ABCDEF").digest("hex").toUpperCase());
  }
  const v3 = emitir("QR v3 online", pedido({ canal: "PDV" }), { ctx: { qrCode: { versao: 3 } } });
  if (v3) confere("QR v3 online termina em |3|2", (txt(v3.doc, "qrCode") ?? "").endsWith(`${v3.nota.chave}|3|2`), true);
  const v3off = emitir("QR v3 offline", pedido({ canal: "PDV" }), { ctx: { qrCode: { versao: 3 } }, tipoDeEmissao: 9 });
  if (v3off) verdade("QR v3 offline com assinatura base64", /\|3\|2\|29\|15\.60\|\|\|[A-Za-z0-9+/]+=*$/.test(txt(v3off.doc, "qrCode") ?? ""), txt(v3off.doc, "qrCode") ?? "");
}

// ─── 9. O que o tradutor RECUSA ─────────────────────────────────────────────
console.log("\n— Recusas do tradutor (nada sai calado) —");
{
  const m = montarCorpoDaNfce(pedido({ canal: "PDV" }), CONFIG_NIK, AGORA);
  if (!m.ok) throw new Error("corpo base não montou");
  const base = m.corpo;
  const ctx = { uf: "DF", ambiente: 2 as const, serie: 1, numero: 5 };
  const recusa = (oQue: string, corpo: Record<string, unknown>, campo: RegExp, c: Partial<typeof ctx> & Record<string, unknown> = {}) => {
    const r = montarXmlDaNfce(corpo, { ...ctx, ...c });
    verdade(oQue, !r.ok && r.pendencias.some((p) => campo.test(p.campo)), r.ok ? "montou" : JSON.stringify(r.pendencias));
  };
  recusa("campo novo no corpo sem tradução", { ...base, valor_frete: 3 }, /^valor_frete$/);
  recusa("campo novo no item", { ...base, items: [{ ...(base.items[0] as any), codigo_beneficio_fiscal: "DF123456" }] }, /codigo_beneficio_fiscal/);
  recusa("CSOSN 101 (pede crédito do Simples)", { ...base, items: [{ ...(base.items[0] as any), icms_situacao_tributaria: "101" }] }, /csosn/);
  recusa("PIS 01 (pede alíquota)", { ...base, items: [{ ...(base.items[0] as any), pis_situacao_tributaria: "01" }] }, /pis/);
  recusa("total adulterado (não é a soma dos itens)", { ...base, valor_total: 99 }, /^valor_total$/);
  recusa("pagamento que não fecha com o total", { ...base, formas_pagamento: [{ forma_pagamento: "01", valor_pagamento: 10 }] }, /formas_pagamento/);
  recusa("IE com letras", { ...base, inscricao_estadual_emitente: "ABC" }, /inscricao_estadual/);
  recusa("UF do corpo diferente da UF do emissor", base, /uf_emitente/, { uf: "MG" });
  recusa("contingência sem justificativa", base, /xJust/, { tipoDeEmissao: 9, contingencia: { entradaEm: AGORA, justificativa: "curta" } });
  recusa("presença 2 (proibida desde a NT 2026.002)", { ...base, presenca_comprador: 2 }, /presenca/);
  // Série da nota do contribuinte: 0 a 889 (B26-10 → 244; C02-30 → 503).
  recusa("série 890 (faixa da nota avulsa do fisco)", { ...base, serie: 890 }, /^serie$/, { serie: 890 });
  recusa("série 999", { ...base, serie: 999 }, /^serie$/, { serie: 999 });
  // Destinatário de outra cidade sem código IBGE: pendência; com o resolvedor, monta.
  const transportadorDaLoja = { modalidade_frete: 3, cnpj_transportador: "64568087000180", nome_transportador: "NIK COMERCIO DE ALIMENTOS LTDA" };
  const foraDoDf = {
    ...base, presenca_comprador: 4, cpf_destinatario: CPF, indicador_inscricao_estadual_destinatario: 9, nome_destinatario: "Paulo",
    logradouro_destinatario: "Rua 10", numero_destinatario: "5", bairro_destinatario: "Centro", municipio_destinatario: "Valparaíso de Goiás", uf_destinatario: "GO",
    ...transportadorDaLoja,
  };
  // Transporte — o que o XSD deixa passar e a SEFAZ recusa (MOC 7.0, modelo 65).
  const semTransportador: Record<string, unknown> = { ...foraDoDf, modalidade_frete: 9 };
  delete semTransportador.cnpj_transportador;
  delete semTransportador.nome_transportador;
  recusa("entrega (indPres 4) sem transportador: 786 (X03-20)", semTransportador, /^transportador$/, { codigoDoMunicipio: () => "5221858" });
  recusa("transportador fora da entrega: 754 (X03-10)", { ...base, cnpj_transportador: "64568087000180", nome_transportador: "NIK" }, /^transportador$/);
  recusa("modFrete ≠ 9 fora da entrega: 753 (X02-10)", { ...base, modalidade_frete: 3 }, /^modalidade_frete$/);
  recusa("CNPJ do transportador inválido: 542 (X04-20)", { ...foraDoDf, cnpj_transportador: "64568087000181" }, /^cnpj_transportador$/, { codigoDoMunicipio: () => "5221858" });
  recusa("IE do transportador sem a UF: 559 (X07-10)", { ...foraDoDf, inscricao_estadual_transportador: "0712345600123" }, /^uf_transportador$/, { codigoDoMunicipio: () => "5221858" });
  recusa("modalidade de frete fora da tabela", { ...foraDoDf, modalidade_frete: 7 }, /^modalidade_frete$/, { codigoDoMunicipio: () => "5221858" });
  recusa("cliente em Valparaíso/GO sem código IBGE", foraDoDf, /codigo_municipio_destinatario/);
  const comCodigo = montarXmlDaNfce(foraDoDf, { ...ctx, codigoDoMunicipio: (mun, uf) => (uf === "GO" && /valpara/i.test(mun) ? "5221858" : null) });
  confere("com o resolvedor de município, monta com cMun 5221858", comCodigo.ok && primeiro(lerXml(comCodigo.xml), "enderDest") && txt(primeiro(lerXml(comCodigo.xml), "enderDest")!, "cMun"), "5221858");
}

// ─── 10. Texto da SEFAZ ─────────────────────────────────────────────────────
console.log("\n— Texto dentro do TString (U+0020–U+00FF) —");
{
  confere("travessão, aspas curvas e reticências", textoDaSefaz("Esfiha – “especial”… ‘boa’"), 'Esfiha - "especial"... \'boa\'');
  confere("emoji e caractere fora do Latin-1 saem", textoDaSefaz("Pizza 🍕 grande ✓"), "Pizza grande");
  confere("acentos do português ficam", textoDaSefaz("Pão de queijo, açaí, maçã"), "Pão de queijo, açaí, maçã");
  confere("quebras de linha e espaços viram um espaço, sem ponta", textoDaSefaz("  Rua A\r\n\tcasa 2  "), "Rua A casa 2");
  confere("corta no máximo sem deixar espaço na ponta", textoDaSefaz("abc def", 4), "abc");
  confere("fuso: Manaus é −04:00", dataHoraNoFuso(AGORA, "America/Manaus"), "2026-09-29T11:00:00-04:00");
  confere("fuso: virada do dia em Brasília (23h)", dataHoraNoFuso(new Date("2026-09-30T02:30:00Z"), "America/Sao_Paulo"), "2026-09-29T23:30:00-03:00");
}

// ─── 11. Varredura: 200 pedidos sorteados ──────────────────────────────────
console.log("\n— Varredura: 200 pedidos sorteados —");
{
  let semente = 11;
  const aleatorio = () => (semente = (semente * 1103515245 + 12345) % 2147483648) / 2147483648;
  const formas = ["Dinheiro", "PIX", "Cartão Crédito", "Cartão Débito", "Vale-refeição", "Cartão Visa Debito"];
  let montadas = 0;
  for (let n = 0; n < 200; n++) {
    const itens = Array.from({ length: 1 + Math.floor(aleatorio() * 8) }, (_, i) =>
      item(`Item ${i} ${n}`, Math.round(aleatorio() * 8000 + 50) / 100, 1 + Math.floor(aleatorio() * 4), aleatorio() < 0.3 ? { csosn: "500", cfop: "5405" } : {})
    );
    const produtos = itens.reduce((s, i) => s + Math.round(i.valorTotal * 100), 0);
    const desconto = aleatorio() < 0.5 ? Math.floor(aleatorio() * produtos * 0.5) : 0;
    const taxa = aleatorio() < 0.6 ? Math.round(aleatorio() * 1500) : 0;
    const total = (produtos - desconto + taxa) / 100;
    const e = emitir(`sorteado ${n}`, pedido({ canal: "PDV", itens, valorTotal: total, desconto: desconto / 100, taxaEntrega: taxa / 100, formaDePagamento: formas[n % formas.length], trocoPara: n % 4 === 0 ? Math.ceil(total / 50) * 50 : null }));
    if (e) montadas++;
  }
  confere("200 pedidos sorteados viraram XML assinado", montadas, 200);
}

// ─── Validação em lote: XSD oficial + digest independente ──────────────────
console.log(`\n— ${emitidas.length} notas contra o XSD oficial (PL_010f) e o digest do lxml —`);
{
  const resultados = validarNoXsd(emitidas.map((e) => ({ xsd: "nfe_v4.00.xsd", xml: e.xml, digest: "infNFe" })));
  const invalidas = resultados.map((r, i) => ({ r, e: emitidas[i] })).filter(({ r }) => !r.ok);
  confere("todas validam no XSD", invalidas.length, 0);
  for (const { r, e } of invalidas.slice(0, 5)) console.log(`   ${e.nome}: ${r.erros.join(" | ")}`);
  const digestErrado = resultados.map((r, i) => ({ r, e: emitidas[i] })).filter(({ r, e }) => r.digest !== e.digest);
  confere("DigestValue = SHA-1 do C14N calculado pelo lxml, em todas", digestErrado.length, 0);
  const assinaturas = emitidas.filter((e) => !verificarAssinatura(e.xml).ok);
  confere("assinatura confere (xml-crypto), em todas", assinaturas.length, 0);
  // O grupo X tem regras que o XSD não pega (MOC 7.0, Anexo I, modelo 65):
  // X03-20 (786) entrega sem transportador, X03-10 (754) transportador fora da
  // entrega, X02-10 (753) modFrete ≠ 9 fora da entrega. Conferidas em TODAS.
  const regraX = (xml: string): string | null => {
    const doc = lerXml(xml);
    const temTransporta = elementos(doc, "transporta").length > 0;
    if (txt(doc, "indPres") === "4") return temTransporta ? null : "786";
    if (temTransporta) return "754";
    return txt(doc, "modFrete") === "9" ? null : "753";
  };
  confere(`regras 786/754/753 do transporte, nas ${emitidas.length} notas`, emitidas.map((e) => [e.nome, regraX(e.xml)]).filter(([, r]) => r), []);
  const entregas = emitidas.filter((e) => txt(lerXml(e.xml), "indPres") === "4").length;
  verdade(`as notas de entrega entraram na conta (${entregas})`, entregas >= 5);
  // Adulterar depois de assinar: o schema continua válido, a assinatura não.
  const adulterada = emitidas[0].xml.replace(/<vNF>([\d.]+)<\/vNF>/, "<vNF>0.01</vNF>");
  verdade("nota adulterada depois de assinada: assinatura não confere", !verificarAssinatura(adulterada).ok);
}

terminar();
