/**
 * /src/lib/fiscal-emissao.ts
 *
 * Emissão de NFC-e. A regra deste arquivo cabe numa frase:
 * **enquanto não houver emissão de verdade, o sistema diz que não emitiu.**
 *
 * O que existia antes: o botão "Emitir" da tela fiscal era
 * `await new Promise(r => setTimeout(r, 1200))` seguido de
 * `alert("✅ Nota Fiscal emitida com sucesso")`. Nenhuma API era chamada. A
 * listagem completava o teatro fabricando chave de acesso (prefixo "352608"
 * fixo + dígitos do id do lojista), número de NFC-e (resto de divisão do
 * timestamp), protocolo ("13526" + timestamp) e marcava a nota como AUTORIZADA
 * porque o pedido tinha mais de uma hora. A inutilização de numeração devolvia
 * um protocolo de `Math.random()` com a frase "inutilizada com sucesso na
 * SEFAZ".
 *
 * Isso é pior que não ter módulo. Um lojista que confiasse nessas telas passaria
 * meses achando que estava emitindo, sem uma única nota na SEFAZ — e descobriria
 * na fiscalização. A inutilização falsa é ainda mais grave: ele acreditaria ter
 * regularizado uma faixa de numeração que continua em aberto.
 *
 * Emitir NFC-e de verdade exige coisas que não se resolvem no código sozinho:
 * certificado digital A1 da empresa, CSC obtido no portal da SEFAZ do estado,
 * e um caminho de transmissão (provedor contratado ou webservice próprio
 * homologado). Enquanto essas peças não existirem, este arquivo devolve
 * `nao_configurado` com a lista exata do que falta — e a tela mostra essa lista.
 *
 * ── O CONTEÚDO DA NOTA (revisão de 24/09/2026) ──────────────────────────────
 *
 * A montagem do corpo virou uma função PURA (`montarCorpoDaNfce`), testada em
 * scripts/teste-fiscal-corpo-da-nfce.ts sem precisar de token nem de SEFAZ. As
 * regras, cada uma com a fonte conferida:
 *
 *  - Presença: NFC-e só aceita indPres 1, 4 ou 5 desde 03/08/2026 (NT 2026.002,
 *    regra B25b-20, rejeição 717). Entrega = 4; todo o resto (balcão, mesa,
 *    totem, RETIRADA de pedido do iFood/site) = 1, porque a mercadoria é
 *    entregue ao cliente dentro da loja.
 *  - Entrega (indPres 4) exige destinatário identificado (NT 2026.002, E01-20,
 *    rejeição 787) e endereço (rejeição 788). Sem CPF/CNPJ ou sem endereço
 *    legível, a emissão RECUSA com a pendência — não manda para tomar rejeição.
 *  - Intermediador: iFood e 99Food vão com indIntermed=1 + CNPJ + identificador
 *    da loja na plataforma (NT 2020.006, B25c-10 rejeição 434, YB01-10
 *    rejeição 438). Brendi, Wabiz e JotaJá são software de delivery PRÓPRIO da
 *    loja — venda em "site/plataforma própria" pela definição da própria NT.
 *  - Pagamento: cartão (03/04) e Pix (17) levam o grupo de cartão (NT 2025.001,
 *    YA04-10, rejeição 391); 99-Outros leva descrição (NT 2020.006, YA02a-10,
 *    rejeição 441); soma dos pagamentos − troco = total (YA03-10/20, 865/866).
 *  - Cupom pago pela PLATAFORMA não é desconto da loja: a loja recebe o valor
 *    cheio (parte do cliente, parte do iFood). Vai como pagamento, não como
 *    vDesc — ver `valoresDaNota`.
 *  - Transporte (grupo X): a NFC-e de entrega (indPres 4) leva SEMPRE o
 *    transportador (MOC 7.0 Anexo I, X03-20, rejeição 786); a que não é
 *    entrega não leva (X03-10, 754) e vai com modFrete 9 (X02-10, 753). Motoboy
 *    da loja: o próprio emitente, modFrete 3; entregador da plataforma: a
 *    plataforma, modFrete 2 — ver `transporteDaNota`.
 *  - Entrega exige também o NOME do cliente: o DANFE da entrega imprime nome e
 *    endereço (Manual do DANFE NFC-e v6.0, 3.1.6), e o DANFE só mostra o XML.
 *  - Campos da Focus conferidos em https://doc.focusnfe.com.br/reference/emitir_nfce
 *    e na lista completa https://campos.focusnfe.com.br/nfe/NotaFiscalXML.html.
 */
import type { Problema } from "./fiscal-validacao";
import {
  chaveDeAcessoLimpa,
  cnpjValido,
  documentoValido,
  pendenciasDoEmitente,
  pendenciasDoProduto,
} from "./fiscal-validacao";
import { ratearEmCentavos } from "./rateio";
import { nomeDoAmbiente, tokenDoAmbiente, type TokensDoProvedor } from "./fiscal-credenciais";
import type { ChaveDeCanal } from "./canal-do-pedido";
import { documentoDeVerdade, lerEnderecoDeEntrega, nomeServeDeDestinatario, normalizarDocumento } from "./documento-do-cliente";
import { usaEmissorProprio, type ConfigDoEmissorProprio } from "./nfce/config-da-loja";
import { dadosDoEmissorParaConferencia, pendenciasDoEmissorProprio, serieDoEmissor } from "./nfce/pendencias";

export type ItemDaNota = {
  codigo: string;
  descricao: string;
  ncm: string;
  cest?: string | null;
  cfop: string;
  unidadeComercial: string;
  quantidade: number;
  valorUnitario: number;
  valorTotal: number;
  origem: number;
  csosn?: string | null;
  cst?: string | null;
  /** Situação tributária de PIS/COFINS (2 dígitos). "49" = outras operações. */
  pis?: string | null;
  cofins?: string | null;
};

/** Uma forma de pagamento com o valor que ela cobriu (pagamento dividido). */
export type PagamentoInformado = { forma: string; valor: number };

/**
 * Um benefício (cupom, promoção) do pedido e QUEM pagou cada parte.
 *
 * Vem do `discountDetails` que o webhook do iFood grava: `alvo` é o
 * `target` deles ("ITEM", "CART", "DELIVERY_FEE"), `plataforma` a parte
 * patrocinada pelo iFood e `loja` a parte da loja.
 */
export type DescontoDetalhado = { alvo: string; plataforma: number; loja: number };

export type PedidoParaNota = {
  id: string;
  numero: number | null;
  itens: ItemDaNota[];
  /**
   * O que o CLIENTE pagou (`totalAmount`). No iFood e no 99Food inclui taxas
   * que são da plataforma (taxa de serviço, entrega feita por eles) — por
   * isso o total da nota não é este número nesses canais; ver `valoresDaNota`.
   */
  valorTotal: number;
  /**
   * Taxa de entrega. Vai como "outras despesas acessórias" (vOutro), rateada
   * nos itens; o transportador e a modalidade do frete saem de `transporteDaNota`.
   */
  taxaEntrega?: number;
  /** Desconto total do pedido (loja + plataforma). */
  desconto?: number;
  formaDePagamento: string;
  documentoDoCliente?: string | null;
  nomeDoCliente?: string | null;
  /**
   * O pedido é entrega a domicílio? Decide a presença (4 = entrega, 1 =
   * presencial) e, com ela, a obrigação de CPF e endereço do cliente.
   */
  entregaEmDomicilio?: boolean;

  // ── Campos abaixo: preenchidos por `pedidoParaNota` (lib/fiscal-itens). ──
  // Opcionais para não quebrar quem ainda monta o objeto à mão; sem eles a
  // nota sai como venda de canal próprio, com uma forma de pagamento só.

  /** Pagamento dividido (`paymentMethods`): várias formas na mesma nota. */
  pagamentos?: PagamentoInformado[] | null;
  /** A nota que o cliente entrega para pagar em dinheiro ("troco para 50"). */
  trocoPara?: number | null;
  /** De onde veio o pedido (lib/canal-do-pedido). */
  canal?: ChaveDeCanal | null;
  /** O número do pedido no parceiro (#ABC123), para a informação adicional. */
  referenciaNoCanal?: string | null;
  /** Já pago por caminho eletrônico (app do parceiro, gateway). */
  pagoOnline?: boolean;
  /** Parte do desconto paga pela plataforma (`discountIfood`). */
  descontoDaPlataforma?: number | null;
  /** O desconto benefício a benefício, quando o parceiro detalha. */
  descontosDetalhados?: DescontoDetalhado[] | null;
  /** Entrega feita pelo iFood (Entrega Parceira): a taxa é deles, não da loja. */
  entregaPelaPlataforma?: boolean;
  /**
   * A plataforma cujo ENTREGADOR leva o pedido ("IFOOD", "99FOOD"...), pela
   * regra única de "quem entrega" do sistema (lib/entrega-parceira →
   * infoDaEntrega, a mesma do painel e da comanda); null = o motoboy da loja,
   * ou o pedido não diz. Decide só o TRANSPORTADOR da nota (grupo X,
   * `transporteDaNota`): a taxa de entrega continua decidida por
   * `entregaPelaPlataforma`.
   */
  entregadorDaPlataforma?: string | null;
  /** `customerAddress`, texto livre. */
  enderecoDoCliente?: string | null;
  /** Identificador da loja na plataforma (merchant do iFood, shop do 99Food). */
  idNaPlataforma?: string | null;
};

export type ConfiguracaoFiscal = {
  provedor?: string | null; // "focusnfe" | "sefaz" (emissor próprio, lib/nfce) | null
  /** O bloco do emissor próprio (certificado, CSC, série, QR) — lib/nfce/config-da-loja. */
  sefaz?: ConfigDoEmissorProprio | null;
  complemento?: string | null;
  tokenDoProvedor?: string | null;
  /** Tokens da Focus por ambiente, CIFRADOS (lib/fiscal-credenciais). */
  tokens?: TokensDoProvedor | null;
  cnpj?: string | null;
  inscricaoEstadual?: string | null;
  razaoSocial?: string | null;
  nomeFantasia?: string | null;
  regimeTributario?: number | null;
  logradouro?: string | null;
  numero?: string | null;
  bairro?: string | null;
  municipio?: string | null;
  codigoMunicipio?: string | null;
  uf?: string | null;
  cep?: string | null;
  serie?: number | null;
  ambiente?: number | null;
  cscId?: string | null;
  csc?: string | null;
  /**
   * Quando o CSC foi cadastrado DIRETO na Focus (api/store/fiscal/provisionar),
   * o FireHub guarda só o final dele e o id por ambiente — o CSC inteiro mora
   * lá, que é quem assina o QR Code.
   */
  cscFinal?: string | null;
  cscNaFocus?: {
    homologacao?: { id: string; final: string } | null;
    producao?: { id: string; final: string } | null;
  } | null;
  temCertificado?: boolean;
  /** Id da empresa na Focus quando a loja foi cadastrada pelo FireHub (rota /provisionar). */
  focusEmpresaId?: string | null;
  /**
   * Ajuste por canal do intermediador. `cnpj`/`id` sobrepõem o padrão de
   * INTERMEDIADORES_CONHECIDOS; num canal próprio (Brendi, Wabiz, JotaJá),
   * informar `cnpj` passa a declarar o intermediador; `ativo: false` desliga.
   */
  intermediadores?: Partial<Record<string, { cnpj?: string | null; id?: string | null; ativo?: boolean }>> | null;
  /** A loja recebe Pix por chave/QR fixo: vai como 20 (Pix estático), sem grupo de cartão. */
  pixEstatico?: boolean;
  /**
   * Para a UF que recusa NFC-e de entrega (rejeição 785 — "resolva com presença
   * 1", segundo as bases de conhecimento da Oobj e TecnoSpeed): a entrega sai
   * como venda presencial. Desligado por padrão.
   */
  entregaComoPresencial?: boolean;
};

