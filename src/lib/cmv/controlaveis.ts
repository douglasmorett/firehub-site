/**
 * RELATÓRIO DOS CONTROLÁVEIS — onde a mercadoria foi parar além da venda.
 *
 * Pedido do Douglas (12/11/2026), no modelo do "Relatório detalhado do cálculo
 * do real" das redes de fast-food: cada seção em R$ e em % da venda líquida.
 *
 *   1. Desperdício completo    produto pronto do cardápio jogado fora (pela ficha)
 *                              + pedidos cancelados depois de produzidos
 *   2. Desperdício incompleto  insumo / embalagem jogado fora
 *   3. Segurança alimentar     descarte por validade, temperatura, contaminação
 *                              (pelo motivo) e baixa de lote vencido
 *   4. Condimentos             insumo de uso livre (sem ficha): sachê, sal, óleo
 *                              — consumo da contagem × custo
 *   5. Refeição da equipe      pedidos da equipe (source EQUIPE), pela ficha
 *   6. Diferença de inventário por insumo de ficha em "un": o que a contagem diz
 *                              que saiu × o que deveria ter saído (Alimentos e
 *                              Embalagens à parte)
 *   7. Rendimento              a mesma diferença para o que é a granel (kg, l)
 *   8. Indiretos               descartáveis de uso livre (guardanapo, sacola)
 *
 * ── A diferença (6 e 7) ─────────────────────────────────────────────────────
 *
 *   consumo real      = abertura + entradas − fechamento   (contagens COMPLETAS)
 *   consumo explicado = vendas pela ficha + refeição da equipe + perdas
 *                       lançadas + saídas à mão
 *   diferença         = explicado − real
 *
 * Negativo = sumiu (saiu mais do que a ficha e as perdas explicam), positivo =
 * sobrou. O AJUSTE da contagem não é consumo: é o acerto que a própria contagem
 * faz no saldo, e contá-lo zeraria a diferença. A baixa da refeição da equipe é
 * uma SALE como a da venda: aqui ela é separada pelo pedido e entra UMA vez,
 * como "equipe".
 *
 * Preparo (massa, recheio) não tem compra: a diferença dele desce para os
 * insumos que o compõem (`explodirPreparo`), e é lá que aparece.
 *
 * Puro: quem busca é lib/cmv/controlaveis-no-banco.ts. Testado em
 * scripts/teste-controlaveis.ts.
 */
import { explodirPreparo, ehPreparo, type InsumoParaCusto } from "@/lib/cmv/custo-do-insumo";

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export const semAcento = (s: unknown) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** % sobre a venda, com 2 casas (as perdas são frações pequenas). Nulo sem venda. */
export function pctDaVenda(valor: number, venda: number): number | null {
  return venda > 0 ? Math.round((valor / venda) * 10000) / 100 : null;
}

// ── Unidades ────────────────────────────────────────────────────────────────

const UNIDADES: Record<string, { familia: "un" | "g" | "ml"; fator: number }> = {
  un: { familia: "un", fator: 1 }, und: { familia: "un", fator: 1 }, unid: { familia: "un", fator: 1 }, unidade: { familia: "un", fator: 1 },
  unidades: { familia: "un", fator: 1 }, pc: { familia: "un", fator: 1 }, pct: { familia: "un", fator: 1 }, cx: { familia: "un", fator: 1 },
  g: { familia: "g", fator: 1 }, gr: { familia: "g", fator: 1 }, grama: { familia: "g", fator: 1 }, gramas: { familia: "g", fator: 1 },
  mg: { familia: "g", fator: 0.001 },
  kg: { familia: "g", fator: 1000 }, kilo: { familia: "g", fator: 1000 }, quilo: { familia: "g", fator: 1000 }, kgs: { familia: "g", fator: 1000 },
  ml: { familia: "ml", fator: 1 }, l: { familia: "ml", fator: 1000 }, lt: { familia: "ml", fator: 1000 }, litro: { familia: "ml", fator: 1000 },
  litros: { familia: "ml", fator: 1000 },
};

function lerUnidade(u: string | null | undefined) {
  return UNIDADES[semAcento(u).replace(/\.$/, "")] ?? null;
}

/** Converte entre unidades da mesma família (g↔kg, ml↔l). Nulo se não dá (un → kg). */
export function converter(q: number, de: string | null | undefined, para: string | null | undefined): number | null {
  if (semAcento(de) === semAcento(para)) return q;
  const a = lerUnidade(de), b = lerUnidade(para);
  if (!a || !b || a.familia !== b.familia) return null;
  return (q * a.fator) / b.fator;
}

/** A granel (peso ou volume): vai para o Rendimento. */
export function ehGranel(u: string | null | undefined): boolean {
  const x = lerUnidade(u);
  return Boolean(x && x.familia !== "un");
}

