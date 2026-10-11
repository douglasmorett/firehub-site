/**
 * O relatório "Itens vendidos" — o da Saipos, que os lojistas pediram (NIK,
 * 24/09/2026: "todo mundo tá pedindo relatórios como o da Saipos").
 *
 * Especificação: a central de ajuda da Saipos (meajuda.saipos.com, artigo
 * "Itens vendidos", 23 prints), o vídeo oficial e o vídeo do lojista. O que
 * eles fazem, este faz:
 *
 * - Visão padrão: duas tabelas — ITENS (os produtos) e OPÇÕES (os grupos de
 *   opção: sabores, bordas, adicionais…, cada um abrindo nas opções). As duas
 *   não se somam: o valor do produto já contém as opções.
 * - "Agrupar produtos por categoria": a categoria vira o primeiro nível.
 * - "Agrupar opções por produto": uma tabela só, produto → o que foi escolhido
 *   NELE. Com a de cima: categoria → produto → opções (a tela do vídeo da NIK).
 * - "Agrupar apenas produtos": a Coca escolhida dentro do combo soma na linha
 *   da Coca vendida sozinha — "quantas Cocas saíram", sem as opções.
 * - Quantidade da meia pizza é FRAÇÃO: meio a meio = 0,5 de cada sabor, como
 *   na Saipos ("4 sabores em 1 pizza = 0,25 de cada").
 * - Percentual pela QUANTIDADE, relativo ao nível de cima (a categoria no total,
 *   o produto na categoria, a opção entre as opções do produto).
 * - Total = "total dos itens": produtos + opções, sem taxa de entrega, serviço
 *   e desconto, e sem pedido cancelado.
 *
 * E o que eles fazem mal, este faz melhor (levantamento de 24/09/2026):
 * - "Juntar produtos de mesmo nome" no lugar do "Agrupar por código" (o
 *   FireHub não tem código de produto; o mesmo "Combo 1" chega do iFood, da
 *   Wabiz e do balcão com três ids, e para o dono é um só).
 * - A opção que casa com o cadastro sai com o NOME do cadastro: "Borda
 *   Catupiry Original" (Wabiz), "Massa Tradicional + Borda Catupiry" (iFood) e
 *   "Borda de Catupiry" (balcão) viram uma linha só.
 * - Percentual também pelo valor, quando o lojista pede.
 *
 * Puro (só lê pedidos e mapas já montados). Os mapas vêm de
 * lib/itens-do-relatorio.ts, que é quem sabe a categoria de verdade do item de
 * plataforma e reconhecer borda/sabor no nome da opção.
 */
import { chaveDoNome } from "@/lib/categoria-do-item";
import { complementosDaOpcao } from "@/lib/complemento-da-opcao";
import { precoDaOpcao } from "@/lib/preco-por-canal";
import { canalDePrecoDo, categoriaDoItem, precoUnitarioDaOpcao, SEM_CATEGORIA, type MapasDaLoja } from "@/lib/itens-do-relatorio";
import { c2 } from "@/lib/relatorios/base";

// ── O QUE ENTRA ─────────────────────────────────────────────────────────────

export type ItemParaRelatorio = {
  quantity: number;
  price: number;
  productName?: string | null;
  menuProductId?: string | null;
  comboSelections?: unknown;
  menuProduct?: { id?: string | null; name?: string | null; category?: string | null; active?: boolean | null } | null;
};

export type PedidoParaItens = {
  franchiseeId: string;
  /** Chave do canal (lib/canal-do-pedido.ts): decide a coluna de preço da opção sem preço. */
  canal: string;
  items: ItemParaRelatorio[];
};

/**
 * Um grupo de opção do cadastro: o título, se é de sabor FRACIONADO (os sabores
 * escolhidos nele dividem UMA pizza — `grupoDeSaborDePizza`) e as opções dele
 * (chaveDoNome), para achar o grupo da escolha que o pedido gravou sem ele.
 */
export type GrupoDoCadastro = { id: string; titulo: string; fracionado: boolean; opcoes?: string[] };