/** Uma nota que a SEFAZ (ou a contingência) numerou. */
export type NotaEmitida = {
  /** 44 posições, SEM o prefixo "NFe" que a Focus devolve. */
  chaveDeAcesso: string;
  numero: number;
  serie: number;
  protocolo: string;
  emitidaEm: string;
  urlDoXml: string | null;
  urlDoDanfe: string | null;
  urlDoQrCode?: string | null;
  ambiente: number;
  /**
   * Emitida em CONTINGÊNCIA OFF-LINE e ainda não efetivada na SEFAZ: o cupom
   * vale para o cliente e o DANFE tem de ser impresso, mas a nota ainda vai
   * ser transmitida (até 24 h) e PODE ser rejeitada. Quem grava e sabe desta
   * marca guarda a nota como pendente de efetivação; quem não sabe grava como
   * emitida — com a chave e o DANFE, que é o mínimo.
   */
  emContingencia?: boolean;
  /** Frase para o lojista quando `emContingencia`. */
  aviso?: string;
  /**
   * O que o PROVEDOR precisa guardar no fiscalInfo além dos campos de sempre
   * (lib/fiscal-automatico → gravarResultado junta isto em toda gravação). O
   * emissor próprio (lib/nfce/emissao-da-loja) põe aqui o XML no cofre, o QR
   * Code, a reserva do número, o envio a conferir; a Focus não usa.
   */
  gravarNoPedido?: Record<string, unknown>;
};

export type ResultadoDaEmissao =
  | ({ ok: true } & NotaEmitida)
  | {
      ok: false;
      motivo:
        | "nao_configurado"
        | "dados_incompletos"
        | "rejeitada"
        | "erro_de_comunicacao"
        | "processando";
      mensagem: string;
      pendencias?: Problema[];
      detalheDaRejeicao?: string;
      /** Código da SEFAZ quando foi ela quem recusou ("787", "391"...). */
      statusSefaz?: string;
      /** Ver `NotaEmitida.gravarNoPedido`: a reserva do número, o envio a conferir, o cStat. */
      gravarNoPedido?: Record<string, unknown>;
      /**
       * Não grave nada: outra emissão do MESMO pedido está transmitindo agora
       * (lib/nfce/numeracao, "emissão em curso") e é ela que grava o resultado.
       */
      naoGravar?: boolean;
    };

/**
 * Provedores que este código sabe conversar. Nenhum vem ligado por padrão.
 * "sefaz" é o emissor PRÓPRIO (lib/nfce): transmite direto à SEFAZ.
 */
export const PROVEDORES_SUPORTADOS = ["focusnfe", "sefaz"] as const;
export type Provedor = (typeof PROVEDORES_SUPORTADOS)[number];

/**
 * A loja está pronta para emitir?
 *
 * Devolve a lista de pendências. Lista vazia significa que os dados estão
 * completos — o que ainda não garante autorização, porque quem autoriza é a
 * SEFAZ, mas garante que não vamos gastar a viagem à toa.
 */
export function pendenciasParaEmitir(config: ConfiguracaoFiscal): Problema[] {
  // EMISSOR PRÓPRIO ("sefaz"): os mesmos dados da empresa, mas o CSC e o
  // certificado são os do bloco `sefaz` (lib/nfce/pendencias) — cifrados no
  // FireHub, por ambiente — e token da Focus não se aplica. Além do que falta,
  // o que está ERRADO: certificado vencido ou de outro CNPJ, UF que o emissor
  // ainda não atende, id de CSC torto.
  if (usaEmissorProprio(config)) {
    const proprio = dadosDoEmissorParaConferencia(config);
    const doEmissor = pendenciasDoEmissorProprio(config);
    // O Regime Normal tem a frase do emissor próprio (a do IBS/CBS, em
    // lib/nfce/pendencias): a genérica do emitente não repete o mesmo campo.
    const oEmissorFalaDoRegime = doEmissor.some((p) => p.campo === "regimeTributario");
    return [
      ...pendenciasDoEmitente({
        cnpj: config.cnpj,
        inscricaoEstadual: config.inscricaoEstadual,
        razaoSocial: config.razaoSocial,
        regimeTributario: config.regimeTributario,
        logradouro: config.logradouro,
        numero: config.numero,
        bairro: config.bairro,
        municipio: config.municipio,
        codigoMunicipio: config.codigoMunicipio,
        uf: config.uf,
        cep: config.cep,
        serie: proprio.serie,
        ambiente: config.ambiente,
        cscId: proprio.cscId,
        csc: proprio.csc,
        temCertificado: proprio.temCertificado,
      }).filter((p) => !(oEmissorFalaDoRegime && p.campo === "regimeTributario")),
      ...doEmissor,
    ];
  }

  // CSC cadastrado na Focus conta como CSC presente. Sem isto, a loja que fez
  // o cadastro certinho pela tela nova via "falta o CSC" para sempre na rota
  // de emitir, na automática e na inutilização — que leem a config sem a ponte
  // da tela (`configParaConferencia` em lib/fiscal-config).
  //
  // A MESMA regra da ponte (lib/fiscal-config → cscDoAmbiente): na loja
  // cadastrada pelo FireHub o CSC é POR AMBIENTE e só vale o `cscNaFocus` do
  // ambiente da nota. Um `cscId`/`cscFinal` velho em cima (o /provisionar
  // antigo espelhava o de homologação ali) não pode fazer a emissão dizer
  // "pronta" para produção enquanto a tela diz "sem CSC deste ambiente".
  const cscDaFocus = config.cscNaFocus?.[nomeDoAmbiente(config.ambiente)] ?? null;
  const naFocus = Boolean(String(config.focusEmpresaId ?? "").trim());
  const cscId = naFocus ? cscDaFocus?.id || null : config.cscId || cscDaFocus?.id || null;
  const csc = naFocus
    ? (cscDaFocus?.id ? "(cadastrado na Focus)" : null)
    : config.csc || (config.cscFinal || cscDaFocus?.final ? "(cadastrado na Focus)" : null);
  const faltas = pendenciasDoEmitente({
    cnpj: config.cnpj,
    inscricaoEstadual: config.inscricaoEstadual,
    razaoSocial: config.razaoSocial,
    regimeTributario: config.regimeTributario,
    logradouro: config.logradouro,
    numero: config.numero,
    bairro: config.bairro,
    municipio: config.municipio,
    codigoMunicipio: config.codigoMunicipio,
    uf: config.uf,
    cep: config.cep,
    serie: config.serie,
    ambiente: config.ambiente,
    cscId,
    csc,
    temCertificado: config.temCertificado,
  });

  if (!config.provedor || !PROVEDORES_SUPORTADOS.includes(config.provedor as Provedor)) {
    faltas.push({
      campo: "provedor",
      valor: config.provedor ?? null,
      mensagem:
        "Emissor não definido. Salve o cadastro fiscal uma vez: desde 09/10/2026 as notas saem pelo " +
        "Emissor do FireHub, direto na SEFAZ, e a gravação deixa isso marcado.",
    });
  } else if (!tokenDoAmbiente(config)) {
    faltas.push({
      campo: "tokenDoProvedor",
      valor: null,
      mensagem: `Token de acesso do provedor "${config.provedor}" não cadastrado.`,
    });
  }

  return faltas;
}

/** Confere os itens antes de montar a nota. Um item sem NCM derruba a nota inteira. */
export function pendenciasDosItens(itens: ItemDaNota[], regime: number): Problema[] {
  const faltas: Problema[] = [];
  for (const item of itens) {
    for (const p of pendenciasDoProduto(item, regime)) {
      faltas.push({ ...p, campo: `${item.descricao} → ${p.campo}` });
    }
  }
  return faltas;
}

// ─── Intermediador (marketplace) ────────────────────────────────────────────

/**
 * As plataformas que VENDEM pela loja e repassam o dinheiro depois.
 *
 * Ajustes SINIEF 21/2020 e 22/2020 + NT 2020.006: venda feita em plataforma de
 * terceiro leva indIntermed=1, o CNPJ do intermediador e o identificador da
 * loja cadastrado nele. A regra B25c-10 exige o indicador em toda nota de
 * saída com presença 1, 2, 3, 4 ou 9 (rejeição 434); a YB01-10 exige o grupo
 * do intermediador quando o indicador é 1 (rejeição 438); a YB02-10 confere o
 * dígito do CNPJ (rejeição 440). Na presença 1 (retirada no balcão de pedido
 * do iFood) a validação não obriga, mas a NT diz que a legislação obriga
 * ("deve a empresa preencher indIntermed=1 ... por força da legislação
 * tributária") — então vai igual.
 *
 * CNPJs conferidos em 24/09/2026:
 *  - iFood: 14.380.200/0001-21, IFOOD.COM AGENCIA DE RESTAURANTES ONLINE S.A.,
 *    atividade principal "intermediação e agenciamento de serviços e negócios"
 *    (cadastro da Receita, visto em cnpj.biz/14380200000121 e Serasa).
 *  - 99Food: 60.112.920/0001-23, 99 FOOD LTDA. (antes NOURISHFLOW BRASIL LTDA.),
 *    o CNPJ impresso no rodapé do portal do parceiro (merchant.99app.com) e com
 *    a mesma atividade de intermediação (cnpja.com/office/60112920000123). NÃO
 *    é o da 99 Tecnologia (18.033.552/0001-61, o app de corridas). Confirmar
 *    com a NFS-e de comissão que a 99Food emite para a loja: o CNPJ daquela
 *    nota é o do intermediador. Se for outro, `config.intermediadores["99FOOD"]`.
 *
 * Brendi, Wabiz e JotaJá ficam FORA de propósito: são sistemas de delivery
 * próprio (cardápio digital e app com a marca da loja, sem comissão por
 * pedido — brendi.com.br, wabiz.com.br, site.jotaja.com). A NT 2020.006
 * define: "considera-se site/plataforma própria as vendas que não foram
 * intermediadas (por marketplace), como venda em site próprio" — é o mesmo
 * caso do site do FireHub. A loja que tiver contrato diferente liga em
 * `config.intermediadores`.
 */
export const INTERMEDIADORES_CONHECIDOS: Partial<Record<ChaveDeCanal, { nome: string; razaoSocial: string; cnpj: string }>> = {
  IFOOD: { nome: "iFood", razaoSocial: "IFOOD.COM AGENCIA DE RESTAURANTES ONLINE S.A.", cnpj: "14380200000121" },
  "99FOOD": { nome: "99Food", razaoSocial: "99 FOOD LTDA.", cnpj: "60112920000123" },
};

/** Nome do canal para frase corrida na nota ("Pago no app iFood"). */
const NOME_DO_CANAL: Partial<Record<ChaveDeCanal, string>> = {
  IFOOD: "iFood",
  "99FOOD": "99Food",
  BRENDI: "Brendi",
  WABIZ: "Wabiz",
  JOTAJA: "JotaJá",
};

export type IntermediadorDaNota = { nome: string; cnpj: string; id: string };