/** A unidade para mostrar o granel: g → kg, ml → l (o rendimento se lê em kg). */
export function unidadeDeExibicao(u: string): string {
  const x = lerUnidade(u);
  if (!x || x.familia === "un") return u;
  return x.familia === "g" ? "kg" : "l";
}

// ── Classe do insumo ────────────────────────────────────────────────────────

export type Classe = "ALIMENTO" | "EMBALAGEM" | "CONDIMENTO" | "INDIRETO";
export const CLASSES: Classe[] = ["ALIMENTO", "EMBALAGEM", "CONDIMENTO", "INDIRETO"];
export const ROTULO_DA_CLASSE: Record<Classe, string> = {
  ALIMENTO: "Alimento", EMBALAGEM: "Embalagem", CONDIMENTO: "Condimento", INDIRETO: "Indireto",
};
export const ehClasse = (c: unknown): c is Classe => CLASSES.includes(c as Classe);

const DESCARTAVEL = /guardanapo|\bsac(o|os|ola|olas|hinho)\b|canudo|\bcopo|tampa|embalage|\bcaixa|papel|\bpote|talher|garfo|\bfaca|colher|\bluva|touca|filme|bandeja|marmit|isopor|etiqueta|palito|porta[- ]?copo|lacre|\bmexedor/;
const CONDIMENTO = /sache|ketchup|catchup|mostarda|maionese|\bsal\b|acucar|adocante|\boleo\b|gordura|azeite|vinagre|molho|tempero|oregano|pimenta/;

/**
 * O palpite pelo nome, quando a loja ainda não escolheu. Descartável na ficha
 * (a caixa da pizza) é Embalagem; fora da ficha (guardanapo), Indireto. Sachê,
 * sal, óleo fora da ficha é Condimento; na ficha, é alimento como outro qualquer.
 */
export function palpiteDaClasse(nome: string, emFicha: boolean): Classe {
  const n = semAcento(nome);
  if (DESCARTAVEL.test(n)) return emFicha ? "EMBALAGEM" : "INDIRETO";
  if (!emFicha && CONDIMENTO.test(n)) return "CONDIMENTO";
  return "ALIMENTO";
}

// ── Segurança alimentar ─────────────────────────────────────────────────────

const SEGURANCA = /vencid|validade|venceu|vencimento|estrag|seguranca|temperatura|contamin/;

/** O descarte foi por segurança alimentar (validade, temperatura, contaminação)? */
export function ehSegurancaAlimentar(motivo: string | null | undefined, loteVencido = false): boolean {
  return loteVencido || SEGURANCA.test(semAcento(motivo));
}

// ── O relatório ─────────────────────────────────────────────────────────────

export type IdDaSecao = "completo" | "incompleto" | "seguranca" | "condimentos" | "break" | "inventario" | "rendimento" | "indiretos";

export const TITULO_DA_SECAO: Record<IdDaSecao, string> = {
  completo: "Desperdício completo",
  incompleto: "Desperdício incompleto",
  seguranca: "Segurança alimentar",
  condimentos: "Condimentos",
  break: "Refeição da equipe",
  inventario: "Diferença de inventário",
  rendimento: "Rendimento",
  indiretos: "Indiretos",
};

export const DESCRICAO_DA_SECAO: Record<IdDaSecao, string> = {
  completo: "Produto pronto do cardápio que foi para o lixo (ex.: pizza que queimou, lanche que caiu no chão), pelo custo da ficha técnica, mais os pedidos cancelados depois de já estarem prontos.",
  incompleto: "Insumo ou embalagem jogado fora antes de virar produto (ex.: pão que endureceu, alface que murchou, copo que rasgou).",
  seguranca: "O que foi para o lixo por segurança do cliente: passou da validade, ficou fora da temperatura ou contaminou (pelo motivo lançado na perda), e lote vencido baixado do estoque.",
  condimentos: "Temperos e itens de uso livre, que não estão na ficha técnica (ex.: sal, orégano, sachê de ketchup). A conta: quanto foi usado entre as duas contagens × o custo, menos o que já foi lançado como perda.",
  break: "O que a equipe comeu (pedidos marcados como de funcionário), pelo custo da ficha técnica no dia.",
  inventario: "É o que sumiu (ou sobrou) do estoque. Comparamos o que SAIU de verdade (contagem do início + compras − contagem do fim) com o que DEVERIA ter saído (vendas pela ficha técnica + refeição da equipe + perdas lançadas + saídas lançadas à mão). Saiu mais do que deveria = valor negativo = sumiu (furo, porção maior que a ficha, desvio ou perda não lançada). Valor positivo = sobrou. Vale para os itens contados em unidade: pão, queijo fatiado, embalagem.",
  rendimento: "A mesma conta para o que é a granel (kg, litro): carne, queijo, molho, óleo. Negativo = rendeu menos do que a ficha técnica manda (sumiu); positivo = rendeu mais (sobrou).",
  indiretos: "Descartáveis de uso livre, que não estão na ficha técnica (ex.: guardanapo, sacola, canudo). A conta: quanto foi usado entre as duas contagens × o custo, menos o que já foi lançado como perda.",
};