// ── QUANDO O SABOR É FRAÇÃO ─────────────────────────────────────────────────
//
// Meia pizza conta 0,5 de cada sabor (como na Saipos). Até 11/10/2026 só
// fracionava o grupo com regra de preço de pizza (`priceRule`, "cobra o mais
// caro"/"média") ou o sabor com "1/2" no nome — e a pizza de dois sabores
// cadastrada sem a regra contava como duas: Pizzaria 17, "COMBO 1 — Pizza G:
// escolha 2 sabores" {Calabresa, Bacon c/ Ovos} saía 1 + 1 (57 itens do site
// em 30 dias); no balcão e na mesa, que gravam a escolha sem o grupo, nem o
// `priceRule` valia (331 itens de pizza/combo em 30 dias, só 2 com "1/2").
//
// O critério, explícito, para o grupo SEM regra de preço: o título fala de
// sabor (ou de metade, meio a meio) e a pizza aparece no título — ou, título
// genérico ("Escolha até 2 sabores"), no nome ou na categoria do produto. E
// NÃO é fração, cada sabor é uma unidade inteira: rodízio (no título, no
// produto ou na categoria: o "Rodizio em casa" da Showrrascão mora na
// categoria Pizza), "mini" no título (ou no produto, quando o título não fala
// de pizza: a caixa de mini pizzas), título que nomeia outra coisa (esfiha,
// pastel, salgado, bebida… — o combo "Pizza + 4 Esfirras" tem as duas
// perguntas) e grupo de mais de 4 sabores (pizza tem até 4; caixa tem mais).

const semAcento = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const FALA_DE_SABOR = /\bsabor(es)?\b|\bmetades?\b|\bmeio a meio\b/;
const FALA_DE_PIZZA = /\bpizzas?\b/;
const RODIZIO = /\brodizios?\b/;
const MINI = /\bmini\b/;
const OUTRA_COISA = /\b(esfi(h|rr)as?|pastel|pasteis|salgad\w*|coxinhas?|refri\w*|bebidas?|sucos?|aguas?|cervejas?|acai|sorvetes?|milk ?shakes?|hamburguer\w*|burgers?|lanches?|calzones?|batatas?|porcao|porcoes)\b/;

/** O produto é pizza (pelo nome ou pela categoria) — e não rodízio nem mini. */
export function produtoDePizza(nome: string | null | undefined, categoria?: string | null): boolean {
  const n = semAcento(nome), c = semAcento(categoria);
  if (RODIZIO.test(n) || RODIZIO.test(c) || MINI.test(n)) return false;
  return FALA_DE_PIZZA.test(n) || FALA_DE_PIZZA.test(c);
}

/**
 * O grupo vale UMA pizza dividida entre os sabores escolhidos nele? Com
 * `priceRule` sempre (é a pergunta de sabores da pizza); sem ela, pelo
 * critério do topo desta seção.
 */
export function grupoDeSaborDePizza(
  grupo: { titulo: string; priceRule?: string | null; maxQty?: number | null },
  produto: { nome?: string | null; categoria?: string | null } = {},
): boolean {
  if (String(grupo.priceRule || "").trim()) return true;
  const titulo = semAcento(grupo.titulo), nome = semAcento(produto.nome), categoria = semAcento(produto.categoria);
  if (!FALA_DE_SABOR.test(titulo)) return false;
  if (RODIZIO.test(titulo) || RODIZIO.test(nome) || RODIZIO.test(categoria) || MINI.test(titulo)) return false;
  if (grupo.maxQty != null && Number(grupo.maxQty) > 4) return false;
  if (FALA_DE_PIZZA.test(titulo)) return true;
  if (OUTRA_COISA.test(titulo) || MINI.test(nome) || MINI.test(categoria)) return false;
  return FALA_DE_PIZZA.test(nome) || FALA_DE_PIZZA.test(categoria);
}

export type ConfigDosItens = {
  porCategoria: boolean;
  opcoesPorProduto: boolean;
  apenasProdutos: boolean;
  juntarMesmoNome: boolean;
  percentualPor: "quantidade" | "valor";
  /** Categorias e produtos marcados (vazio = todos). Valem para o ITEM. */
  categorias: Set<string>;
  produtos: Set<string>;
  /** Grupos de opção escondidos pela "Filtragem de opções" (chave do grupo). */
  gruposOcultos: Set<string>;
};

// ── O QUE SAI ───────────────────────────────────────────────────────────────

