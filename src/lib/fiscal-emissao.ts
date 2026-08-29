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
 */
import type { Problema } from "./fiscal-validacao";
import { pendenciasDoEmitente, pendenciasDoProduto } from "./fiscal-validacao";

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

export type PedidoParaNota = {
  id: string;
  numero: number | null;
  itens: ItemDaNota[];
  valorTotal: number;
  /** Taxa de entrega. Vai como "outras despesas acessórias" — NFC-e não tem frete. */
  taxaEntrega?: number;
  /** Desconto total do pedido. */
  desconto?: number;
  formaDePagamento: string;
  documentoDoCliente?: string | null;
  nomeDoCliente?: string | null;
  /**
   * O pedido é entrega a domicílio?
   *
   * Muda o `presenca_comprador` da nota: 1 é operação presencial (balcão, PDV,
   * mesa, totem) e 4 é "NFC-e em operação com entrega a domicílio". Isto vinha
   * chumbado em 1 para TODO pedido — inclusive delivery, que é a maioria do
   * movimento das lojas. Declarar entrega como venda de balcão é informação
   * errada no documento fiscal, e alguns estados usam esse campo na validação.
   */
  entregaEmDomicilio?: boolean;
};

export type ConfiguracaoFiscal = {
  provedor?: string | null; // "focusnfe" | "plugnotas" | null
  tokenDoProvedor?: string | null;
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
  temCertificado?: boolean;
};

export type ResultadoDaEmissao =
  | {
      ok: true;
      chaveDeAcesso: string;
      numero: number;
      serie: number;
      protocolo: string;
      emitidaEm: string;
      urlDoXml: string | null;
      urlDoDanfe: string | null;
      ambiente: number;
    }
  | {
      ok: false;
      motivo: "nao_configurado" | "dados_incompletos" | "rejeitada" | "erro_de_comunicacao" | "processando";
      mensagem: string;
      pendencias?: Problema[];
      detalheDaRejeicao?: string;
    };

/** Provedores que este código sabe conversar. Nenhum vem ligado por padrão. */
export const PROVEDORES_SUPORTADOS = ["focusnfe"] as const;
export type Provedor = (typeof PROVEDORES_SUPORTADOS)[number];

/**
 * A loja está pronta para emitir?
 *
 * Devolve a lista de pendências. Lista vazia significa que os dados estão
 * completos — o que ainda não garante autorização, porque quem autoriza é a
 * SEFAZ, mas garante que não vamos gastar a viagem à toa.
 */
