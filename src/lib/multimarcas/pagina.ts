/**
 * A PÁGINA DO MULTIMARCAS — o que o dono monta depois de ativar: as marcas
 * (cada uma é um conjunto de categorias do cardápio DA MESMA LOJA), os
 * banners e a identidade da página /marcas/<slug>.
 *
 * Por que marca = categorias e não loja: um pedido com itens de várias marcas
 * tem de sair como UM pedido, com UMA entrega (Douglas, 17/10/2026). Sendo a
 * mesma loja, a sacola, o checkout, o painel, a impressora e o caixa são os de
 * sempre. Categoria que não é de nenhuma marca (bebida, sobremesa) aparece em
 * todas, como "para acompanhar".
 *
 * O produto liga à categoria pelo NOME (MenuProduct.category), então a marca
 * guarda nomes; a comparação ignora caixa e espaços nas pontas.
 *
 * Tabela própria criada no primeiro uso (como a assinatura): se faltar, a
 * página não abre, o resto do sistema não sente.
 */
import { prisma } from "@/lib/prisma";

export type MarcaDaPagina = {
  id: string;
  nome: string;
  /** Tipo de comida: o filtro da página ("Hambúrguer", "Pizza"). */
  tipo: string;
  cor: string;
  logo: string | null;
  capa: string | null;
  /** Nomes das categorias do cardápio que são desta marca. */
  categorias: string[];
  oculta: boolean;
};

export type BannerDaPagina = {
  id: string;
  titulo: string;
  texto: string;
  imagem: string | null;
  /** A marca que o banner abre (null = só aviso). */
  marca: string | null;
  ativo: boolean;
};

export type ConfigDaPagina = {
  nome: string;
  frase: string;
  cor: string;
  marcas: MarcaDaPagina[];
  banners: BannerDaPagina[];
};

export const LIMITES = { marcas: 30, banners: 12, categoriasPorMarca: 60 } as const;
export const CORES_DAS_MARCAS = ["#1F1F23", "#E8590C", "#C92A2A", "#F08C00", "#2B8A3E", "#1864AB", "#7048E8", "#C2255C", "#0B7285", "#5C940D"];

export const chaveDaCategoria = (nome: string) => String(nome || "").trim().toLowerCase();

const texto = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const cor = (v: unknown, padrao: string) => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v.toUpperCase() : padrao);
/** Só imagem do próprio site (/uploads/…, /multimarcas/…) ou https. */
const imagem = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const u = v.trim();
  if (!u || u.length > 600) return null;
  if (u.startsWith("/") && !u.startsWith("//")) return u;
  try { return new URL(u).protocol === "https:" ? u : null; } catch { return null; }
};
const id = (v: unknown, prefixo: string, i: number) => {
  const s = typeof v === "string" ? v.replace(/[^a-z0-9_-]/gi, "").slice(0, 24) : "";
  return s || `${prefixo}${i + 1}`;
};

/**
 * A config que vem da tela (ou do banco), limpa: textos cortados, cores e
 * imagens validadas, ids únicos, e cada categoria numa marca só (a primeira
 * que a reivindicou). Puro, para o teste.
 */
export function limparConfig(bruto: unknown, nomeDaLoja = "Minhas marcas"): ConfigDaPagina {
  const b = (bruto && typeof bruto === "object" ? bruto : {}) as any;
  const usadas = new Set<string>();
  const ids = new Set<string>();
  const marcas: MarcaDaPagina[] = (Array.isArray(b.marcas) ? b.marcas : []).slice(0, LIMITES.marcas).map((m: any, i: number) => {
    let mid = id(m?.id, "m", i);
    while (ids.has(mid)) mid = `${mid}x`;
    ids.add(mid);
    const categorias: string[] = [];
    for (const c of Array.isArray(m?.categorias) ? m.categorias : []) {
      const nome = texto(c, 80);
      const k = chaveDaCategoria(nome);
      if (!k || usadas.has(k) || categorias.length >= LIMITES.categoriasPorMarca) continue;
      usadas.add(k);
      categorias.push(nome);
    }
    return {
      id: mid,
      nome: texto(m?.nome, 40) || `Marca ${i + 1}`,
      tipo: texto(m?.tipo, 24),
      cor: cor(m?.cor, CORES_DAS_MARCAS[i % CORES_DAS_MARCAS.length]),
      logo: imagem(m?.logo),
      capa: imagem(m?.capa),
      categorias,
      oculta: m?.oculta === true,
    };
  });
  const idsDasMarcas = new Set(marcas.map((m) => m.id));
  const idsBanners = new Set<string>();
  const banners: BannerDaPagina[] = (Array.isArray(b.banners) ? b.banners : []).slice(0, LIMITES.banners).map((x: any, i: number) => {
    let bid = id(x?.id, "b", i);
    while (idsBanners.has(bid)) bid = `${bid}x`;
    idsBanners.add(bid);
    return {
      id: bid,
      titulo: texto(x?.titulo, 60),
      texto: texto(x?.texto, 90),
      imagem: imagem(x?.imagem),
      marca: typeof x?.marca === "string" && idsDasMarcas.has(x.marca) ? x.marca : null,
      ativo: x?.ativo !== false,
    };
  }).filter((x: BannerDaPagina) => x.titulo || x.imagem);
  return {
    nome: texto(b.nome, 40) || nomeDaLoja.slice(0, 40),
    frase: texto(b.frase, 120),
    cor: cor(b.cor, "#E8590C"),
    marcas,
    banners,
  };
}