export type TipoDoNo = "categoria" | "produto" | "grupo" | "opcao";

export type NoDoRelatorio = {
  chave: string;
  nome: string;
  tipo: TipoDoNo;
  quantidade: number;
  /** null = não dá para saber (opção sem preço no pedido nem no cadastro). */
  valor: number | null;
  /** Participação no nível de cima, 0 a 100. */
  pct: number;
  filhos?: NoDoRelatorio[];
};

export type ResultadoDosItens = {
  /** A tabela principal: "Itens" ou "Itens e opções". */
  itens: NoDoRelatorio[];
  /** A tabela "Opções" da visão padrão (grupo → opção). null nos modos que a juntam. */
  opcoes: NoDoRelatorio[] | null;
  total: { quantidade: number; valor: number };
  /** Os grupos de opção vistos no período — as caixinhas da "Filtragem de opções". */
  gruposDeOpcao: { chave: string; nome: string; quantidade: number }[];
  /** Quantas vendas de itens entraram (linhas de pedido). */
  linhas: number;
};

// ── AS ESCOLHAS DE UM ITEM ──────────────────────────────────────────────────

export type EscolhaLida = {
  /** Nome como o canal gravou, sem o "1/2 " da frente. */
  nome: string;
  /** Quantidade já multiplicada pelo item e pela fração do sabor. */
  quantidade: number;
  /** Quantidade antes da fração — a que multiplica o preço unitário da opção. */
  quantidadeInteira: number;
  /**
   * Preço UNITÁRIO da opção pelo que o canal gravou, lido pela regra do canal
   * (lib/itens-do-relatorio.ts, `precoUnitarioDaOpcao`): no iFood e no 99 o
   * gravado é o total da linha da opção e se divide pela quantidade dela.
   */
  precoDoCanal: number | null;
  /** Grupo do cadastro (formato do site), quando o pedido o guarda. */
  grupoId: string | null;
};

/** O que o relatório sabe do pedido e do item para ler as escolhas. */
export type ContextoDasEscolhas = {
  /** Chave do canal do pedido (lib/canal-do-pedido.ts): decide como se lê o preço gravado na opção. */
  canal?: string | null;
  /**
   * Os grupos do produto do item — ou, no espelho do iFood/99/Brendi, os do
   * produto do cardápio de mesmo nome. Acham o grupo da escolha que o pedido
   * gravou sem ele (balcão, mesa, marketplace): é o grupo que diz se o sabor é
   * fração.
   */
  gruposDoProduto?: GrupoDoCadastro[];
  /** O item é pizza (`produtoDePizza`): vale o grupo "Sabor - " que a Brendi põe no nome da escolha. */
  ehPizza?: boolean;
};

const FRACAO_RE = /^\s*(\d+)\s*\/\s*(\d+)\s+/;
/** A Brendi manda o grupo no nome da escolha: "Sabor - Calabresa" (Pizzaria Supimpa, set/2026). */
const GRUPO_SABOR_NO_NOME = /^\s*sabor(es)?\s*[-–:]\s*\S/i;

/**
 * As escolhas do item, com o grupo quando o pedido o guarda e com a FRAÇÃO do
 * sabor. Três formatos, os mesmos de lib/parse-combo.ts:
 *
 * - site: { grupoId: { nome: qtd } } — o grupo vem;
 * - iFood/99/Wabiz/Brendi/JotaJá: [{ name, quantity, price }] — a meia pode vir
 *   no nome ("1/2 Portuguesa") e o preço é o daquela metade (no iFood e no 99,
 *   o total da linha da opção: `precoUnitarioDaOpcao` divide pela quantidade);
 * - balcão e mesa: [{ name, quantity }] ou texto — sem grupo e sem preço.
 *
 * A fração: "1/2 " no nome vale o que diz. Sem ela, o GRUPO decide: no grupo
 * de sabor de pizza (`grupoDeSaborDePizza`) cada sabor vale qtd ÷ total
 * escolhido no grupo — dois sabores de 1 = 0,5 cada; o mesmo sabor 2× = 1. O
 * grupo é o gravado (site, ou `groupId` na lista) ou, quando o pedido não o
 * grava — ou grava um grupo que o cardápio já apagou —, o grupo do produto que
 * tem uma opção com aquele nome. Se o nome está
 * em dois grupos de sabor (COMBO 4 da P17: "1ª Pizza M" e "2ª Pizza M", com
 * os mesmos 10 sabores), os sabores repartem as DUAS pizzas: 4 sabores = 0,5
 * cada. Nome em dois grupos que não são ambos de sabor: não dá para saber, e
 * a escolha conta inteira, como antes.
 */