export function intermediadorDoPedido(
  pedido: Pick<PedidoParaNota, "canal" | "idNaPlataforma">,
  config: Pick<ConfiguracaoFiscal, "intermediadores">
): { intermediador: IntermediadorDaNota | null; pendencias: Problema[] } {
  const canal = pedido.canal ?? null;
  if (!canal) return { intermediador: null, pendencias: [] };

  const ajuste = config.intermediadores?.[canal] ?? null;
  if (ajuste?.ativo === false) return { intermediador: null, pendencias: [] };

  const conhecido = INTERMEDIADORES_CONHECIDOS[canal];
  const cnpjDoAjuste = normalizarDocumento(ajuste?.cnpj);
  if (!conhecido && !cnpjDoAjuste) return { intermediador: null, pendencias: [] };

  const nome = conhecido?.nome ?? NOME_DO_CANAL[canal] ?? canal;
  const cnpj = cnpjDoAjuste || conhecido!.cnpj;
  const id = String(ajuste?.id || pedido.idNaPlataforma || "").trim().slice(0, 60);

  const pendencias: Problema[] = [];
  if (!cnpjValido(cnpj)) {
    pendencias.push({
      campo: "cnpjDoIntermediador",
      valor: cnpj,
      mensagem: `O CNPJ do intermediador ${nome} configurado não é válido (a SEFAZ rejeita com o código 440).`,
    });
  }
  if (id.length < 2) {
    pendencias.push({
      campo: "idNoIntermediador",
      valor: null,
      mensagem:
        `Pedido do ${nome} sem o identificador da loja na plataforma. A nota de venda intermediada ` +
        `precisa dele (NT 2020.006, rejeição 438) — confira se a integração com o ${nome} está conectada.`,
    });
  }
  return { intermediador: pendencias.length ? null : { nome, cnpj, id }, pendencias };
}

// ─── Transporte (grupo X) ───────────────────────────────────────────────────

/** O transporte no corpo da Focus: a modalidade do frete e o transportador. */
export type TransporteDaNota = {
  modalidade_frete: 2 | 3 | 9;
  cnpj_transportador?: string;
  nome_transportador?: string;
  inscricao_estadual_transportador?: string;
  endereco_transportador?: string;
  municipio_transportador?: string;
  uf_transportador?: string;
};

const textoCurto = (v: unknown, maximo: number): string => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, maximo).trim();

/**
 * O grupo de transporte da NFC-e — quem leva a mercadoria.
 *
 * MOC 7.0, Anexo I, regras do modelo 65:
 *  - X03-20 (rejeição 786): NFC-e de entrega a domicílio (indPres 4) SEM os
 *    dados do transportador (tag transporta);
 *  - X03-10 (754): transportador numa NFC-e que não é entrega;
 *  - X02-10 (753): modalidade de frete diferente de 9 numa NFC-e que não é
 *    entrega.
 * Então: fora da entrega, modFrete 9 e nenhum transportador; na entrega, o
 * transportador SEMPRE vai.
 *
 * Quem é o transportador:
 *  - o MOTOBOY DA LOJA (o caso da NIK e de quase todo delivery próprio): o
 *    próprio emitente — CNPJ, razão social, IE, endereço, município e UF —,
 *    com modFrete 3 ("Transporte Próprio por conta do Remetente", X02);
 *  - o ENTREGADOR DA PLATAFORMA (Entrega Parceira do iFood, entrega do 99):
 *    a plataforma, com o CNPJ do intermediador que a nota já declara no
 *    infIntermed e a razão social dele, e modFrete 2 ("Contratação do Frete
 *    por conta de Terceiros"). Plataforma sem CNPJ conhecido vai só com o nome;
 *  - o pedido não diz quem entrega: o emitente — delivery próprio é a regra.
 *
 * A TAXA DE ENTREGA NÃO MUDA DE LUGAR: continua em vOutro, rateada nos itens.
 * Nenhuma regra de validação amarra o vFrete à modalidade do frete (ele só
 * entra na soma do vNF, W16-10), e a taxa da entrega feita pela plataforma
 * continua fora da nota (`valoresDaNota`).
 */
export function transporteDaNota(
  pedido: Pick<PedidoParaNota, "canal" | "entregaPelaPlataforma" | "entregadorDaPlataforma">,
  config: Pick<
    ConfiguracaoFiscal,
    "cnpj" | "razaoSocial" | "inscricaoEstadual" | "logradouro" | "numero" | "complemento" | "bairro" | "municipio" | "uf"
  >,
  presenca: 1 | 4,
  intermediador: IntermediadorDaNota | null
): TransporteDaNota {
  if (presenca !== 4) return { modalidade_frete: 9 };

  const canal = pedido.canal ?? null;
  // `entregaPelaPlataforma` é a Entrega Parceira do iFood (o `deliveryBy` do webhook).
  const plataforma = String(pedido.entregadorDaPlataforma || (pedido.entregaPelaPlataforma ? canal || "IFOOD" : "")).trim().toUpperCase();
  if (plataforma) {
    const conhecido = INTERMEDIADORES_CONHECIDOS[plataforma as ChaveDeCanal];
    // O intermediador da nota é a MESMA plataforma: o CNPJ é o do infIntermed
    // (vale o ajuste que a loja fez em `config.intermediadores`).
    const daNota = intermediador && canal === plataforma ? intermediador : null;
    const cnpj = daNota?.cnpj || conhecido?.cnpj || "";
    const nome =
      (conhecido && conhecido.cnpj === cnpj ? conhecido.razaoSocial : null) ||
      daNota?.nome ||
      conhecido?.nome ||
      NOME_DO_CANAL[plataforma as ChaveDeCanal] ||
      (canal && NOME_DO_CANAL[canal]) ||
      "Plataforma de entrega";
    return { modalidade_frete: 2, ...(cnpj ? { cnpj_transportador: cnpj } : {}), nome_transportador: textoCurto(nome, 60) };
  }

  // Motoboy da loja: o emitente é o transportador.
  const ie = String(config.inscricaoEstadual ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  const rua = [config.logradouro, config.numero].map((s) => textoCurto(s, 60)).filter(Boolean).join(", ");
  const endereco = [rua, textoCurto(config.complemento, 60), textoCurto(config.bairro, 60)].filter(Boolean).join(" - ");
  const municipio = textoCurto(config.municipio, 60);
  const uf = String(config.uf ?? "").trim().toUpperCase();
  return {
    modalidade_frete: 3,
    cnpj_transportador: normalizarDocumento(config.cnpj),
    nome_transportador: textoCurto(config.razaoSocial, 60),
    ...(ie ? { inscricao_estadual_transportador: ie } : {}),
    ...(endereco ? { endereco_transportador: textoCurto(endereco, 60) } : {}),
    ...(municipio ? { municipio_transportador: municipio } : {}),
    ...(uf ? { uf_transportador: uf } : {}),
  };
}

// ─── Formas de pagamento ────────────────────────────────────────────────────

/** O código tPag da forma e o que ele arrasta junto. */
export type FormaNaNota = {
  /** Tabela de meios de pagamento do Portal da NF-e (campo tPag). */
  codigo: string;
  /** Obrigatória no 99 (rejeição 441) e PROIBIDA nos outros (rejeição 442). */
  descricao?: string;
  /** Grupo de cartão (obrigatório em 03, 04 e 17 — rejeição 391). */
  cartao?: { tipo_integracao: "1" | "2"; bandeira_operadora?: string };
};

const semAcento = (s: string): string =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** xPag: 2 a 60 caracteres. */
const descricaoDoPagamento = (s: string): string => s.replace(/\s+/g, " ").trim().slice(0, 60).trim();

/** Bandeira quando o rótulo diz ("Cartão Elo Credito", "Cartão Visa Debito"). */
function bandeiraDoRotulo(t: string): string | undefined {
  if (/\bvisa\b/.test(t)) return "01";
  if (/\bmaster/.test(t)) return "02";
  if (/\bamex\b|american express/.test(t)) return "03";
  if (/\bdiners\b/.test(t)) return "05";
  if (/\belo\b/.test(t)) return "06";
  if (/\bhiper/.test(t)) return "07";
  return undefined;
}

/**
 * O código de pagamento da nota para o texto que o pedido gravou.
 *
 * Os rótulos são os que existem no banco (contados em 24/09/2026, 30 dias,
 * todas as lojas): "Pix (Pago Online)", "Crédito (Cobrar na Entrega)",
 * "iFood App (Pago Online)", "Cartão (Pago Online)", "Pago Online (99Food)",
 * "Conta Funcionário", "PIX_ENTREGA", "VOUCHER_Ticket", "N/A" (mesa)...
 *
 * - PAGO NO APP do marketplace → 99 "Pago no app iFood (Crédito)". O cartão
 *   ou o Pix passou entre o cliente e a plataforma; a loja recebe um repasse.
 *   Declarar 03/17 obrigaria o grupo de cartão (391) e, "integrado", o CNPJ da
 *   credenciadora e o código de autorização (392) — que a loja não tem. E 90
 *   ("sem pagamento") exige vPag = 0 (NT 2025.001, YA03-30, rejeição 904):
 *   houve pagamento, só não foi na loja.
 * - PAGO ONLINE em canal PRÓPRIO (Brendi, Wabiz, gateway do site) → 99
 *   "Pagamento online Brendi (Pix)", pelo mesmo motivo. Aqui não há
 *   intermediador, e o certo seria 17/03 com o grupo de cartão "1 =
 *   integrado" (comércio eletrônico é o exemplo da própria tabela), CNPJ da
 *   instituição de pagamento e código de autorização — nenhum dos três é
 *   gravado no pedido (processBrendiEvent e wabiz-traducao não leem). Declarar
 *   "2 = não integrado (POS)" seria afirmar uma maquininha que não existiu.
 *   NÃO é caso raro: em 30 dias (24/09/2026) foram 55 pedidos (Brendi Pix 30,
 *   Brendi crédito 7, Wabiz 18). Passa a 17/03 no dia em que a integração
 *   gravar os dados da transação.
 * - Cartão e Pix recebidos pela loja (maquininha, Pix na entrega) → 03/04/17
 *   com o grupo de cartão "2 = não integrado (POS)", que não pede CNPJ nem
 *   autorização (NT 2025.001, YA04-10 e YA05-10).
 * - Vale-refeição → 11 (era 10, que é vale-ALIMENTAÇÃO); alimentação → 10.
 * - Fiado / Conta Funcionário → 99 com a descrição: ninguém pagou ainda, e o
 *   código certo para crediário (05/21) depende de como o contador enquadra.
 * - "N/A", "Pendente", "A combinar", vazio → null: sem forma, sem nota. A
 *   mesa acerta a conta na sessão; emitir antes disso seria chutar.
 */
export function formaDaNota(
  rotulo: string | null | undefined,
  contexto: { canal?: ChaveDeCanal | null; pagoOnline?: boolean; pixEstatico?: boolean } = {}
): FormaNaNota | null {
  const bruto = String(rotulo ?? "").trim();
  const t = semAcento(bruto);
  if (!t) return null;
  if (/^(n\s*\/\s*a|na|pendente|nao informado|a combinar|pagar no caixa|other|outros?|-)$/.test(t)) return null;
  if (/a combinar/.test(t)) return null;

  const limpo = bruto.replace(/\s*\([^)]*\)/g, "").replace(/_/g, " ").trim();
  const canal = contexto.canal ?? null;
  const nomeDoCanal = canal ? NOME_DO_CANAL[canal] : undefined;

  const online = contexto.pagoOnline ?? /pago online|\bprepaid\b/.test(t);
  if (online) {
    const plataforma =
      nomeDoCanal ??
      (/ifood/.test(t) ? "iFood" : /99food|didi/.test(t) ? "99Food" : /wabiz/.test(t) ? "Wabiz" : /brendi/.test(t) ? "Brendi" : null);
    // O que o cliente usou, quando o rótulo diz e não é só o nome do app.
    const meio = limpo
      .replace(/pagamento online|pago online|ifood app|carteira didi|99food|wabiz|brendi/gi, "")
      .replace(/^[\s+\-–,;:/]+|[\s+\-–,;:/]+$/g, "")
      .trim();
    const intermediado = canal ? Boolean(INTERMEDIADORES_CONHECIDOS[canal]) : /ifood|99food|didi/.test(t);
    const base = intermediado ? `Pago no app ${plataforma ?? "do parceiro"}` : `Pagamento online${plataforma ? ` ${plataforma}` : ""}`;
    return { codigo: "99", descricao: descricaoDoPagamento(meio ? `${base} (${meio})` : base) };
  }

  if (/fiado|conta funcionario|anotad|caderneta|crediario/.test(t)) {
    return { codigo: "99", descricao: descricaoDoPagamento(`${limpo || "Fiado"} (a prazo)`) };
  }
  if (/dinheiro|\bcash\b|\bmoney\b|especie/.test(t)) return { codigo: "01" };
  if (/\bpix\b|pix /.test(t) || t.startsWith("pix")) {
    return contexto.pixEstatico ? { codigo: "20" } : { codigo: "17", cartao: { tipo_integracao: "2" } };
  }
  if (/aliment|food voucher|\bva\b/.test(t)) return { codigo: "10" };
  if (/vale|voucher|refei|ticket|\bvr\b|pluxee|sodexo|alelo|\bmeal\b/.test(t)) return { codigo: "11" };

  const bandeira = bandeiraDoRotulo(t);
  const cartao = { tipo_integracao: "2" as const, ...(bandeira ? { bandeira_operadora: bandeira } : {}) };
  if (/\bdeb|debito/.test(t)) return { codigo: "04", cartao };
  if (/\bcred|credito/.test(t)) return { codigo: "03", cartao };
  // "Cartão" sem dizer qual: crédito, a mesma leitura de `formaCanonica`
  // (lib/pagamento-na-entrega) — o caixa e a nota não podem discordar.
  if (/cart|\bcard\b|maquin|\bpos\b/.test(t)) return { codigo: "03", cartao };

  // Rótulo que ninguém previu: vai como "Outros" com o próprio texto — é o
  // que a loja registrou, e o campo existe para isso (NT 2020.006, xPag).
  const descricao = descricaoDoPagamento(limpo);
  return descricao.length >= 2 ? { codigo: "99", descricao } : null;
}

