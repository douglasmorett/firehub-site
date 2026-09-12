/**
 * O modelo da comanda: o que sai no papel, em que ordem e como.
 *
 * ── Por que existe ──────────────────────────────────────────────────────────
 *
 * Até aqui o layout da comanda era fixo dentro do Assistente de Impressão, que
 * roda no PC da loja. Mudar qualquer coisa — tirar o telefone, aumentar o
 * número do pedido, escrever um recado no rodapé — exigia mexer no código e
 * atualizar o programa em todas as lojas. O lojista que vinha da Saipos
 * estranhava na hora: lá ele abre a comanda na tela e mexe.
 *
 * Aqui o modelo é DADO, não código: uma lista de blocos guardada dentro de
 * `User.printerConfig.comandaModelo`. O painel manda a lista em `order.blocos`
 * e o Assistente cola as seções nessa ordem.
 *
 * ── O que o painel manda e o que o Assistente monta ─────────────────────────
 *
 * O painel NÃO manda a comanda pronta. Manda a ORDEM. O conteúdo de cada seção
 * continua saindo do mesmo código que já roda nas lojas hoje — preço efetivo
 * com desconto rateado, combo, tarja de bebida, rateio de mesa, aviso de
 * entrega parceira. Reimplementar isso aqui criaria uma segunda verdade que
 * divergiria da primeira na primeira mudança.
 *
 * A consequência disso está nos tipos: só os blocos LEVES (número, canal,
 * loja, data, texto livre) aceitam tamanho e alinhamento. Mudar o corpo de
 * fonte de uma seção já quebrada na largura da bobina faria a IMPRESSORA
 * quebrar a linha onde ela quisesse — foi assim que endereço já saiu como
 * "Rua Ma / cae".
 *
 * ── Compatibilidade ─────────────────────────────────────────────────────────
 *
 * Loja sem modelo salvo não manda `blocos` e nada muda, em lugar nenhum.
 * Assistente antigo ignora o campo que não conhece e imprime o layout
 * embutido. Os dois casos estão medidos em
 * firehub-print-assistant/scripts/teste-modelo-comanda.js.
 */

export type Alinhamento = "esquerda" | "centro" | "direita";

/**
 * De quantas letras normais cada letra desta linha ocupa o lugar.
 *
 * ── Por que a escada é 1 / 1,5 / 2 / 3 e não um número qualquer ──────────
 *
 * A impressora térmica não tem fonte com tamanho em pontos: ela repete a
 * mesma matriz de pontos N vezes, e N é NÚMERO INTEIRO. Só com isso, o
 * degrau depois do normal já é o dobro — grande demais para título de seção
 * e come bobina à toa.
 *
 * A saída é que a impressora tem DUAS fontes embutidas: a Fonte A, de 12
 * pontos de largura (48 colunas em 80 mm), e a Fonte B, de 9 (64 colunas).
 * Combinando fonte e multiplicador dá para chegar em degraus intermediários
 * de verdade, não arredondados:
 *
 *   1,0x = Fonte A sem multiplicar ...... 48 colunas em 80 mm
 *   1,5x = Fonte B multiplicada por 2 ... 32 colunas  (64 / 2 = 32 = 48/1,5)
 *   2,0x = Fonte A multiplicada por 2 ... 24 colunas
 *   3,0x = Fonte A multiplicada por 3 ... 16 colunas
 *
 * 2,5x NÃO existe nesta escada e não adianta pedir: a única combinação
 * entre 2 e 3 é Fonte B x3, que dá 2,25x — perto demais de 2 para valer um
 * degrau a mais na tela.
 *
 * Se a impressora ignorar a troca de fonte (acontece em modelo muito antigo,
 * o mesmo que pede o perfil "legacy"), o 1,5x sai como 2x: maior do que foi
 * pedido, nunca ilegível.
 */
export type Tamanho = 1 | 1.5 | 2 | 3;

export const TAMANHOS: Tamanho[] = [1, 1.5, 2, 3];

/** Encosta no degrau mais próximo da escada. Valor de fora vira 1. */
export function tamanhoValido(t: unknown): Tamanho {
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 1) return 1;
  return TAMANHOS.reduce((melhor, cand) =>
    Math.abs(cand - n) < Math.abs(melhor - n) ? cand : melhor, 1 as Tamanho);
}