export function escolhasDoItemComGrupo(
  item: { quantity: number; comboSelections?: unknown },
  grupos: Map<string, GrupoDoCadastro>,
  contexto: ContextoDasEscolhas = {},
): EscolhaLida[] {
  const qtdItem = Number(item.quantity) || 1;
  let bruto: any = item.comboSelections;
  if (!bruto) return [];
  if (typeof bruto === "string") {
    try { bruto = JSON.parse(bruto); } catch {
      bruto = bruto.split(/[\n|;]/).map((s: string) => s.trim()).filter(Boolean);
    }
  }

  // 1. As escolhas cruas: nome, quantidade da opção, preço gravado, grupo gravado.
  type Crua = { nome: string; qtd: number; precoGravado: unknown; grupoId: string | null; fracaoDoNome: number | null; fracao: { chave: string; pizzas: number } | null };
  const cruas: Crua[] = [];
  const ler = (nomeBruto: string, qtd: number, precoGravado: unknown, grupoId: string | null) => {
    const m = FRACAO_RE.exec(nomeBruto);
    const nome = nomeBruto.replace(FRACAO_RE, "").trim();
    if (!nome || !(qtd > 0)) return;
    cruas.push({ nome, qtd, precoGravado, grupoId, fracaoDoNome: m && Number(m[2]) > 0 ? Number(m[1]) / Number(m[2]) : null, fracao: null });
  };
  if (bruto && !Array.isArray(bruto) && typeof bruto === "object") {
    for (const [grupoId, escolhas] of Object.entries(bruto as Record<string, any>)) {
      if (!escolhas || typeof escolhas !== "object" || Array.isArray(escolhas)) continue;
      for (const [nome, q] of Object.entries(escolhas as Record<string, any>)) {
        const n = Number(q);
        if (nome && Number.isFinite(n) && n > 0) ler(nome, n, null, grupoId);
      }
    }
  } else if (Array.isArray(bruto)) {
    for (const e of bruto) {
      if (typeof e === "string") {
        const m = e.match(/^(\d+)x?\s+(.+)$/i);
        if (m) ler(m[2].trim(), Number(m[1]), null, null);
        else if (e.trim()) ler(e.trim(), 1, null, null);
      } else if (e && typeof e === "object") {
        const nome = String(e.name || e.productName || e.label || e.description || "").trim();
        if (nome) ler(nome, Number(e.quantity || e.qty || 1), e.price, e.groupId ? String(e.groupId) : null);
      }
    }
  } else {
    return [];
  }

  // 2. O grupo de FRAÇÃO de cada escolha (só os de sabor de pizza importam).
  const doProduto = contexto.gruposDoProduto || [];
  for (const c of cruas) {
    if (c.fracaoDoNome !== null) continue;
    const chave = chaveDoNome(c.nome);
    const candidatos = chave ? doProduto.filter((g) => g.opcoes?.includes(chave)) : [];
    if (c.grupoId) {
      const g = grupos.get(c.grupoId);
      if (g) {
        if (g.fracionado) c.fracao = { chave: `g:${g.id}`, pizzas: 1 };
        continue;
      }
      // O grupo gravado não existe mais: salvar o cardápio recria os grupos
      // com outro id (Deeds, 30 dias até 11/10/2026: 117 de 162 itens do site
      // apontavam para grupo apagado; Serpa 26 de 43). O grupo de HOJE com a
      // opção de mesmo nome diz se é sabor de pizza; a divisão continua pelo
      // grupo gravado, que é uma pizza só.
      if (candidatos.length && candidatos.every((x) => x.fracionado)) c.fracao = { chave: `g:${c.grupoId}`, pizzas: 1 };
      continue;
    }
    if (candidatos.length && candidatos.every((g) => g.fracionado)) {
      c.fracao = { chave: `g:${candidatos.map((g) => g.id).sort().join("+")}`, pizzas: candidatos.length };
    } else if (!candidatos.length && contexto.ehPizza && GRUPO_SABOR_NO_NOME.test(c.nome)) {
      c.fracao = { chave: "nome:sabor", pizzas: 1 };
    }
  }
  const totalDaFracao = new Map<string, number>();
  for (const c of cruas) if (c.fracao) totalDaFracao.set(c.fracao.chave, (totalDaFracao.get(c.fracao.chave) || 0) + c.qtd);

  // 3. A quantidade: × item × fração (a do nome, ou pizzas ÷ sabores do grupo).
  return cruas.map((c) => {
    const inteira = c.qtd * qtdItem;
    const total = c.fracao ? totalDaFracao.get(c.fracao.chave) || 0 : 0;
    const fracao = c.fracaoDoNome ?? (c.fracao && total > 0 ? c.fracao.pizzas / total : 1);
    return {
      nome: c.nome,
      quantidade: inteira * fracao,
      quantidadeInteira: inteira,
      precoDoCanal: precoUnitarioDaOpcao(c.precoGravado, c.qtd, contexto.canal),
      grupoId: c.grupoId,
    };
  });
}

