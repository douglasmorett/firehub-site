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
import { canalDePrecoDo, categoriaDoItem, SEM_CATEGORIA, type MapasDaLoja } from "@/lib/itens-do-relatorio";
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

/** Um grupo de opção do cadastro: o título, e se é de sabor fracionado (pizza). */
export type GrupoDoCadastro = { id: string; titulo: string; fracionado: boolean };

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
  /** Quantidade antes da fração — a que multiplica o preço mandado pelo canal. */
  quantidadeInteira: number;
  /** Preço unitário que o canal mandou (iFood, Wabiz, 99). */
  precoDoCanal: number | null;
  /** Grupo do cadastro (formato do site), quando o pedido o guarda. */
  grupoId: string | null;
};

const FRACAO_RE = /^\s*(\d+)\s*\/\s*(\d+)\s+/;

/**
 * As escolhas do item, com o grupo quando o pedido o guarda e com a FRAÇÃO do
 * sabor. Três formatos, os mesmos de lib/parse-combo.ts:
 *
 * - site: { grupoId: { nome: qtd } } — o grupo vem; se o grupo é de sabor
 *   fracionado (pizza, com `priceRule`), cada sabor vale qtd ÷ total do grupo;
 * - iFood/99/Wabiz: [{ name, quantity, price }] — a meia vem no nome
 *   ("1/2 Portuguesa") e o preço é o daquela metade;
 * - balcão: [{ name, quantity }] ou texto — sem grupo e sem preço.
 */
export function escolhasDoItemComGrupo(
  item: { quantity: number; comboSelections?: unknown },
  grupos: Map<string, GrupoDoCadastro>,
): EscolhaLida[] {
  const qtdItem = Number(item.quantity) || 1;
  let bruto: any = item.comboSelections;
  if (!bruto) return [];
  if (typeof bruto === "string") {
    try { bruto = JSON.parse(bruto); } catch {
      bruto = bruto.split(/[\n|;]/).map((s: string) => s.trim()).filter(Boolean);
    }
  }
  const saida: EscolhaLida[] = [];
  const empurrar = (nomeBruto: string, qtd: number, preco: number | null, grupoId: string | null, fracaoDoGrupo = 1) => {
    const m = FRACAO_RE.exec(nomeBruto);
    const fracaoDoNome = m && Number(m[2]) > 0 ? Number(m[1]) / Number(m[2]) : 1;
    const nome = nomeBruto.replace(FRACAO_RE, "").trim();
    if (!nome) return;
    const inteira = qtd * qtdItem;
    saida.push({
      nome,
      quantidade: inteira * fracaoDoNome * fracaoDoGrupo,
      quantidadeInteira: inteira,
      precoDoCanal: preco !== null && Number.isFinite(preco) && preco >= 0 ? preco : null,
      grupoId,
    });
  };

  if (bruto && !Array.isArray(bruto) && typeof bruto === "object") {
    for (const [grupoId, escolhas] of Object.entries(bruto as Record<string, any>)) {
      if (!escolhas || typeof escolhas !== "object" || Array.isArray(escolhas)) continue;
      const pares = Object.entries(escolhas as Record<string, any>)
        .map(([nome, q]) => [nome, Number(q)] as const)
        .filter(([nome, q]) => nome && Number.isFinite(q) && q > 0);
      const doGrupo = grupos.get(grupoId);
      const totalDoGrupo = pares.reduce((s, [, q]) => s + q, 0);
      for (const [nome, q] of pares) {
        const fracao = doGrupo?.fracionado && totalDoGrupo > 0 ? 1 / totalDoGrupo : 1;
        // No sabor fracionado a fração já está no "1 ÷ total": a quantidade do
        // sabor é q × (1 ÷ total) — dois sabores de 1 = 0,5 cada.
        empurrar(nome, q, null, grupoId, fracao);
      }
    }
    return saida;
  }
  if (!Array.isArray(bruto)) return [];
  for (const e of bruto) {
    if (typeof e === "string") {
      const m = e.match(/^(\d+)x?\s+(.+)$/i);
      if (m) empurrar(m[2].trim(), Number(m[1]), null, null);
      else if (e.trim()) empurrar(e.trim(), 1, null, null);
    } else if (e && typeof e === "object") {
      const nome = String(e.name || e.productName || e.label || e.description || "").trim();
      if (!nome) continue;
      const preco = e.price != null && e.price !== "" ? Number(e.price) : null;
      empurrar(nome, Number(e.quantity || e.qty || 1), preco, e.groupId ? String(e.groupId) : null);
    }
  }
  return saida;
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
      for (const e of escolhasDoItemComGrupo(item, conta.grupos)) {
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
