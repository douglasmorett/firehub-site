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
 * Aqui o modelo é DADO, não código: uma lista de blocos guardada em
 * `User.comandaModelo`. O painel monta a comanda a partir dele e manda pronta;
 * o Assistente só converte em comandos de impressora. Assistente antigo ignora
 * o campo que não conhece e segue com o layout embutido, então nenhuma loja
 * fica sem imprimir enquanto não atualiza.
 *
 * ── A régua ─────────────────────────────────────────────────────────────────
 *
 * Bobina de 80 mm imprime 48 colunas; a de 58 mm, 32. Todo o cálculo de quebra
 * e alinhamento é feito nessas colunas, e é isso que permite mostrar na tela a
 * comanda EXATAMENTE como ela vai sair — a prévia usa a mesma função que o
 * papel.
 */

export type Alinhamento = "esquerda" | "centro" | "direita";

/**
 * De quantas letras normais cada letra desta linha ocupa o lugar.
 *
 * ── Por que a escada é 1 / 1,5 / 2 / 3 e não um número qualquer ──────────
 *
 * A impressora térmica não tem fonte com tamanho em pontos: ela repete a
 * mesma matriz de pontos N vezes, e N é NÚMERO INTEIRO. Só com isso, o
 * degrau depois do normal já é o dobro — que é grande demais para título de
 * seção e come bobina à toa.
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
 * degrau a mais na tela. Fica 1,5 / 2 / 3, que é o que o lojista consegue
 * distinguir no papel.
 *
 * Se a impressora ignorar a troca de fonte (acontece em modelo muito antigo,
 * o mesmo que pede o perfil "legacy"), o 1,5x sai como 2x: maior do que foi
 * pedido, nunca ilegível.
 */
export type Tamanho = 1 | 1.5 | 2 | 3;

export const TAMANHOS: Tamanho[] = [1, 1.5, 2, 3];

/**
 * Como cada degrau vira comando de impressora.
 *
 * Fonte A/B é o ESC M; o multiplicador é o GS ! Quem escreve os bytes é o
 * Assistente — esta tabela existe para a regra morar num lugar só e a
 * prévia da tela não divergir do papel.
 */
export const ESCPOS_DO_TAMANHO: Record<string, { fonte: "A" | "B"; multiplicador: 1 | 2 | 3 }> = {
  "1": { fonte: "A", multiplicador: 1 },
  "1.5": { fonte: "B", multiplicador: 2 },
  "2": { fonte: "A", multiplicador: 2 },
  "3": { fonte: "A", multiplicador: 3 },
};

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

/** Cada peça que pode entrar na comanda. */
export type TipoDeBloco =
  | "numeroPedido"
  | "canal"
  | "loja"
  | "dataHora"
  | "cliente"
  | "entrega"
  | "itens"
  | "observacao"
  | "totais"
  | "pagamento"
  | "codigoEntrega"
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

/** Os campos que o lojista pode usar dentro de um bloco de texto livre. */
export const CAMPOS_DISPONIVEIS: { chave: string; rotulo: string; exemplo: string }[] = [
  { chave: "numero", rotulo: "Número do pedido", exemplo: "79" },
  { chave: "canal", rotulo: "Canal (iFood, 99Food…)", exemplo: "iFood" },
  { chave: "codigoCanal", rotulo: "Número no canal", exemplo: "#3523" },
  { chave: "loja", rotulo: "Nome da loja", exemplo: "Salz Burgueria" },
  { chave: "cliente", rotulo: "Nome do cliente", exemplo: "Larissa Moreira" },
  { chave: "telefone", rotulo: "Telefone do cliente", exemplo: "0800 705 1020" },
  { chave: "endereco", rotulo: "Endereço de entrega", exemplo: "Rua Dez, 59 - Costazul" },
  { chave: "bairro", rotulo: "Bairro", exemplo: "Costazul" },
  { chave: "data", rotulo: "Data", exemplo: "12/09/2026" },
  { chave: "hora", rotulo: "Hora", exemplo: "23:22" },
  { chave: "prazo", rotulo: "Entregar até", exemplo: "00:07" },
  { chave: "total", rotulo: "Total do pedido", exemplo: "R$ 27,87" },
  { chave: "taxaEntrega", rotulo: "Taxa de entrega", exemplo: "R$ 5,00" },
  { chave: "pagamento", rotulo: "Forma de pagamento", exemplo: "Crédito (Pago Online)" },
  { chave: "troco", rotulo: "Troco a levar", exemplo: "R$ 12,00" },
  { chave: "entregador", rotulo: "Entregador", exemplo: "Jefim Bahia" },
  { chave: "localizador", rotulo: "Localizador (99Food)", exemplo: "55301287" },
  { chave: "codigoEntrega", rotulo: "Código de entrega", exemplo: "1138" },
];

