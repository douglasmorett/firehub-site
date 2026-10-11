/**
 * O que o dono do grupo personaliza na página das suas lojas (/lojas/[slug]).
 * Gravado na loja PRINCIPAL, coluna `User.paginaDoGrupo` (JSONB). Tudo é
 * opcional: sem nada gravado, a página nasce com o nome, o logo e a capa da
 * principal e mostra todas as lojas — o lojista não precisa configurar nada
 * para o link funcionar.
 */

export type ConfigDaPaginaDoGrupo = {
  /** O nome no topo. Vazio = nome da loja principal. */
  titulo: string;
  /** A frase embaixo do nome. Vazio = "N lojas para te atender…". */
  frase: string;
  /** Cor dos botões e destaques, "#rrggbb". Vazio = a cor padrão. */
  cor: string;
  /** De qual loja vem a foto do topo. Vazio = a principal. */
  capaDaLoja: string;
  /** A ordem das lojas na página (ids). As que faltam entram no fim. */
  ordem: string[];
  /** Por loja: o nome que aparece ("Unidade Cavaleiros") e se ela fica fora da página. */
  lojas: Record<string, { nome: string; oculta: boolean }>;
};

export const CORES_SUGERIDAS = ["#e4472b", "#c8102e", "#d97706", "#15803d", "#1d4ed8", "#7c3aed", "#1d1a17"];

const texto = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export function lerConfigDaPaginaDoGrupo(bruto: unknown): ConfigDaPaginaDoGrupo {
  const o = bruto && typeof bruto === "object" && !Array.isArray(bruto) ? (bruto as Record<string, any>) : {};
  const cor = texto(o.cor, 7);
  const lojas: ConfigDaPaginaDoGrupo["lojas"] = {};
  if (o.lojas && typeof o.lojas === "object") {
    for (const [id, v] of Object.entries(o.lojas as Record<string, any>)) {
      if (!id || typeof v !== "object" || !v) continue;
      lojas[id.slice(0, 40)] = { nome: texto(v.nome, 60), oculta: v.oculta === true };
    }
  }
  return {
    titulo: texto(o.titulo, 60),
    frase: texto(o.frase, 120),
    cor: /^#[0-9a-f]{6}$/i.test(cor) ? cor.toLowerCase() : "",
    capaDaLoja: texto(o.capaDaLoja, 40),
    ordem: Array.isArray(o.ordem) ? o.ordem.filter((x: unknown) => typeof x === "string").slice(0, 50) : [],
    lojas,
  };
}

/**
 * As lojas na ordem e com os nomes da configuração, sem as ocultas. Nunca
 * esconde TODAS: uma página do grupo vazia seria um link morto divulgado no
 * Instagram — se o dono marcar todas como ocultas, valem todas.
 */
export function aplicarConfigNasLojas<T extends { id: string; nome: string }>(lojas: T[], config: ConfigDaPaginaDoGrupo): T[] {
  const posicao = (id: string) => {
    const i = config.ordem.indexOf(id);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  const ordenadas = lojas
    .map((l, i) => ({ l, i }))
    .sort((a, b) => posicao(a.l.id) - posicao(b.l.id) || a.i - b.i)
    .map(({ l }) => ({ ...l, nome: config.lojas[l.id]?.nome || l.nome }));
  const visiveis = ordenadas.filter((l) => !config.lojas[l.id]?.oculta);
  return visiveis.length > 0 ? visiveis : ordenadas;
}