/** Quantas letras cabem na linha neste tamanho. Papel e prévia usam esta. */
export function larguraDoTamanho(colunas: number, tamanho?: Tamanho | number): number {
  return Math.max(4, Math.floor(colunas / tamanhoValido(tamanho)));
}

/**
 * Cada peça que pode entrar na comanda.
 *
 * Esta lista é um CONTRATO com o Assistente: todo tipo daqui tem um `case`
 * em `aplicarModelo()` dentro de firehub-print-assistant/server.js. Tipo novo
 * que o Assistente não conheça simplesmente não imprime nada — some do papel
 * sem erro nenhum, que é a pior forma de descobrir.
 */
export type TipoDeBloco =
  | "numeroPedido"
  | "canal"
  | "loja"
  | "dataHora"
  | "avisoEntrega"
  | "cliente"
  | "entrega"
  | "itens"
  | "totais"
  | "pagamento"
  | "qrMotoboy"
  | "qrCliente"
  | "textoLivre"
  | "separador"
  | "espaco";

export type Bloco = {
  tipo: TipoDeBloco;
  /** Desligado não sai no papel. O bloco fica na lista para religar depois. */
  ligado: boolean;
  /** Título da seção, quando o bloco tem um ("CLIENTE", "ENTREGA"). Vazio = sem título. */
  titulo?: string;
  /** Só para `textoLivre`: aceita {cliente}, {endereco}, {total}… */
  texto?: string;
  negrito?: boolean;
  /** Um degrau de TAMANHOS: 1, 1.5, 2 ou 3. Ausente = 1. */
  tamanho?: Tamanho;
  alinhamento?: Alinhamento;
};

export type ModeloDeComanda = {
  versao: 1;
  /** A via que vai para a cozinha: sem valores, sem pagamento. */
  cozinha: Bloco[];
  /** A via completa: entrega, valores, pagamento. */
  completo: Bloco[];
};

/**
 * Blocos que a loja não pode tirar do papel.
 *
 * `itens` porque comanda sem o pedido é papel jogado fora. `avisoEntrega`
 * porque é o aviso de que o pedido JÁ tem motoboy do parceiro a caminho, mais
 * o código de coleta — sem ele a loja manda o próprio motoboy num pedido que
 * não é dela para entregar, e paga a corrida duas vezes.
 */
export const BLOCOS_OBRIGATORIOS: TipoDeBloco[] = ["itens", "avisoEntrega"];

/** Blocos cujo conteúdo o Assistente monta: aceitam título, nunca formato. */
export const BLOCOS_DE_SECAO: TipoDeBloco[] = [
  "avisoEntrega", "cliente", "entrega", "itens", "totais", "pagamento", "qrMotoboy", "qrCliente",
];

/** Blocos que aceitam negrito, tamanho e alinhamento. */
export function aceitaFormato(tipo: TipoDeBloco): boolean {
  return !BLOCOS_DE_SECAO.includes(tipo) && tipo !== "separador" && tipo !== "espaco";
}

/** Blocos que têm um título editável em cima. */
export function aceitaTitulo(tipo: TipoDeBloco): boolean {
  return tipo === "cliente" || tipo === "entrega" || tipo === "itens";
}

/** Os campos que o lojista pode usar dentro de um bloco de texto livre. */
export const CAMPOS_DISPONIVEIS: { chave: string; rotulo: string }[] = [
  { chave: "numero", rotulo: "Número do pedido" },
  { chave: "canal", rotulo: "Canal (iFood, 99Food…)" },
  { chave: "codigoCanal", rotulo: "Número no canal" },
  { chave: "loja", rotulo: "Nome da loja" },
  { chave: "cliente", rotulo: "Nome do cliente" },
  { chave: "telefone", rotulo: "Telefone" },
  { chave: "endereco", rotulo: "Endereço de entrega" },
  { chave: "data", rotulo: "Data" },
  { chave: "hora", rotulo: "Hora" },
  { chave: "total", rotulo: "Total do pedido" },
  { chave: "taxaEntrega", rotulo: "Taxa de entrega" },
  { chave: "pagamento", rotulo: "Forma de pagamento" },
  { chave: "entregador", rotulo: "Entregador" },
];