/** Como cada bloco se chama na tela de edição. */
export const NOME_DO_BLOCO: Record<TipoDeBloco, string> = {
  numeroPedido: "Número do pedido",
  canal: "Canal e número no parceiro",
  loja: "Nome da loja",
  dataHora: "Data e hora",
  cliente: "Dados do cliente",
  entrega: "Endereço de entrega",
  itens: "Itens do pedido",
  observacao: "Observação do pedido",
  totais: "Valores e total",
  pagamento: "Forma de pagamento",
  codigoEntrega: "Código de entrega e localizador",
  qrMotoboy: "QR do entregador",
  qrCliente: "QR do cupom do cliente",
  textoLivre: "Texto livre",
  separador: "Linha separadora",
  espaco: "Linha em branco",
};

/** O que o bloco faz, em uma linha, para quem nunca viu esta tela. */
export const AJUDA_DO_BLOCO: Record<TipoDeBloco, string> = {
  numeroPedido: "O número grande no topo, que a cozinha lê de longe.",
  canal: "De onde veio o pedido e o número dele lá (iFood #3523).",
  loja: "Útil para quem imprime pedidos de mais de uma loja na mesma impressora.",
  dataHora: "Quando o pedido entrou.",
  cliente: "Nome e telefone.",
  entrega: "Endereço completo, complemento e ponto de referência.",
  itens: "A lista do que foi pedido, com complementos e observações. Não pode ser desligada.",
  observacao: "O recado que o cliente escreveu para a cozinha.",
  totais: "Subtotal, descontos, taxa de entrega e total.",
  pagamento: "Como o cliente paga e se já está pago. Inclui o troco a levar.",
  codigoEntrega: "Os códigos que o entregador precisa na porta do cliente.",
  qrMotoboy: "O código que o entregador escaneia para puxar o pedido no app.",
  qrCliente: "O cupom da campanha de trazer o cliente do iFood/99 para o seu site.",
  textoLivre: "O que você quiser escrever. Use os campos entre chaves para trazer dados do pedido.",
  separador: "Uma linha de tracinhos para separar seções.",
  espaco: "Um espaço em branco.",
};

const b = (tipo: TipoDeBloco, extra: Partial<Bloco> = {}): Bloco => ({ tipo, ligado: true, ...extra });

/**
 * O modelo que toda loja começa usando — a comanda que o FireHub já imprime
 * hoje, peça por peça. Quem nunca abrir a tela de edição não vê diferença
 * nenhuma no papel, que é a única forma segura de introduzir isto.
 */
export function modeloPadrao(): ModeloDeComanda {
  return {
    versao: 1,
    cozinha: [
      b("numeroPedido", { tamanho: 2, negrito: true, alinhamento: "centro" }),
      b("canal", { alinhamento: "centro" }),
      b("separador"),
      b("dataHora"),
      b("cliente", { titulo: "CLIENTE" }),
      b("entrega", { titulo: "ENTREGA" }),
      b("itens", { titulo: "RESUMO DO PEDIDO" }),
      b("observacao"),
      b("espaco"),
      b("textoLivre", { texto: "-- COMANDA DA COZINHA --", alinhamento: "centro" }),
    ],
    completo: [
      b("numeroPedido", { tamanho: 2, negrito: true, alinhamento: "centro" }),
      b("canal", { alinhamento: "centro" }),
      b("loja", { alinhamento: "centro" }),
      b("separador"),
      b("dataHora"),
      b("cliente", { titulo: "CLIENTE" }),
      b("entrega", { titulo: "ENTREGA" }),
      b("itens", { titulo: "RESUMO DO PEDIDO" }),
      b("observacao"),
      b("totais"),
      b("pagamento", { negrito: true }),
      b("codigoEntrega"),
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
        ligado: x.ligado !== false,
        // Tamanho fora da escada (modelo de versão futura, edição na mão)
        // encosta no degrau mais próximo em vez de virar tarja preta.
        tamanho: x.tamanho ? tamanhoValido(x.tamanho) : undefined,
      }));
    // Os itens são a razão de a comanda existir: se sumirem do modelo salvo
    // (edição manual, versão antiga), voltam para o fim em vez de a cozinha
    // receber um papel sem o pedido.
    if (!limpos.some((x) => x.tipo === "itens")) limpos.push(b("itens", { titulo: "RESUMO DO PEDIDO" }));
    return limpos;
  };
  return {
    versao: 1,
    cozinha: valida(m.cozinha, padrao.cozinha),
    completo: valida(m.completo, padrao.completo),
  };
}

// ── Montagem ────────────────────────────────────────────────────────────────

