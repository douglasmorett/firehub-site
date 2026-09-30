/**
 * /src/lib/textos-da-tela-fiscal.ts
 *
 * O que a tela fiscal escreve para o LOJISTA a partir do que as regras
 * devolvem — puro, sem banco e sem React: a tela (app/store/fiscal) e o
 * checklist do emissor (lib/nfce/cadastro-do-emissor, no servidor) usam o
 * mesmo texto.
 *
 * ── O rótulo do campo ───────────────────────────────────────────────────────
 *
 * As pendências (lib/fiscal-validacao → pendenciasDoEmitente, lib/nfce/pendencias,
 * lib/fiscal-emissao → pendenciasParaEmitir e montarCorpoDaNfce) guardam em
 * `campo` o NOME INTERNO do dado ("inscricaoEstadual", "codigoMunicipio"): é a
 * chave que o código filtra (`p.campo !== "serie"`) e que os testes conferem —
 * e continua assim. O que mudou é a tela: a caixa vermelha do topo mostrava
 * "**inscricaoEstadual**: …" e o checklist "Falta: cnpj, razaoSocial,
 * regimeTributario…" — nome de variável para quem só quer saber o que
 * preencher. Aqui o nome vira o rótulo do formulário ("Inscrição Estadual").
 *
 * Campo que ninguém cadastrou aqui não quebra nem aparece cru: vira palavras
 * ("tokenDoProvedor" → "Token do provedor", "uf_emitente" → "UF emitente").
 */

/** O rótulo de cada `campo` que as pendências fiscais geram, com o nome que a tela usa. */
export const ROTULO_DO_CAMPO_FISCAL: Readonly<Record<string, string>> = {
  // ── Empresa (pendenciasDoEmitente) ──
  cnpj: "CNPJ",
  inscricaoEstadual: "Inscrição Estadual",
  razaoSocial: "Razão social",
  nomeFantasia: "Nome fantasia",
  regimeTributario: "Regime tributário",
  logradouro: "Logradouro",
  numero: "Número",
  complemento: "Complemento",
  bairro: "Bairro",
  municipio: "Município",
  codigoMunicipio: "Código IBGE do município",
  uf: "UF",
  cep: "CEP",
  serie: "Série",
  ambiente: "Ambiente",
  cscId: "ID do CSC",
  csc: "CSC",
  certificado: "Certificado digital",
  // ── Quem transmite (pendenciasParaEmitir) e emissor do FireHub (lib/nfce/pendencias) ──
  provedor: "Quem transmite as notas",
  tokenDoProvedor: "Token do provedor",
  qrVersao: "Versão do QR Code",
  numeroInicial: "Número inicial",
  contingenciaOffline: "Contingência off-line",
  // ── Só o titular altera (lib/fiscal-config → CAMPOS_DO_TITULAR): voltam em `camposIgnorados` ──
  enabled: "Emissão ligada/desligada",
  tokenHomologacao: "Token de homologação",
  tokenProducao: "Token de produção",
  temCertificado: "Certificado enviado à Focus",
  momentoDaEmissao: "Momento da emissão",
  taxaDeServicoNaNota: "Taxa de serviço na nota",
  intermediadores: "Intermediadores",
  pixEstatico: "Pix estático",
  entregaComoPresencial: "Entrega como venda presencial",
  cfopPadrao: "CFOP padrão",
  csosnPadrao: "CSOSN padrão",
  autoEmitPaymentMethods: "Formas de pagamento da emissão automática",
  modoDaEmissao: "Como a nota é emitida (automática ou manual)",
  formasPorIntegracao: "Formas com nota automática nas integrações",
  cpfNaEntrega: "CPF/CNPJ obrigatório na entrega",
  // ── Cadastro na Focus (lib/focus-empresas → conferirPedidoDeCadastro) ──
  senhaCertificado: "Senha do certificado",
  "csc.homologacao": "CSC de homologação",
  "csc.producao": "CSC de produção",
  "csc.homologacao.id": "ID do CSC de homologação",
  "csc.producao.id": "ID do CSC de produção",
  "csc.homologacao.codigo": "CSC de homologação",
  "csc.producao.codigo": "CSC de produção",
  // ── Produto (pendenciasDoProduto; no pedido vem como "Produto → ncm") ──
  ncm: "NCM",
  cfop: "CFOP",
  cest: "CEST",
  csosn: "CSOSN",
  cst: "CST",
  origem: "Origem da mercadoria",
  unidadeComercial: "Unidade comercial",
  pis: "PIS",
  cofins: "COFINS",
  quantidade: "Quantidade",
  valor: "Valor",
  desconto: "Desconto",
  descricao: "Descrição",
  // ── Pedido (montarCorpoDaNfce, intermediadorDoPedido) ──
  itens: "Itens do pedido",
  valorTotal: "Valor total",
  documentoDoCliente: "CPF/CNPJ do cliente",
  enderecoDoCliente: "Endereço do cliente",
  formaDePagamento: "Forma de pagamento",
  pagamentos: "Pagamentos",
  cnpjDoIntermediador: "CNPJ do intermediador",
  idNoIntermediador: "Identificador da loja no intermediador",
  // ── Montagem do XML (lib/nfce/xml-da-nota): chegam nas pendências da nota que falhou ──
  items: "Itens do pedido",
  formas_pagamento: "Formas de pagamento",
  valor_total: "Valor total",
  presenca_comprador: "Indicador de presença",
  chave: "Chave de acesso",
  dhCont: "Entrada em contingência",
  xJust: "Justificativa da contingência",
  cnpj_emitente: "CNPJ",
  nome_emitente: "Razão social",
  inscricao_estadual_emitente: "Inscrição Estadual",
  regime_tributario_emitente: "Regime tributário",
  logradouro_emitente: "Logradouro",
  bairro_emitente: "Bairro",
  municipio_emitente: "Município",
  codigo_municipio_emitente: "Código IBGE do município",
  cep_emitente: "CEP",
  uf_emitente: "UF",
  cpf_destinatario: "CPF do cliente",
  cnpj_destinatario: "CNPJ do cliente",
  logradouro_destinatario: "Logradouro do cliente",
  bairro_destinatario: "Bairro do cliente",
  municipio_destinatario: "Município do cliente",
  codigo_municipio_destinatario: "Código IBGE do município do cliente",
  uf_destinatario: "UF do cliente",
  indicador_inscricao_estadual_destinatario: "Indicador de IE do cliente",
  cnpj_intermediario: "CNPJ do intermediador",
  id_intermediario: "Identificador da loja no intermediador",
  // ── Entrega a domicílio (indPres 4): destinatário e transportador ──
  nomeDoCliente: "Nome do cliente",
  modalidade_frete: "Modalidade do frete",
  transportador: "Transportador da entrega",
  cnpj_transportador: "CNPJ do transportador",
  cpf_transportador: "CPF do transportador",
  nome_transportador: "Nome do transportador",
  inscricao_estadual_transportador: "Inscrição Estadual do transportador",
  uf_transportador: "UF do transportador",
};

