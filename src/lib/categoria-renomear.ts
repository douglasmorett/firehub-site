/**
 * RENOMEAR E APAGAR CATEGORIA DO CARDÁPIO — a regra, sem banco.
 *
 * A categoria mora em dois lugares: a linha de `MenuCategory` e o TEXTO
 * `MenuProduct.category` de cada produto. A tela junta os dois, e a categoria
 * que só existe no texto do produto aparece com id "virtual-...". Antes o
 * servidor só sabia mexer na linha: com a virtual dava 404 ("erro ao
 * renomear", "erro ao apagar") e, com a real, renomeava a linha e deixava os
 * produtos para trás com o nome velho — viravam outra categoria virtual, e
 * reordenar depois criava a cópia (Pizzou153, 14/10/2026).
 *
 * Agora renomear leva os produtos junto, e as configs que guardam a categoria
 * pelo NOME (impressora, telas do KDS, "só na finalização"). Renomear para um
 * nome que já existe é juntar as duas, nunca criar duplicata.
 */

export type CategoriaDaLoja = { id: string; name: string };

/** Mesma comparação do resto do cardápio: sem maiúscula e sem espaço nas pontas. */
export const chaveDaCategoria = (v: unknown) => String(v ?? "").toLowerCase().trim();

export type PlanoDeRenomear =
  | { erro: string; status: number }
  | {
      erro?: undefined;
      nomeAntigo: string;
      /** O nome que os produtos e as configs passam a ter. Na junção, o da que já existia. */
      nomeFinal: string;
      /** Linha que muda de nome (a própria categoria, se ela já tinha linha). */
      renomearId: string | null;
      /** Categoria virtual sem outra para juntar: nasce a linha. */
      criar: boolean;
      /** Junção: a categoria que recebe os produtos. */
      juntarEm: string | null;
      /** Junção: a linha antiga que some depois de esvaziada. */
      apagarId: string | null;
    };

export function planoDeRenomear(args: {
  /** A linha de MenuCategory desta categoria, se existir. Null = virtual. */
  atual: CategoriaDaLoja | null;
  /** Nome de hoje (obrigatório quando é virtual). */
  nomeAntigo?: string | null;
  nomeNovo: string | null | undefined;
  /** Todas as categorias (linhas) da loja. */
  categorias: CategoriaDaLoja[];
}): PlanoDeRenomear {
  const nomeNovo = String(args.nomeNovo ?? "").trim();
  if (!nomeNovo) return { erro: "Nome da categoria é obrigatório", status: 400 };
  const nomeAntigo = String(args.atual?.name ?? args.nomeAntigo ?? "").trim();
  if (!nomeAntigo) return { erro: "Informe qual categoria renomear", status: 400 };

  const outra = args.categorias.find(
    (c) => chaveDaCategoria(c.name) === chaveDaCategoria(nomeNovo) && c.id !== args.atual?.id
  );
  if (outra) {
    return { nomeAntigo, nomeFinal: outra.name.trim(), renomearId: null, criar: false, juntarEm: outra.id, apagarId: args.atual?.id ?? null };
  }
  return { nomeAntigo, nomeFinal: nomeNovo, renomearId: args.atual?.id ?? null, criar: !args.atual, juntarEm: null, apagarId: null };
}

export type PlanoDeApagar =
  | { erro: string; status: number; produtos?: number }
  | { erro?: undefined; moverPara: string | null };

/**
 * Apagar categoria NÃO apaga produto. Com produto dentro, ou a loja escolhe
 * para onde eles vão, ou a resposta é 409 com a contagem.
 */
export function planoDeApagar(args: {
  nome: string;
  produtos: number;
  /** Categoria que recebe os produtos, já conferida na loja. */
  destino?: CategoriaDaLoja | null;
}): PlanoDeApagar {
  if (args.produtos <= 0) return { moverPara: null };
  if (!args.destino) {
    const n = args.produtos;
    return {
      erro: `Esta categoria tem ${n} produto${n === 1 ? "" : "s"}. Mova-os para outra categoria antes de excluir.`,
      status: 409,
      produtos: n,
    };
  }
  if (chaveDaCategoria(args.destino.name) === chaveDaCategoria(args.nome)) {
    return { erro: "Escolha outra categoria para receber os produtos", status: 400 };
  }
  return { moverPara: args.destino.name.trim() };
}

/** Troca o nome na lista, sem repetir quando o novo já estava lá (junção). */
export function renomearNaLista(lista: unknown, antigo: string, novo: string): { lista: unknown; mudou: boolean } {
  if (!Array.isArray(lista)) return { lista, mudou: false };
  const chaveAntiga = chaveDaCategoria(antigo);
  if (!lista.some((v) => typeof v === "string" && chaveDaCategoria(v) === chaveAntiga)) return { lista, mudou: false };
  const vistos = new Set<string>();
  const saida: unknown[] = [];
  for (const v of lista) {
    const item = typeof v === "string" && chaveDaCategoria(v) === chaveAntiga ? novo : v;
    if (typeof item === "string") {
      const k = chaveDaCategoria(item);
      if (vistos.has(k)) continue;
      vistos.add(k);
    }
    saida.push(item);
  }
  return { lista: saida, mudou: true };
}

type ConfigsDaLoja = { printerConfig?: unknown; kdsScreens?: unknown; kdsConfig?: unknown };

/**
 * As configs da loja que guardam a categoria pelo NOME. Devolve só os campos
 * que mudaram — o resto não é regravado.
 *   printerConfig.printers[].categories (impressora por categoria)
 *   kdsScreens[].categoryFilter        (telas do KDS)
 *   kdsConfig.soNaFinalizacao          (categorias que só aparecem na finalização)
 */
export function renomearNasConfigs(cfg: ConfigsDaLoja, antigo: string, novo: string): ConfigsDaLoja {
  const mudou: ConfigsDaLoja = {};
  const obj = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);

  if (obj(cfg.printerConfig) && Array.isArray(cfg.printerConfig.printers)) {
    let algum = false;
    const printers = cfg.printerConfig.printers.map((p: any) => {
      if (!obj(p)) return p;
      const r = renomearNaLista(p.categories, antigo, novo);
      if (!r.mudou) return p;
      algum = true;
      return { ...p, categories: r.lista };
    });
    if (algum) mudou.printerConfig = { ...cfg.printerConfig, printers };
  }

  if (Array.isArray(cfg.kdsScreens)) {
    let algum = false;
    const telas = cfg.kdsScreens.map((t: any) => {
      if (!obj(t)) return t;
      const r = renomearNaLista(t.categoryFilter, antigo, novo);
      if (!r.mudou) return t;
      algum = true;
      return { ...t, categoryFilter: r.lista };
    });
    if (algum) mudou.kdsScreens = telas;
  }

  if (obj(cfg.kdsConfig)) {
    const r = renomearNaLista(cfg.kdsConfig.soNaFinalizacao, antigo, novo);
    if (r.mudou) mudou.kdsConfig = { ...cfg.kdsConfig, soNaFinalizacao: r.lista };
  }

  return mudou;
}