/** Uma linha pronta para o papel: texto já quebrado na largura certa. */
export type LinhaDaComanda = {
  texto: string;
  negrito?: boolean;
  tamanho?: Tamanho;
  alinhamento?: Alinhamento;
  /** Marca a linha como QR: o Assistente imprime o código, não o texto. */
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
  bairro?: string | null;
  data?: string | null;
  hora?: string | null;
  prazo?: string | null;
  total?: number | null;
  subtotal?: number | null;
  taxaEntrega?: number | null;
  desconto?: number | null;
  pagamento?: string | null;
  troco?: number | null;
  entregador?: string | null;
  localizador?: string | null;
  codigoEntrega?: string | null;
  observacao?: string | null;
  /** Campanha "trazer o cliente do marketplace para o site da loja". */
  campanha?: { valor?: string | null; cupom?: string | null; url?: string | null } | null;
  itens?: { quantidade: number; nome: string; preco?: number | null; observacao?: string | null; complementos?: string[] }[];
  qrMotoboy?: string | null;
};

const dinheiro = (v?: number | null) => `R$ ${Number(v || 0).toFixed(2).replace(".", ",")}`;

/** Substitui {campo} pelo valor do pedido. Campo desconhecido sai vazio. */
export function preencherCampos(texto: string, p: PedidoParaComanda): string {
  return String(texto || "").replace(/\{(\w+)\}/g, (_, campo: string) => {
    switch (campo) {
      case "numero": return String(p.numero ?? "");
      case "canal": return p.canal || "";
      case "codigoCanal": return p.codigoCanal || "";
      case "loja": return p.loja || "";
      case "cliente": return p.cliente || "";
      case "telefone": return p.telefone || "";
      case "endereco": return p.endereco || "";
      case "bairro": return p.bairro || "";
      case "data": return p.data || "";
      case "hora": return p.hora || "";
      case "prazo": return p.prazo || "";
      case "total": return dinheiro(p.total);
      case "taxaEntrega": return dinheiro(p.taxaEntrega);
      case "pagamento": return p.pagamento || "";
      case "troco": return p.troco ? dinheiro(p.troco) : "";
      case "entregador": return p.entregador || "";
      case "localizador": return p.localizador || "";
      case "codigoEntrega": return p.codigoEntrega || "";
      default: return "";
    }
  });
}

/**
 * O modelo + o pedido viram a lista de linhas que vai para o papel.
 *
 * Bloco sem conteúdo não vira linha nenhuma: pedido de retirada não tem
 * endereço, e uma seção "ENTREGA" vazia só gasta bobina e confunde.
 */