/** "Dividido: Dinheiro R$ 43,64 + Cartão Débito R$ 43,63" → as partes. */
function lerPagamentoDividido(texto: string): PagamentoInformado[] | null {
  if (!/^\s*dividido\s*:/i.test(texto)) return null;
  const lidos: PagamentoInformado[] = [];
  for (const parte of texto.replace(/^\s*dividido\s*:\s*/i, "").split(/\s+\+\s+/)) {
    const m = parte.match(/^(.*?)\s*R\$\s*([\d.]+,\d{2})\s*$/);
    if (!m) return null;
    lidos.push({ forma: m[1].trim(), valor: Number(m[2].replace(/\./g, "").replace(",", ".")) });
  }
  return lidos.length > 0 ? lidos : null;
}

// ─── Valores ────────────────────────────────────────────────────────────────

const centavos = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};
const emReais = (c: number): number => Number((c / 100).toFixed(2));
const reais = (c: number): string => (c / 100).toFixed(2).replace(".", ",");

/** Os totais da nota, em CENTAVOS inteiros. */
export type ValoresDaNota = {
  produtos: number;
  desconto: number;
  outrasDespesas: number;
  total: number;
  /** Parte do total paga pela plataforma (cupom patrocinado pelo iFood/99). */
  subsidioDaPlataforma: number;
  /** Parte do total paga pelo cliente. total = parteDoCliente + subsídio. */
  parteDoCliente: number;
  /** A taxa de entrega existia mas é da plataforma e ficou fora da nota. */
  entregaDaPlataformaFora: boolean;
};

/**
 * Quanto a nota vale — que NÃO é sempre o que o cliente pagou.
 *
 * ── CUPOM PAGO PELA PLATAFORMA NÃO É DESCONTO DA LOJA ──────────────────────
 *
 * A FAQ da tela fiscal já prometia: "subsídios de cupons pagos pelo iFood não
 * reduzem o valor fiscal". O código fazia o contrário: mandava `discountTotal`
 * (loja + iFood) inteiro como vDesc. Num pedido real da Hakim (24,90 de
 * produto, cupom de 20,99 sendo 10,01 do iFood e 10,98 da loja), a nota
 * declarava R$ 9,90 de venda — e a loja recebe R$ 19,91 pela venda: o que o
 * cliente pagou mais os 10,01 que o iFood deposita no repasse.
 *
 * A regra fiscal: integram a base do ICMS as "importâncias pagas, recebidas
 * ou debitadas" (LC 87/96, art. 13, § 1º, II, "a"); só o desconto
 * INCONDICIONAL concedido pelo vendedor sai dela. O cupom que a plataforma
 * banca não é desconto do vendedor — ele recebe o preço cheio, de duas fontes.
 * No Simples é a mesma conta: a receita bruta só exclui "os descontos
 * incondicionais concedidos" (LC 123/06, art. 3º, § 1º). Então:
 *   - vDesc = só a parte da LOJA;
 *   - a parte da plataforma entra como PAGAMENTO ("Cupom pago pelo iFood"),
 *     porque é dinheiro que a loja recebe — do intermediador, que é também
 *     quem repassa o resto (NT 2020.006, item 6.2).
 *
 * ── A ENTREGA FEITA PELO IFOOD NÃO É DA LOJA ────────────────────────────────
 *
 * Na Entrega Parceira a taxa é cobrada e retida pelo iFood. O próprio iFood
 * orienta: "Entrega efetuada pelo iFood (Plano Entrega): o valor da taxa não
 * deverá constar no cupom/Nota Fiscal" (blog-parceiros.ifood.com.br/nota-fiscal-ifood).
 * Descontos sobre essa taxa também ficam fora: são sobre um serviço que não é
 * da loja.
 *
 * ── E A TAXA DE SERVIÇO DO IFOOD ────────────────────────────────────────────
 *
 * O `totalAmount` do iFood inclui a taxa de serviço cobrada do cliente (R$ 0,99
 * em quase todo pedido medido; o 99Food cobra a dele). É receita da plataforma.
 * Por isso nesses canais o total da nota sai dos itens, e não do total pago.
 * Nos canais próprios as duas contas TÊM de bater (bateram em 100% dos pedidos
 * medidos) — e quando não batem, a emissão para e diz.
 */
export function valoresDaNota(pedido: PedidoParaNota): ValoresDaNota {
  const produtos = pedido.itens.reduce((s, i) => s + centavos(i.valorTotal), 0);
  const taxaInformada = Math.max(0, centavos(pedido.taxaEntrega));
  const entregaDaPlataformaFora = Boolean(pedido.entregaPelaPlataforma) && taxaInformada > 0;
  const taxaDaLoja = pedido.entregaPelaPlataforma ? 0 : taxaInformada;

  let descontoNosItens = 0;
  let descontoNaEntrega = 0;
  let subsidio = 0;

  const detalhes = (pedido.descontosDetalhados ?? []).filter((d) => d && (d.plataforma > 0 || d.loja > 0));
  if (detalhes.length > 0) {
    for (const d of detalhes) {
      const ehDaEntrega = /deliver|entrega|frete/i.test(String(d.alvo ?? ""));
      // Benefício sobre a entrega que o iFood fez: nem a taxa nem o desconto são da loja.
      if (ehDaEntrega && pedido.entregaPelaPlataforma) continue;
      subsidio += Math.max(0, centavos(d.plataforma));
      if (ehDaEntrega) descontoNaEntrega += Math.max(0, centavos(d.loja));
      else descontoNosItens += Math.max(0, centavos(d.loja));
    }
  } else {
    const descontoTotal = Math.max(0, centavos(pedido.desconto));
    subsidio = Math.min(descontoTotal, Math.max(0, centavos(pedido.descontoDaPlataforma)));
    descontoNosItens = descontoTotal - subsidio;
  }

  // Desconto da loja na taxa abate a própria taxa (vOutro). Se passar dela, o
  // resto vira desconto dos itens — o total é o mesmo.
  let outrasDespesas = taxaDaLoja - descontoNaEntrega;
  if (outrasDespesas < 0) {
    descontoNosItens += -outrasDespesas;
    outrasDespesas = 0;
  }

  // DESCONTO MAIOR QUE OS PRODUTOS. Acontece de verdade: cupom de frete grátis
  // gravado como desconto do pedido. Rateado entre os itens, isso daria a algum
  // item um desconto maior que o próprio valor dele — vDesc > vProd, que a
  // SEFAZ rejeita. O excedente não é desconto de produto: é desconto da ENTREGA.
  // Abater da taxa preserva o total exato que o cliente pagou.
  let desconto = descontoNosItens;
  if (desconto > produtos) {
    const excedente = desconto - produtos;
    desconto = produtos;
    outrasDespesas = Math.max(0, outrasDespesas - excedente);
  }

  const total = produtos - desconto + outrasDespesas;
  const subsidioDaPlataforma = Math.max(0, Math.min(subsidio, total));
  return {
    produtos,
    desconto,
    outrasDespesas,
    total,
    subsidioDaPlataforma,
    parteDoCliente: total - subsidioDaPlataforma,
    entregaDaPlataformaFora,
  };
}

/** Canais cujo `totalAmount` embute taxas cobradas pela plataforma. */
const CANAIS_COM_TAXA_DA_PLATAFORMA: ChaveDeCanal[] = ["IFOOD", "99FOOD"];

// ─── Montagem do corpo ──────────────────────────────────────────────────────

export type CorpoDaNfce = Record<string, unknown> & {
  items: Record<string, unknown>[];
  formas_pagamento: Record<string, unknown>[];
};

export type ResumoDaNfce = {
  total: number;
  parteDoCliente: number;
  subsidioDaPlataforma: number;
  troco: number;
  presenca: 1 | 4;
  intermediador: IntermediadorDaNota | null;
};

export type MontagemDaNfce =
  | { ok: true; corpo: CorpoDaNfce; resumo: ResumoDaNfce }
  | { ok: false; mensagem: string; pendencias: Problema[] };

/**
 * O corpo da requisição POST /v2/nfce da Focus, a partir do pedido.
 *
 * PURA: não lê banco, não chama rede, não olha o relógio (recebe `agora`).
 * Tudo que decide o conteúdo da nota passa por aqui — e o teste
 * (scripts/teste-fiscal-corpo-da-nfce.ts) confere caso a caso que os totais
 * fecham ENTRE SI no centavo (vProd = Σ itens, vDesc = Σ vDesc dos itens,
 * vNF = vProd − vDesc + vOutro, Σ pagamentos − troco = vNF), que é o que a
 * SEFAZ confere antes de qualquer outra coisa.
 */