/** "Como ler este relatório": a caixa do topo da aba, o PDF e a aba Resumo do Excel. */
export const COMO_LER_O_RELATORIO: string[] = [
  "Mostra para onde foi a mercadoria ALÉM do que foi vendido, em R$ e em % da venda do período.",
  "Cada grupo é dinheiro que saiu do estoque sem virar venda (desperdício, validade, equipe, o que sumiu...).",
  "As setas ▲ ▼ comparam com o período anterior, do mesmo tamanho. Vermelho = piorou; verde = melhorou.",
  "Diferença de inventário, Rendimento, Condimentos e Indiretos precisam das DUAS contagens completas do estoque: uma no início e outra no fim do período. Sem elas, ficam em branco (“falta contagem”).",
  "Nas diferenças: negativo (vermelho) = sumiu do estoque; positivo (verde) = sobrou.",
];

/** Explica o "Onde está o dinheiro" (tela, PDF e Excel). */
export const DESCRICAO_DO_ONDE_ESTA_O_DINHEIRO =
  "Os itens que mais custaram dinheiro no período, somando todos os grupos (desperdício, validade, equipe, o que sumiu no inventário, pedidos cancelados já prontos...). Comece pelo primeiro da lista: é por onde mais está escorrendo.";

/** Rótulo curto da diferença de inventário/rendimento: negativo = sumiu, positivo = sobrou. */
export const sumiuOuSobrou = (v: number) => (v < 0 ? "sumiu" : v > 0 ? "sobrou" : "");

/** As seções que dependem da contagem (abertura e fechamento). */
export const SECOES_DA_CONTAGEM: IdDaSecao[] = ["condimentos", "inventario", "rendimento", "indiretos"];
export const ORDEM_DAS_SECOES: IdDaSecao[] = ["completo", "incompleto", "seguranca", "condimentos", "break", "inventario", "rendimento", "indiretos"];

export type Lancamento = {
  quando: string;
  quem: string | null;
  motivo: string | null;
  /** "Estoque", "FireCheck", "Perda" (Movimentar / QR), "Pedido cancelado", "Equipe". */
  origem: string;
  quantidade: number | null;
  unidade: string | null;
  valor: number | null;
  estimado?: boolean;
};

/** O detalhe da diferença de um insumo (6, 7) ou do consumo de uso livre (4, 8). */
export type ContaDoInsumo = {
  abertura: number;
  entradas: number;
  fechamento: number;
  /** abertura + entradas − fechamento */
  real: number;
  vendas: number;
  equipe: number;
  perdas: number;
  saidas: number;
  /** vendas + equipe + perdas + saídas */
  explicado: number;
};

export type LinhaDoRelatorio = {
  chave: string;
  nome: string;
  unidade: string;
  /** Na diferença, com sinal (negativo = sumiu). */
  quantidade: number;
  custoUnitario: number | null;
  /** R$. Na diferença, com sinal. */
  total: number;
  /** Sem custo: entra com R$ 0 e a tela avisa. */
  semCusto?: boolean;
  tipo?: "PRODUTO" | "INSUMO";
  insumoId?: string;
  classe?: Classe;
  /** A classe veio do palpite pelo nome (a loja ainda não escolheu). */
  classePalpite?: boolean;
  grupo?: "ALIMENTOS" | "EMBALAGENS";
  conta?: ContaDoInsumo;
  lancamentos?: Lancamento[];
};

export type Secao = {
  id: IdDaSecao;
  titulo: string;
  descricao: string;
  linhas: LinhaDoRelatorio[];
  /** R$. Nas diferenças, com sinal (negativo = perda). */
  total: number;
  pct: number | null;
  /** Lançamentos/linhas sem valor (fora do total). */
  semValor: number;
  /** Seção que precisa de contagem e não tem: o que falta. */
  falta: string | null;
  /** Os pedidos cancelados depois de produzidos (só no Desperdício completo). */
  cancelados?: { numero: string; quando: string; etapa: string; motivo: string | null; valor: number | null }[];
  /** Diferença de inventário: os dois grupos. */
  grupos?: { alimentos: number; embalagens: number };
};

// ── 1, 2 e 3: os desperdícios lançados ──────────────────────────────────────

