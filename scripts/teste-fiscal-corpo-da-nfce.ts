/**
 * Trava o CONTEÚDO da NFC-e (lib/fiscal-emissao.ts → montarCorpoDaNfce) nas
 * regras da SEFAZ e da Focus NFe, sem token e sem rede.
 *
 *   npx tsx scripts/teste-fiscal-corpo-da-nfce.ts
 *
 * Os pedidos imitam os reais (Hakim Centro e NIK, 24/09/2026): o cupom do
 * iFood dividido entre iFood e loja, a taxa de serviço de R$ 0,99 dentro do
 * total do iFood, o endereço em texto livre de cada canal, o "Dividido:" do
 * balcão e o "N/A" da mesa.
 *
 * Toda nota montada passa pela mesma conferência que a SEFAZ faz antes de
 * olhar qualquer outra coisa: vProd = Σ itens, vDesc/vOutro = Σ dos itens
 * (W16/W17), vNF = vProd − vDesc + vOutro, Σ pagamentos − troco = vNF
 * (865/866), grupo de cartão em 03/04/17 (391), descrição só no 99 (441/442),
 * indicador de intermediador sempre presente (434) e completo quando 1 (438),
 * e destinatário com documento e endereço na entrega (787/788).
 */
import {
  montarCorpoDaNfce,
  formaDaNota,
  valoresDaNota,
  pendenciasDosItens,
  pendenciasParaEmitir,
  traduzirNotaAutorizada,
  INTERMEDIADORES_CONHECIDOS,
  type ConfiguracaoFiscal,
  type PedidoParaNota,
  type ItemDaNota,
  type CorpoDaNfce,
} from "../src/lib/fiscal-emissao";
import { pedidoParaNota } from "../src/lib/fiscal-itens";
import { documentoDeVerdade, lerEnderecoDeEntrega } from "../src/lib/documento-do-cliente";
import { chaveDeAcessoLimpa, cnpjValido, documentoValido, pendenciasDoEmitente } from "../src/lib/fiscal-validacao";
import type { Prisma } from "@prisma/client";

// Checagem de TIPO (o tsc confere; não roda): o pedido como as rotas o leem
// do Prisma entra direto em pedidoParaNota, sem objeto montado à mão.
type PedidoComItens = Prisma.CustomerOrderGetPayload<{ include: { items: { include: { menuProduct: true } } } }>;
void ((o: PedidoComItens) => pedidoParaNota(o, { documentoInformado: null, loja: { ifoodMerchantId: null } }));

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};
const verdade = (oQue: string, cond: boolean, detalhe = "") => {
  if (!cond) falhas++;
  console.log(`${cond ? "✅" : "❌"} ${oQue}${cond ? "" : ` — ${detalhe}`}`);
};

const AGORA = new Date("2026-09-24T15:00:00Z");
const CPF = "52998224725"; // CPF de teste com DV válido
const CNPJ_ALFA = "12ABC34501DE35"; // exemplo da Receita para o CNPJ alfanumérico

