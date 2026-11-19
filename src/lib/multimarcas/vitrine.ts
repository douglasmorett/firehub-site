/**
 * Os dados que a VITRINE do Multimarcas desenha (components/multimarcas/Vitrine.tsx):
 * a página pública /marcas/<slug>, a prévia no editor do dono e o exemplo da
 * página de venda. Sem banco: a tela importa.
 */

export type MarcaDaVitrine = {
  id: string;
  nome: string;
  /** Tipo de comida — vira o filtro da página inicial. */
  tipo: string;
  cor: string;
  logo: string | null;
  capa: string | null;
  /** A foto do cartão grande (escolhida pelo dono); sem ela, a capa; sem capa, a cor e a logo. */
  fundo?: string | null;
  /** Nota média dos pedidos com itens da marca; null = ainda sem avaliação ("Nova"). */
  nota: number | null;
  avaliacoes: number;
  aberta: boolean;
  oculta: boolean;
};

export type BannerDaVitrine = {
  id: string;
  titulo: string;
  texto: string;
  imagem: string | null;
  /** Para onde o banner leva: um produto, uma marca ou nada (aviso, cupom). */
  marca: string | null;
  produto?: string | null;
  ativo: boolean;
};

export type ConfigDaVitrine = {
  nome: string;
  frase: string;
  /** Onde entrega, na barra do topo ("Entrega em …"). Vazio = não mostra. */
  local: string;
  cor: string;
  /** Logo da loja no topo da página; sem ela, as iniciais. */
  logo?: string | null;
  /** O que o cartão diz quando a loja está fechada ("Fechada · abre às 18:30"). */
  avisoFechada?: string;
  /** Taxa nula = depende do endereço (a página pública não sabe onde o cliente está). */
  entrega: { taxa: number | null; min: number | null; max: number | null; minimo: number };
  marcas: MarcaDaVitrine[];
  banners: BannerDaVitrine[];
  /** Ids dos produtos da fileira de destaques; vazio = um com foto por marca. */
  destaques?: string[];
  /** Os atalhos embaixo do banner (nome do dono + as marcas de cada um). Vazio = filtro pelo tipo de comida. */
  atalhos?: { id: string; nome: string; marcas: string[] }[];
  /** Os tipos de comida com foto embaixo do banner, escolhidos pelo dono. null/ausente = automático; [] = não mostra. */
  tiposDeComida?: { id: string; nome: string; foto: string | null; categorias: string[] }[] | null;
};

export type ProdutoDaVitrine = {
  id: string;
  /** Id da marca, ou MARCA_DOS_EXTRAS para o que acompanha qualquer marca. Em mais de uma marca: a primeira. */
  marca: string;
  /**
   * Todas as marcas em que o produto aparece: a categoria pode estar em várias
   * (bebida só em duas das cinco — Lucas, 11/11/2026). Vazio ou ausente = só `marca`.
   */
  marcas?: string[];
  categoria: string;
  nome: string;
  descricao: string;
  preco: number;
  /** O preço de antes, riscado, quando o item está em promoção. */
  precoDe?: number | null;
  /** Entra em "Promoções do dia": a mesma regra do botão Ofertas do cardápio (lib/multimarcas/carga.ts). */
  promocao?: boolean;
  foto: string | null;
};

/** Bebida, sobremesa, porção: categoria que não é de nenhuma marca — aparece em todas e vai na mesma entrega. */
export const MARCA_DOS_EXTRAS = "extras";

export const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** As marcas do produto (a primeira é `marca`). Para acompanhar: [MARCA_DOS_EXTRAS]. */
export const marcasDoProduto = (p: Pick<ProdutoDaVitrine, "marca" | "marcas">): string[] => (p.marcas?.length ? p.marcas : [p.marca]);

/** O "-37%" do item em promoção (0 = sem preço de antes maior que o de agora). */
export function descontoDaPromocao(preco: number, precoDe: number | null | undefined): number {
  const de = Number(precoDe);
  return de > preco && preco >= 0 ? Math.round((1 - preco / de) * 100) : 0;
}