export type DescarteLancado = {
  quando: string; item: string; tipo: "PRODUTO" | "INSUMO"; quantidade: number | null; unidade: string | null;
  motivo: string | null; quem: string | null; origem: string; valor: number | null; estimado: boolean; loteVencido?: boolean;
};
export type CanceladoProduzido = { numero: string; quando: string; etapaTexto: string; motivo: string | null; valor: number | null };

function agrupar(lancados: DescarteLancado[], unidadeDoInsumo: Map<string, string>): LinhaDoRelatorio[] {
  const porItem = new Map<string, LinhaDoRelatorio & { qtdComValor: number }>();
  for (const l of lancados) {
    const chave = `${l.tipo}:${semAcento(l.item)}`;
    const unidadeAlvo = l.tipo === "INSUMO" ? unidadeDoInsumo.get(semAcento(l.item)) ?? l.unidade ?? "un" : "un";
    const q = l.quantidade == null ? 0 : converter(l.quantidade, l.unidade || unidadeAlvo, unidadeAlvo) ?? l.quantidade;
    let linha = porItem.get(chave);
    if (!linha) {
      linha = { chave, nome: l.item, unidade: unidadeAlvo, quantidade: 0, custoUnitario: null, total: 0, tipo: l.tipo, lancamentos: [], qtdComValor: 0 };
      porItem.set(chave, linha);
    }
    linha.quantidade += q;
    if (l.valor != null) { linha.total += l.valor; linha.qtdComValor += q; } else linha.semCusto = true;
    linha.lancamentos!.push({ quando: l.quando, quem: l.quem, motivo: l.motivo, origem: l.origem, quantidade: l.quantidade, unidade: l.unidade, valor: l.valor, estimado: l.estimado });
  }
  return [...porItem.values()].map(({ qtdComValor, ...l }) => ({
    ...l,
    quantidade: r3(l.quantidade),
    total: r2(l.total),
    custoUnitario: qtdComValor > 0 ? r2(l.total / qtdComValor) : null,
  })).sort((a, b) => b.total - a.total);
}

function secao(id: IdDaSecao, linhas: LinhaDoRelatorio[], total: number, venda: number, extra: Partial<Secao> = {}): Secao {
  return {
    id, titulo: TITULO_DA_SECAO[id], descricao: DESCRICAO_DA_SECAO[id], linhas,
    total: r2(total), pct: pctDaVenda(total, venda), semValor: 0, falta: null, ...extra,
  };
}

/** Seções 1, 2 e 3 a partir dos desperdícios do período (lib/cmv/desperdicio.ts). */
export function secoesDosDescartes(e: {
  lancados: DescarteLancado[];
  cancelados: CanceladoProduzido[];
  /** nome do insumo (sem acento) → unidade dele, para somar g com kg. */
  unidadeDoInsumo: Map<string, string>;
  venda: number;
}): { completo: Secao; incompleto: Secao; seguranca: Secao } {
  const seguranca = e.lancados.filter((l) => ehSegurancaAlimentar(l.motivo, l.loteVencido));
  const resto = e.lancados.filter((l) => !ehSegurancaAlimentar(l.motivo, l.loteVencido));
  const produtos = resto.filter((l) => l.tipo === "PRODUTO");
  const insumos = resto.filter((l) => l.tipo === "INSUMO");
  const semValor = (l: { valor: number | null }[]) => l.filter((x) => x.valor == null).length;
  const soma = (l: LinhaDoRelatorio[]) => l.reduce((s, x) => s + x.total, 0);

  const linhasProdutos = agrupar(produtos, e.unidadeDoInsumo);
  const totalCancelados = e.cancelados.reduce((s, c) => s + (c.valor || 0), 0);
  const linhasInsumos = agrupar(insumos, e.unidadeDoInsumo);
  const linhasSeguranca = agrupar(seguranca, e.unidadeDoInsumo);
  return {
    completo: secao("completo", linhasProdutos, soma(linhasProdutos) + totalCancelados, e.venda, {
      semValor: semValor(produtos) + semValor(e.cancelados),
      cancelados: e.cancelados.map((c) => ({ numero: c.numero, quando: c.quando, etapa: c.etapaTexto, motivo: c.motivo, valor: c.valor })),
    }),
    incompleto: secao("incompleto", linhasInsumos, soma(linhasInsumos), e.venda, { semValor: semValor(insumos) }),
    seguranca: secao("seguranca", linhasSeguranca, soma(linhasSeguranca), e.venda, { semValor: semValor(seguranca) }),
  };
}

// ── 5: refeição da equipe ───────────────────────────────────────────────────

export type ItemDaEquipe = { nome: string; quantidade: number; custo: number | null; quando: string; quem: string | null };