/** Como cada bloco se chama na tela de edição. */
export const NOME_DO_BLOCO: Record<TipoDeBloco, string> = {
  numeroPedido: "Número do pedido",
  canal: "Marca ou marketplace",
  loja: "Nome da loja",
  dataHora: "Data, hora e nº no parceiro",
  avisoEntrega: "Aviso de entrega parceira",
  cliente: "Dados do cliente",
  entrega: "Endereço de entrega",
  itens: "Itens do pedido",
  totais: "Valores e total",
  pagamento: "Forma de pagamento",
  qrMotoboy: "QR do entregador",
  qrCliente: "QR do cupom do cliente",
  textoLivre: "Texto livre",
  separador: "Linha separadora",
  espaco: "Linha em branco",
};

/** O que o bloco faz, em uma linha, para quem nunca viu esta tela. */
export const AJUDA_DO_BLOCO: Record<TipoDeBloco, string> = {
  numeroPedido: "O número grande no topo, que a cozinha lê de longe.",
  canal: "A marca, quando você tem mais de uma no iFood — senão o nome do marketplace. Pedido do seu site não imprime nada aqui.",
  loja: "Útil para quem imprime pedidos de mais de uma loja na mesma impressora.",
  dataHora: "Quando o pedido entrou e o número dele no parceiro.",
  avisoEntrega: "\"MOTOBOY IFOOD — NÃO USAR MOTOBOY DA LOJA\" e o código de coleta. Não pode ser desligado.",
  cliente: "Nome e telefone.",
  entrega: "Endereço completo e a observação que o cliente escreveu.",
  itens: "A lista do que foi pedido, com combos e observações. Não pode ser desligada.",
  totais: "Subtotal, descontos, taxa de entrega e total.",
  pagamento: "Como o cliente paga, se já está pago e quanto de troco levar.",
  qrMotoboy: "O código que o ENTREGADOR escaneia para puxar o pedido no app.",
  qrCliente: "O cupom da campanha de trazer o cliente do iFood/99 para o seu site.",
  textoLivre: "O que você quiser escrever. Clique num campo para trazer dado do pedido.",
  separador: "Uma linha de tracinhos para separar seções.",
  espaco: "Um espaço em branco.",
};

const b = (tipo: TipoDeBloco, extra: Partial<Bloco> = {}): Bloco => ({ tipo, ligado: true, ...extra });

/**
 * O modelo que toda loja começa usando — a comanda que o FireHub já imprime
 * hoje, seção por seção, na mesma ordem. Quem nunca abrir a tela de edição não
 * vê diferença nenhuma no papel, que é a única forma segura de introduzir isto.
 */
export function modeloPadrao(): ModeloDeComanda {
  return {
    versao: 1,
    cozinha: [
      b("numeroPedido", { tamanho: 2, negrito: true, alinhamento: "centro" }),
      b("canal", { tamanho: 2, negrito: true, alinhamento: "centro" }),
      b("avisoEntrega"),
      b("separador"),
      b("loja"),
      b("dataHora"),
      b("cliente", { titulo: "CLIENTE" }),
      b("entrega", { titulo: "ENTREGA" }),
      b("itens", { titulo: "RESUMO DO PEDIDO" }),
    ],
    completo: [
      b("numeroPedido", { tamanho: 2, negrito: true, alinhamento: "centro" }),
      b("canal", { tamanho: 2, negrito: true, alinhamento: "centro" }),
      b("avisoEntrega"),
      b("separador"),
      b("loja"),
      b("dataHora"),
      b("cliente", { titulo: "CLIENTE" }),
      b("entrega", { titulo: "ENTREGA" }),
      b("itens", { titulo: "RESUMO DO PEDIDO" }),
      b("totais"),
      b("pagamento"),
      b("qrMotoboy"),
      b("qrCliente"),
    ],
  };
}