/** Marca de cada categoria (chave normalizada → id da marca). Categoria fora do mapa = "para acompanhar". */
export function mapaDeCategorias(config: Pick<ConfigDaPagina, "marcas">): Map<string, string> {
  const m = new Map<string, string>();
  for (const marca of config.marcas) {
    if (marca.oculta) continue;
    for (const c of marca.categorias) m.set(chaveDaCategoria(c), marca.id);
  }
  return m;
}

/** A marca de um produto pela categoria dele (null = para acompanhar ou nenhuma). */
export function marcaDaCategoria(config: Pick<ConfigDaPagina, "marcas">, categoria: string | null | undefined): MarcaDaPagina | null {
  const id = mapaDeCategorias(config).get(chaveDaCategoria(categoria || ""));
  return id ? config.marcas.find((m) => m.id === id) ?? null : null;
}

// ─── Banco ───────────────────────────────────────────────────────────────

const INSTRUCOES = [
  `CREATE TABLE IF NOT EXISTS "MultimarcasPagina" (
     "franchiseeId" TEXT NOT NULL,
     "config" JSONB NOT NULL DEFAULT '{}',
     "atualizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     CONSTRAINT "MultimarcasPagina_pkey" PRIMARY KEY ("franchiseeId")
   )`,
];

let pronto = false;
async function garantirEstruturaDaPagina(): Promise<boolean> {
  if (pronto) return true;
  try {
    for (const sql of INSTRUCOES) await prisma.$executeRawUnsafe(sql);
    pronto = true;
  } catch (err: any) {
    console.error("[Multimarcas] Estrutura da página falhou:", err?.message);
  }
  return pronto;
}

/** A config salva (null = nunca montou). Nunca lança. */
export async function lerConfigDaPagina(franchiseeId: string, nomeDaLoja?: string): Promise<ConfigDaPagina | null> {
  try {
    if (!(await garantirEstruturaDaPagina())) return null;
    const r = await prisma.$queryRawUnsafe<{ config: unknown }[]>(
      `SELECT "config" FROM "MultimarcasPagina" WHERE "franchiseeId" = $1`, franchiseeId,
    );
    if (!r[0]) return null;
    const bruto = typeof r[0].config === "string" ? JSON.parse(r[0].config) : r[0].config;
    return limparConfig(bruto, nomeDaLoja);
  } catch (err: any) {
    console.error("[Multimarcas] Erro ao ler a página:", err?.message);
    return null;
  }
}

export async function gravarConfigDaPagina(franchiseeId: string, bruto: unknown, nomeDaLoja?: string): Promise<ConfigDaPagina> {
  if (!(await garantirEstruturaDaPagina())) throw new Error("A página das marcas não está disponível agora. Tente de novo em alguns minutos.");
  const config = limparConfig(bruto, nomeDaLoja);
  await prisma.$executeRawUnsafe(
    `INSERT INTO "MultimarcasPagina" ("franchiseeId", "config", "atualizadoEm") VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT ("franchiseeId") DO UPDATE SET "config" = $2::jsonb, "atualizadoEm" = NOW()`,
    franchiseeId, JSON.stringify(config),
  );
  return config;
}