export function secaoDaEquipe(itens: ItemDaEquipe[], venda: number): Secao {
  const porNome = new Map<string, LinhaDoRelatorio & { qtdComValor: number }>();
  let semValor = 0;
  for (const i of itens) {
    const chave = semAcento(i.nome);
    let l = porNome.get(chave);
    if (!l) { l = { chave, nome: i.nome, unidade: "un", quantidade: 0, custoUnitario: null, total: 0, tipo: "PRODUTO", lancamentos: [], qtdComValor: 0 }; porNome.set(chave, l); }
    l.quantidade += i.quantidade;
    if (i.custo != null) { l.total += i.custo; l.qtdComValor += i.quantidade; } else { l.semCusto = true; semValor++; }
    l.lancamentos!.push({ quando: i.quando, quem: i.quem, motivo: null, origem: "Equipe", quantidade: i.quantidade, unidade: "un", valor: i.custo == null ? null : r2(i.custo) });
  }
  const linhas = [...porNome.values()].map(({ qtdComValor, ...l }) => ({
    ...l, quantidade: r3(l.quantidade), total: r2(l.total), custoUnitario: qtdComValor > 0 ? r2(l.total / qtdComValor) : null,
  })).sort((a, b) => b.total - a.total);
  return secao("break", linhas, linhas.reduce((s, l) => s + l.total, 0), venda, { semValor });
}

// ── 4, 6, 7, 8: o que depende da contagem ───────────────────────────────────

/** O movimento de estoque entre as duas contagens. */
export type Movimento = { stockItemId: string; tipo: string; quantidade: number; notes?: string | null; sourceRef?: string | null };

export type ParteDoMovimento = "entrada" | "vendas" | "equipe" | "perdas" | "saidas" | null;