export function montarCorpoDaNfce(
  pedido: PedidoParaNota,
  config: ConfiguracaoFiscal,
  agora: Date = new Date()
): MontagemDaNfce {
  const pendencias: Problema[] = [];
  const recusa = (mensagem: string): MontagemDaNfce => ({ ok: false, mensagem, pendencias });

  if (!pedido.itens || pedido.itens.length === 0) {
    pendencias.push({ campo: "itens", valor: null, mensagem: "Pedido sem itens: não há o que declarar na nota." });
    return recusa("Este pedido não tem itens.");
  }

  const canal = pedido.canal ?? null;
  const v = valoresDaNota(pedido);

  if (v.total <= 0) {
    pendencias.push({
      campo: "valorTotal",
      valor: reais(v.total),
      mensagem:
        `O total da nota ficou R$ ${reais(v.total)} (itens R$ ${reais(v.produtos)} − desconto ` +
        `R$ ${reais(v.desconto)} + entrega R$ ${reais(v.outrasDespesas)}). A SEFAZ não autoriza nota ` +
        `com total zero ou negativo.`,
    });
    return recusa(`O total da nota ficou R$ ${reais(v.total)} — a SEFAZ não autoriza nota com total zero ou negativo.`);
  }

  // Canal próprio: o total da nota TEM de ser o que o cliente pagou.
  const cobraTaxaDaPlataforma = canal ? CANAIS_COM_TAXA_DA_PLATAFORMA.includes(canal) : false;
  if (!cobraTaxaDaPlataforma && v.subsidioDaPlataforma === 0) {
    const pago = centavos(pedido.valorTotal);
    if (Math.abs(pago - v.total) > 1) {
      pendencias.push({
        campo: "valorTotal",
        valor: reais(pago),
        mensagem:
          `O pedido fechou em R$ ${reais(pago)}, mas itens − desconto + entrega dá R$ ${reais(v.total)}. ` +
          "A nota não pode declarar um valor diferente do que foi cobrado — confira os itens e o desconto do pedido.",
      });
    }
  }

  // ── Presença ──────────────────────────────────────────────────────────────
  // NT 2026.002 (regra B25b-20, produção em 03/08/2026): na NFC-e só valem
  // 1 (presencial), 4 (não presencial COM ENTREGA) e 5. Os antigos 2
  // (internet) e 9 (outros) passaram a ser rejeição 717. Pedido do iFood ou do
  // site RETIRADO no balcão é 1: o cliente está na loja quando recebe.
  const entrega = Boolean(pedido.entregaEmDomicilio);
  const presenca: 1 | 4 = entrega && !config.entregaComoPresencial ? 4 : 1;

  // ── Destinatário ─────────────────────────────────────────────────────────
  // `documentoDeVerdade` e não só `normalizarDocumento`: o "00000000000" que
  // o JotaJá grava quando o cliente não dá CPF é ausência de documento. Lido
  // como CPF inválido, recusava até a nota de RETIRADA, que sai sem
  // destinatário. Aqui, e não só em `pedidoParaNota`, porque a nota da conta
  // da mesa (lib/fiscal-momento → montarNotaDaMesa) leva o documento cru.
  const documento = documentoDeVerdade(pedido.documentoDoCliente) ?? "";
  if (documento && !documentoValido(documento)) {
    pendencias.push({
      campo: "documentoDoCliente",
      valor: documento,
      mensagem: "O CPF/CNPJ do cliente gravado no pedido não é válido (os dígitos verificadores não batem). Corrija ou tire o documento.",
    });
  }
  const documentoOk = Boolean(documento) && documentoValido(documento);

  let endereco: ReturnType<typeof lerEnderecoDeEntrega> | null = null;
  if (presenca === 4) {
    if (!documento) {
      pendencias.push({
        campo: "documentoDoCliente",
        valor: null,
        mensagem:
          "Entrega sem CPF do cliente: a SEFAZ rejeita NFC-e de entrega sem CPF e endereço " +
          "(rejeições 787 e 788; NT 2026.002, regra E01-20). Peça o CPF (ou CNPJ) ao cliente e emita de novo.",
      });
    }
    endereco = lerEnderecoDeEntrega(
      pedido.enderecoDoCliente,
      { municipio: config.municipio, uf: config.uf },
      // iFood, Brendi e JotaJá terminam o texto na cidade do cliente — que pode
      // não ser a da loja (a Hakim Unamar entrega em Cabo Frio).
      { cidadeNoFim: canal === "IFOOD" || canal === "JOTAJA" || canal === "BRENDI" }
    );
    if (!endereco.ok) {
      pendencias.push({
        campo: "enderecoDoCliente",
        valor: pedido.enderecoDoCliente ?? null,
        mensagem:
          `Entrega sem endereço completo do cliente (falta: ${endereco.falta.join(", ")}). A SEFAZ rejeita ` +
          "NFC-e de entrega sem o endereço do destinatário (rejeição 788). Corrija o endereço do pedido.",
      });
    }
    // O NOME também: "No caso de emissão de NFC-e com entrega em domicílio é
    // obrigatória a impressão do nome do consumidor e do endereço de entrega"
    // (Manual do DANFE NFC-e v6.0, 3.1.6) — e o DANFE só imprime o que está no
    // XML (xNome do destinatário). Sem esta pendência a nota saía sem xNome e
    // o cupom da entrega, sem o nome. Rótulo que o sistema ou o parceiro
    // inventou ("Cliente", "Balcão", "Cliente iFood") não é nome de ninguém.
    if (!nomeServeDeDestinatario(pedido.nomeDoCliente)) {
      pendencias.push({
        campo: "nomeDoCliente",
        valor: pedido.nomeDoCliente ?? null,
        mensagem:
          "Entrega sem o nome do cliente: o DANFE da entrega tem de trazer o nome e o endereço de quem recebe " +
          "(Manual do DANFE NFC-e v6.0, item 3.1.6). Informe o nome do cliente no pedido e emita de novo.",
      });
    }
  }

  // ── Intermediador ────────────────────────────────────────────────────────
  const { intermediador, pendencias: doIntermediador } = intermediadorDoPedido(pedido, config);
  pendencias.push(...doIntermediador);
  const nomeDaPlataforma = (canal && NOME_DO_CANAL[canal]) || intermediador?.nome || "parceiro";

  // ── Transporte (grupo X): quem leva a mercadoria na entrega ──────────────
  const transporte = transporteDaNota(pedido, config, presenca, intermediador);

  // ── Pagamentos ───────────────────────────────────────────────────────────
  // `paymentMethods` quando o pedido tem; senão o texto "Dividido: ..." que o
  // balcão grava em `paymentMethod`; senão uma forma só.
  const doPedido = (pedido.pagamentos ?? []).filter((p) => p && centavos(p.valor) > 0);
  const informados = doPedido.length > 0 ? doPedido : lerPagamentoDividido(String(pedido.formaDePagamento ?? ""));
  const dividido = Boolean(informados && informados.length > 1);

  type Linha = { forma: FormaNaNota; valor: number; rotulo: string };
  const linhas: Linha[] = [];
  const contexto = { canal, pagoOnline: pedido.pagoOnline, pixEstatico: Boolean(config.pixEstatico) };
  const semForma: string[] = [];

  if (dividido) {
    for (const p of informados!) {
      const forma = formaDaNota(p.forma, contexto);
      if (!forma) semForma.push(p.forma || "(vazio)");
      else linhas.push({ forma, valor: centavos(p.valor), rotulo: p.forma });
    }
  } else {
    // Uma forma só cobre a parte do cliente inteira — o valor gravado nela
    // não manda (é o total, com as taxas da plataforma no iFood).
    const rotulo = informados?.[0]?.forma ?? pedido.formaDePagamento;
    const forma = formaDaNota(rotulo, contexto);
    if (!forma) semForma.push(rotulo || "(vazio)");
    else linhas.push({ forma, valor: v.parteDoCliente, rotulo });
  }

  if (semForma.length > 0) {
    pendencias.push({
      campo: "formaDePagamento",
      valor: semForma.join(", "),
      mensagem:
        `Forma de pagamento não informada no pedido ("${semForma.join('", "')}"). A nota declara como o ` +
        "cliente pagou — defina a forma (na mesa, feche a conta) e emita de novo.",
    });
  }

  let troco = 0;
  if (linhas.length > 0 && dividido) {
    // Pagamento dividido: as partes têm de cobrir a parte do cliente.
    const soma = linhas.reduce((s, l) => s + l.valor, 0);
    const diferenca = v.parteDoCliente - soma;
    const emDinheiro = linhas.filter((l) => l.forma.codigo === "01");
    if (Math.abs(diferenca) <= 2) {
      // Arredondamento da divisão (43,64 + 43,63 + 43,63): o centavo vai na maior.
      if (diferenca !== 0) linhas.reduce((a, b) => (b.valor > a.valor ? b : a)).valor += diferenca;
    } else if (diferenca < 0 && emDinheiro.length === 1 && emDinheiro[0].valor >= -diferenca) {
      troco = -diferenca; // pagou a mais em dinheiro: é troco
    } else {
      pendencias.push({
        campo: "pagamentos",
        valor: reais(soma),
        mensagem:
          `As formas de pagamento do pedido somam R$ ${reais(soma)}, e a nota vale R$ ${reais(v.parteDoCliente)}. ` +
          "Acerte o pagamento dividido antes de emitir.",
      });
    }
  }

  // Troco: `trocoPara` é a NOTA que o cliente deu ("troco para 50"), não o
  // troco. A NFC-e declara o dinheiro recebido e o troco devolvido
  // (vPag − vTroco = vNF; sem vTroco é rejeição 866).
  const trocoPara = centavos(pedido.trocoPara);
  const linhasEmDinheiro = linhas.filter((l) => l.forma.codigo === "01");
  if (troco === 0 && trocoPara > 0 && linhasEmDinheiro.length === 1) {
    const dinheiro = linhasEmDinheiro[0];
    // Numa forma só, o cliente deve na porta o total que PAGOU (no iFood,
    // com a taxa de serviço da plataforma); no dividido, a parte em dinheiro.
    const devido = !dividido && centavos(pedido.valorTotal) > 0 ? centavos(pedido.valorTotal) : dinheiro.valor;
    if (trocoPara > devido) {
      troco = trocoPara - devido;
      // O dinheiro declarado é o que o cliente ENTREGOU; o troco volta.
      dinheiro.valor += troco;
    }
  }

  if (v.subsidioDaPlataforma > 0) {
    linhas.push({
      forma: { codigo: "99", descricao: descricaoDoPagamento(`Cupom pago pelo ${nomeDaPlataforma}`) },
      valor: v.subsidioDaPlataforma,
      rotulo: "subsídio da plataforma",
    });
  }

  if (pendencias.length > 0) {
    return recusa(
      `${pendencias.length} problema(s) impedem a emissão desta nota. ` +
        "Nada foi enviado à SEFAZ — corrija e emita de novo."
    );
  }

  const formas_pagamento = linhas
    .filter((l) => l.valor > 0)
    .map((l) => ({
      forma_pagamento: l.forma.codigo,
      valor_pagamento: emReais(l.valor),
      ...(l.forma.codigo === "99" && l.forma.descricao ? { descricao_pagamento: l.forma.descricao } : {}),
      ...(l.forma.cartao ?? {}),
    }));

  // Conferência final — a mesma que a SEFAZ faz (YA03-10/YA03-20).
  const somaDosPagamentos = linhas.filter((l) => l.valor > 0).reduce((s, l) => s + l.valor, 0);
  if (somaDosPagamentos - troco !== v.total) {
    pendencias.push({
      campo: "pagamentos",
      valor: reais(somaDosPagamentos),
      mensagem:
        `Os pagamentos (R$ ${reais(somaDosPagamentos)}, troco R$ ${reais(troco)}) não fecham com o total ` +
        `da nota (R$ ${reais(v.total)}).`,
    });
    return recusa("Os pagamentos não fecham com o total da nota.");
  }

  /**
   * ── RATEIO DE DESCONTO E TAXA DE ENTREGA ENTRE OS ITENS ───────────────────
   *
   * A nota não fecha só no total: o layout da NF-e exige que o vDesc e o vOutro
   * do CABEÇALHO sejam a SOMA dos mesmos campos dos ITENS (regras W16/W17).
   * O rateio é proporcional ao valor de cada item, em CENTAVOS INTEIROS — em
   * ponto flutuante a soma erra um centavo com frequência, e um centavo aqui é
   * rejeição. A sobra da divisão vai para a maior linha. Como o rateio é
   * proporcional, nenhum item recebe desconto maior que o próprio valor.
   */
  const pesos = pedido.itens.map((i) => centavos(i.valorTotal));
  const descontoPorItem = v.desconto > 0 ? ratearEmCentavos(emReais(v.desconto), pesos) : null;
  const despesaPorItem = v.outrasDespesas > 0 ? ratearEmCentavos(emReais(v.outrasDespesas), pesos) : null;
  const regime = Number(config.regimeTributario);

  const destinatario: Record<string, unknown> = {};
  if (documentoOk) {
    destinatario[documento.length === 14 ? "cnpj_destinatario" : "cpf_destinatario"] = documento;
    // NFC-e é venda a consumidor final não contribuinte (indIEDest = 9).
    destinatario.indicador_inscricao_estadual_destinatario = 9;
  }
  if (nomeServeDeDestinatario(pedido.nomeDoCliente) && (documentoOk || presenca === 4)) {
    destinatario.nome_destinatario = String(pedido.nomeDoCliente).replace(/\s+/g, " ").trim().slice(0, 60);
  }
  if (presenca === 4 && endereco?.ok) {
    const e = endereco.endereco;
    destinatario.logradouro_destinatario = e.logradouro;
    destinatario.numero_destinatario = e.numero;
    if (e.complemento) destinatario.complemento_destinatario = e.complemento;
    destinatario.bairro_destinatario = e.bairro;
    destinatario.municipio_destinatario = e.municipio;
    destinatario.uf_destinatario = e.uf;
    // Na cidade da loja, o código IBGE é o do cadastro fiscal. Em outra, a
    // Focus procura pelo nome + UF ("Se não informado o sistema tentará
    // encontrar o código com base no nome do município e da UF").
    if (e.municipioDaLoja && config.codigoMunicipio) {
      destinatario.codigo_municipio_destinatario = String(config.codigoMunicipio).replace(/\D/g, "");
    }
    if (e.cep) destinatario.cep_destinatario = e.cep;
  }

  const informacoes: string[] = [];
  if (pedido.numero != null) informacoes.push(`Pedido #${pedido.numero}`);
  if (canal && NOME_DO_CANAL[canal] && pedido.referenciaNoCanal) informacoes.push(`${NOME_DO_CANAL[canal]} #${pedido.referenciaNoCanal}`);
  if (v.subsidioDaPlataforma > 0) {
    informacoes.push(`Cupom de R$ ${reais(v.subsidioDaPlataforma)} pago pelo ${nomeDaPlataforma}, não pela loja`);
  }
  if (v.entregaDaPlataformaFora) informacoes.push(`Entrega feita e cobrada pelo ${nomeDaPlataforma}, fora desta nota`);

  const corpo: CorpoDaNfce = {
    natureza_operacao: "Venda ao consumidor",
    data_emissao: dataDeEmissaoLocal(agora),
    tipo_documento: 1, // saída
    finalidade_emissao: 1, // normal
    // Obrigatório na API da Focus e ausente até aqui. NFC-e é sempre operação
    // interna (idDest = 1); outro valor é rejeição.
    local_destino: 1,
    presenca_comprador: presenca,
    consumidor_final: 1,
    // Fora da entrega, 9 e nada mais; na entrega, 3 (motoboy da loja) ou 2
    // (entregador da plataforma) com o transportador — `transporteDaNota`.
    // A taxa de entrega continua em "outras despesas" (vOutro).
    ...transporte,
    indicador_intermediario: intermediador ? 1 : 0,
    ...(intermediador ? { cnpj_intermediario: intermediador.cnpj, id_intermediario: intermediador.id } : {}),
    // CNPJ SEM apagar letras: o alfanumérico está no schema desde 01/07/2026
    // (NT 2026.004). O replace(/\D/g, "") de antes transformava o CNPJ de uma
    // loja aberta este ano num número de 9 dígitos.
    cnpj_emitente: normalizarDocumento(config.cnpj),
    nome_emitente: config.razaoSocial,
    nome_fantasia_emitente: config.nomeFantasia || config.razaoSocial,
    inscricao_estadual_emitente: String(config.inscricaoEstadual ?? "").toUpperCase().replace(/[^0-9A-Z]/g, ""),
    regime_tributario_emitente: regime,
    logradouro_emitente: config.logradouro,
    numero_emitente: config.numero,
    bairro_emitente: config.bairro,
    municipio_emitente: config.municipio,
    codigo_municipio_emitente: String(config.codigoMunicipio ?? "").replace(/\D/g, ""),
    uf_emitente: String(config.uf ?? "").toUpperCase(),
    cep_emitente: String(config.cep ?? "").replace(/\D/g, ""),
    serie: Number(config.serie),
    ...destinatario,
    valor_produtos: emReais(v.produtos),
    ...(v.desconto > 0 ? { valor_desconto: emReais(v.desconto) } : {}),
    ...(v.outrasDespesas > 0 ? { valor_outras_despesas: emReais(v.outrasDespesas) } : {}),
    valor_total: emReais(v.total),
    ...(informacoes.length ? { informacoes_adicionais_contribuinte: informacoes.join(" | ").slice(0, 2000) } : {}),
    items: pedido.itens.map((item, i) => ({
      numero_item: i + 1,
      codigo_produto: item.codigo,
      descricao: item.descricao,
      cfop: String(item.cfop).replace(/\D/g, ""),
      codigo_ncm: String(item.ncm).replace(/\D/g, ""),
      ...(item.cest ? { cest: String(item.cest).replace(/\D/g, "") } : {}),
      unidade_comercial: item.unidadeComercial,
      quantidade_comercial: item.quantidade,
      valor_unitario_comercial: emReais(centavos(item.valorUnitario)),
      valor_bruto: emReais(centavos(item.valorTotal)),
      unidade_tributavel: item.unidadeComercial,
      quantidade_tributavel: item.quantidade,
      valor_unitario_tributavel: emReais(centavos(item.valorUnitario)),
      icms_origem: item.origem,
      icms_situacao_tributaria: regime === 3 ? item.cst : item.csosn,
      // PIS/COFINS são obrigatórios no item da NFC-e. O cadastro do produto
      // tem os dois (padrão "49" — outras operações).
      pis_situacao_tributaria: String(item.pis ?? "49").padStart(2, "0"),
      cofins_situacao_tributaria: String(item.cofins ?? "49").padStart(2, "0"),
      // A parte do desconto e da taxa que cabe a este item (regras W16/W17).
      ...(descontoPorItem && descontoPorItem[i] > 0 ? { valor_desconto: descontoPorItem[i] } : {}),
      ...(despesaPorItem && despesaPorItem[i] > 0 ? { valor_outras_despesas: despesaPorItem[i] } : {}),
      inclui_no_total: 1,
    })),
    formas_pagamento,
    ...(troco > 0 ? { valor_troco: emReais(troco) } : {}),
  };

  return {
    ok: true,
    corpo,
    resumo: {
      total: v.total,
      parteDoCliente: v.parteDoCliente,
      subsidioDaPlataforma: v.subsidioDaPlataforma,
      troco,
      presenca,
      intermediador,
    },
  };
}