/** Lê o que está gravado, completando o que faltar com o padrão. */
export function lerModelo(bruto: unknown): ModeloDeComanda {
  const padrao = modeloPadrao();
  if (!bruto || typeof bruto !== "object") return padrao;
  const m = bruto as Partial<ModeloDeComanda>;
  const valida = (lista: unknown, reserva: Bloco[]): Bloco[] => {
    if (!Array.isArray(lista) || lista.length === 0) return reserva;
    const limpos = lista
      .filter((x): x is Bloco => !!x && typeof x === "object" && typeof (x as Bloco).tipo === "string" && (x as Bloco).tipo in NOME_DO_BLOCO)
      .map((x): Bloco => ({
        ...x,
        ligado: BLOCOS_OBRIGATORIOS.includes(x.tipo) ? true : x.ligado !== false,
        // Tamanho fora da escada (modelo de versão futura, edição na mão)
        // encosta no degrau mais próximo em vez de virar tarja preta.
        tamanho: x.tamanho ? tamanhoValido(x.tamanho) : undefined,
      }));
    // Bloco obrigatório que sumiu do modelo salvo volta para o fim. Some por
    // edição manual, por versão antiga, ou por um bug meu — e em qualquer um
    // desses casos a loja não pode descobrir na hora do pedido.
    for (const obrigatorio of BLOCOS_OBRIGATORIOS) {
      if (!limpos.some((x) => x.tipo === obrigatorio)) {
        limpos.push(b(obrigatorio, obrigatorio === "itens" ? { titulo: "RESUMO DO PEDIDO" } : {}));
      }
    }
    return limpos;
  };
  return {
    versao: 1,
    cozinha: valida(m.cozinha, padrao.cozinha),
    completo: valida(m.completo, padrao.completo),
  };
}

/**
 * A lista que vai no `order.blocos`, enxuta.
 *
 * Bloco desligado nem é mandado, e campo vazio sai do JSON: o payload que
 * atravessa a rede fica do tamanho do que a loja realmente configurou.
 */
export function blocosParaOAssistente(lista: Bloco[]): Bloco[] {
  return lista
    .filter((x) => x.ligado !== false)
    .map((x) => {
      const saida: Bloco = { tipo: x.tipo, ligado: true };
      if (x.titulo != null) saida.titulo = x.titulo;
      if (x.texto) saida.texto = x.texto;
      if (x.negrito) saida.negrito = true;
      if (x.tamanho && x.tamanho !== 1) saida.tamanho = x.tamanho;
      if (x.alinhamento && x.alinhamento !== "esquerda") saida.alinhamento = x.alinhamento;
      return saida;
    });
}

/**
 * O modelo está mexido, ou a loja nunca abriu a tela?
 *
 * Quem nunca abriu não deve mandar `blocos` nenhum: assim o Assistente (novo
 * ou velho) imprime o layout embutido e não há como o modelo introduzir
 * diferença onde ninguém pediu diferença.
 */
export function modeloFoiPersonalizado(bruto: unknown): boolean {
  return !!bruto && typeof bruto === "object" && Array.isArray((bruto as ModeloDeComanda).completo);
}

/**
 * Os blocos prontos para o `order.blocos`, ou `undefined` quando a loja não
 * personalizou. As duas rotas de impressão (navegador e fila da nuvem) passam
 * por aqui para não divergirem uma da outra.
 */
export function blocosDoPedido(
  printerConfig: unknown,
  opcoes: { semValores?: boolean } = {},
): Bloco[] | undefined {
  const bruto = (printerConfig as { comandaModelo?: unknown } | null)?.comandaModelo;
  if (!modeloFoiPersonalizado(bruto)) return undefined;
  const modelo = lerModelo(bruto);
  return blocosParaOAssistente(opcoes.semValores ? modelo.cozinha : modelo.completo);
}

// ── Prévia ──────────────────────────────────────────────────────────────────

/** Uma linha pronta para o papel: texto já quebrado na largura certa. */
export type LinhaDaComanda = {
  texto: string;
  negrito?: boolean;
  tamanho?: Tamanho;
  alinhamento?: Alinhamento;
  /** Marca a linha como QR: o papel mostra o código, não o texto. */
  qr?: string;
};