/** Siglas que continuam em maiúsculas quando o rótulo sai do nome interno. */
const SIGLAS = new Set(["cnpj", "cpf", "csc", "ie", "uf", "cep", "ncm", "cfop", "cest", "csosn", "cst", "pis", "cofins", "qr", "ibge", "nfce", "nfe", "id", "crt"]);

/** "tokenDoProvedor" / "uf_emitente" → "Token do provedor" / "UF emitente". */
function emPalavras(nome: string): string {
  const palavras = nome
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_\-.]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => (SIGLAS.has(p.toLowerCase()) ? p.toUpperCase() : p.toLowerCase()));
  if (palavras.length === 0) return nome.trim();
  const [primeira, ...resto] = palavras;
  return [primeira.charAt(0).toUpperCase() + primeira.slice(1), ...resto].join(" ");
}

/**
 * O rótulo de um `campo` de pendência, como a tela escreve.
 *
 * Aceita também as formas compostas que as regras montam:
 *  - "Pizza Calabresa → ncm" (o item do pedido, lib/fiscal-emissao) → "Pizza Calabresa → NCM";
 *  - "item 3.ncm" (lib/nfce/xml-da-nota) → "Item 3 → NCM";
 *  - "items[0].x" / "formas_pagamento[1].y" → "Item 1 → X" / "Pagamento 2 → Y".
 *
 * Vazio devolve vazio (a pendência gravada sem campo mostra só a mensagem).
 */