// ── A CONTA ─────────────────────────────────────────────────────────────────

const SEM_GRUPO = "grupo:outras";

type Acumulado = { chave: string; nome: string; tipo: TipoDoNo; quantidade: number; valor: number; valorConhecido: boolean; filhos: Map<string, Acumulado> };

function novo(chave: string, nome: string, tipo: TipoDoNo): Acumulado {
  return { chave, nome, tipo, quantidade: 0, valor: 0, valorConhecido: true, filhos: new Map() };
}

function filho(pai: Acumulado | Map<string, Acumulado>, chave: string, nome: string, tipo: TipoDoNo): Acumulado {
  const mapa = pai instanceof Map ? pai : pai.filhos;
  let n = mapa.get(chave);
  if (!n) { n = novo(chave, nome, tipo); mapa.set(chave, n); }
  return n;
}

function somar(n: Acumulado, quantidade: number, valor: number | null) {
  n.quantidade += quantidade;
  if (valor === null) n.valorConhecido = false;
  else n.valor += valor;
}

/** Ordena por quantidade (e valor) e calcula o percentual dentro de cada nível. */
function finalizar(mapa: Map<string, Acumulado>, por: "quantidade" | "valor"): NoDoRelatorio[] {
  const lista = [...mapa.values()];
  const base = lista.reduce((s, n) => s + (por === "valor" ? (n.valorConhecido ? n.valor : 0) : n.quantidade), 0);
  return lista
    .sort((a, b) => b.quantidade - a.quantidade || b.valor - a.valor || a.nome.localeCompare(b.nome, "pt-BR"))
    .map((n) => {
      const medida = por === "valor" ? (n.valorConhecido ? n.valor : 0) : n.quantidade;
      const saida: NoDoRelatorio = {
        chave: n.chave,
        nome: n.nome,
        tipo: n.tipo,
        quantidade: Math.round(n.quantidade * 1000) / 1000,
        valor: n.valorConhecido ? c2(n.valor) : (n.valor > 0 ? c2(n.valor) : null),
        pct: base > 0 ? Math.round((medida / base) * 100000) / 1000 : 0,
      };
      if (n.filhos.size) saida.filhos = finalizar(n.filhos, por);
      return saida;
    });
}

/** A chave que junta "o mesmo produto": id, ou o nome dentro da categoria. */
function chaveDoProduto(item: ItemParaRelatorio, nome: string, categoria: string, juntarMesmoNome: boolean): string {
  if (juntarMesmoNome) return `p:${categoria}:${chaveDoNome(nome) || nome.toLowerCase()}`;
  return `p:${item.menuProductId || item.menuProduct?.id || chaveDoNome(nome)}`;
}

/** O nome do produto para o relatório: o do cadastro, ou o gravado sem as opções (" | Borda X"). */
export function nomeDoProduto(item: ItemParaRelatorio): string {
  return (item.menuProduct?.name || String(item.productName || "").split(" | ")[0] || "Produto removido").trim();
}

