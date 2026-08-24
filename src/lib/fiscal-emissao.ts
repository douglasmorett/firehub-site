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
};

export type PedidoParaNota = {
  id: string;
  numero: number | null;
  itens: ItemDaNota[];
  valorTotal: number;
  formaDePagamento: string;
  documentoDoCliente?: string | null;
  nomeDoCliente?: string | null;
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
      motivo: "nao_configurado" | "dados_incompletos" | "rejeitada" | "erro_de_comunicacao";
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
  const agora = new Date().toISOString();

  const corpo = {
    natureza_operacao: "Venda ao consumidor",
    data_emissao: agora,
    tipo_documento: 1, // saída
    presenca_comprador: 1, // operação presencial
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
    valor_total: Number(pedido.valorTotal.toFixed(2)),
    valor_produtos: Number(pedido.valorTotal.toFixed(2)),
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
      inclui_no_total: 1,
    })),
    formas_pagamento: [
      {
        forma_pagamento: mapearFormaDePagamento(pedido.formaDePagamento),
        valor_pagamento: Number(pedido.valorTotal.toFixed(2)),
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
    if (res.status === 202 || dados?.status === "processando_autorizacao") {
      return {
        ok: false,
        motivo: "erro_de_comunicacao",
        mensagem:
          "A SEFAZ está processando esta nota. Consulte novamente em alguns segundos — " +
          "a nota NÃO foi autorizada ainda.",
        detalheDaRejeicao: JSON.stringify(dados).slice(0, 400),
      };
    }

    if (!res.ok || dados?.status !== "autorizado") {
      const motivo =
        dados?.mensagem_sefaz || dados?.mensagem || dados?.erros?.[0]?.mensagem || `HTTP ${res.status}`;
      return {
        ok: false,
        motivo: res.status >= 500 ? "erro_de_comunicacao" : "rejeitada",
        mensagem: `A SEFAZ recusou esta nota: ${motivo}`,
        detalheDaRejeicao: JSON.stringify(dados).slice(0, 600),
      };
    }

    return {
      ok: true,
      chaveDeAcesso: dados.chave_nfe,
      numero: Number(dados.numero),
      serie: Number(dados.serie ?? config.serie),
      protocolo: String(dados.protocolo ?? ""),
      emitidaEm: dados.data_emissao ?? agora,
      urlDoXml: dados.caminho_xml_nota_fiscal ? `${base}${dados.caminho_xml_nota_fiscal}` : null,
      urlDoDanfe: dados.caminho_danfe ? `${base}${dados.caminho_danfe}` : null,
      ambiente: Number(config.ambiente),
    };
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

/** Código da forma de pagamento no layout da NFC-e. */
function mapearFormaDePagamento(forma: string): string {
  const f = (forma || "").toLowerCase();
  if (f.includes("dinheiro")) return "01";
  if (f.includes("crédito") || f.includes("credito")) return "03";
  if (f.includes("débito") || f.includes("debito")) return "04";
  if (f.includes("pix")) return "17";
  if (f.includes("vale") || f.includes("voucher") || f.includes("refeição")) return "10";
  return "99"; // outros
}