export function pendenciasParaEmitir(config: ConfiguracaoFiscal): Problema[] {
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
    cscId: config.cscId,
    csc: config.csc,
    temCertificado: config.temCertificado,
  });

  if (!config.provedor || !PROVEDORES_SUPORTADOS.includes(config.provedor as Provedor)) {
    faltas.push({
      campo: "provedor",
      valor: config.provedor ?? null,
      mensagem:
        "Nenhum provedor de emissão está configurado. A NFC-e precisa ser transmitida à SEFAZ " +
        "por um serviço homologado — o FireHub não transmite sozinho.",
    });
  } else if (!config.tokenDoProvedor?.trim()) {
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

/**
 * Emite a NFC-e.
 *
 * Hoje só existe caminho para o provedor Focus NFe. Sem provedor configurado, a
 * resposta é `nao_configurado` com as pendências — nunca um sucesso inventado.
 */
export async function emitirNfce(
  config: ConfiguracaoFiscal,
  pedido: PedidoParaNota
): Promise<ResultadoDaEmissao> {
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

  if (config.provedor === "focusnfe") {
    return emitirPeloFocusNfe(config, pedido);
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
 * O corpo segue o layout que o provedor publica para NFC-e (modelo 65). O
 * `ref` é o identificador do lado do FireHub e serve de idempotência: reenviar
 * o mesmo `ref` não gera nota nova, o provedor devolve a que já existe. Por isso
 * o `ref` é derivado do id do pedido, e não de um contador ou do relógio.
 */
async function emitirPeloFocusNfe(
  config: ConfiguracaoFiscal,
  pedido: PedidoParaNota
): Promise<ResultadoDaEmissao> {
  const base =
    Number(config.ambiente) === 1
      ? "https://api.focusnfe.com.br"
      : "https://homologacao.focusnfe.com.br";

  const ref = `firehub-${pedido.id}`;
  // Hora LOCAL com offset, não UTC: toISOString() emitia "Z" com milissegundos
  // — fora do layout e, entre 21h e meia-noite, com o DIA FISCAL errado.
  const agora = dataDeEmissaoLocal();

  // Os totais da nota precisam fechar ENTRE SI, senão a SEFAZ rejeita
  // (validação 610: valor total difere do somatório dos itens). Por isso
  // valor_produtos é a soma real dos itens — nunca o total cobrado do pedido,
  // que embute taxa de entrega e desconto. A taxa de entrega entra como
  // "outras despesas acessórias" (NFC-e não tem frete; modalidade 9) e o
  // desconto abate do total.
  const somaDosItens = Number(
    pedido.itens.reduce((soma, i) => soma + Number(i.valorTotal.toFixed(2)), 0).toFixed(2)
  );
  const desconto = Math.max(0, Number((pedido.desconto || 0).toFixed(2)));
  const outrasDespesas = Math.max(0, Number((pedido.taxaEntrega || 0).toFixed(2)));
  const valorTotalDaNota = Number((somaDosItens - desconto + outrasDespesas).toFixed(2));

  if (valorTotalDaNota <= 0) {
    return {
      ok: false,
      motivo: "dados_incompletos",
      mensagem:
        `O total da nota ficou R$ ${valorTotalDaNota.toFixed(2)} (itens R$ ${somaDosItens.toFixed(2)} ` +
        `− desconto R$ ${desconto.toFixed(2)} + entrega R$ ${outrasDespesas.toFixed(2)}). ` +
        `A SEFAZ não autoriza nota com total zero ou negativo.`,
    };
  }

  const corpo = {
    natureza_operacao: "Venda ao consumidor",
    data_emissao: agora,
    tipo_documento: 1, // saída
    // 1 = presencial (balcão, PDV, mesa, totem); 4 = entrega a domicílio.
    // Estava chumbado em 1 até para delivery, que é o grosso do movimento.
    presenca_comprador: pedido.entregaEmDomicilio ? 4 : 1,
    consumidor_final: 1,
    modalidade_frete: 9, // sem frete
    cnpj_emitente: String(config.cnpj).replace(/\D/g, ""),
    nome_emitente: config.razaoSocial,
    nome_fantasia_emitente: config.nomeFantasia || config.razaoSocial,
    inscricao_estadual_emitente: String(config.inscricaoEstadual).replace(/\D/g, ""),
    regime_tributario_emitente: Number(config.regimeTributario),
    logradouro_emitente: config.logradouro,
    numero_emitente: config.numero,
    bairro_emitente: config.bairro,
    municipio_emitente: config.municipio,
    codigo_municipio_emitente: String(config.codigoMunicipio).replace(/\D/g, ""),
    uf_emitente: String(config.uf).toUpperCase(),
    cep_emitente: String(config.cep).replace(/\D/g, ""),
    serie: Number(config.serie),
    ...(pedido.documentoDoCliente
      ? { cpf_destinatario: String(pedido.documentoDoCliente).replace(/\D/g, "") }
      : {}),
    ...(pedido.nomeDoCliente ? { nome_destinatario: pedido.nomeDoCliente } : {}),
    valor_produtos: somaDosItens,
    ...(desconto > 0 ? { valor_desconto: desconto } : {}),
    ...(outrasDespesas > 0 ? { valor_outras_despesas: outrasDespesas } : {}),
    valor_total: valorTotalDaNota,
    items: pedido.itens.map((item, i) => ({
      numero_item: i + 1,
      codigo_produto: item.codigo,
      descricao: item.descricao,
      cfop: String(item.cfop).replace(/\D/g, ""),
      codigo_ncm: String(item.ncm).replace(/\D/g, ""),
      ...(item.cest ? { cest: String(item.cest).replace(/\D/g, "") } : {}),
      unidade_comercial: item.unidadeComercial,
      quantidade_comercial: item.quantidade,
      valor_unitario_comercial: Number(item.valorUnitario.toFixed(2)),
      valor_bruto: Number(item.valorTotal.toFixed(2)),
      unidade_tributavel: item.unidadeComercial,
      quantidade_tributavel: item.quantidade,
      valor_unitario_tributavel: Number(item.valorUnitario.toFixed(2)),
      icms_origem: item.origem,
      ...(Number(config.regimeTributario) === 3
        ? { icms_situacao_tributaria: item.cst }
        : { icms_situacao_tributaria: item.csosn }),
      // PIS/COFINS são obrigatórios no item da NFC-e. O cadastro do produto
      // tem os dois (padrão "49" — outras operações); antes eram ignorados e
      // a nota ia sem, contando com sorte na validação.
      pis_situacao_tributaria: String(item.pis ?? "49").padStart(2, "0"),
      cofins_situacao_tributaria: String(item.cofins ?? "49").padStart(2, "0"),
      inclui_no_total: 1,
    })),
    formas_pagamento: [
      {
        forma_pagamento: mapearFormaDePagamento(pedido.formaDePagamento),
        valor_pagamento: valorTotalDaNota,
      },
    ],
  };

  try {
    // O Focus autentica por Basic com o token no usuário e senha vazia.
    const autorizacao = Buffer.from(`${config.tokenDoProvedor}:`).toString("base64");

    const res = await fetch(`${base}/v2/nfce?ref=${encodeURIComponent(ref)}`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${autorizacao}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(45_000),
    });

    const dados = await res.json().catch(() => ({}));

    // 200/201 = autorizada na hora. 202 = em processamento (o Focus responde
    // assim quando a SEFAZ está lenta); nesse caso a nota ainda não existe e
    // quem chamou precisa consultar depois — não podemos devolver ok.
    // 202 = a SEFAZ ainda está processando. A nota EXISTE do lado do Focus
    // (a ref foi consumida) — declarar erro aqui prenderia a ref para sempre.
    // Espera alguns segundos consultando; se não resolver, devolve "processando"
    // para quem chamou tentar de novo mais tarde via consulta.
    if (res.status === 202 || dados?.status === "processando_autorizacao") {
      return aguardarProcessamento(config, pedido.id);
    }

    if (!res.ok || dados?.status !== "autorizado") {
      const motivo =
        dados?.mensagem_sefaz || dados?.mensagem || dados?.erros?.[0]?.mensagem || `HTTP ${res.status}`;
      // "Referência já utilizada": uma tentativa anterior já criou a nota do
      // lado do provedor (autorizada ou em processamento) e este POST não diz
      // em qual estado ela está. Consulta a ref e traduz o estado real.
      if (/refer[eê]ncia|j[aá]\s+(foi\s+)?(emitid|autorizad|utilizad|enviad)/i.test(String(motivo))) {
        return consultarNfce(config, pedido.id);
      }
      return traduzirFalhaHttp(res.status, String(motivo), dados);
    }

    return traduzirNotaAutorizada(config, base, dados);
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
  return {
    ok: false,
    motivo: "rejeitada",
    mensagem: `A SEFAZ recusou esta nota: ${motivo}`,
    detalheDaRejeicao: JSON.stringify(dados).slice(0, 600),
  };
}

function urlBaseDoFocus(config: ConfiguracaoFiscal): string {
  return Number(config.ambiente) === 1
    ? "https://api.focusnfe.com.br"
    : "https://homologacao.focusnfe.com.br";
}

/** Traduz o JSON de uma nota AUTORIZADA do Focus para o resultado do FireHub. */
function traduzirNotaAutorizada(
  config: ConfiguracaoFiscal,
  base: string,
  dados: any
): ResultadoDaEmissao {
  // Sem chave de acesso não existe nota. Uma resposta "autorizado" sem esse
  // campo gravaria o pedido como EMITIDO com chave `undefined` — o lojista
  // veria badge verde e não teria documento nenhum para apresentar. É
  // exatamente o tipo de mentira que este arquivo existe para não contar.
  const chave = String(dados?.chave_nfe ?? "").replace(/\D/g, "");
  if (chave.length !== 44) {
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

  return {
    ok: true,
    chaveDeAcesso: dados.chave_nfe,
    numero: Number(dados.numero),
    serie: Number(dados.serie ?? config.serie),
    protocolo: String(dados.protocolo ?? ""),
    emitidaEm: dados.data_emissao ?? new Date().toISOString(),
    urlDoXml: dados.caminho_xml_nota_fiscal ? `${base}${dados.caminho_xml_nota_fiscal}` : null,
    urlDoDanfe: dados.caminho_danfe ? `${base}${dados.caminho_danfe}` : null,
    ambiente: Number(config.ambiente),
  };
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
    const autorizacao = Buffer.from(`${config.tokenDoProvedor}:`).toString("base64");
    const res = await fetch(`${base}/v2/nfce/${encodeURIComponent(ref)}`, {
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

    if (dados?.status === "processando_autorizacao") {
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

    // erro_autorizacao / rejeição: o Focus libera a ref para reenvio corrigido.
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
  | { ok: true; protocolo: string; mensagemSefaz: string; canceladaEm: string }
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
    const autorizacao = Buffer.from(`${config.tokenDoProvedor}:`).toString("base64");
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
        protocolo: String(dados.protocolo ?? dados.numero_protocolo ?? ""),
        mensagemSefaz: String(dados.mensagem_sefaz ?? "Evento registrado e vinculado a NF-e"),
        canceladaEm: new Date().toISOString(),
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
 */
export async function inutilizarNumeracao(
  config: ConfiguracaoFiscal,
  faixa: { serie: number; numeroInicial: number; numeroFinal: number; justificativa: string }
): Promise<ResultadoDaInutilizacao> {
  const base = urlBaseDoFocus(config);

  try {
    const autorizacao = Buffer.from(`${config.tokenDoProvedor}:`).toString("base64");
    const res = await fetch(`${base}/v2/nfce/inutilizacao`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${autorizacao}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        cnpj: String(config.cnpj).replace(/\D/g, ""),
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
        protocolo: String(dados.numero_protocolo ?? dados.protocolo ?? ""),
        statusSefaz: String(dados.status_sefaz ?? ""),
        mensagemSefaz: String(dados.mensagem_sefaz ?? "Inutilização de número homologado"),
        serie: faixa.serie,
        numeroInicial: faixa.numeroInicial,
        numeroFinal: faixa.numeroFinal,
        homologadaEm: new Date().toISOString(),
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
  if (!config.tokenDoProvedor?.trim()) {
    return { ok: false, mensagem: "Nenhum token de provedor cadastrado ainda. Salve o token primeiro." };
  }

  const base = urlBaseDoFocus(config);
  const nomeDoAmbiente = Number(config.ambiente) === 1 ? "PRODUÇÃO" : "homologação";

  try {
    const autorizacao = Buffer.from(`${config.tokenDoProvedor}:`).toString("base64");
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

/**
 * Código da forma de pagamento no layout da NFC-e.
 *
 * Os canais gravam o método de formas diferentes: o site em português
 * ("Dinheiro", "Cartão de Crédito"), o iFood/99Food em inglês ("CASH",
 * "CREDIT", "DEBIT", "credit_card"). A versão antiga só entendia português —
 * tudo que vinha de fora caía em "99 – Outros", que é o código que mais chama
 * atenção numa malha fiscal.
 */
function mapearFormaDePagamento(forma: string): string {
  const f = (forma || "").toLowerCase();
  if (f.includes("pix")) return "17";
  if (f.includes("dinheiro") || f.includes("cash") || f.includes("money") || f.includes("espécie") || f.includes("especie")) return "01";
  if (f.includes("créd") || f.includes("cred")) return "03";
  if (f.includes("déb") || f.includes("deb")) return "04";
  if (f.includes("vale") || f.includes("voucher") || f.includes("refei") || f.includes("aliment") || f.includes("meal") || f.includes("ticket")) return "10";
  return "99"; // outros
}

/** Agora de São Paulo no formato do layout (sem milissegundos, offset -03:00). */
function dataDeEmissaoLocal(): string {
  // "sv-SE" formata como YYYY-MM-DD HH:mm:ss; o Brasil não tem horário de
  // verão desde 2019, então o offset de São Paulo é fixo.
  const local = new Date().toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" });
  return local.replace(" ", "T") + "-03:00";
}