export type ContextoDaConta = {
  /** Mapas por loja (lib/itens-do-relatorio.ts, montarMapasDoRelatorio). */
  mapasDe: (lojaId: string) => MapasDaLoja;
  /** Grupos de opção de todas as lojas do relatório, por id. */
  grupos: Map<string, GrupoDoCadastro>;
  /**
   * Produtos VENDÁVEIS por nome (chaveDoNome) — o destino do "Agrupar apenas
   * produtos": a Coca do combo soma na Coca avulsa. Por loja.
   */
  vendaveisDe: (lojaId: string) => Map<string, { id: string; nome: string; categoria: string }>;
  /**
   * Os grupos de opção do produto do item (lib/relatorios/catalogo.ts) — no
   * espelho do marketplace, os do produto do cardápio de mesmo nome. Acham o
   * grupo do sabor que o balcão, a mesa e o marketplace gravam sem ele. Sem
   * isto, só o grupo gravado no pedido decide a fração.
   */
  gruposDoItem?: (lojaId: string, item: ItemParaRelatorio) => GrupoDoCadastro[];
};

/**
 * O relatório. `pedidos` já vêm filtrados por período, tipo de venda, canal,
 * marca e horário (lib/relatorios/servidor.ts) e sem cancelados.
 */
export function itensVendidos(pedidos: PedidoParaItens[], conta: ContextoDaConta, cfg: ConfigDosItens): ResultadoDosItens {
  // Árvore principal. Com categoria: categoria → produto (→ opção).
  // Sem categoria: produto (→ opção) na raiz.
  const raiz = new Map<string, Acumulado>();
  // Tabela "Opções" (visão padrão): grupo → opção.
  const tabelaOpcoes = new Map<string, Acumulado>();
  const gruposVistos = new Map<string, { chave: string; nome: string; quantidade: number }>();
  let totalQtd = 0, totalValor = 0, linhas = 0;

  for (const pedido of pedidos) {
    const mapas = conta.mapasDe(pedido.franchiseeId);
    const canalDePreco = canalDePrecoDo(pedido.canal);
    for (const item of pedido.items) {
      const qtd = Number(item.quantity) || 0;
      if (qtd <= 0) continue;
      const categoria = categoriaDoItem(item as any, mapas) || SEM_CATEGORIA;
      const produtoId = item.menuProductId || item.menuProduct?.id || "";
      if (cfg.categorias.size && !cfg.categorias.has(categoria)) continue;
      if (cfg.produtos.size && !cfg.produtos.has(produtoId)) continue;

      const nome = nomeDoProduto(item);
      const valorDoItem = (Number(item.price) || 0) * qtd;
      linhas++;
      totalQtd += qtd;
      totalValor += valorDoItem;

      const pai: Map<string, Acumulado> | Acumulado = cfg.porCategoria ? filho(raiz, `c:${categoria}`, categoria, "categoria") : raiz;
      if (!(pai instanceof Map)) somar(pai, qtd, valorDoItem);
      const noProduto = filho(pai, chaveDoProduto(item, nome, categoria, cfg.juntarMesmoNome), nome, "produto");
      somar(noProduto, qtd, valorDoItem);

      // ── As opções do item ──
      const precoNoCadastro = produtoId ? mapas.precoNoCombo.get(produtoId) : undefined;
      const escolhas = escolhasDoItemComGrupo(item, conta.grupos, {
        canal: pedido.canal,
        gruposDoProduto: conta.gruposDoItem?.(pedido.franchiseeId, item),
        ehPizza: produtoDePizza(nome, categoria),
      });
      for (const e of escolhas) {
        // Casa com o cadastro: borda, sabor, adicional. Uma opção pode juntar
        // duas coisas ("Massa Tradicional + Borda Catupiry"); cada uma vira linha.
        const casados = complementosDaOpcao(e.nome, mapas.complementos);
        const partes = casados.length
          ? casados.map((c) => ({ id: c.id, nome: c.id ? c.nome : e.nome, categoriaDoComplemento: c.categoria }))
          : [{ id: null as string | null, nome: e.nome, categoriaDoComplemento: null as string | null }];

        for (const parte of partes) {
          // O grupo: a CATEGORIA do complemento quando a opção casa com o
          // cadastro (Bordas, Sabores de Pizza) — é a mesma em todo canal. O
          // título do grupo do site só vale quando não casou: usado primeiro,
          // ele partia a Portuguesa em duas linhas, "Sabores" (site) e
          // "Sabores de Pizza" (iFood), 0,5 em cada.
          // A opção que é produto de verdade (a esfiha do combo, a Coca) vai
          // para a categoria DELE: na NIK, 339 esfihas de combo caíam em
          // "Outras opções" em um só dia.
          const doCadastro = e.grupoId ? conta.grupos.get(e.grupoId) : undefined;
          const vendavelDaOpcao = parte.categoriaDoComplemento ? undefined : conta.vendaveisDe(pedido.franchiseeId).get(chaveDoNome(parte.nome));
          const grupoNome = parte.categoriaDoComplemento || doCadastro?.titulo || vendavelDaOpcao?.categoria || "Outras opções";
          const grupoChave = parte.categoriaDoComplemento
            ? `grupo:${chaveDoNome(parte.categoriaDoComplemento)}`
            : doCadastro ? `grupo:${chaveDoNome(doCadastro.titulo)}`
            : vendavelDaOpcao ? `grupo:${chaveDoNome(vendavelDaOpcao.categoria)}` : SEM_GRUPO;
          const g = gruposVistos.get(grupoChave) || { chave: grupoChave, nome: grupoNome, quantidade: 0 };
          g.quantidade += e.quantidade;
          gruposVistos.set(grupoChave, g);

          // O valor da opção: o que o canal mandou, senão o preço dela no grupo
          // DESTE produto no cadastro, senão desconhecido.
          let valor: number | null = null;
          if (e.precoDoCanal !== null && partes.length === 1) valor = e.precoDoCanal * e.quantidadeInteira;
          else if (parte.id && precoNoCadastro?.get(parte.id)) valor = precoDaOpcao(precoNoCadastro.get(parte.id)!, canalDePreco) * e.quantidade;

          // "Agrupar apenas produtos": a opção que é um produto vendável (a Coca
          // do combo, a esfiha do combo) soma na linha desse produto e some
          // como opção. Complemento (borda, sabor) não é produto: fica de fora.
          if (cfg.apenasProdutos) {
            if (parte.categoriaDoComplemento) continue;
            const vendavel = conta.vendaveisDe(pedido.franchiseeId).get(chaveDoNome(parte.nome));
            if (!vendavel) continue;
            if (cfg.categorias.size && !cfg.categorias.has(vendavel.categoria)) continue;
            if (cfg.produtos.size && !cfg.produtos.has(vendavel.id)) continue;
            const paiV: Map<string, Acumulado> | Acumulado = cfg.porCategoria ? filho(raiz, `c:${vendavel.categoria}`, vendavel.categoria, "categoria") : raiz;
            if (!(paiV instanceof Map)) somar(paiV, e.quantidade, 0);
            const chaveV = cfg.juntarMesmoNome
              ? `p:${vendavel.categoria}:${chaveDoNome(vendavel.nome)}`
              : `p:${vendavel.id}`;
            somar(filho(paiV, chaveV, vendavel.nome, "produto"), e.quantidade, 0);
            continue;
          }

          if (cfg.gruposOcultos.has(grupoChave)) continue;
          const chaveDaOpcao = parte.id ? `o:${parte.id}` : `o:${chaveDoNome(parte.nome)}`;
          if (cfg.opcoesPorProduto) {
            somar(filho(noProduto, chaveDaOpcao, parte.nome, "opcao"), e.quantidade, valor);
          } else {
            const noGrupo = filho(tabelaOpcoes, grupoChave, grupoNome, "grupo");
            somar(noGrupo, e.quantidade, valor);
            somar(filho(noGrupo, chaveDaOpcao, parte.nome, "opcao"), e.quantidade, valor);
          }
        }
      }
    }
  }

  return {
    itens: finalizar(raiz, cfg.percentualPor),
    opcoes: cfg.opcoesPorProduto || cfg.apenasProdutos ? null : finalizar(tabelaOpcoes, cfg.percentualPor),
    total: { quantidade: Math.round(totalQtd * 1000) / 1000, valor: c2(totalValor) },
    gruposDeOpcao: [...gruposVistos.values()]
      .map((g) => ({ ...g, quantidade: Math.round(g.quantidade * 1000) / 1000 }))
      .sort((a, b) => b.quantidade - a.quantidade),
    linhas,
  };
}