export function montarComanda(
  modelo: Bloco[],
  pedido: PedidoParaComanda,
  opcoes: { colunas: number; comValores: boolean },
): LinhaDaComanda[] {
  const { colunas, comValores } = opcoes;
  const saida: LinhaDaComanda[] = [];
  const por = (texto: string, extra: Partial<LinhaDaComanda> = {}) => saida.push({ texto, ...extra });
  const titulo = (t?: string) => {
    if (!t) return;
    // 1,5x e não 2x: título de seção em corpo dobrado ocupa meia linha de
    // bobina para dizer "CLIENTE", e some a informação em volta.
    por(t.toUpperCase(), { alinhamento: "centro", tamanho: 1.5 });
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
        if (pedido.numero != null && pedido.numero !== "") por(`PEDIDO #${pedido.numero}`, formato);
        break;

      case "canal":
        if (pedido.canal) por(pedido.codigoCanal ? `${pedido.canal} ${pedido.codigoCanal}` : pedido.canal, formato);
        break;

      case "loja":
        if (pedido.loja) por(pedido.loja.toUpperCase(), formato);
        break;

      case "dataHora":
        if (pedido.data || pedido.hora) por(`Data: ${pedido.data || ""} ${pedido.hora || ""}`.trim(), formato);
        if (pedido.prazo) por(`Entregar ate: ${pedido.prazo}`, { ...formato, negrito: true });
        break;

      case "cliente":
        if (!pedido.cliente && !pedido.telefone) break;
        titulo(bloco.titulo);
        if (pedido.cliente) por(`Nome: ${pedido.cliente}`, formato);
        if (pedido.telefone) por(`Telefone: ${pedido.telefone}`, formato);
        break;

      case "entrega":
        if (!pedido.endereco) break;
        titulo(bloco.titulo);
        por(`Endereco: ${pedido.endereco}`, formato);
        if (pedido.entregador) por(`Entregador: ${pedido.entregador}`, formato);
        break;

      case "itens": {
        titulo(bloco.titulo);
        for (const item of pedido.itens || []) {
          const valor = comValores && item.preco != null ? dinheiro(item.preco) : "";
          por(linhaComValor(`${item.quantidade}x ${item.nome}`, valor, colunas), { negrito: bloco.negrito });
          for (const c of item.complementos || []) por(`  - ${c}`);
          if (item.observacao) por(`  Obs: ${item.observacao}`);
        }
        break;
      }

      case "observacao":
        if (pedido.observacao) por(`Obs: ${pedido.observacao}`, { ...formato, negrito: true });
        break;

      case "totais":
        if (!comValores) break;
        por("-".repeat(colunas));
        if (pedido.subtotal != null) por(linhaComValor("Subtotal:", dinheiro(pedido.subtotal), colunas));
        if (pedido.desconto) por(linhaComValor("Desconto:", `-${dinheiro(pedido.desconto)}`, colunas));
        if (pedido.taxaEntrega != null) por(linhaComValor("Taxa de entrega:", dinheiro(pedido.taxaEntrega), colunas));
        por(linhaComValor("TOTAL:", dinheiro(pedido.total), larguraDoTamanho(colunas, 1.5)), { negrito: true, tamanho: 1.5 });
        break;

      case "pagamento":
        if (!comValores || !pedido.pagamento) break;
        por(`Forma de pagamento: ${pedido.pagamento}`, formato);
        if (pedido.troco) por(`Levar ${dinheiro(pedido.troco)} de troco`, { ...formato, negrito: true, tamanho: 2 });
        break;

      case "codigoEntrega":
        if (pedido.localizador) por(`Localizador: ${pedido.localizador}`, formato);
        if (pedido.codigoEntrega) por(`Codigo de entrega: ${pedido.codigoEntrega}`, { ...formato, negrito: true });
        break;

      // ── OS DOIS QR NÃO PODEM SE PARECER ────────────────────────────
      //
      // Na mesma folha podem sair dois códigos: o que o ENTREGADOR lê para
      // puxar o pedido no app, e o cupom de desconto que o CLIENTE leva. Sem
      // rótulo (era o caso do QR do entregador até aqui) são dois quadrados
      // pretos iguais, e o cliente aponta a câmera no errado achando que é o
      // desconto dele — não vaza nada, o QR do entregador só carrega o número
      // do pedido e quem autoriza é a sessão do motoboy, mas o cliente fica
      // com a sensação de que o cupom não funcionou.
      //
      // Por isso o rótulo e o separador nascem DENTRO do bloco: não é opção
      // que a loja possa desligar sem querer e voltar a ter dois quadrados
      // anônimos lado a lado.
      case "qrMotoboy":
        if (!pedido.qrMotoboy) break;
        por("-".repeat(colunas));
        por(bloco.titulo || "ENTREGADOR: PUXAR PEDIDO", { alinhamento: "centro", negrito: true });
        por("", { qr: pedido.qrMotoboy, alinhamento: "centro" });
        por("(uso da loja - leia pelo app do entregador)", { alinhamento: "centro" });
        break;

      case "qrCliente": {
        const c = pedido.campanha;
        if (!c || !c.url) break;
        por("");
        // Barra de "=" de propósito: a folha inteira usa "-", então esta
        // faixa é a única coisa com essa cara e separa o que é do cliente.
        por("=".repeat(colunas));
        por(bloco.titulo || "SEU DESCONTO NO PROXIMO PEDIDO", { alinhamento: "centro", negrito: true });
        if (c.valor) por(String(c.valor), { alinhamento: "centro", negrito: true, tamanho: 2 });
        por("", { qr: c.url, alinhamento: "centro" });
        por("Aponte a camera do seu celular aqui", { alinhamento: "centro" });
        if (c.cupom) por(`Cupom: ${c.cupom}`, { alinhamento: "centro", negrito: true });
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
 * prévia não é uma aproximação: é a comanda.
 */
export function previaEmTexto(linhas: LinhaDaComanda[], colunas: number): string {
  const out: string[] = [];
  for (const l of linhas) {
    if (l.qr) { out.push(centralizar("[ QR do entregador ]", colunas)); continue; }
    // Letra ampliada ocupa o lugar de N letras: cabe colunas/N por linha.
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
    bairro: "Costazul",
    data: "12/09/2026",
    hora: "23:22",
    prazo: "00:07",
    subtotal: 34.88,
    desconto: 12.99,
    taxaEntrega: 6.0,
    total: 27.87,
    pagamento: "Credito (Pago Online)",
    troco: 0,
    entregador: "Jefim Bahia",
    localizador: "55301287",
    codigoEntrega: "1138",
    observacao: "Sem cebola, por favor",
    itens: [
      { quantidade: 1, nome: "Esfirra Duo", preco: 7.98 },
      { quantidade: 1, nome: "3 Esfirras Doces", preco: 26.9, complementos: ["3x Chocolate Branco"], observacao: "caprichar no recheio" },
    ],
    qrMotoboy: "20260912-79",
    campanha: { valor: "VOCE GANHOU R$ 10", cupom: "VOLTA10", url: "https://firehubfood.com.br/loja/exemplo?cupom=VOLTA10" },
  };
}