export function rotuloDoCampoFiscal(campo: unknown): string {
  const bruto = String(campo ?? "").trim();
  if (!bruto) return "";
  const conhecido = ROTULO_DO_CAMPO_FISCAL[bruto];
  if (conhecido) return conhecido;

  // "sefaz.serie", "sefaz.csc.homologacao": o bloco do emissor do FireHub
  // (lib/nfce/cadastro-do-emissor → recusados). O rótulo é o do campo.
  if (bruto.startsWith("sefaz.")) return rotuloDoCampoFiscal(bruto.slice("sefaz.".length));

  // "Produto → campo": o nome do produto fica como veio; só o campo vira rótulo.
  const seta = bruto.lastIndexOf("→");
  if (seta > 0) {
    const dono = bruto.slice(0, seta).trim();
    const resto = rotuloDoCampoFiscal(bruto.slice(seta + 1));
    return dono && resto ? `${dono} → ${resto}` : dono || resto;
  }

  // "item 3.ncm" (xml-da-nota numera os itens a partir de 1).
  const doItem = /^item\s+(\d+)\.(.+)$/i.exec(bruto);
  if (doItem) return `Item ${doItem[1]} → ${rotuloDoCampoFiscal(doItem[2])}`;

  // "items[0].x" / "formas_pagamento[1]" (índice a partir de 0).
  const daLista = /^(items|formas_pagamento)\[(\d+)\](?:\.(.+))?$/.exec(bruto);
  if (daLista) {
    const nome = `${daLista[1] === "items" ? "Item" : "Pagamento"} ${Number(daLista[2]) + 1}`;
    return daLista[3] ? `${nome} → ${rotuloDoCampoFiscal(daLista[3])}` : nome;
  }

  return emPalavras(bruto);
}

type PendenciaNaTela = { campo?: unknown; mensagem?: unknown };

/** "Rótulo: mensagem" — a linha de uma pendência num aviso ou num alert. */
export function pendenciaEmTexto(p: PendenciaNaTela): string {
  const rotulo = rotuloDoCampoFiscal(p?.campo);
  const mensagem = String(p?.mensagem ?? "").trim();
  if (!rotulo) return mensagem;
  return mensagem ? `${rotulo}: ${mensagem}` : rotulo;
}

/** Os rótulos das pendências, sem repetir, na ordem: "CNPJ, Razão social, UF". */
export function camposEmTexto(pendencias: ReadonlyArray<PendenciaNaTela> | null | undefined): string {
  const vistos: string[] = [];
  for (const p of pendencias ?? []) {
    const rotulo = rotuloDoCampoFiscal(p?.campo);
    if (rotulo && !vistos.includes(rotulo)) vistos.push(rotulo);
  }
  return vistos.join(", ");
}

/**
 * O `aviso` do PUT /api/store/fiscal com a lista de `camposIgnorados` (o que o
 * funcionário tentou mudar e só o titular muda) escrita com os rótulos. A frase
 * é montada na rota com os nomes internos ("…mantidos como estavam: cnpj,
 * sefaz.serie."); a tela troca só a lista, e o resto do aviso fica como veio.
 */
export function avisoComRotulos(aviso: unknown, camposIgnorados: unknown): string {
  const texto = String(aviso ?? "");
  if (!texto || !Array.isArray(camposIgnorados) || camposIgnorados.length === 0) return texto;
  const cru = camposIgnorados.map(String).join(", ");
  if (!cru || !texto.includes(cru)) return texto;
  const rotulos = camposEmTexto(camposIgnorados.map((campo) => ({ campo })));
  return texto.replace(cru, () => rotulos);
}

// ─── A JUSTIFICATIVA QUE A TELA PEDE ────────────────────────────────────────

/**
 * Cancelamento de NFC-e: xJust de 15 a 255 caracteres (lib/nfce/sefaz →
 * eventoDeCancelamento; a rota /cancelar recusa abaixo de 15).
 */
export const JUSTIFICATIVA_DO_CANCELAMENTO = { minimo: 15, maximo: 255 } as const;

/**
 * Devolução registrada pelo contador: mínimo 10 (lib/edicao-de-pedido →
 * registroDaDevolucao), e o servidor guarda só os 500 primeiros — passar
 * disso cortaria calado o fim do que a loja escreveu.
 */
export const OBSERVACAO_DA_DEVOLUCAO = { minimo: 10, maximo: 500 } as const;

/** O texto como vai: espaços repetidos e quebras de linha viram um espaço (a SEFAZ faz o mesmo). */
export const textoDaJustificativa = (texto: string): string => String(texto ?? "").replace(/\s+/g, " ").trim();

export type RegraDoTexto = {
  /** Caracteres que contam (sem os espaços sobrando). */
  tamanho: number;
  ok: boolean;
  /** Quantos faltam para o mínimo (0 = já chegou). */
  faltam: number;
  /** Quantos passaram do máximo (0 = dentro). */
  sobram: number;
};

/** O texto cabe na regra? É o que habilita o botão de confirmar. */
export function regraDoTexto(texto: string, regra: { minimo: number; maximo: number }): RegraDoTexto {
  const tamanho = textoDaJustificativa(texto).length;
  const faltam = Math.max(0, regra.minimo - tamanho);
  const sobram = Math.max(0, tamanho - regra.maximo);
  return { tamanho, ok: faltam === 0 && sobram === 0, faltam, sobram };
}