// ─── Tipos de comida (Lucas, 16/11/2026) ────────────────────────────────
// A fileira com foto embaixo do banner: "Hambúrguer", "Frango Frito", "Açaí"…
// Tocar mostra os itens de TODAS as marcas daquele tipo. O dono escolhe no
// editor (nome, foto e as categorias do cardápio de cada um); sem escolha, a
// página monta sozinha pelo nome da categoria e, se ele não diz, pelo do item.

/** Na ordem da fileira. `re` testa o texto sem acento e em minúsculas. */
export const TIPOS_DE_COMIDA = [
  { id: "hamburguer", nome: "Hambúrguer", emoji: "🍔", re: /hamburg|burg|smash|lanche|\bx-/ },
  { id: "frango", nome: "Frango Frito", emoji: "🍗", re: /frango|chicken|crispy|balde|tirinha|sobrecoxa|asinha|nugget/ },
  { id: "acai", nome: "Açaí", emoji: "🍇", re: /acai/ },
  { id: "salgadinhos", nome: "Salgadinhos", emoji: "🥟", re: /salgad|coxinha|pastel|pasteis|esfiha|esfirra|kibe|quibe|empad|enroladinho|risole/ },
  { id: "porcoes", nome: "Porções", emoji: "🍟", re: /porcao|porcoes|batata|fritas|petisco|onion|mandioca|aipim|isca/ },
  { id: "sobremesas", nome: "Sobremesas", emoji: "🍰", re: /sobremesa|doce|brownie|pudim|sorvete|milk ?shake|\bbolos?\b|torta|brigadeiro|mousse|churros/ },
  { id: "pizza", nome: "Pizza", emoji: "🍕", re: /pizza/ },
  { id: "japones", nome: "Japonês", emoji: "🍣", re: /sushi|temaki|japones|hot ?roll|sashimi|poke|uramaki/ },
  { id: "pratos", nome: "Pratos", emoji: "🍛", re: /marmit|prato|refeic|executiv|almoco|parmegian|feijoada/ },
  { id: "bebidas", nome: "Bebidas", emoji: "🥤", re: /bebida|refri|suco|agua|cerveja|coca|guarana|drink|sprite|fanta/ },
] as const;
/**
 * A ordem em que as regras são testadas (a primeira que bate leva): sobremesa e
 * açaí antes ("esfiha doce" é doce), pizza e lanche antes do frango ("pizza de
 * frango", "X-Frango"), salgado antes do frango ("coxinha de frango") e o
 * frango antes da porção ("porção de tiras de frango", na Frangoso).
 */
const ORDEM_DO_TESTE = ["acai", "sobremesas", "pizza", "hamburguer", "salgadinhos", "frango", "porcoes", "japones", "pratos", "bebidas"];
const REGRAS = ORDEM_DO_TESTE.map((id) => TIPOS_DE_COMIDA.find((t) => t.id === id)!);
const semAcento = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const tipoDoTexto = (t: string) => REGRAS.find((r) => r.re.test(semAcento(t)))?.id ?? null;

/** O tipo automático do item: pelo nome da categoria; se ele não diz ("Combos", "Destaques"), pelo nome do item. */
export function tipoAutomatico(p: Pick<ProdutoDaVitrine, "categoria" | "nome">): string | null {
  return tipoDoTexto(p.categoria) ?? tipoDoTexto(p.nome);
}

export type TipoDeComidaNaTela = { id: string; nome: string; foto: string | null; emoji: string; produtos: string[] };

/**
 * A fileira pronta: cada tipo com os ids dos itens e a foto (a do dono, senão
 * a do primeiro item com foto). Tipo sem item não aparece. `escolhidos` null =
 * automático (só com 2 tipos ou mais, senão não ajuda a escolher); [] = nada.
 * Recebe só os itens que a página mostra (marca escondida já fora). Puro.
 */