// ─── Emissão ────────────────────────────────────────────────────────────────

/**
 * Os pedidos que a nota cobre e a loja deles — o emissor próprio precisa para
 * reservar o número no fiscalInfo de cada um (lib/nfce/numeracao). Um pedido,
 * ou os da conta da mesa.
 */
export type AlvoDaEmissao = { lojaId: string; pedidos: string[] };

/**
 * Emite a NFC-e.
 *
 * Dois caminhos: a Focus NFe ("focusnfe") e o emissor PRÓPRIO ("sefaz",
 * lib/nfce/emissao-da-loja), que transmite direto à SEFAZ. O conteúdo da nota
 * é o mesmo nos dois — `montarCorpoDaNfce`. Sem provedor configurado, a
 * resposta é `nao_configurado` com as pendências — nunca um sucesso inventado.
 */
export async function emitirNfce(
  configDaLoja: ConfiguracaoFiscal,
  pedido: PedidoParaNota,
  alvo?: AlvoDaEmissao
): Promise<ResultadoDaEmissao> {
  // No emissor próprio a série é a do bloco `sefaz` (a loja que veio de outro
  // sistema usa série nova): é ELA que vai no corpo, no XML e na numeração —
  // o tradutor do XML recusa corpo com série diferente da do contexto.
  const proprio = usaEmissorProprio(configDaLoja);
  const config: ConfiguracaoFiscal = proprio ? { ...configDaLoja, serie: serieDoEmissor(configDaLoja) } : configDaLoja;
  const faltasDaLoja = pendenciasParaEmitir(config);
  if (faltasDaLoja.length > 0) {
    return {
      ok: false,
      motivo: "nao_configurado",
      mensagem:
        `Faltam ${faltasDaLoja.length} informações para esta loja emitir nota fiscal. ` +
        `Complete o cadastro em Fiscal → Configuração.`,
      pendencias: faltasDaLoja,
    };
  }

  const faltasDosItens = pendenciasDosItens(pedido.itens, Number(config.regimeTributario));
  if (faltasDosItens.length > 0) {
    return {
      ok: false,
      motivo: "dados_incompletos",
      mensagem:
        `${faltasDosItens.length} problema(s) nos itens deste pedido impedem a emissão. ` +
        `Complete os dados fiscais dos produtos em Fiscal → Produtos.`,
      pendencias: faltasDosItens,
    };
  }

  const montagem = montarCorpoDaNfce(pedido, config);
  if (!montagem.ok) {
    return { ok: false, motivo: "dados_incompletos", mensagem: montagem.mensagem, pendencias: montagem.pendencias };
  }

  if (proprio) {
    // Import dinâmico: a emissão da loja fala com o banco (a numeração) e o
    // cofre, e este arquivo é carregado sem banco nenhum (a montagem do corpo
    // é pura e testada assim — scripts/teste-fiscal-corpo-da-nfce.ts); o
    // lib/prisma lança no carregamento se não houver DATABASE_URL.
    const { emitirNaSefazDaLoja } = await import("./nfce/emissao-da-loja");
    return emitirNaSefazDaLoja(config, pedido.id, montagem.corpo, alvo);
  }

  if (config.provedor === "focusnfe") {
    return emitirPeloFocusNfe(config, pedido.id, montagem.corpo);
  }

  return {
    ok: false,
    motivo: "nao_configurado",
    mensagem: `Provedor "${config.provedor}" não é suportado por esta versão.`,
  };
}

/**
 * Focus NFe.
 *
 * O `ref` é o identificador do lado do FireHub e serve de idempotência:
 * reenviar o mesmo `ref` não gera nota nova, o provedor devolve a que já
 * existe. Por isso o `ref` é derivado do id do pedido, e não de um contador.
 *
 * `completa=1`: sem ele a resposta de autorização NÃO traz o protocolo
 * ("Se 1, retorna dados completos da requisição e protocolo em caso de
 * autorização" — doc.focusnfe.com.br/reference/emitir_nfce). O pedido era
 * gravado como emitido com protocolo vazio.
 */