/** O pedido de uma baixa de venda (`sale:<pedido>:<insumo>`) ou da devolução (`cancel id: <pedido>`). */
export function pedidoDoMovimento(m: { sourceRef?: string | null; notes?: string | null }): string | null {
  const ref = /^sale:([^:]+):/.exec(m.sourceRef || "");
  if (ref) return ref[1];
  const nota = /(?:cancel id|\(id): ?([A-Za-z0-9_-]+)/.exec(m.notes || "");
  return nota ? nota[1] : null;
}

/**
 * Onde o movimento entra na conta. O AJUSTE da contagem fica de fora (é o
 * acerto, não consumo). A devolução da venda cancelada (INPUT "cancel id:")
 * desfaz a venda: entra como venda negativa, não como compra.
 */
export function parteDoMovimento(m: Movimento, pedidosDaEquipe: Set<string>): ParteDoMovimento {
  const tipo = String(m.tipo || "").toUpperCase();
  if (tipo === "AJUSTE") return null;
  const devolucao = tipo === "INPUT" && String(m.notes || "").includes("cancel id:");
  if (tipo === "SALE" || devolucao) {
    const pedido = pedidoDoMovimento(m);
    return pedido && pedidosDaEquipe.has(pedido) ? "equipe" : "vendas";
  }
  if (tipo === "INPUT" || tipo === "ESTORNO") return "entrada";
  if (tipo === "WASTE") return "perdas";
  if (tipo === "OUTPUT") return "saidas";
  return m.quantidade >= 0 ? "entrada" : "saidas";
}

export type InsumoDoRelatorio = InsumoParaCusto & {
  /** Custo no dia do fechamento; nulo = sem custo. */
  custo: number | null;
  entraNoCmv: boolean;
  /** Está em alguma ficha técnica ou é componente de preparo. */
  emFicha: boolean;
  /** A classe que a loja escolheu (nula = palpite). */
  classeGravada: Classe | null;
};

/** O que a contagem diz do item: quantidade, unidade congelada e se foi CONTADO. */
export type ItemContado = { quantidade: number; unidade: string; contado: boolean };

export type ResultadoDaContagem = {
  condimentos: Secao;
  inventario: Secao;
  rendimento: Secao;
  indiretos: Secao;
  /** Insumos que ficaram de fora porque não foram contados nas duas contagens. */
  naoContados: string[];
  /** Insumos que pesaram na conta sem custo. */
  semCusto: string[];
  /** Alimentos sem ficha que caíram em Condimentos. */
  alimentosSemFicha: string[];
};

export function classeDoInsumo(i: Pick<InsumoDoRelatorio, "nome" | "emFicha" | "classeGravada">): { classe: Classe; palpite: boolean } {
  return i.classeGravada ? { classe: i.classeGravada, palpite: false } : { classe: palpiteDaClasse(i.nome, i.emFicha), palpite: true };
}

const contaZerada = (): ContaDoInsumo => ({ abertura: 0, entradas: 0, fechamento: 0, real: 0, vendas: 0, equipe: 0, perdas: 0, saidas: 0, explicado: 0 });

function somarConta(alvo: ContaDoInsumo, c: ContaDoInsumo, fator: number) {
  for (const k of Object.keys(alvo) as (keyof ContaDoInsumo)[]) alvo[k] += c[k] * fator;
}

export function secoesDaContagem(e: {
  insumos: InsumoDoRelatorio[];
  abertura: Map<string, ItemContado>;
  fechamento: Map<string, ItemContado>;
  movimentos: Movimento[];
  pedidosDaEquipe: Set<string>;
  /** Venda dos dias da janela (para a %). */
  venda: number;
  /** Sem as duas contagens: o que falta (as quatro seções ficam vazias com esse texto). */
  falta: string | null;
}): ResultadoDaContagem {
  const vazia = (id: IdDaSecao) => secao(id, [], 0, e.venda, { falta: e.falta });
  if (e.falta) {
    return { condimentos: vazia("condimentos"), inventario: vazia("inventario"), rendimento: vazia("rendimento"), indiretos: vazia("indiretos"), naoContados: [], semCusto: [], alimentosSemFicha: [] };
  }
  const porId = new Map(e.insumos.map((i) => [i.id, i]));

  // A conta de cada insumo, na unidade dele.
  const contas = new Map<string, ContaDoInsumo>();
  const contaDe = (id: string) => { let c = contas.get(id); if (!c) { c = contaZerada(); contas.set(id, c); } return c; };
  for (const m of e.movimentos) {
    if (!porId.has(m.stockItemId)) continue;
    const parte = parteDoMovimento(m, e.pedidosDaEquipe);
    if (!parte) continue;
    const c = contaDe(m.stockItemId);
    if (parte === "entrada") c.entradas += m.quantidade;
    else c[parte] += -m.quantidade;
  }

  const naoContados: string[] = [];
  const contados = new Set<string>();
  for (const i of e.insumos) {
    const a = e.abertura.get(i.id), f = e.fechamento.get(i.id);
    if (!a?.contado || !f?.contado) {
      // Nunca teve nada e não mexeu: não é falta de contagem que importe.
      const mexeu = contas.has(i.id) || (a && a.quantidade > 0) || (f && f.quantidade > 0);
      if (mexeu && i.entraNoCmv) naoContados.push(i.nome);
      continue;
    }
    const qa = converter(a.quantidade, a.unidade, i.unidade);
    const qf = converter(f.quantidade, f.unidade, i.unidade);
    if (qa == null || qf == null) { naoContados.push(i.nome); continue; }
    const c = contaDe(i.id);
    c.abertura = qa;
    c.fechamento = qf;
    c.real = qa + c.entradas - qf;
    c.explicado = c.vendas + c.equipe + c.perdas + c.saidas;
    contados.add(i.id);
  }

  const semCusto = new Set<string>();
  const alimentosSemFicha: string[] = [];
  const condimentos: LinhaDoRelatorio[] = [];
  const indiretos: LinhaDoRelatorio[] = [];

  // Preparo usado em ficha desce para os componentes; a diferença do insumo
  // comprado soma a dele com a parte que veio dos preparos.
  const base = new Map<string, ContaDoInsumo>();
  for (const id of contados) {
    const i = porId.get(id)!;
    if (!i.entraNoCmv) continue;
    const c = contas.get(id)!;
    const usoLivre = !i.emFicha && !ehPreparo(i);
    if (usoLivre) {
      const { classe, palpite } = classeDoInsumo(i);
      // Consumo menos o que já entrou como perda nas seções 2 e 3.
      const consumo = c.real - c.perdas;
      if (Math.abs(consumo) < 1e-9 && c.real === 0) continue;
      if (i.custo == null && Math.abs(consumo) > 1e-9) semCusto.add(i.nome);
      const linha: LinhaDoRelatorio = {
        chave: id, insumoId: id, nome: i.nome, unidade: i.unidade, quantidade: r3(consumo), custoUnitario: i.custo,
        total: i.custo != null ? r2(consumo * i.custo) : 0, semCusto: i.custo == null, classe, classePalpite: palpite, tipo: "INSUMO",
        conta: arredondarConta(c),
      };
      if (classe === "INDIRETO" || classe === "EMBALAGEM") indiretos.push(linha);
      else {
        if (classe === "ALIMENTO") alimentosSemFicha.push(i.nome);
        condimentos.push(linha);
      }
      continue;
    }
    const partes = ehPreparo(i) ? explodirPreparo(e.insumos, id, 1) : new Map([[id, 1]]);
    for (const [baseId, fator] of partes) {
      if (baseId !== id && !contados.has(baseId)) { if (!naoContados.includes(porId.get(baseId)?.nome || "")) naoContados.push(porId.get(baseId)?.nome || baseId); continue; }
      let alvo = base.get(baseId);
      if (!alvo) { alvo = contaZerada(); base.set(baseId, alvo); }
      somarConta(alvo, c, fator);
    }
  }

  const inventario: LinhaDoRelatorio[] = [];
  const rendimento: LinhaDoRelatorio[] = [];
  for (const [id, c] of base) {
    const i = porId.get(id);
    if (!i) continue;
    const dif = c.explicado - c.real;
    if (Math.abs(dif) < 1e-6 && Math.abs(c.real) < 1e-6) continue;
    const { classe, palpite } = classeDoInsumo(i);
    if (i.custo == null && Math.abs(dif) > 1e-6) semCusto.add(i.nome);
    const embalagem = classe === "EMBALAGEM" || classe === "INDIRETO";
    const granel = !embalagem && ehGranel(i.unidade);
    // O granel se lê em kg / l.
    const unidade = granel ? unidadeDeExibicao(i.unidade) : i.unidade;
    const fator = granel ? converter(1, i.unidade, unidade) ?? 1 : 1;
    const custo = i.custo == null ? null : i.custo / fator;
    const conta = arredondarConta(c, fator);
    const linha: LinhaDoRelatorio = {
      chave: id, insumoId: id, nome: i.nome, unidade, quantidade: r3(dif * fator), custoUnitario: custo == null ? null : r2(custo),
      total: i.custo != null ? r2(dif * i.custo) : 0, semCusto: i.custo == null, classe, classePalpite: palpite, tipo: "INSUMO",
      grupo: embalagem ? "EMBALAGENS" : "ALIMENTOS", conta,
    };
    (granel ? rendimento : inventario).push(linha);
  }

  const porPerda = (a: LinhaDoRelatorio, b: LinhaDoRelatorio) => a.total - b.total;
  const porCusto = (a: LinhaDoRelatorio, b: LinhaDoRelatorio) => b.total - a.total;
  const soma = (l: LinhaDoRelatorio[]) => l.reduce((s, x) => s + x.total, 0);
  const alimentos = soma(inventario.filter((l) => l.grupo === "ALIMENTOS"));
  const embalagens = soma(inventario.filter((l) => l.grupo === "EMBALAGENS"));
  return {
    condimentos: secao("condimentos", condimentos.sort(porCusto), soma(condimentos), e.venda, { semValor: condimentos.filter((l) => l.semCusto).length }),
    inventario: secao("inventario", inventario.sort(porPerda), alimentos + embalagens, e.venda, {
      semValor: inventario.filter((l) => l.semCusto).length, grupos: { alimentos: r2(alimentos), embalagens: r2(embalagens) },
    }),
    rendimento: secao("rendimento", rendimento.sort(porPerda), soma(rendimento), e.venda, { semValor: rendimento.filter((l) => l.semCusto).length }),
    indiretos: secao("indiretos", indiretos.sort(porCusto), soma(indiretos), e.venda, { semValor: indiretos.filter((l) => l.semCusto).length }),
    naoContados: [...new Set(naoContados)].sort(),
    semCusto: [...semCusto].sort(),
    alimentosSemFicha: alimentosSemFicha.sort(),
  };
}

function arredondarConta(c: ContaDoInsumo, fator = 1): ContaDoInsumo {
  const s = contaZerada();
  for (const k of Object.keys(s) as (keyof ContaDoInsumo)[]) s[k] = r3(c[k] * fator);
  return s;
}

// ── Resumo, comparação e onde está o dinheiro ───────────────────────────────

export type Resumo = {
  venda: number;
  /** R$ de cada seção (diferenças com sinal). */
  porSecao: Record<IdDaSecao, number>;
  /** Diferença de alimentos = inventário (alimentos) + rendimento. */
  diferencaAlimentos: number;
  diferencaEmbalagens: number;
  diferencaTotal: number;
  /**
   * O custo dos controláveis: as perdas (1 a 5 e 8) mais o que sumiu no
   * inventário. Diferença positiva (sobrou) abate.
   */
  totalControlaveis: number;
  pct: { diferencaAlimentos: number | null; diferencaEmbalagens: number | null; diferencaTotal: number | null; totalControlaveis: number | null; porSecao: Record<IdDaSecao, number | null> };
};

export function resumir(secoes: Record<IdDaSecao, Secao>, venda: number): Resumo {
  const porSecao = Object.fromEntries(ORDEM_DAS_SECOES.map((id) => [id, r2(secoes[id].total)])) as Record<IdDaSecao, number>;
  const diferencaAlimentos = r2((secoes.inventario.grupos?.alimentos ?? 0) + secoes.rendimento.total);
  const diferencaEmbalagens = r2(secoes.inventario.grupos?.embalagens ?? 0);
  const diferencaTotal = r2(diferencaAlimentos + diferencaEmbalagens);
  const perdas = porSecao.completo + porSecao.incompleto + porSecao.seguranca + porSecao.condimentos + porSecao.break + porSecao.indiretos;
  const totalControlaveis = r2(perdas - diferencaTotal);
  return {
    venda: r2(venda), porSecao, diferencaAlimentos, diferencaEmbalagens, diferencaTotal, totalControlaveis,
    pct: {
      diferencaAlimentos: pctDaVenda(diferencaAlimentos, venda),
      diferencaEmbalagens: pctDaVenda(diferencaEmbalagens, venda),
      diferencaTotal: pctDaVenda(diferencaTotal, venda),
      totalControlaveis: pctDaVenda(totalControlaveis, venda),
      porSecao: Object.fromEntries(ORDEM_DAS_SECOES.map((id) => [id, secoes[id].pct])) as Record<IdDaSecao, number | null>,
    },
  };
}

export type Comparacao = {
  /** Pontos percentuais de diferença na % da venda (atual − anterior). Nulo sem venda num dos dois. */
  pontos: number | null;
  /** R$ atual − anterior. */
  valor: number;
  /** "pior" = custou mais (para diferenças: sumiu mais). */
  sentido: "pior" | "melhor" | "igual";
};

/**
 * Atual × período anterior de mesmo tamanho. Nas seções de custo, subir é
 * pior; nas diferenças (com sinal), cair (sumir mais) é pior.
 */
export function comparar(atual: Resumo, anterior: Resumo): Record<IdDaSecao | "totalControlaveis", Comparacao> {
  const um = (a: number, b: number, pa: number | null, pb: number | null, custo: boolean): Comparacao => {
    const valor = r2(a - b);
    const pontos = pa != null && pb != null ? Math.round((pa - pb) * 100) / 100 : null;
    const delta = pontos ?? valor;
    const sentido = Math.abs(delta) < 0.005 ? "igual" : (custo ? delta > 0 : delta < 0) ? "pior" : "melhor";
    return { pontos, valor, sentido };
  };
  const saida = {} as Record<IdDaSecao | "totalControlaveis", Comparacao>;
  for (const id of ORDEM_DAS_SECOES) {
    const custo = id !== "inventario" && id !== "rendimento";
    saida[id] = um(atual.porSecao[id], anterior.porSecao[id], atual.pct.porSecao[id], anterior.pct.porSecao[id], custo);
  }
  saida.totalControlaveis = um(atual.totalControlaveis, anterior.totalControlaveis, atual.pct.totalControlaveis, anterior.pct.totalControlaveis, true);
  return saida;
}

export type ItemCaro = { nome: string; secao: IdDaSecao; valor: number; quantidade: number; unidade: string };

/** Os itens que mais custaram, somando as seções. Na diferença, só o que sumiu. */
export function ondeEstaODinheiro(secoes: Record<IdDaSecao, Secao>, n = 10): ItemCaro[] {
  const itens: ItemCaro[] = [];
  for (const id of ORDEM_DAS_SECOES) {
    const dif = id === "inventario" || id === "rendimento";
    for (const l of secoes[id].linhas) {
      const valor = dif ? -l.total : l.total;
      if (valor > 0) itens.push({ nome: l.nome, secao: id, valor: r2(valor), quantidade: dif ? -l.quantidade : l.quantidade, unidade: l.unidade });
    }
    if (id === "completo") {
      for (const c of secoes[id].cancelados || []) if ((c.valor || 0) > 0) itens.push({ nome: `Pedido ${c.numero} cancelado`, secao: id, valor: r2(c.valor!), quantidade: 1, unidade: "pedido" });
    }
  }
  return itens.sort((a, b) => b.valor - a.valor).slice(0, n);
}

// ── O relatório inteiro (o que a rota devolve) ──────────────────────────────

export type AvisoDoRelatorio = { tipo: "erro" | "atencao" | "info"; texto: string };

export type RelatorioDosControlaveis = {
  loja: string;
  periodo: { de: string; ate: string };
  geradoEm: string;
  venda: number;
  /** A janela das contagens (seções 4, 6, 7, 8): de que dia a que dia valem. */
  contagem: { de: string; ate: string; venda: number; parcial: boolean } | null;
  secoes: Record<IdDaSecao, Secao>;
  resumo: Resumo;
  anterior: { de: string; ate: string; resumo: Resumo; comparacao: Record<IdDaSecao | "totalControlaveis", Comparacao> } | null;
  ondeEstaODinheiro: ItemCaro[];
  avisos: AvisoDoRelatorio[];
};