export function tiposDeComidaDaVitrine(
  escolhidos: ConfigDaVitrine["tiposDeComida"],
  produtos: Pick<ProdutoDaVitrine, "id" | "categoria" | "nome" | "foto">[],
): TipoDeComidaNaTela[] {
  const chave = (n: string) => String(n || "").trim().toLowerCase();
  const comFoto = (ids: string[]) => produtos.find((p) => p.foto && ids.includes(p.id))?.foto ?? null;
  if (escolhidos) {
    return escolhidos.map((t) => {
      const cats = new Set(t.categorias.map(chave));
      const ids = produtos.filter((p) => cats.has(chave(p.categoria))).map((p) => p.id);
      const padrao = TIPOS_DE_COMIDA.find((x) => x.id === tipoDoTexto(t.nome));
      return { id: t.id, nome: t.nome, foto: t.foto || comFoto(ids), emoji: padrao?.emoji ?? "🍽️", produtos: ids };
    }).filter((t) => t.produtos.length > 0);
  }
  const porTipo = new Map<string, string[]>();
  for (const p of produtos) {
    const t = tipoAutomatico(p);
    if (t) porTipo.set(t, [...(porTipo.get(t) ?? []), p.id]);
  }
  const lista = TIPOS_DE_COMIDA.filter((t) => porTipo.has(t.id))
    .map((t) => ({ id: t.id, nome: t.nome, foto: comFoto(porTipo.get(t.id)!), emoji: t.emoji, produtos: porTipo.get(t.id)! }));
  return lista.length >= 2 ? lista : [];
}

/**
 * O começo do "escolher eu mesmo" no editor: os tipos automáticos com as
 * categorias do cardápio em que a maioria dos itens é daquele tipo. Puro.
 */
export function sugestaoDeTiposDeComida(produtos: Pick<ProdutoDaVitrine, "categoria" | "nome">[]): { id: string; nome: string; foto: null; categorias: string[] }[] {
  const contagem = new Map<string, { nome: string; total: number; votos: Map<string, number> }>();
  for (const p of produtos) {
    const k = p.categoria.trim().toLowerCase();
    if (!k) continue;
    const c = contagem.get(k) ?? { nome: p.categoria.trim(), total: 0, votos: new Map() };
    c.total++;
    const t = tipoAutomatico(p);
    if (t) c.votos.set(t, (c.votos.get(t) ?? 0) + 1);
    contagem.set(k, c);
  }
  const doTipo = new Map<string, string[]>();
  for (const c of contagem.values()) {
    const [tipo, votos] = [...c.votos].sort((a, b) => b[1] - a[1])[0] ?? [];
    if (tipo && votos * 2 >= c.total) doTipo.set(tipo, [...(doTipo.get(tipo) ?? []), c.nome]);
  }
  return TIPOS_DE_COMIDA.filter((t) => doTipo.has(t.id)).map((t) => ({ id: t.id, nome: t.nome, foto: null, categorias: doTipo.get(t.id)! }));
}

// ─── Contraste ───────────────────────────────────────────────────────────
// A cor é livre (Lucas, 11/11/2026: o amarelo da marca dele). Texto branco em
// cima de amarelo some, e amarelo como texto no fundo branco também.

/** Luminância relativa (WCAG) de "#RRGGBB"; null se não for uma cor assim. */
function luminancia(cor: string): number | null {
  if (!/^#[0-9a-f]{6}$/i.test(cor)) return null;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(cor.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contraComBranco = (l: number) => 1.05 / (l + 0.05);

/** O texto EM CIMA da cor (botão, selo, iniciais): branco, ou escuro quando a cor é clara (amarelo). */
export function textoSobreCor(cor: string): string {
  const l = luminancia(cor);
  return l !== null && contraComBranco(l) < 3 ? "#1F1F23" : "#FFFFFF";
}

/** A cor usada COMO TEXTO no fundo branco (nome da marca, "+"): cor clara escurece até dar para ler. */
export function corParaTexto(cor: string): string {
  if (luminancia(cor) === null) return cor;
  let [r, g, b] = [1, 3, 5].map((i) => parseInt(cor.slice(i, i + 2), 16));
  let atual = cor;
  for (let i = 0; i < 20 && contraComBranco(luminancia(atual)!) < 3; i++) {
    [r, g, b] = [r, g, b].map((c) => Math.round(c * 0.9));
    atual = `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
  }
  return atual;
}