export type PedidoParaComanda = {
  numero?: string | number | null;
  canal?: string | null;
  codigoCanal?: string | null;
  loja?: string | null;
  cliente?: string | null;
  telefone?: string | null;
  endereco?: string | null;
  data?: string | null;
  hora?: string | null;
  total?: number | null;
  subtotal?: number | null;
  taxaEntrega?: number | null;
  desconto?: number | null;
  pagamento?: string | null;
  troco?: number | null;
  entregador?: string | null;
  observacao?: string | null;
  /** Entrega do parceiro: o aviso de não mandar motoboy da loja. */
  entregaParceira?: { parceiro: string; codigoDeColeta?: string | null } | null;
  itens?: { quantidade: number; nome: string; preco?: number | null; observacao?: string | null; complementos?: string[] }[];
  qrMotoboy?: string | null;
  /** Campanha "trazer o cliente do marketplace para o site da loja". */
  campanha?: { valor?: string | null; cupom?: string | null; url?: string | null } | null;
};

const dinheiro = (v?: number | null) => `R$ ${Number(v || 0).toFixed(2).replace(".", ",")}`;

/** Substitui {campo} pelo valor do pedido. Campo desconhecido sai vazio. */
export function preencherCampos(texto: string, p: PedidoParaComanda): string {
  const campos: Record<string, string> = {
    numero: String(p.numero ?? ""),
    canal: p.canal || "",
    codigoCanal: p.codigoCanal || "",
    loja: p.loja || "",
    cliente: p.cliente || "",
    telefone: p.telefone || "",
    endereco: p.endereco || "",
    data: p.data || "",
    hora: p.hora || "",
    total: dinheiro(p.total),
    taxaEntrega: dinheiro(p.taxaEntrega),
    pagamento: p.pagamento || "",
    entregador: p.entregador || "",
  };
  return String(texto || "").replace(/\{(\w+)\}/g, (_, campo: string) => campos[campo] ?? "");
}

/**
 * O modelo + o pedido viram a lista de linhas da PRÉVIA.
 *
 * Atenção ao que isto é e ao que não é: o papel de verdade sai do Assistente,
 * com o preço efetivo já rateado, a tarja de bebida e o rateio de mesa. Aqui
 * o objetivo é a loja ver a ORDEM, a LARGURA e o TAMANHO das letras exatamente
 * como vão sair — que é o que ela está editando nesta tela. Por isso a prévia
 * roda sobre um pedido de exemplo, e não sobre um pedido real.
 */