async function emitirPeloFocusNfe(
  config: ConfiguracaoFiscal,
  pedidoId: string,
  corpo: CorpoDaNfce
): Promise<ResultadoDaEmissao> {
  const base = urlBaseDoFocus(config);
  const ref = `firehub-${pedidoId}`;

  try {
    // O Focus autentica por Basic com o token no usuário e senha vazia.
    const autorizacao = Buffer.from(`${tokenDoAmbiente(config)}:`).toString("base64");

    const res = await fetch(`${base}/v2/nfce?ref=${encodeURIComponent(ref)}&completa=1`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${autorizacao}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(45_000),
    });

    const dados = await res.json().catch(() => ({}));
    const codigo = String(dados?.codigo ?? "");

    // 202, "processando_autorizacao" ou 422 "pending_operation" ("A nota
    // fiscal ainda está em processamento"): a nota EXISTE do lado do Focus (a
    // ref foi consumida). NÃO é recusa — tratar como recusa fazia o lojista
    // reemitir. Espera consultando; se não resolver, devolve "processando".
    if (res.status === 202 || dados?.status === "processando_autorizacao" || codigo === "pending_operation") {
      return aguardarProcessamento(config, pedidoId);
    }

    // 422 "already_processed" / "Referência já utilizada": uma tentativa
    // anterior já criou a nota e este POST não diz em que estado ela está.
    // Consulta a ref e traduz o estado real.
    const motivo =
      dados?.mensagem_sefaz || dados?.mensagem || dados?.erros?.[0]?.mensagem || `HTTP ${res.status}`;
    if (
      codigo === "already_processed" ||
      (dados?.status !== "autorizado" && /refer[eê]ncia|j[aá]\s+(foi\s+)?(emitid|autorizad|utilizad|enviad)/i.test(String(motivo)))
    ) {
      return consultarNfce(config, pedidoId);
    }

    if (res.ok && dados?.status === "autorizado") {
      return traduzirNotaAutorizada(config, base, dados);
    }

    return traduzirFalhaHttp(res.status, String(motivo), dados);
  } catch (e: any) {
    return {
      ok: false,
      motivo: "erro_de_comunicacao",
      mensagem:
        "Não consegui falar com o provedor de emissão. A nota NÃO foi emitida. " +
        "Tente de novo; se persistir, verifique o token e a conexão.",
      detalheDaRejeicao: String(e?.message).slice(0, 300),
    };
  }
}

/**
 * O que fazer, em português, para as rejeições que o conteúdo da nota pode
 * provocar. A mensagem da SEFAZ vem junto, sempre — esta é só a tradução.
 */
const O_QUE_FAZER_NA_REJEICAO: Record<string, string> = {
  "704": "O horário da nota ficou atrasado mais de 5 minutos em relação à SEFAZ. Emita de novo.",
  "717": "Desde 03/08/2026 a NFC-e só aceita presença 1 (presencial), 4 (entrega) ou 5 (NT 2026.002).",
  "785": "A SEFAZ do seu estado não aceita NFC-e de entrega. Peça ao suporte para emitir as entregas como venda presencial.",
  "787": "Nota de entrega precisa do CPF ou CNPJ do cliente.",
  "788": "Nota de entrega precisa do endereço completo do cliente.",
  "391": "Pagamento com cartão ou Pix precisa dos dados do cartão na nota.",
  "434": "Faltou declarar se a venda foi por intermediador (marketplace).",
  "438": "Venda por marketplace precisa do CNPJ e do identificador do intermediador.",
  "440": "O CNPJ do intermediador está inválido.",
  "441": "Forma de pagamento \"Outros\" precisa de descrição.",
  "337": "MEI só pode usar o CFOP 5102 na NFC-e.",
  "782": "MEI só pode usar CSOSN 102 ou 300 na NFC-e.",
  "386": "O CFOP de algum produto não combina com o CSOSN dele. Confira em Fiscal → Produtos.",
  "865": "As formas de pagamento somam menos que o total da nota.",
  "866": "O pagamento passou do total e o troco não foi informado.",
};

/**
 * Traduz uma falha HTTP do provedor para uma frase que diz a VERDADE ao lojista.
 *
 * Antes, todo erro abaixo de 500 virava "A SEFAZ recusou esta nota: HTTP 401".
 * A SEFAZ não recusou nada — 401/403 é o token do Focus errado, vencido, ou o
 * token de um ambiente sendo usado no outro. Mandar o lojista procurar defeito
 * no cadastro fiscal quando o problema é a credencial custa horas dele, e o
 * caso mais comum é justamente o mais mal explicado: gerou o token de
 * homologação e salvou como produção.
 */
function traduzirFalhaHttp(
  status: number,
  motivo: string,
  dados: any
): Extract<ResultadoDaEmissao, { ok: false }> {
  if (status === 401 || status === 403) {
    return {
      ok: false,
      motivo: "nao_configurado",
      mensagem:
        "O provedor de emissão recusou o acesso (token inválido ou sem permissão). " +
        "A nota NÃO foi emitida e a SEFAZ nem chegou a ser consultada. " +
        "Confira o token do Focus NFe e se ele é do MESMO ambiente selecionado aqui " +
        "(o token de homologação não funciona em produção, e vice-versa).",
      detalheDaRejeicao: JSON.stringify(dados).slice(0, 600),
    };
  }
  if (status === 404) {
    return {
      ok: false,
      motivo: "erro_de_comunicacao",
      mensagem: "O provedor não encontrou esta nota. Ela NÃO foi emitida.",
      detalheDaRejeicao: JSON.stringify(dados).slice(0, 600),
    };
  }
  if (status >= 500) {
    return {
      ok: false,
      motivo: "erro_de_comunicacao",
      mensagem:
        `O provedor de emissão está fora do ar (HTTP ${status}). A nota NÃO foi emitida. ` +
        "Tente de novo em alguns minutos.",
      detalheDaRejeicao: JSON.stringify(dados).slice(0, 600),
    };
  }
  const statusSefaz = dados?.status_sefaz != null ? String(dados.status_sefaz) : undefined;
  const oQueFazer = statusSefaz ? O_QUE_FAZER_NA_REJEICAO[statusSefaz] : undefined;
  const denegada = dados?.status === "denegado";
  return {
    ok: false,
    motivo: "rejeitada",
    mensagem:
      (denegada ? "A SEFAZ DENEGOU o uso desta nota (irregularidade cadastral): " : "A SEFAZ recusou esta nota: ") +
      `${statusSefaz ? `[${statusSefaz}] ` : ""}${motivo}` +
      (oQueFazer ? ` — ${oQueFazer}` : ""),
    detalheDaRejeicao: JSON.stringify(dados).slice(0, 600),
    ...(statusSefaz ? { statusSefaz } : {}),
  };
}

function urlBaseDoFocus(config: ConfiguracaoFiscal): string {
  return Number(config.ambiente) === 1
    ? "https://api.focusnfe.com.br"
    : "https://homologacao.focusnfe.com.br";
}

/**
 * Traduz o JSON de uma nota "autorizado" do Focus para o resultado do FireHub.
 *
 * Exportada para o teste: é aqui que mora a leitura da chave (sem o prefixo
 * "NFe" que a Focus põe, com letras permitidas) e da contingência.
 */
export function traduzirNotaAutorizada(
  config: ConfiguracaoFiscal,
  base: string,
  dados: any
): ResultadoDaEmissao {
  // Sem chave de acesso não existe nota. Uma resposta "autorizado" sem esse
  // campo gravaria o pedido como EMITIDO com chave `undefined` — o lojista
  // veria badge verde e não teria documento nenhum para apresentar.
  //
  // A Focus devolve "NFe" + 44 posições (doc.focusnfe.com.br/reference/emitir_nfce,
  // exemplo "NFe41190612345678000123650010000000121743484310"). Antes o
  // replace(/\D/g, "") limpava a conferência, mas GRAVAVA `dados.chave_nfe`
  // com o prefixo — 47 caracteres que a consulta pública não encontra. E com o
  // CNPJ alfanumérico (NT 2026.004) a chave pode ter letras: apagar letras
  // rejeitaria a nota autorizada de uma loja com CNPJ novo.
  const chave = chaveDeAcessoLimpa(dados?.chave_nfe);
  if (!chave) {
    return {
      ok: false,
      motivo: "erro_de_comunicacao",
      mensagem:
        "O provedor respondeu 'autorizado' mas não devolveu a chave de acesso da nota. " +
        "Como não dá para comprovar a emissão, ela NÃO foi registrada aqui. " +
        "Consulte o pedido de novo em alguns minutos.",
      detalheDaRejeicao: JSON.stringify(dados).slice(0, 600),
    };
  }

  const nota: NotaEmitida = {
    chaveDeAcesso: chave,
    numero: Number(dados.numero),
    serie: Number(dados.serie ?? config.serie),
    // Com completa=1 o protocolo vem em `protocolo` e em
    // `protocolo_nota_fiscal.numero_protocolo`; a consulta usa `numero_protocolo`.
    protocolo: String(dados.protocolo ?? dados.protocolo_nota_fiscal?.numero_protocolo ?? dados.numero_protocolo ?? ""),
    emitidaEm:
      dados.data_emissao ??
      dados.requisicao_nota_fiscal?.data_emissao ??
      dados.protocolo_nota_fiscal?.data_recebimento ??
      new Date().toISOString(),
    urlDoXml: dados.caminho_xml_nota_fiscal ? `${base}${dados.caminho_xml_nota_fiscal}` : null,
    urlDoDanfe: dados.caminho_danfe ? `${base}${dados.caminho_danfe}` : null,
    urlDoQrCode: dados.qrcode_url ?? null,
    ambiente: Number(config.ambiente),
  };

  // CONTINGÊNCIA OFF-LINE: a Focus responde "autorizado" com
  // `contingencia_offline: true` e `contingencia_offline_efetivada: false`
  // quando a SEFAZ estava fora e a nota saiu off-line. O cupom vale para o
  // cliente, mas a nota ainda vai ser transmitida (até 24 h) e PODE ser
  // rejeitada.
  //
  // Sai como `ok: true` com a marca `emContingencia`, e não como falha. Uma
  // versão anterior devolvia `ok: false, motivo: "contingencia"`, e a rota do
  // botão Emitir (api/store/fiscal/emitir), que só conhece `ok`, gravava o
  // pedido como FAILED sem chave, número nem DANFE: a nota existia e valia
  // para o cliente, o painel dizia "Falhou" e o DANFE que tem de ser impresso
  // na contingência nunca chegava à tela. A nota EXISTE — quem grava precisa
  // da chave. Distinguir "emitida" de "pendente de efetivação" é da marca.
  // (A empresa cadastrada pela tela nova vai à Focus com a contingência
  // off-line desligada — lib/focus-empresas —, então isto só aparece em loja
  // cadastrada à mão no painel da Focus.)
  if (dados?.contingencia_offline === true && dados?.contingencia_offline_efetivada !== true) {
    return {
      ok: true,
      ...nota,
      emContingencia: true,
      aviso:
        "Nota emitida em CONTINGÊNCIA OFF-LINE (a SEFAZ estava fora do ar). O cupom vale para o cliente " +
        "e o DANFE deve ser impresso, mas a nota ainda NÃO está autorizada: o provedor transmite em até " +
        "24 horas. Consulte a situação depois — se a SEFAZ recusar, a nota precisa ser corrigida.",
    };
  }

  return { ok: true, ...nota };
}

/**
 * Consulta a situação de uma NFC-e já enviada (GET /v2/nfce/{ref}).
 *
 * É o caminho de recuperação para dois casos reais: nota que ficou
 * "processando" (SEFAZ lenta) e reenvio com "referência já utilizada". Sem
 * esta consulta, uma nota que caísse em 202 ficava marcada FAILED para sempre
 * — a ref estava consumida no provedor e o reenvio só devolvia erro.
 */