const CONFIG: ConfiguracaoFiscal = {
  provedor: "focusnfe",
  tokenDoProvedor: "token-de-teste",
  cnpj: "11.222.333/0001-81",
  inscricaoEstadual: "12.345.678",
  razaoSocial: "HAKIM CENTRO LTDA",
  nomeFantasia: "Hakim Centro",
  regimeTributario: 1,
  logradouro: "Rua Teixeira e Souza",
  numero: "100",
  bairro: "Centro",
  municipio: "Rio das Ostras",
  codigoMunicipio: "3304524",
  uf: "RJ",
  cep: "28890-000",
  serie: 1,
  ambiente: 2,
  cscId: "1",
  csc: "abc",
  temCertificado: true,
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

const c = (v: unknown) => Math.round(Number(v ?? 0) * 100);

/** A conferência da SEFAZ. Devolve a lista do que não fecha. */
function conferir(corpo: CorpoDaNfce): string[] {
  const erros: string[] = [];
  const itens = corpo.items as any[];
  const somaBruto = itens.reduce((s, i) => s + c(i.valor_bruto), 0);
  const somaDesc = itens.reduce((s, i) => s + c(i.valor_desconto), 0);
  const somaOutro = itens.reduce((s, i) => s + c(i.valor_outras_despesas), 0);
  if (somaBruto !== c(corpo.valor_produtos)) erros.push(`W16 vProd ${somaBruto} != ${c(corpo.valor_produtos)}`);
  if (somaDesc !== c(corpo.valor_desconto)) erros.push(`W17 vDesc ${somaDesc} != ${c(corpo.valor_desconto)}`);
  if (somaOutro !== c(corpo.valor_outras_despesas)) erros.push(`W17 vOutro ${somaOutro} != ${c(corpo.valor_outras_despesas)}`);
  if (c(corpo.valor_total) !== c(corpo.valor_produtos) - c(corpo.valor_desconto) + c(corpo.valor_outras_despesas)) erros.push("vNF não fecha");
  for (const i of itens) if (c(i.valor_desconto) > c(i.valor_bruto)) erros.push(`item ${i.numero_item} com desconto maior que o valor`);
  const formas = corpo.formas_pagamento as any[];
  const somaPag = formas.reduce((s, f) => s + c(f.valor_pagamento), 0);
  if (somaPag - c(corpo.valor_troco) !== c(corpo.valor_total)) erros.push(`pagamentos ${somaPag} − troco ${c(corpo.valor_troco)} != vNF ${c(corpo.valor_total)}`);
  for (const f of formas) {
    if (["03", "04", "17"].includes(f.forma_pagamento) && !f.tipo_integracao) erros.push(`391: forma ${f.forma_pagamento} sem grupo de cartão`);
    if (f.forma_pagamento === "99" && !(String(f.descricao_pagamento ?? "").length >= 2)) erros.push("441: 99 sem descrição");
    if (f.forma_pagamento !== "99" && f.descricao_pagamento) erros.push("442: descrição fora do 99");
    if (!(c(f.valor_pagamento) > 0)) erros.push("pagamento com valor zero");
  }
  if (corpo.local_destino !== 1) erros.push("local_destino ausente");
  if (![1, 4].includes(corpo.presenca_comprador as number)) erros.push("presença fora de 1/4 (717)");
  if (corpo.indicador_intermediario !== 0 && corpo.indicador_intermediario !== 1) erros.push("434: sem indicador de intermediador");
  if (corpo.indicador_intermediario === 1 && !(corpo.cnpj_intermediario && corpo.id_intermediario)) erros.push("438: intermediador incompleto");
  if (corpo.presenca_comprador === 4) {
    if (!corpo.cpf_destinatario && !corpo.cnpj_destinatario) erros.push("787: entrega sem documento");
    for (const k of ["logradouro_destinatario", "numero_destinatario", "bairro_destinatario", "municipio_destinatario", "uf_destinatario"]) {
      if (!corpo[k]) erros.push(`788: entrega sem ${k}`);
    }
  }
  // Grupo X (MOC 7.0, modelo 65): entrega leva o transportador (X03-20, 786);
  // o resto não leva (X03-10, 754) e vai com modFrete 9 (X02-10, 753).
  const temTransportador = Object.keys(corpo).some((k) => k.endsWith("_transportador"));
  if (corpo.presenca_comprador === 4) {
    if (!corpo.cnpj_transportador && !corpo.cpf_transportador && !corpo.nome_transportador) erros.push("786: entrega sem transportador");
    if (corpo.modalidade_frete === 9) erros.push("entrega com transportador e modFrete 9 (sem transporte)");
  } else {
    if (temTransportador) erros.push("754: transportador fora da entrega");
    if (corpo.modalidade_frete !== 9) erros.push("753: modFrete ≠ 9 fora da entrega");
  }
  if (corpo.cnpj_transportador && !cnpjValido(corpo.cnpj_transportador)) erros.push("542: CNPJ do transportador inválido");
  return erros;
}

function montar(p: PedidoParaNota, cfg: ConfiguracaoFiscal = CONFIG) {
  const m = montarCorpoDaNfce(p, cfg, AGORA);
  if (m.ok) {
    const erros = conferir(m.corpo);
    verdade(`   (conferência da SEFAZ fecha)`, erros.length === 0, erros.join("; "));
  }
  return m;
}

// ─── 1. Balcão, dinheiro com troco ──────────────────────────────────────────
console.log("\n— Balcão, dinheiro com troco para 50 —");
{
  const m = montar(pedido({ canal: "PDV", itens: [item("Esfiha", 3.9, 4), item("Refrigerante lata", 6.4, 1, { csosn: "500", cfop: "5405" })], valorTotal: 22, trocoPara: 50 }));
  confere("montou", m.ok, true);
  if (m.ok) {
    confere("presença 1 (balcão)", m.corpo.presenca_comprador, 1);
    confere("sem intermediador", m.corpo.indicador_intermediario, 0);
    confere("dinheiro declara a nota entregue (50,00)", m.corpo.formas_pagamento, [{ forma_pagamento: "01", valor_pagamento: 50 }]);
    confere("troco 28,00", m.corpo.valor_troco, 28);
    confere("sem destinatário", m.corpo.cpf_destinatario ?? m.corpo.nome_destinatario ?? null, null);
    confere("data com offset de São Paulo", m.corpo.data_emissao, "2026-09-24T12:00:00-03:00");
    confere("finalidade e destino explícitos", [m.corpo.finalidade_emissao, m.corpo.local_destino, m.corpo.modalidade_frete], [1, 1, 9]);
  }
}

// ─── 2. Delivery do site com CPF e endereço ─────────────────────────────────
console.log("\n— Delivery do site com CPF e endereço —");
{
  const m = montar(pedido({
    canal: "SITE",
    itens: [item("Pizza grande", 59.9)],
    taxaEntrega: 5,
    valorTotal: 64.9,
    formaDePagamento: "PIX_ENTREGA",
    documentoDoCliente: "529.982.247-25",
    nomeDoCliente: "Maria Souza",
    entregaEmDomicilio: true,
    enderecoDoCliente: "Rua Nova Iguaçu, 668 - Atlântica (BL A AP 203 - Cond. Caravelas)",
  }));
  confere("montou", m.ok, true);
  if (m.ok) {
    confere("presença 4 (entrega)", m.corpo.presenca_comprador, 4);
    confere("destinatário", [m.corpo.cpf_destinatario, m.corpo.nome_destinatario, m.corpo.indicador_inscricao_estadual_destinatario], [CPF, "Maria Souza", 9]);
    confere(
      "endereço em campos",
      [m.corpo.logradouro_destinatario, m.corpo.numero_destinatario, m.corpo.complemento_destinatario, m.corpo.bairro_destinatario, m.corpo.municipio_destinatario, m.corpo.uf_destinatario, m.corpo.codigo_municipio_destinatario],
      ["Rua Nova Iguaçu", "668", "BL A AP 203 - Cond. Caravelas", "Atlântica", "Rio das Ostras", "RJ", "3304524"]
    );
    confere("taxa de entrega em outras despesas", [m.corpo.valor_outras_despesas, m.corpo.valor_total], [5, 64.9]);
    confere("Pix na entrega: 17 com grupo de cartão não integrado", m.corpo.formas_pagamento, [{ forma_pagamento: "17", valor_pagamento: 64.9, tipo_integracao: "2" }]);
    // Motoboy da loja: o transportador é o próprio emitente, modFrete 3 (786 sem ele).
    confere(
      "transporte: modFrete 3 e o emitente como transportador (CNPJ, razão, IE, endereço, município, UF)",
      [m.corpo.modalidade_frete, m.corpo.cnpj_transportador, m.corpo.nome_transportador, m.corpo.inscricao_estadual_transportador, m.corpo.endereco_transportador, m.corpo.municipio_transportador, m.corpo.uf_transportador],
      [3, "11222333000181", "HAKIM CENTRO LTDA", "12345678", "Rua Teixeira e Souza, 100 - Centro", "Rio das Ostras", "RJ"]
    );
  }
}

// ─── 3. Delivery sem CPF / sem endereço legível: RECUSA ─────────────────────
console.log("\n— Delivery sem CPF: recusa antes de mandar —");
{
  const m = montar(pedido({
    canal: "SITE", taxaEntrega: 5, valorTotal: 20.6, entregaEmDomicilio: true, nomeDoCliente: "Rosa",
    enderecoDoCliente: "Rua Machado da Silva, 160, Recanto",
  }));
  confere("não montou", m.ok, false);
  if (!m.ok) {
    verdade("pendência diz 'Entrega sem CPF do cliente'", m.pendencias.some((p) => p.mensagem.startsWith("Entrega sem CPF do cliente: a SEFAZ rejeita NFC-e de entrega sem CPF e endereço")), JSON.stringify(m.pendencias));
    confere("só essa pendência (o endereço do robô foi lido)", m.pendencias.length, 1);
  }
  // Entrega sem nome de verdade: o DANFE da entrega tem de trazer nome e
  // endereço (Manual do DANFE NFC-e v6.0, 3.1.6) — e ele só imprime o XML.
  for (const nome of [null, "", "Cliente", "Balcão", "Cliente iFood", "Mesa 3"]) {
    const semNome = montar(pedido({ canal: "SITE", taxaEntrega: 5, valorTotal: 20.6, entregaEmDomicilio: true, documentoDoCliente: CPF, nomeDoCliente: nome, enderecoDoCliente: "Rua Machado da Silva, 160, Recanto" }));
    confere(
      `entrega com o nome ${JSON.stringify(nome)}: recusa pelo nome (3.1.6), e só por ele`,
      !semNome.ok && semNome.pendencias.map((p) => [p.campo, /3\.1\.6/.test(p.mensagem)]),
      [["nomeDoCliente", true]]
    );
  }
  const comNome = montar(pedido({ canal: "SITE", taxaEntrega: 5, valorTotal: 20.6, entregaEmDomicilio: true, documentoDoCliente: CPF, nomeDoCliente: "Rosa Maria", enderecoDoCliente: "Rua Machado da Silva, 160, Recanto" }));
  confere("entrega com nome de verdade: monta com o nome no destinatário", comNome.ok && comNome.corpo.nome_destinatario, "Rosa Maria");
  const balcaoSemNome = montar(pedido({ canal: "PDV", documentoDoCliente: CPF, nomeDoCliente: "Balcão" }));
  confere("balcão sem nome (não é entrega): monta, sem exigir o nome", balcaoSemNome.ok && (balcaoSemNome.corpo.nome_destinatario ?? null), null);
  const semBairro = montar(pedido({
    canal: "PDV", taxaEntrega: 5, valorTotal: 20.6, entregaEmDomicilio: true, documentoDoCliente: CPF, enderecoDoCliente: "quadra 1",
  }));
  confere("endereço 'quadra 1' não monta", semBairro.ok, false);
  if (!semBairro.ok) verdade("pendência do endereço cita o bairro e a 788", semBairro.pendencias.some((p) => /bairro/.test(p.mensagem) && /788/.test(p.mensagem)), JSON.stringify(semBairro.pendencias));
  // A UF que recusa entrega em NFC-e (785) emite como presencial, sem exigir nada.
  const presencial = montar(pedido({ canal: "SITE", taxaEntrega: 5, valorTotal: 20.6, entregaEmDomicilio: true }), { ...CONFIG, entregaComoPresencial: true });
  confere("entregaComoPresencial: presença 1 sem CPF", presencial.ok && presencial.corpo.presenca_comprador, 1);
}

// ─── 4. iFood pago online, cupom dividido entre iFood e loja ────────────────
console.log("\n— iFood pago online (pedido real 7jxhqv): cupom do iFood não é desconto da loja —");
const MERCHANT = "0b6a0f4e-1d4c-4d9b-9f55-4a3e2f1c0d11";
const pedidoIfood = {
  id: "cm-7jxhqv",
  dailyOrderNumber: 17,
  source: "IFOOD",
  ifoodOrderId: "ifood-1",
  ifoodReference: "7JXH",
  deliveryType: "DELIVERY",
  deliveryBy: "MERCHANT",
  totalAmount: 10.89, // 24,90 − 20,99 + 5,99 + 0,99 de taxa de serviço do iFood
  deliveryFee: 5.99,
  discountTotal: 20.99,
  discountIfood: 10.01,
  discountMerchant: 10.98,
  discountDetails: [{ target: "ITEM", value: 20.99, ifood: 10.01, merchant: 10.98, description: "Cupom" }],
  paymentMethod: "Pix (Pago Online)",
  customerCpfCnpj: CPF,
  customerName: "João Lima",
  customerAddress: "R. Itaperu, 107 - Comp: casa 1 - Ref: uma vila próximo ao colégio conceito - Centro - Rio das Ostras",
  items: [{ id: "i1", productName: "Pizza broto", quantity: 1, price: 24.9, menuProduct: { id: "pb", name: "Pizza broto", ncm: "19059090", cfop: "5102", csosn: "102", origem: "0" } }],
};
{
  const p = pedidoParaNota(pedidoIfood, { loja: { ifoodMerchantId: MERCHANT } });
  confere("canal e pago online lidos do pedido", [p.canal, p.pagoOnline, p.idNaPlataforma], ["IFOOD", true, MERCHANT]);
  const v = valoresDaNota(p);
  confere("valores: vDesc só da loja, total = 19,91, cupom do iFood 10,01", [v.desconto, v.total, v.subsidioDaPlataforma, v.parteDoCliente], [1098, 1991, 1001, 990]);
  const m = montar(p);
  confere("montou", m.ok, true);
  if (m.ok) {
    confere("intermediador iFood", [m.corpo.indicador_intermediario, m.corpo.cnpj_intermediario, m.corpo.id_intermediario], [1, "14380200000121", MERCHANT]);
    confere("vProd 24,90 − vDesc 10,98 + entrega 5,99 = 19,91", [m.corpo.valor_produtos, m.corpo.valor_desconto, m.corpo.valor_outras_despesas, m.corpo.valor_total], [24.9, 10.98, 5.99, 19.91]);
    confere(
      "pagamentos: app do iFood (cliente) + cupom pago pelo iFood",
      m.corpo.formas_pagamento,
      [
        { forma_pagamento: "99", valor_pagamento: 9.9, descricao_pagamento: "Pago no app iFood (Pix)" },
        { forma_pagamento: "99", valor_pagamento: 10.01, descricao_pagamento: "Cupom pago pelo iFood" },
      ]
    );
    confere("presença 4 com endereço do iFood lido", [m.corpo.presenca_comprador, m.corpo.logradouro_destinatario, m.corpo.numero_destinatario, m.corpo.bairro_destinatario, m.corpo.complemento_destinatario], [4, "R. Itaperu", "107", "Centro", "casa 1"]);
    verdade("informação adicional explica o cupom", String(m.corpo.informacoes_adicionais_contribuinte).includes("pago pelo iFood, não pela loja"));
  }
  const semMerchant = montar(pedidoParaNota(pedidoIfood));
  confere("iFood sem identificador da loja: recusa (438)", !semMerchant.ok && semMerchant.pendencias.some((x) => x.campo === "idNoIntermediador"), true);
  // Quem ainda monta o objeto à mão (sem canal) não emite nota de iFood errada:
  // a taxa de serviço faz o total não fechar, e a emissão para.
  const aMao = montar({ id: "x", numero: 1, itens: p.itens, valorTotal: 10.89, taxaEntrega: 5.99, desconto: 20.99, formaDePagamento: "Pix (Pago Online)", documentoDoCliente: CPF, entregaEmDomicilio: false });
  confere("objeto montado à mão com dados do iFood: recusa pelo total", !aMao.ok && aMao.pendencias.some((x) => x.campo === "valorTotal"), true);
}

console.log("\n— iFood: retirada, Entrega Parceira e dinheiro na entrega —");
{
  const retirada = montar(pedidoParaNota({ ...pedidoIfood, deliveryType: "RETIRADA", deliveryFee: 0, totalAmount: 4.9, customerCpfCnpj: null, customerAddress: "" }, { loja: { ifoodMerchantId: MERCHANT } }));
  confere("retirada do iFood: presença 1, intermediador 1, sem CPF", retirada.ok && [retirada.corpo.presenca_comprador, retirada.corpo.indicador_intermediario, retirada.corpo.cpf_destinatario ?? null], [1, 1, null]);

  // Entrega Parceira (pedido real qwdh8c, desconto de entrega do iFood): taxa
  // e desconto da entrega ficam fora; o cupom do item pago pelo iFood entra.
  const parceira = montar(pedidoParaNota({
    ...pedidoIfood,
    deliveryBy: "IFOOD",
    deliveryFee: 12.99,
    totalAmount: 42.86,
    items: [{ id: "i1", productName: "Combo", quantity: 1, price: 68.88, menuProduct: { id: "cb", ncm: "21069090", cfop: "5102", csosn: "102" } }],
    discountTotal: 40,
    discountIfood: 30,
    discountMerchant: 10,
    discountDetails: [
      { target: "ITEM", ifood: 17.01, merchant: 10 },
      { target: "DELIVERY_FEE", ifood: 12.99, merchant: 0 },
    ],
  }, { loja: { ifoodMerchantId: MERCHANT } }));
  confere("Entrega Parceira montou", parceira.ok, true);
  if (parceira.ok) {
    confere("sem taxa de entrega; vDesc 10,00 da loja; total 58,88", [parceira.corpo.valor_outras_despesas ?? 0, parceira.corpo.valor_desconto, parceira.corpo.valor_total], [0, 10, 58.88]);
    confere("cupom do iFood só a parte do item (17,01)", (parceira.corpo.formas_pagamento as any[]).map((f) => f.valor_pagamento), [41.87, 17.01]);
    verdade("informação adicional: entrega fora da nota", String(parceira.corpo.informacoes_adicionais_contribuinte).includes("Entrega feita e cobrada pelo iFood"));
    // Quem leva é o entregador do iFood: transportador = o iFood (o CNPJ do
    // infIntermed e a razão social), frete por conta de terceiros (2).
    confere(
      "Entrega Parceira: transportador = iFood, modFrete 2",
      [parceira.corpo.modalidade_frete, parceira.corpo.cnpj_transportador, parceira.corpo.nome_transportador, parceira.corpo.inscricao_estadual_transportador ?? null],
      [2, "14380200000121", "IFOOD.COM AGENCIA DE RESTAURANTES ONLINE S.A.", null]
    );
  }
  // O CNPJ do transportador é o do intermediador DA NOTA: a loja que ajustou o
  // CNPJ do iFood em `config.intermediadores` vê o mesmo nos dois grupos.
  const comAjuste = montar(
    pedidoParaNota({ ...pedidoIfood, deliveryBy: "IFOOD", deliveryFee: 0, totalAmount: 4.9 }, { loja: { ifoodMerchantId: MERCHANT } }),
    { ...CONFIG, intermediadores: { IFOOD: { cnpj: "11.222.333/0001-81" } } }
  );
  confere("Entrega Parceira com o CNPJ do iFood ajustado: o mesmo no infIntermed e no transportador", comAjuste.ok && [comAjuste.corpo.cnpj_intermediario, comAjuste.corpo.cnpj_transportador, comAjuste.corpo.nome_transportador], ["11222333000181", "11222333000181", "iFood"]);

  // Dinheiro na entrega: o cliente deve 41,89 (com a taxa de serviço do
  // iFood) e dá 100. Troco 58,11; a nota vale 40,90.
  const dinheiro = montar(pedidoParaNota({
    ...pedidoIfood,
    totalAmount: 41.89,
    deliveryFee: 6,
    discountTotal: 0, discountIfood: 0, discountMerchant: 0, discountDetails: null,
    items: [{ id: "i1", productName: "Pizza", quantity: 1, price: 34.9, menuProduct: { id: "pz", ncm: "19059090", cfop: "5102", csosn: "102" } }],
    paymentMethod: "Dinheiro (Cobrar na Entrega)",
    changeAmount: 100,
  }, { loja: { ifoodMerchantId: MERCHANT } }));
  confere("dinheiro no iFood montou", dinheiro.ok, true);
  if (dinheiro.ok) {
    confere("vNF 40,90, dinheiro entregue 99,01, troco 58,11", [dinheiro.corpo.valor_total, (dinheiro.corpo.formas_pagamento as any[])[0], dinheiro.corpo.valor_troco], [40.9, { forma_pagamento: "01", valor_pagamento: 99.01 }, 58.11]);
  }
}

// ─── 4b. 99Food pago online com cupom da plataforma ─────────────────────────
console.log("\n— 99Food (pedido real jilvmu): cupom de 50 pago pela 99 —");
{
  const m = montar(pedidoParaNota({
    id: "cm-jilvmu", source: "99FOOD", openDeliveryChannel: "99FOOD", openDeliveryReference: "266009", food99AppShopId: "5764607523034234880",
    deliveryType: "DELIVERY", deliveryBy: "MERCHANT", totalAmount: 44, deliveryFee: 0, discountTotal: 50, discountIfood: 50,
    paymentMethod: "Pago Online (99Food)", customerCpfCnpj: CPF, customerName: "Ana",
    customerAddress: "q 8 cj e, Quadra 08 Conjunto E Lote 34 - Sobradinho, Brasília - DF, sobradinho 1",
    items: [{ id: "i1", productName: "Pizza família", quantity: 1, price: 91.9, menuProduct: { id: "pf", ncm: "19059090", cfop: "5102", csosn: "102" } }],
  }), { ...CONFIG, municipio: "Brasília", uf: "DF", codigoMunicipio: "5300108" });
  confere("montou", m.ok, true);
  if (m.ok) {
    confere("intermediador 99Food", [m.corpo.cnpj_intermediario, m.corpo.id_intermediario], ["60112920000123", "5764607523034234880"]);
    confere("vNF 91,90 = app 41,90 + cupom 50,00", [m.corpo.valor_total, (m.corpo.formas_pagamento as any[]).map((f) => [f.valor_pagamento, f.descricao_pagamento])], [91.9, [[41.9, "Pago no app 99Food"], [50, "Cupom pago pelo 99Food"]]]);
    confere("endereço do 99: bairro e UF", [m.corpo.bairro_destinatario, m.corpo.municipio_destinatario, m.corpo.uf_destinatario], ["Sobradinho", "Brasília", "DF"]);
  }
}

// ─── 5. Pix e cartão ────────────────────────────────────────────────────────
console.log("\n— Pix e cartão no balcão —");
{
  const pix = montar(pedido({ canal: "PDV", formaDePagamento: "PIX" }));
  confere("Pix: 17 + grupo de cartão (391)", pix.ok && pix.corpo.formas_pagamento, [{ forma_pagamento: "17", valor_pagamento: 15.6, tipo_integracao: "2" }]);
  const estatico = montar(pedido({ canal: "PDV", formaDePagamento: "PIX" }), { ...CONFIG, pixEstatico: true });
  confere("Pix por chave fixa (pixEstatico): 20, sem grupo de cartão", estatico.ok && estatico.corpo.formas_pagamento, [{ forma_pagamento: "20", valor_pagamento: 15.6 }]);
  const cartao = montar(pedidoParaNota({
    id: "jj1", source: "JOTAJA", openDeliveryChannel: "JOTAJA", openDeliveryOrderId: "od-1", deliveryType: "DELIVERY", totalAmount: 55.9, deliveryFee: 6,
    paymentMethod: "Cartão Elo Credito (Cobrar na Entrega)", customerCpfCnpj: CPF, customerName: "Paulo",
    customerAddress: "Rua Recife, 506, Casa 3 , Jardim Bela Vista - Rio das Ostras - Brasil - Rio das Ostras",
    items: [{ id: "i1", productName: "Pizza", quantity: 1, price: 49.9, menuProduct: { id: "pz", ncm: "19059090", cfop: "5102", csosn: "102" } }],
  }));
  confere("JotaJá, crédito Elo na entrega: 03 + não integrado + bandeira 06", cartao.ok && cartao.corpo.formas_pagamento, [{ forma_pagamento: "03", valor_pagamento: 55.9, tipo_integracao: "2", bandeira_operadora: "06" }]);
  confere("JotaJá é delivery próprio: sem intermediador", cartao.ok && cartao.corpo.indicador_intermediario, 0);
  confere("endereço do JotaJá", cartao.ok && [cartao.corpo.logradouro_destinatario, cartao.corpo.numero_destinatario, cartao.corpo.complemento_destinatario, cartao.corpo.bairro_destinatario], ["Rua Recife", "506", "Casa 3", "Jardim Bela Vista"]);
  const debito = montar(pedido({ canal: "PDV", formaDePagamento: "Cartão Débito" }));
  confere("débito: 04 + não integrado", debito.ok && debito.corpo.formas_pagamento, [{ forma_pagamento: "04", valor_pagamento: 15.6, tipo_integracao: "2" }]);
}

// ─── 6. Dividido ────────────────────────────────────────────────────────────
console.log("\n— Pagamento dividido —");
{
  const pixDinheiro = montar(pedido({
    canal: "PDV", itens: [item("Pizza", 45)], valorTotal: 45,
    formaDePagamento: "Dividido: PIX R$ 20,00 + Dinheiro R$ 25,00",
    pagamentos: [{ forma: "PIX", valor: 20 }, { forma: "Dinheiro", valor: 25 }],
    trocoPara: 50,
  }));
  confere(
    "Pix 20 + dinheiro (deu 50 para pagar 25): troco 25",
    pixDinheiro.ok && [pixDinheiro.corpo.formas_pagamento, pixDinheiro.corpo.valor_troco],
    [[{ forma_pagamento: "17", valor_pagamento: 20, tipo_integracao: "2" }, { forma_pagamento: "01", valor_pagamento: 50 }], 25]
  );
  const pagouAMais = montar(pedido({ canal: "PDV", itens: [item("Pizza", 45)], valorTotal: 45, pagamentos: [{ forma: "Pix", valor: 20 }, { forma: "Dinheiro", valor: 30 }] }));
  confere("dinheiro a mais no dividido vira troco", pagouAMais.ok && pagouAMais.corpo.valor_troco, 5);
  const texto = montar(pedido({
    canal: "MESA", itens: [item("Rodízio", 130.9)], valorTotal: 130.9,
    formaDePagamento: "Dividido: Dinheiro R$ 43,64 + Cartão Débito R$ 43,63 + Cartão Crédito R$ 43,63",
  }));
  confere("texto 'Dividido:' do balcão vira três formas", texto.ok && (texto.corpo.formas_pagamento as any[]).map((f) => [f.forma_pagamento, f.valor_pagamento]), [["01", 43.64], ["04", 43.63], ["03", 43.63]]);
  const falta = montar(pedido({ canal: "PDV", itens: [item("Pizza", 45)], valorTotal: 45, pagamentos: [{ forma: "Pix", valor: 20 }, { forma: "Cartão Crédito", valor: 20 }] }));
  confere("dividido que não cobre o total: recusa", !falta.ok && falta.pendencias.some((p) => p.campo === "pagamentos"), true);
}

// ─── 7. Combo discriminado + rateio de desconto e taxa ─────────────────────
console.log("\n— Combo discriminado, desconto e taxa rateados —");
{
  const combo = {
    id: "combo1", name: "Combo Esfiha + Refri", isCombo: true, ncm: "21069090", cfop: "5102", csosn: "102",
    fiscalBreakdown: [
      { name: "Esfihas (6un)", price: 25, ncm: "19059090", csosn: "102", cfop: "5102" },
      { name: "Refrigerante 350ml", price: 8, ncm: "22021000", csosn: "500", cfop: "5405" },
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
  confere("combo aberto em duas linhas + suco", p.itens.map((i) => [i.descricao.slice(0, 12), i.valorUnitario, i.quantidade, i.cfop]), [["Esfihas (6un", 22.66, 2, "5102"], ["Refrigerante", 7.24, 2, "5405"], ["Suco", 7.77, 1, "5102"]]);
  const m = montar(p);
  confere("montou", m.ok, true);
  if (m.ok) {
    confere("totais", [m.corpo.valor_produtos, m.corpo.valor_desconto, m.corpo.valor_outras_despesas, m.corpo.valor_total], [67.57, 3.33, 4.99, 69.23]);
    confere("rateio do desconto por item (centavos batem)", (m.corpo.items as any[]).map((i) => i.valor_desconto), [2.24, 0.71, 0.38]);
    confere("rateio da taxa por item (sobra na maior linha)", (m.corpo.items as any[]).map((i) => i.valor_outras_despesas), [3.36, 1.06, 0.57]);
  }
  // Varredura: 3000 pedidos de canal próprio com valores aleatórios.
  let quebrou = 0;
  let primeiro = "";
  let semente = 7;
  const aleatorio = () => ((semente = (semente * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let n = 0; n < 3000; n++) {
    const itens = Array.from({ length: 1 + Math.floor(aleatorio() * 6) }, (_, i) => item(`Item ${i}`, Math.round(aleatorio() * 8000 + 50) / 100, 1 + Math.floor(aleatorio() * 3)));
    const produtos = itens.reduce((s, i) => s + Math.round(i.valorTotal * 100), 0);
    const desconto = aleatorio() < 0.5 ? Math.floor(aleatorio() * produtos * 1.1) : 0; // às vezes maior que os produtos
    const taxa = aleatorio() < 0.6 ? Math.round(aleatorio() * 1500) : 0;
    let d = desconto, o = taxa;
    if (d > produtos) { o = Math.max(0, o - (d - produtos)); d = produtos; }
    const total = (produtos - d + o) / 100;
    if (total <= 0) continue;
    const formas = ["Dinheiro", "PIX", "Cartão Crédito", "Cartão Débito", "Vale-refeição"];
    const m = montarCorpoDaNfce(pedido({ canal: "PDV", itens, valorTotal: total, desconto: desconto / 100, taxaEntrega: taxa / 100, formaDePagamento: formas[n % formas.length], trocoPara: n % 5 === 0 ? Math.ceil(total / 50) * 50 : null }), CONFIG, AGORA);
    const erros = m.ok ? conferir(m.corpo) : [m.mensagem + " " + JSON.stringify(m.pendencias)];
    if (erros.length) { quebrou++; primeiro ||= erros.join("; "); }
  }
  confere("varredura de 3000 pedidos: toda nota fecha no centavo", quebrou, 0);
  if (primeiro) console.log("   primeiro erro:", primeiro);
}

// ─── 8. MEI ─────────────────────────────────────────────────────────────────
console.log("\n— MEI (CRT 4) —");
{
  const mei = { ...CONFIG, regimeTributario: 4 };
  confere("MEI não é mais 'regime inválido'", pendenciasDoEmitente(mei).filter((p) => p.campo === "regimeTributario"), []);
  const crt3 = pendenciasDoEmitente({ ...CONFIG, regimeTributario: 3 }).find((p) => p.campo === "regimeTributario");
  verdade("Regime Normal continua bloqueado, com o motivo", Boolean(crt3 && /cBenef/.test(crt3.mensagem) && /IBS\/CBS/.test(crt3.mensagem)), crt3?.mensagem);
  const bebidaSt = pendenciasDosItens([item("Refrigerante", 6, 1, { csosn: "500", cfop: "5405" })], 4).map((p) => p.mensagem.match(/\d{3}\)/)?.[0]);
  confere("MEI com CSOSN 500 e CFOP 5405: rejeições 782 e 337 avisadas antes", bebidaSt, ["782)", "337)"]);
  confere("MEI com 102/5102 passa", pendenciasDosItens([item("Esfiha", 3.9)], 4), []);
  confere("MEI com 300/5102 passa", pendenciasDosItens([item("Esfiha", 3.9, 1, { csosn: "300" })], 4), []);
  const m = montar(pedido({ canal: "PDV" }), mei);
  confere("corpo do MEI sai com CRT 4 e CSOSN no item", m.ok && [m.corpo.regime_tributario_emitente, (m.corpo.items as any[])[0].icms_situacao_tributaria], [4, "102"]);
  confere("Simples: CSOSN 500 com CFOP 5102 é avisado (386)", pendenciasDosItens([item("Refrigerante", 6, 1, { csosn: "500", cfop: "5102", cest: "0300700" })], 1).map((p) => p.campo), ["Refrigerante → cfop"]);
  confere("Simples: CSOSN 101 (crédito) é avisado", pendenciasDosItens([item("X", 6, 1, { csosn: "101" })], 1).length, 1);
  // 5910 (bonificação, doação ou brinde): aceito na NFC-e desde 03/08/2026
  // (NT 2026.002 v1.10a: I08-150, N12a-40 e N12a-44).
  confere("Simples: CSOSN 102 com CFOP 5910 passa (NT 2026.002)", pendenciasDosItens([item("Brinde", 1, 1, { csosn: "102", cfop: "5910" })], 1), []);
  confere("Simples: CSOSN 500 com CFOP 5910 (e CEST) passa", pendenciasDosItens([item("Refri brinde", 1, 1, { csosn: "500", cfop: "5910", cest: "0300700" })], 1), []);
  const cfopErrado = pendenciasDosItens([item("Brinde", 1, 1, { csosn: "102", cfop: "5405" })], 1);
  verdade("a pendência do CFOP ensina que o 5910 vale", cfopErrado.length === 1 && cfopErrado[0].mensagem.includes("5910"), JSON.stringify(cfopErrado));
  confere("Simples: CSOSN 900 com 5102 passa", pendenciasDosItens([item("X", 6, 1, { csosn: "900" })], 1), []);
  // CSOSN 500 (ST) exige o CEST (Ajuste SINIEF 19/16, cl. 4ª, VIII).
  const semCest = pendenciasDosItens([item("Refrigerante lata", 6.4, 1, { csosn: "500", cfop: "5405" })], 1);
  confere("Simples: CSOSN 500 sem CEST é avisado", semCest.map((p) => [p.campo, p.mensagem.startsWith("CSOSN 500 (substituição tributária) exige o CEST")]), [["Refrigerante lata → cest", true]]);
  confere("Simples: CSOSN 500 com CEST e 5405 passa", pendenciasDosItens([item("Refrigerante lata", 6.4, 1, { csosn: "500", cfop: "5405", cest: "03.007.00" })], 1), []);
  confere("Simples: CEST torto é UMA pendência (a do formato)", pendenciasDosItens([item("Refrigerante lata", 6.4, 1, { csosn: "500", cfop: "5405", cest: "0300" })], 1).map((p) => p.campo), ["Refrigerante lata → cest"]);
  confere("Simples: CSOSN 102 sem CEST passa (o CEST é do produto com ST)", pendenciasDosItens([item("Esfiha", 3.9)], 1), []);
  confere("MEI: CSOSN 500 é a 782, sem cobrar o CEST (facultativo no MEI — cl. 4ª, XIII)", pendenciasDosItens([item("Refrigerante", 6, 1, { csosn: "500", cfop: "5102" })], 4).map((p) => p.campo), ["Refrigerante → csosn"]);
}

// ─── 8b. Emissor próprio: regime e série ────────────────────────────────────
console.log("\n— Emissor próprio: Regime Normal fora (IBS/CBS) e série até 889 —");
{
  const proprio = (x: Partial<ConfiguracaoFiscal> & Record<string, unknown> = {}): ConfiguracaoFiscal =>
    ({ ...CONFIG, provedor: "sefaz", tokenDoProvedor: null, ...x }) as ConfiguracaoFiscal;
  const doRegime = (c: ConfiguracaoFiscal) => pendenciasParaEmitir(c).filter((p) => p.campo === "regimeTributario");
  const crt3 = doRegime(proprio({ regimeTributario: 3 }));
  confere("CRT 3 no emissor próprio: UMA pendência de regime, a do emissor (IBS/CBS, 1115)", crt3.map((p) => [/emissor do FireHub/.test(p.mensagem), /1115/.test(p.mensagem)]), [[true, true]]);
  confere("CRT 1, 2 e 4 no emissor próprio: nenhuma pendência de regime", [1, 2, 4].map((r) => doRegime(proprio({ regimeTributario: r })).length), [0, 0, 0]);
  const daSerie = (c: ConfiguracaoFiscal) => pendenciasParaEmitir(c).filter((p) => p.campo === "serie").map((p) => p.valor);
  confere("série do bloco 890: pendência (B26-10 → 244; C02-30 → 503)", daSerie(proprio({ sefaz: { serie: 890 } as any })), ["890"]);
  confere("série do bloco 889: sem pendência", daSerie(proprio({ sefaz: { serie: 889 } as any })), []);
  confere("sem série no bloco, a do cadastro vale — e a 950 é pendência", daSerie(proprio({ serie: 950 })), ["950"]);
  confere("Focus: série 890 também é pendência (a regra é da SEFAZ)", pendenciasParaEmitir({ ...CONFIG, serie: 890 }).map((p) => p.campo), ["serie"]);
}

// ─── 9. CNPJ alfanumérico e chave de acesso ─────────────────────────────────
console.log("\n— CNPJ alfanumérico (NT 2026.004) e chave com prefixo —");
{
  confere("o exemplo da Receita é CNPJ válido", cnpjValido(CNPJ_ALFA), true);
  confere("documentoValido aceita o alfanumérico", documentoValido("12.ABC.345/01DE-35"), true);
  confere("letra em CPF é inválido", documentoValido("5299822472A"), false);
  const m = montar(pedido({ canal: "PDV", documentoDoCliente: "12.abc.345/01de-35", nomeDoCliente: "Empresa X" }), { ...CONFIG, cnpj: "12.ABC.345/01DE-35" });
  confere(
    "emitente e destinatário com letras; CNPJ vai em cnpj_destinatario",
    m.ok && [m.corpo.cnpj_emitente, m.corpo.cnpj_destinatario, m.corpo.cpf_destinatario ?? null],
    [CNPJ_ALFA, CNPJ_ALFA, null]
  );
  const chaveComLetras = "33260912ABC34501DE35650010000000011000000019";
  confere("chave de 44 com letras é aceita", chaveDeAcessoLimpa("NFe" + chaveComLetras), chaveComLetras);
  confere("chave curta é recusada", chaveDeAcessoLimpa("NFe123"), null);
  const r = traduzirNotaAutorizada(CONFIG, "https://homologacao.focusnfe.com.br", {
    status: "autorizado", chave_nfe: "NFe" + chaveComLetras, numero: "12", serie: "1",
    protocolo_nota_fiscal: { numero_protocolo: "333260000012345" },
    caminho_xml_nota_fiscal: "/arquivos/x-nfe.xml", caminho_danfe: "/notas_fiscais_consumidor/NFe1.html",
  });
  confere("autorizada: chave gravada SEM 'NFe' e protocolo do completa=1", r.ok && [r.chaveDeAcesso, r.protocolo, r.urlDoXml], [chaveComLetras, "333260000012345", "https://homologacao.focusnfe.com.br/arquivos/x-nfe.xml"]);
  const cont = traduzirNotaAutorizada(CONFIG, "https://x", {
    status: "autorizado", chave_nfe: "NFe" + chaveComLetras, numero: "13", caminho_danfe: "/notas_fiscais_consumidor/NFe13.html",
    contingencia_offline: true, contingencia_offline_efetivada: false,
  });
  confere("contingência off-line não efetivada: nota com chave e DANFE, marcada emContingencia", cont.ok && [cont.chaveDeAcesso, cont.urlDoDanfe, cont.emContingencia, /CONTINGÊNCIA/.test(cont.aviso ?? "")], [chaveComLetras, "https://x/notas_fiscais_consumidor/NFe13.html", true, true]);
  // O que a rota do botão Emitir (api/store/fiscal/emitir) grava, na mesma
  // regra dela: `!ok` → FAILED sem chave; `ok` → EMITTED com chave e DANFE.
  // Com `ok: false, motivo: "contingencia"` a nota existente sumia do painel.
  const gravadoPelaRota = (r: ReturnType<typeof traduzirNotaAutorizada>) =>
    r.ok ? { fiscalStatus: "EMITTED", nfceKey: r.chaveDeAcesso, pdfUrl: r.urlDoDanfe } : { fiscalStatus: "FAILED", nfceKey: null, pdfUrl: null };
  confere("rota Emitir não perde a nota em contingência", gravadoPelaRota(cont), { fiscalStatus: "EMITTED", nfceKey: chaveComLetras, pdfUrl: "https://x/notas_fiscais_consumidor/NFe13.html" });
  const efetivada = traduzirNotaAutorizada(CONFIG, "https://x", { status: "autorizado", chave_nfe: "NFe" + chaveComLetras, numero: "13", contingencia_offline: true, contingencia_offline_efetivada: true });
  confere("contingência já efetivada é autorizada, sem a marca", efetivada.ok && (efetivada.emContingencia ?? false), false);
}

// ─── 10. Mesa sem forma, total que não fecha, intermediadores ──────────────
console.log("\n— Recusas de dados e intermediadores —");
{
  const na = montar(pedido({ canal: "MESA", formaDePagamento: "N/A" }));
  confere("mesa 'N/A': recusa por forma não informada", !na.ok && na.pendencias.map((p) => p.campo), ["formaDePagamento"]);
  const naoFecha = montar(pedido({ canal: "SITE", valorTotal: 20 }));
  confere("canal próprio com total diferente dos itens: recusa", !naoFecha.ok && naoFecha.pendencias.map((p) => p.campo), ["valorTotal"]);
  for (const [canal, dados] of Object.entries(INTERMEDIADORES_CONHECIDOS)) {
    confere(`CNPJ do intermediador ${canal} tem DV válido (440)`, cnpjValido(dados!.cnpj), true);
  }
  const brendiComContrato = montar(pedido({ canal: "BRENDI", idNaPlataforma: "loja-123" }), { ...CONFIG, intermediadores: { BRENDI: { cnpj: "11.222.333/0001-81" } } });
  confere("canal próprio com intermediador configurado passa a declarar", brendiComContrato.ok && brendiComContrato.corpo.indicador_intermediario, 1);
  confere("sem token não emite (pendência da loja)", pendenciasParaEmitir({ ...CONFIG, tokenDoProvedor: null }).map((p) => p.campo), ["tokenDoProvedor"]);
  confere(
    "CSC cadastrado na Focus (só o final + id por ambiente) não é 'falta CSC'",
    pendenciasParaEmitir({ ...CONFIG, csc: null, cscId: null, cscFinal: "9F2A", cscNaFocus: { homologacao: { id: "2", final: "9F2A" } } }).map((p) => p.campo),
    []
  );
  confere(
    "CSC da Focus só de homologação não vale em produção (falta o id)",
    pendenciasParaEmitir({ ...CONFIG, ambiente: 1, csc: null, cscId: null, cscNaFocus: { homologacao: { id: "2", final: "9F2A" } } }).map((p) => p.campo),
    ["cscId", "csc"]
  );
}

// ─── 11. Formas de pagamento reais ─────────────────────────────────────────
console.log("\n— Rótulos reais de pagamento → tPag —");
{
  const casos: [string, Parameters<typeof formaDaNota>[1], string | null][] = [
    ["Pix (Pago Online)", { canal: "IFOOD", pagoOnline: true }, "99:Pago no app iFood (Pix)"],
    ["Crédito (Pago Online)", { canal: "IFOOD", pagoOnline: true }, "99:Pago no app iFood (Crédito)"],
    ["iFood App (Pago Online)", { canal: "IFOOD", pagoOnline: true }, "99:Pago no app iFood"],
    ["Cartão (Pago Online)", { canal: "IFOOD", pagoOnline: true }, "99:Pago no app iFood (Cartão)"],
    ["Vale Refeição (Pago Online)", { canal: "IFOOD", pagoOnline: true }, "99:Pago no app iFood (Vale Refeição)"],
    ["Pago Online (99Food)", { canal: "99FOOD", pagoOnline: true }, "99:Pago no app 99Food"],
    ["Pagamento Online (Wabiz) (Pago Online)", { canal: "WABIZ", pagoOnline: true }, "99:Pagamento online Wabiz"],
    // Canal próprio sem código de autorização gravado: 99, não 17 "não integrado".
    ["Pix (Pago Online)", { canal: "BRENDI", pagoOnline: true }, "99:Pagamento online Brendi (Pix)"],
    ["Crédito (Cobrar na Entrega)", { canal: "IFOOD", pagoOnline: false }, "03"],
    ["Débito (Cobrar na Entrega)", { canal: "IFOOD", pagoOnline: false }, "04"],
    ["Dinheiro (Cobrar na Entrega)", { canal: "IFOOD", pagoOnline: false }, "01"],
    ["Vale Refeição (Cobrar na Entrega)", { canal: "IFOOD", pagoOnline: false }, "11"],
    ["Conta Funcionário", { canal: "PDV" }, "99:Conta Funcionário (a prazo)"],
    ["DEBITO", { canal: "SITE" }, "04"],
    ["CREDITO", { canal: "SITE" }, "03"],
    ["PIX_ENTREGA", { canal: "SITE" }, "17"],
    ["VOUCHER_Ticket", { canal: "SITE" }, "11"],
    ["Vale alimentação", { canal: "PDV" }, "10"],
    ["Cartão na entrega", { canal: "WHATSAPP_IA" }, "03"],
    ["N/A", { canal: "MESA" }, null],
    ["Pendente", {}, null],
    ["A combinar (Cobrar na Entrega)", {}, null],
    ["Pagar no caixa", {}, null],
    [" ", {}, null],
  ];
  for (const [rotulo, ctx, esperado] of casos) {
    const f = formaDaNota(rotulo, ctx);
    confere(`"${rotulo}"`, f ? (f.descricao ? `${f.codigo}:${f.descricao}` : f.codigo) : null, esperado);
  }
}

// ─── 12. Endereços reais ────────────────────────────────────────────────────
console.log("\n— Endereços reais em texto livre —");
{
  const RO = { municipio: "Rio das Ostras", uf: "RJ" };
  const BSB = { municipio: "BRASILIA", uf: "DF" };
  const casos: [string, typeof RO, boolean, (string | null)[] | null][] = [
    ["R. Eduardo Pio Duarte Silva, 35 - Comp: Apartamento - Ref: Ao Lado Padaria - Mar Y Lago - Rio das Ostras", RO, true, ["R. Eduardo Pio Duarte Silva", "35", "Apartamento", "Mar Y Lago", "Rio das Ostras"]],
    ["Rua Nova Iguaçu, 668 - Atlântica (BL A AP 203 - Cond. Caravelas)", RO, false, ["Rua Nova Iguaçu", "668", "BL A AP 203 - Cond. Caravelas", "Atlântica", "Rio das Ostras"]],
    ["Rua Doutor Ricardo Bartelega, 123, Bloco 4B Apartamento 201, Jardim Mariléa - Rio das Ostras - Brasil - Rio das Ostras", RO, true, ["Rua Doutor Ricardo Bartelega", "123", "Bloco 4B Apartamento 201", "Jardim Mariléa", "Rio das Ostras"]],
    ["QD 5, Conjunto C - casa 14 - QUADRA 5 - Brasília/DF - CEP 73053030", BSB, false, ["QD 5", "S/N", "Conjunto C, casa 14", "QUADRA 5", "Brasília"]],
    ["Rua Machado da Silva, 160, Recanto", RO, false, ["Rua Machado da Silva", "160", null, "Recanto", "Rio das Ostras"]],
    ["Rua Machado da Silva, 160, Recanto, Rio das Ostras", RO, false, ["Rua Machado da Silva", "160", null, "Recanto", "Rio das Ostras"]],
    ["Rua dos beijos lote 50 quadra 8 - Âncora", RO, false, ["Rua dos beijos lote 50 quadra 8", "S/N", null, "Âncora", "Rio das Ostras"]],
    ["AR 13, 29 - Comp: AR 13, CONJUNTO 19 - Ref: Entrando Na Esquina - Sobradinho - Brasília", BSB, true, ["AR 13", "29", "AR 13, CONJUNTO 19", "Sobradinho", "Brasília"]],
    ["R. Alagoas, 574 - Comp: Casa - Cidade Praiana - Casimiro de Abreu", RO, true, ["R. Alagoas", "574", "Casa", "Cidade Praiana", "Casimiro de Abreu"]],
    // 99Food (formato do Google): "bairro, cidade - UF". Brazza, Rio das Ostras → Casimiro de Abreu.
    ["Rua das Flores, 10 - Barra de São João, Casimiro de Abreu - RJ", RO, false, ["Rua das Flores", "10", null, "Barra de São João", "Casimiro de Abreu"]],
    ["Rua Alexandre Barbosa, 396 - Recreio, Rio das Ostras - RJ", RO, false, ["Rua Alexandre Barbosa", "396", null, "Recreio", "Rio das Ostras"]],
    ["Rua Aroldo Ribeiro Elias, 49 - Nova Esperança, Rio das Ostras - RJ, loja amarela", RO, false, ["Rua Aroldo Ribeiro Elias", "49", "loja amarela", "Nova Esperança", "Rio das Ostras"]],
    // Complemento do 99 com " - " depois da UF: o bairro continua sendo o de antes da cidade.
    ["Rua Recife, 335 - Barra de São João, Casimiro de Abreu - RJ, sobrado - fundos", RO, false, ["Rua Recife", "335", "fundos, sobrado", "Barra de São João", "Casimiro de Abreu"]],
    // iFood: o nome da rua tem vírgula e o número vem por último. "54B" não é
    // bairro, e adivinhar outra parte da rua também não: recusa.
    ["R.  Ágatha,Lto Recanto Dos Paratis, 54B - Comp: Cs - Ref: Recanto dos Paratis 1 - Casimiro de Abreu", RO, true, null],
    ["SH Mansões Sobradinho, Condomínio Fibral, 30 - Comp: Conjunto B - Ref: Subida Do Mercado Fox - Brasília", BSB, true, null],
    // JotaJá repete a cidade (formattedAddress + city): a repetição não é bairro.
    ["Rua Tal, 10, Vila Nova - Casimiro de Abreu - Brasil - Casimiro de Abreu", RO, true, ["Rua Tal", "10", null, "Vila Nova", "Casimiro de Abreu"]],
    // DF tem um município só: a "cidade" do Google é a região administrativa.
    ["q 11 cj a, q 11 cj a LT 56 - Sobradinho, Sobradinho - DF, lote 56", BSB, false, ["q 11 cj a", "q 11 cj a LT 56", "lote 56", "Sobradinho", "BRASILIA"]],
    ["ar 6, cj 3 LT 1 - Sobradinho II, Sobradinho - DF, apartamento em cima da conveniência do Dudu", BSB, false, ["ar 6", "cj 3 LT 1", "apartamento em cima da conveniência do Dudu", "Sobradinho II", "BRASILIA"]],
    ["Rua 5 - Sobradinho - DF", BSB, false, ["Rua 5", "S/N", null, "Sobradinho", "BRASILIA"]],
    // iFood sem bairro em cidade vizinha: a cidade NÃO vira bairro — recusa.
    ["R. Alagoas, 574 - Comp: Casa - Casimiro de Abreu", RO, true, null],
    // 99Food sem bairro em cidade vizinha: idem.
    ["Rua 17 - Casimiro de Abreu - RJ", RO, false, null],
    ["quadra 1", RO, false, null],
    ["", RO, false, null],
  ];
  for (const [texto, loja, cidadeNoFim, esperado] of casos) {
    const l = lerEnderecoDeEntrega(texto, loja, { cidadeNoFim });
    confere(`"${texto.slice(0, 48)}${texto.length > 48 ? "…" : ""}"`, l.ok ? [l.endereco.logradouro, l.endereco.numero, l.endereco.complemento, l.endereco.bairro, l.endereco.municipio] : null, esperado);
  }
  const wabiz = lerEnderecoDeEntrega("QD 5, Conjunto C - casa 14 - QUADRA 5 - Brasília/DF - CEP 73053030", BSB);
  confere("CEP e UF do Wabiz", wabiz.ok && [wabiz.endereco.cep, wabiz.endereco.uf, wabiz.endereco.municipioDaLoja], ["73053030", "DF", true]);
  const vizinha = lerEnderecoDeEntrega("R. Alagoas, 574 - Cidade Praiana - Casimiro de Abreu", RO, { cidadeNoFim: true });
  confere("cidade vizinha: não usa o código IBGE da loja", vizinha.ok && vizinha.endereco.municipioDaLoja, false);
  const vizinha99 = lerEnderecoDeEntrega("Rua das Flores, 10 - Barra de São João, Casimiro de Abreu - RJ", RO);
  confere("cidade vizinha no 99Food: município do texto, UF RJ, sem IBGE da loja", vizinha99.ok && [vizinha99.endereco.uf, vizinha99.endereco.municipioDaLoja], ["RJ", false]);
  const semBairro = lerEnderecoDeEntrega("R. Alagoas, 574 - Comp: Casa - Casimiro de Abreu", RO, { cidadeNoFim: true });
  confere("iFood sem bairro: falta o bairro, e a cidade lida é a do texto", !semBairro.ok && [semBairro.falta, semBairro.parcial.municipio, semBairro.parcial.municipioDaLoja], [["bairro"], "Casimiro de Abreu", false]);
  const df = lerEnderecoDeEntrega("q 11 cj a, q 11 cj a LT 56 - Sobradinho, Sobradinho - DF, lote 56", BSB);
  confere("DF: município da loja (Brasília), código IBGE da loja", df.ok && df.endereco.municipioDaLoja, true);
  // Wabiz: "DF - 425" é a rodovia DF-425, não UF + cidade. "Brasília/DF" manda,
  // o complemento não some, e "425" não vira bairro.
  const rodovia = lerEnderecoDeEntrega("Condominio Vivendas Serrana, 1 - Módulo X casa 01 - DF - 425 - Brasília/DF - CEP 73092900", BSB);
  confere("Wabiz com a rodovia DF-425: recusa pelo bairro, cidade Brasília, complemento mantido", !rodovia.ok && [rodovia.falta, rodovia.parcial.municipio, rodovia.parcial.complemento], [["bairro"], "Brasília", "Módulo X casa 01"]);
}

// ─── 13. Entrega em cidade vizinha: a nota inteira ─────────────────────────
console.log("\n— Nota de entrega em cidade vizinha (Brazza, 99Food → Casimiro de Abreu) —");
{
  const doc99 = {
    id: "cm-brazza", source: "99FOOD", openDeliveryChannel: "99FOOD", openDeliveryReference: "1001", food99AppShopId: "5764607523034234880",
    deliveryType: "DELIVERY", deliveryBy: "MERCHANT", totalAmount: 40, deliveryFee: 8,
    paymentMethod: "Pago Online (99Food)", customerCpfCnpj: CPF, customerName: "Ana",
    customerAddress: "Rua das Flores, 10 - Barra de São João, Casimiro de Abreu - RJ",
    items: [{ id: "i1", productName: "Burguer", quantity: 1, price: 32, menuProduct: { id: "bg", ncm: "21069090", cfop: "5102", csosn: "102" } }],
  };
  const m = montar(pedidoParaNota(doc99));
  confere("montou", m.ok, true);
  if (m.ok) {
    confere(
      "bairro, município e UF do texto; sem o código IBGE da loja",
      [m.corpo.bairro_destinatario, m.corpo.municipio_destinatario, m.corpo.uf_destinatario, m.corpo.codigo_municipio_destinatario ?? null],
      ["Barra de São João", "Casimiro de Abreu", "RJ", null]
    );
  }
  const ifoodSemBairro = montar(pedidoParaNota({ ...pedidoIfood, customerAddress: "R. Alagoas, 574 - Comp: Casa - Casimiro de Abreu" }, { loja: { ifoodMerchantId: MERCHANT } }));
  confere("iFood sem bairro em cidade vizinha: recusa pelo bairro (não manda a cidade como bairro)", !ifoodSemBairro.ok && ifoodSemBairro.pendencias.map((p) => p.campo), ["enderecoDoCliente"]);
}

// ─── 14. JotaJá: "00000000000" é "sem CPF" ─────────────────────────────────
console.log("\n— JotaJá com o CPF de preenchimento 00000000000 —");
{
  confere("documentoDeVerdade: zeros e repetido são 'sem documento'", [documentoDeVerdade("00000000000"), documentoDeVerdade("000.000.000-00"), documentoDeVerdade("11111111111"), documentoDeVerdade("0")], [null, null, null, null]);
  confere("documentoDeVerdade: número de verdade passa (inválido também, para ser recusado)", [documentoDeVerdade("529.982.247-25"), documentoDeVerdade("52998224724")], [CPF, "52998224724"]);
  const jotaja = {
    id: "jj-ret", source: "JOTAJA", openDeliveryChannel: "JOTAJA", openDeliveryOrderId: "od-2", deliveryType: "RETIRADA", totalAmount: 49.9, deliveryFee: 0,
    paymentMethod: "Pix (Cobrar na Entrega)", customerCpfCnpj: "00000000000", customerName: "Cliente Jotajá",
    items: [{ id: "i1", productName: "Pizza", quantity: 1, price: 49.9, menuProduct: { id: "pz", ncm: "19059090", cfop: "5102", csosn: "102" } }],
  };
  const retirada = montar(pedidoParaNota(jotaja));
  confere("retirada JotaJá com 00000000000: monta, presença 1, sem destinatário", retirada.ok && [retirada.corpo.presenca_comprador, retirada.corpo.cpf_destinatario ?? null, (retirada.corpo.formas_pagamento as any[])[0].forma_pagamento], [1, null, "17"]);
  const entrega = montar(pedidoParaNota({
    ...jotaja, id: "jj-ent", deliveryType: "DELIVERY", deliveryFee: 6, totalAmount: 55.9, customerName: "Paulo Mendes",
    customerAddress: "Rua Recife, 506, Casa 3 , Jardim Bela Vista - Rio das Ostras - Brasil - Rio das Ostras",
  }));
  verdade(
    "entrega JotaJá com 00000000000: a pendência é 'Entrega sem CPF', não 'CPF inválido'",
    !entrega.ok && entrega.pendencias.length === 1 && entrega.pendencias[0].mensagem.startsWith("Entrega sem CPF do cliente"),
    JSON.stringify(!entrega.ok && entrega.pendencias)
  );
  // "Cliente Jotajá" é o rótulo que o parceiro põe quando não há nome: na
  // entrega, além do CPF, falta o nome que o DANFE tem de imprimir (3.1.6).
  const semNome = montar(pedidoParaNota({
    ...jotaja, id: "jj-ent2", deliveryType: "DELIVERY", deliveryFee: 6, totalAmount: 55.9,
    customerAddress: "Rua Recife, 506, Casa 3 , Jardim Bela Vista - Rio das Ostras - Brasil - Rio das Ostras",
  }));
  confere("entrega JotaJá com 'Cliente Jotajá': faltam o CPF e o nome", !semNome.ok && semNome.pendencias.map((p) => p.campo), ["documentoDoCliente", "nomeDoCliente"]);
  // A rota do botão Emitir ainda monta o objeto à mão com o valor cru.
  const aMao = montar(pedido({ canal: "PDV", documentoDoCliente: "000.000.000-00" }));
  confere("objeto montado à mão com 000.000.000-00: monta sem destinatário", aMao.ok && (aMao.corpo.cpf_destinatario ?? null), null);
  const invalido = montar(pedido({ canal: "PDV", documentoDoCliente: "52998224724" }));
  confere("CPF digitado errado continua recusado", !invalido.ok && invalido.pendencias.map((p) => p.campo), ["documentoDoCliente"]);
}

// ─── 15. 99Food antigo: o cupom do 99 sem as colunas gravadas ─────────────
console.log("\n— 99Food anterior a 18/09 (pedido real cmtxn22): cupom do 99 lido das promoções —");
{
  const antigo = {
    id: "cmtxn22ow073gn101rfhov71p", source: "99FOOD", openDeliveryChannel: "99FOOD", food99AppShopId: "5764607523034234880",
    deliveryType: "DELIVERY", deliveryBy: "99FOOD", totalAmount: 65, deliveryFee: 0, discountTotal: 29.99,
    discountIfood: null, discountMerchant: null,
    discountDetails: {
      cupom: 0, itens: 25, total: 29.99, entrega: 4.99,
      promocoes: [
        { promo_type: 3, promo_discount: 499, shop_subside_price: 499 },
        { promo_type: 11, promo_discount: 2500, shop_subside_price: 0 },
      ],
    },
    paymentMethod: "Pago Online (99Food)", customerCpfCnpj: CPF, customerName: "Ana",
    customerAddress: "Rua Alexandre Barbosa, 396 - Recreio, Rio das Ostras - RJ",
    items: [{ id: "i1", productName: "2 Burguer + 2 Batatas P + 2 Latas", quantity: 1, price: 65, menuProduct: { id: "cb", ncm: "21069090", cfop: "5102", csosn: "102" } }],
  };
  const p = pedidoParaNota(antigo);
  const v = valoresDaNota(p);
  confere("cupom de 25,00 do 99 sai do vDesc; só os 4,99 da loja ficam", [v.desconto, v.subsidioDaPlataforma, v.total, v.parteDoCliente], [499, 2500, 6001, 3501]);
  const m = montar(p);
  confere(
    "pagamentos: app do 99 + cupom pago pelo 99Food",
    m.ok && (m.corpo.formas_pagamento as any[]).map((f) => [f.forma_pagamento, f.valor_pagamento, f.descricao_pagamento]),
    [["99", 35.01, "Pago no app 99Food"], ["99", 25, "Cupom pago pelo 99Food"]]
  );
  // deliveryBy "99FOOD": o entregador é do 99 — transportador = o 99Food.
  confere(
    "entregue pelo 99: transportador = 99Food (CNPJ do intermediador), modFrete 2",
    m.ok && [p.entregadorDaPlataforma, m.corpo.modalidade_frete, m.corpo.cnpj_transportador, m.corpo.nome_transportador],
    ["99FOOD", 2, "60112920000123", "99 FOOD LTDA."]
  );
}

// ─── 16. Quem leva: o transportador pela regra única de "quem entrega" ─────
console.log("\n— Transportador: a regra do painel e da comanda (lib/entrega-parceira) —");
{
  const quem = (x: Record<string, unknown>) => pedidoParaNota({ ...pedidoIfood, ...x }).entregadorDaPlataforma ?? null;
  confere("iFood com deliveryBy MERCHANT: a loja", quem({ deliveryBy: "MERCHANT" }), null);
  confere("iFood com deliveryBy IFOOD: o iFood", quem({ deliveryBy: "IFOOD" }), "IFOOD");
  confere("iFood sem deliveryBy, sem entregador: a loja (o pedido não diz)", quem({ deliveryBy: null }), null);
  confere("iFood sem deliveryBy, com entregador do iFood atribuído: o iFood", quem({ deliveryBy: null, ifoodDriverName: "Carlos" }), "IFOOD");
  confere("iFood com código de coleta e nada mais: a loja (código não prova)", quem({ deliveryBy: null, ifoodPickupCode: "1234" }), null);
  // Objeto montado à mão sem o campo novo: `entregaPelaPlataforma` ainda diz que o iFood leva.
  const aMao = montar({ ...pedidoParaNota({ ...pedidoIfood, deliveryBy: "IFOOD" }, { loja: { ifoodMerchantId: MERCHANT } }), entregadorDaPlataforma: undefined });
  confere("só com entregaPelaPlataforma: o iFood leva", aMao.ok && [aMao.corpo.modalidade_frete, aMao.corpo.cnpj_transportador], [2, "14380200000121"]);
  // Plataforma que não é intermediador (logística do JotaJá): o nome dela, sem CNPJ.
  const jota = montar(pedidoParaNota({
    id: "jj-log", source: "JOTAJA", openDeliveryChannel: "JOTAJA", openDeliveryOrderId: "od-9", deliveryType: "DELIVERY", deliveryBy: "LOGISTICS",
    totalAmount: 55.9, deliveryFee: 6, paymentMethod: "Pix (Cobrar na Entrega)", customerCpfCnpj: CPF, customerName: "Paulo",
    customerAddress: "Rua Recife, 506, Casa 3 , Jardim Bela Vista - Rio das Ostras - Brasil - Rio das Ostras",
    items: [{ id: "i1", productName: "Pizza", quantity: 1, price: 49.9, menuProduct: { id: "pz", ncm: "19059090", cfop: "5102", csosn: "102" } }],
  }));
  confere("logística do JotaJá (sem intermediador): transportador JotaJá, só o nome, modFrete 2", jota.ok && [jota.corpo.modalidade_frete, jota.corpo.cnpj_transportador ?? null, jota.corpo.nome_transportador], [2, null, "JotaJá"]);
}

console.log(falhas === 0 ? "\n✅ Tudo certo." : `\n❌ ${falhas} falha(s).`);
if (falhas > 0) process.exit(1);