export function montarComanda(
  modelo: Bloco[],
  pedido: PedidoParaComanda,
  opcoes: { colunas: number; comValores: boolean },
): LinhaDaComanda[] {
  const { colunas, comValores } = opcoes;
  const saida: LinhaDaComanda[] = [];
  const por = (texto: string, extra: Partial<LinhaDaComanda> = {}) => saida.push({ texto, ...extra });
  const titulo = (bloco: Bloco, padrao: string) => {
    const t = String(bloco.titulo == null ? padrao : bloco.titulo).trim();
    if (t) por(t.toUpperCase(), { alinhamento: "centro", tamanho: bloco.tamanho || 1.5 });
  };

  for (const bloco of modelo) {
    if (!bloco.ligado) continue;
    const formato: Partial<LinhaDaComanda> = {
      negrito: bloco.negrito,
      tamanho: bloco.tamanho,
      alinhamento: bloco.alinhamento,
    };

    switch (bloco.tipo) {
      case "numeroPedido":
        if (pedido.numero != null && pedido.numero !== "") {
          por(`(${pedido.numero}) DELIVERY ${pedido.codigoCanal || ""}`.trim(), formato);
        }
        break;

      case "canal":
        if (pedido.canal) por(pedido.canal.toUpperCase(), formato);
        break;

      case "loja":
        if (pedido.loja) por(`Estabelecimento: ${pedido.loja.toUpperCase()}`, formato);
        break;

      case "dataHora":
        if (pedido.codigoCanal) por(`N. do Pedido: ${String(pedido.codigoCanal).replace("#", "")}`, formato);
        if (pedido.data || pedido.hora) por(`Data: ${pedido.data || ""} ${pedido.hora || ""}`.trim(), formato);
        break;

      case "avisoEntrega": {
        const e = pedido.entregaParceira;
        if (!e) break;
        por(`*** MOTOBOY ${e.parceiro.toUpperCase()} (ENTREGA PARCEIRA) ***`, { alinhamento: "centro", tamanho: 2 });
        por("NAO USAR MOTOBOY DA LOJA!", { alinhamento: "centro", tamanho: 2 });
        if (e.codigoDeColeta) por(`CODIGO DE COLETA: #${e.codigoDeColeta}`, { alinhamento: "centro", tamanho: 2 });
        break;
      }

      case "cliente":
        if (!pedido.cliente && !pedido.telefone) break;
        titulo(bloco, "CLIENTE");
        if (pedido.cliente) por(`Nome: ${pedido.cliente}`);
        if (pedido.telefone) por(`Telefone: ${pedido.telefone}`);
        por("Qtd Pedidos: 1");
        break;

      case "entrega":
        if (!pedido.endereco) break;
        titulo(bloco, "ENTREGA");
        por(`Endereco: ${pedido.endereco}`);
        if (pedido.observacao) por(`Obs: ${pedido.observacao}`);
        break;

      case "itens": {
        titulo(bloco, "RESUMO DO PEDIDO");
        for (const item of pedido.itens || []) {
          const valor = comValores && item.preco != null ? dinheiro(item.preco) : "";
          por(linhaComValor(`${item.quantidade}x ${item.nome}`, valor, colunas));
          for (const c of item.complementos || []) por(`  - ${c}`);
          if (item.observacao) por(`  Obs: ${item.observacao}`);
          por("_".repeat(colunas));
        }
        break;
      }

      case "totais":
        if (!comValores) break;
        if (pedido.subtotal != null) por(linhaComValor("Subtotal:", dinheiro(pedido.subtotal), colunas));
        if (pedido.desconto) por(linhaComValor("Desconto (Cupom - Loja):", `-${dinheiro(pedido.desconto)}`, colunas));
        if (pedido.taxaEntrega != null) por(linhaComValor("Taxa de Entrega:", dinheiro(pedido.taxaEntrega), colunas));
        por("_".repeat(colunas));
        por(linhaComValor("Total:", dinheiro(pedido.total), larguraDoTamanho(colunas, 2)), { negrito: true, tamanho: 2 });
        por("_".repeat(colunas));
        break;

      case "pagamento":
        if (!comValores || !pedido.pagamento) break;
        por(`Forma de pagamento: ${pedido.pagamento}`);
        if (pedido.troco) por(`Levar ${dinheiro(pedido.troco)} de troco`, { negrito: true, tamanho: 2 });
        break;

      // ── OS DOIS QR NÃO PODEM SE PARECER ─────────────────────────────────
      //
      // Na mesma folha podem sair dois códigos: o que o ENTREGADOR lê para
      // puxar o pedido no app, e o cupom de desconto que o CLIENTE leva. Sem
      // rótulo são dois quadrados pretos iguais, e o cliente aponta a câmera no
      // errado achando que é o desconto dele — não vaza nada, o QR do
      // entregador só carrega o número do pedido e quem autoriza é a sessão do
      // motoboy, mas o cliente fica com a sensação de que o cupom não funcionou.
      case "qrMotoboy":
        if (!pedido.qrMotoboy) break;
        por("-".repeat(colunas));
        por("ENTREGADOR: PUXAR PEDIDO", { alinhamento: "centro", negrito: true });
        por("", { qr: pedido.qrMotoboy });
        por("(uso da loja - leia pelo app do entregador)", { alinhamento: "centro" });
        break;

      case "qrCliente": {
        const c = pedido.campanha;
        if (!c || !c.url) break;
        por("");
        // Barra de "=" de propósito: a folha inteira usa "-", então esta faixa
        // é a única coisa com essa cara e separa o que é do cliente.
        por("=".repeat(colunas));
        if (c.valor) por(String(c.valor), { alinhamento: "centro", negrito: true, tamanho: 2 });
        por("", { qr: c.url });
        por("Escaneie e faca seu proximo pedido", { alinhamento: "centro", negrito: true });
        if (c.cupom) por(`ou use o cupom ${c.cupom.toUpperCase()}`, { alinhamento: "centro" });
        por("=".repeat(colunas));
        break;
      }

      case "textoLivre": {
        const t = preencherCampos(bloco.texto || "", pedido).trim();
        if (t) por(t, formato);
        break;
      }

      case "separador":
        por("-".repeat(colunas));
        break;

      case "espaco":
        por("");
        break;
    }
  }

  return saida;
}