export async function consultarNfce(
  config: ConfiguracaoFiscal,
  pedidoId: string
): Promise<ResultadoDaEmissao> {
  const base = urlBaseDoFocus(config);
  const ref = `firehub-${pedidoId}`;

  try {
    const autorizacao = Buffer.from(`${tokenDoAmbiente(config)}:`).toString("base64");
    const res = await fetch(`${base}/v2/nfce/${encodeURIComponent(ref)}?completa=1`, {
      headers: { Authorization: `Basic ${autorizacao}` },
      signal: AbortSignal.timeout(20_000),
    });
    const dados = await res.json().catch(() => ({}));

    if (res.status === 404) {
      return {
        ok: false,
        motivo: "erro_de_comunicacao",
        mensagem:
          "O provedor não encontrou nenhuma nota com esta referência. " +
          "Tente emitir novamente.",
      };
    }

    if (dados?.status === "autorizado") {
      return traduzirNotaAutorizada(config, base, dados);
    }

    if (dados?.status === "processando_autorizacao" || dados?.codigo === "pending_operation") {
      return {
        ok: false,
        motivo: "processando",
        mensagem:
          "A SEFAZ ainda está processando esta nota. Ela NÃO foi autorizada — " +
          "consulte de novo em instantes.",
      };
    }

    if (dados?.status === "cancelado") {
      return {
        ok: false,
        motivo: "rejeitada",
        mensagem: "Esta nota foi CANCELADA na SEFAZ.",
        detalheDaRejeicao: JSON.stringify(dados).slice(0, 400),
      };
    }

    // erro_autorizacao / denegado: o Focus libera a ref para reenvio corrigido.
    const motivo =
      dados?.mensagem_sefaz || dados?.mensagem || dados?.status || `HTTP ${res.status}`;
    return traduzirFalhaHttp(res.status, String(motivo), dados);
  } catch (e: any) {
    return {
      ok: false,
      motivo: "erro_de_comunicacao",
      mensagem: "Não consegui consultar a situação da nota no provedor. Tente de novo.",
      detalheDaRejeicao: String(e?.message).slice(0, 300),
    };
  }
}

export type ResultadoDoCancelamento =
  | { ok: true; protocolo: string; mensagemSefaz: string; canceladaEm: string; urlDoXmlCancelamento?: string | null }
  | { ok: false; motivo: "rejeitado" | "erro_de_comunicacao"; mensagem: string; detalhe?: string };

/**
 * Cancela uma NFC-e autorizada (DELETE /v2/nfce/{ref} no Focus).
 *
 * Cancelar é ato junto à SEFAZ com prazo curto (na maioria dos estados,
 * ~30 minutos para NFC-e). Passado o prazo, a própria SEFAZ recusa — e a
 * resposta dela é repassada na íntegra, em vez de um erro genérico. A UI já
 * prometia esse cancelamento; a rota é quem passa a cumprir.
 */
export async function cancelarNfce(
  config: ConfiguracaoFiscal,
  pedidoId: string,
  justificativa: string
): Promise<ResultadoDoCancelamento> {
  const base = urlBaseDoFocus(config);
  const ref = `firehub-${pedidoId}`;

  try {
    const autorizacao = Buffer.from(`${tokenDoAmbiente(config)}:`).toString("base64");
    const res = await fetch(`${base}/v2/nfce/${encodeURIComponent(ref)}`, {
      method: "DELETE",
      headers: {
        Authorization: `Basic ${autorizacao}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ justificativa }),
      signal: AbortSignal.timeout(45_000),
    });

    const dados: any = await res.json().catch(() => ({}));

    if (res.ok && (dados?.status === "cancelado" || dados?.status_sefaz === "135")) {
      return {
        ok: true,
        protocolo: String(dados.numero_protocolo ?? dados.protocolo ?? ""),
        mensagemSefaz: String(dados.mensagem_sefaz ?? "Evento registrado e vinculado a NF-e"),
        canceladaEm: new Date().toISOString(),
        // O XML do evento de cancelamento é o que prova o cancelamento na
        // fiscalização (doc: `caminho_xml_cancelamento`).
        urlDoXmlCancelamento: dados.caminho_xml_cancelamento ? `${base}${dados.caminho_xml_cancelamento}` : null,
      };
    }

    const motivo =
      dados?.mensagem_sefaz || dados?.mensagem || dados?.erros?.[0]?.mensagem || `HTTP ${res.status}`;
    return {
      ok: false,
      motivo: res.status >= 500 ? "erro_de_comunicacao" : "rejeitado",
      mensagem: `A SEFAZ não aceitou o cancelamento: ${motivo}`,
      detalhe: JSON.stringify(dados).slice(0, 600),
    };
  } catch (e: any) {
    return {
      ok: false,
      motivo: "erro_de_comunicacao",
      mensagem: "Não consegui falar com o provedor. O cancelamento NÃO foi feito — tente de novo.",
      detalhe: String(e?.message).slice(0, 300),
    };
  }
}

/** Espera a SEFAZ processar: consulta a ref algumas vezes antes de desistir. */
async function aguardarProcessamento(
  config: ConfiguracaoFiscal,
  pedidoId: string
): Promise<ResultadoDaEmissao> {
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    await new Promise((resolve) => setTimeout(resolve, 4_000));
    const resultado = await consultarNfce(config, pedidoId);
    if (resultado.ok || resultado.motivo !== "processando") return resultado;
  }
  return {
    ok: false,
    motivo: "processando",
    mensagem:
      "A SEFAZ recebeu a nota mas ainda não terminou de processá-la. " +
      "Use \"Consultar situação\" em instantes — NÃO emita de novo.",
  };
}

export type ResultadoDaInutilizacao =
  | {
      ok: true;
      protocolo: string;
      statusSefaz: string;
      mensagemSefaz: string;
      serie: number;
      numeroInicial: number;
      numeroFinal: number;
      homologadaEm: string;
      /** XML da inutilização homologada — é ele que se guarda por 5 anos. */
      urlDoXml: string | null;
    }
  | {
      ok: false;
      motivo: "rejeitada" | "erro_de_comunicacao";
      mensagem: string;
      detalhe?: string;
    };

/**
 * Inutiliza uma faixa de numeração de NFC-e na SEFAZ, pelo Focus NFe
 * (POST /v2/nfce/inutilizacao).
 *
 * Só é chamada quando o cadastro fiscal está completo — quem confere isso é a
 * rota, com pendenciasParaEmitir. O protocolo devolvido aqui é o da SEFAZ; se
 * não houver homologação, a resposta diz o motivo e NÃO existe protocolo.
 *
 * A Focus devolve o protocolo em `protocolo_sefaz` e o XML em `caminho_xml`
 * (doc.focusnfe.com.br/reference/inutilizar_numeracao_nfce). O código lia
 * `numero_protocolo`/`protocolo`, que essa resposta não tem: a inutilização
 * homologada era gravada com protocolo vazio e sem o XML.
 */
export async function inutilizarNumeracao(
  config: ConfiguracaoFiscal,
  faixa: { serie: number; numeroInicial: number; numeroFinal: number; justificativa: string }
): Promise<ResultadoDaInutilizacao> {
  const base = urlBaseDoFocus(config);

  try {
    const autorizacao = Buffer.from(`${tokenDoAmbiente(config)}:`).toString("base64");
    const res = await fetch(`${base}/v2/nfce/inutilizacao`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${autorizacao}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        cnpj: normalizarDocumento(config.cnpj),
        serie: String(faixa.serie),
        numero_inicial: String(faixa.numeroInicial),
        numero_final: String(faixa.numeroFinal),
        justificativa: faixa.justificativa,
      }),
      signal: AbortSignal.timeout(45_000),
    });

    const dados: any = await res.json().catch(() => ({}));

    // "autorizado" = inutilização homologada pela SEFAZ (cStat 102).
    if (res.ok && dados?.status === "autorizado") {
      return {
        ok: true,
        protocolo: String(dados.protocolo_sefaz ?? dados.numero_protocolo ?? dados.protocolo ?? ""),
        statusSefaz: String(dados.status_sefaz ?? ""),
        mensagemSefaz: String(dados.mensagem_sefaz ?? "Inutilização de número homologado"),
        serie: faixa.serie,
        numeroInicial: faixa.numeroInicial,
        numeroFinal: faixa.numeroFinal,
        homologadaEm: new Date().toISOString(),
        urlDoXml: dados.caminho_xml ? `${base}${dados.caminho_xml}` : null,
      };
    }

    const motivo =
      dados?.mensagem_sefaz || dados?.mensagem || dados?.erros?.[0]?.mensagem || `HTTP ${res.status}`;
    return {
      ok: false,
      motivo: res.status >= 500 ? "erro_de_comunicacao" : "rejeitada",
      mensagem: `A SEFAZ não homologou a inutilização: ${motivo}`,
      detalhe: JSON.stringify(dados).slice(0, 600),
    };
  } catch (e: any) {
    return {
      ok: false,
      motivo: "erro_de_comunicacao",
      mensagem:
        "Não consegui falar com o provedor. A inutilização NÃO foi feita — tente de novo.",
      detalhe: String(e?.message).slice(0, 300),
    };
  }
}

/**
 * Testa se o token do provedor autentica.
 *
 * Consulta uma ref que não existe: 404 prova que a autenticação passou e o
 * serviço respondeu; 401/403 prova que o token está errado (ou é do outro
 * ambiente — homologação e produção têm tokens diferentes). O lojista
 * descobre isso aqui, num clique, e não na primeira venda com fila no balcão.
 */
export async function testarConexaoComProvedor(
  config: ConfiguracaoFiscal
): Promise<{ ok: boolean; mensagem: string }> {
  if (!tokenDoAmbiente(config)) {
    return { ok: false, mensagem: "Nenhum token de provedor cadastrado ainda. Salve o token primeiro." };
  }

  const base = urlBaseDoFocus(config);
  const nomeDoAmbiente = Number(config.ambiente) === 1 ? "PRODUÇÃO" : "homologação";

  try {
    const autorizacao = Buffer.from(`${tokenDoAmbiente(config)}:`).toString("base64");
    const res = await fetch(`${base}/v2/nfce/firehub-teste-de-conexao`, {
      headers: { Authorization: `Basic ${autorizacao}` },
      signal: AbortSignal.timeout(15_000),
    });

    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        mensagem:
          `O provedor recusou o token (HTTP ${res.status}). Confira se o token colado é o do ` +
          `ambiente de ${nomeDoAmbiente} — homologação e produção têm tokens diferentes.`,
      };
    }

    // 404 é o resultado esperado: autenticou e a ref de teste não existe.
    if (res.status === 404 || res.ok) {
      return {
        ok: true,
        mensagem: `Conexão OK com o provedor no ambiente de ${nomeDoAmbiente}. Token aceito. ✅`,
      };
    }

    return { ok: false, mensagem: `Resposta inesperada do provedor: HTTP ${res.status}.` };
  } catch {
    return {
      ok: false,
      mensagem: "Não consegui alcançar o provedor de emissão. Tente de novo em instantes.",
    };
  }
}

/** Hora de São Paulo no formato do layout (sem milissegundos, offset -03:00). */
function dataDeEmissaoLocal(agora: Date): string {
  // Hora LOCAL com offset, não UTC: toISOString() emitia "Z" com milissegundos
  // — fora do layout e, entre 21h e meia-noite, com o DIA FISCAL errado.
  // "sv-SE" formata como YYYY-MM-DD HH:mm:ss; o Brasil não tem horário de
  // verão desde 2019, então o offset de São Paulo é fixo.
  const local = agora.toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" });
  return local.replace(" ", "T") + "-03:00";
}