/** "1x Esfirra Duo" à esquerda e "R$ 7,98" à direita, na mesma linha. */
function linhaComValor(esquerda: string, direita: string, colunas: number): string {
  if (!direita) return esquerda;
  const espaco = Math.max(1, colunas - esquerda.length - direita.length);
  if (espaco < 1) return `${esquerda} ${direita}`;
  return esquerda + " ".repeat(espaco) + direita;
}

/**
 * A comanda como TEXTO, do jeito que sai no papel — é o que a tela de edição
 * mostra. Usa a mesma quebra de linha e o mesmo alinhamento do papel, então a
 * prévia não é aproximação de largura: é a largura.
 */
export function previaEmTexto(linhas: LinhaDaComanda[], colunas: number): string {
  const out: string[] = [];
  for (const l of linhas) {
    if (l.qr) { out.push(centralizar("[ QR ]", colunas)); continue; }
    const largura = larguraDoTamanho(colunas, l.tamanho);
    const partes = quebrar(l.texto, largura);
    if (partes.length === 0) { out.push(""); continue; }
    for (const p of partes) {
      out.push(
        l.alinhamento === "centro" ? centralizar(p, largura)
          : l.alinhamento === "direita" ? p.padStart(largura)
          : p,
      );
    }
  }
  return out.join("\n");
}

function centralizar(texto: string, colunas: number): string {
  const t = texto.slice(0, colunas);
  const sobra = Math.max(0, colunas - t.length);
  return " ".repeat(Math.floor(sobra / 2)) + t;
}

/** Quebra por palavra, igual ao Assistente: a linha nunca é cortada no meio. */
function quebrar(texto: string, largura: number): string[] {
  const t = String(texto || "").replace(/\s+/g, " ").trim();
  if (!t) return [];
  const w = Math.max(4, largura);
  const out: string[] = [];
  let atual = "";
  for (let palavra of t.split(" ")) {
    while (palavra.length > w) {
      if (atual) { out.push(atual); atual = ""; continue; }
      out.push(palavra.slice(0, w));
      palavra = palavra.slice(w);
    }
    if (!palavra) continue;
    const tentativa = atual ? `${atual} ${palavra}` : palavra;
    if (tentativa.length > w) { out.push(atual); atual = palavra; }
    else atual = tentativa;
  }
  if (atual) out.push(atual);
  return out;
}

/** Quantas colunas cabem na bobina. */
export function colunasDoPapel(paperWidth?: string | null, colunas?: number | null): number {
  if (colunas && colunas > 10) return colunas;
  return String(paperWidth || "80mm") === "58mm" ? 32 : 48;
}

/** Um pedido de mentira, para a tela de edição ter o que mostrar. */
export function pedidoDeExemplo(nomeDaLoja = "Sua Loja"): PedidoParaComanda {
  return {
    numero: 79,
    canal: "iFood",
    codigoCanal: "#3523",
    loja: nomeDaLoja,
    cliente: "Larissa Moreira",
    telefone: "(22) 99999-1020",
    endereco: "Rua Dez, 59 - Costazul - Rio das Ostras",
    data: "12/09/2026",
    hora: "23:22",
    subtotal: 34.88,
    desconto: 12.99,
    taxaEntrega: 6.0,
    total: 27.87,
    pagamento: "Credito (Pago Online)",
    troco: 0,
    entregador: "Jefim Bahia",
    observacao: "Sem cebola, por favor",
    entregaParceira: null,
    itens: [
      { quantidade: 1, nome: "Esfirra Duo", preco: 7.98 },
      { quantidade: 1, nome: "3 Esfirras Doces", preco: 26.9, complementos: ["3x Chocolate Branco"], observacao: "caprichar no recheio" },
    ],
    qrMotoboy: "20260912-79",
    campanha: { valor: "VOCE GANHOU R$ 10", cupom: "VOLTA10", url: "https://firehubfood.com.br/loja/exemplo?cupom=VOLTA10" },
  };
}
