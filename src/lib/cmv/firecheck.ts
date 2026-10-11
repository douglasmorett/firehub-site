/**
 * DESCARTE DO FIRECHECK VIRA PERDA NO FIREHUB
 *
 * Douglas, 11/10/2026: "todo descarte lançado no FireCheck que está logado
 * dentro do FireHub da conta vai contabilizar para os números". Uma loja do
 * FireHub fica ligada a UM FireCheck (o do balcão dela); a ligação é feita na
 * tela Checklist e ponto, pelo dono, com o login do FireCheck, e mora em
 * `User.firecheckIntegracao`. A senha do FireCheck nunca é guardada: vai uma
 * vez para o FireCheck e volta só a confirmação.
 *
 * O FireCheck manda cada descarte para api/integracoes/firecheck/descarte com a
 * chave da ligação. Aqui ele vira perda:
 *   - casou com um PRODUTO do cardápio com ficha → baixa (WASTE) de cada insumo
 *     da ficha × quantidade descartada ("6 esfirras de carne");
 *   - casou com um INSUMO → baixa dele, na unidade dele (kg ↔ g, l ↔ ml);
 *   - não casou, ou sem quantidade → fica só registrado, com o valor que o
 *     funcionário estimou, para a perda aparecer no painel mesmo assim.
 * Sempre grava uma linha em DescarteDoFirecheck, única por (loja, id do
 * FireCheck): o FireCheck reenvia o que falhou, e a segunda chegada devolve a
 * primeira em vez de dobrar a baixa.
 */
import crypto from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { cifrar, decifrar } from "@/lib/cofre";
import { hojeNaLoja } from "@/lib/relatorios/base";
import { custosNoDia } from "./custo-do-insumo";
import { insumosParaCusto, entradasComCusto } from "./contagem-no-banco";

// ── A ligação ─────────────────────────────────────────────────────────────

export type LigacaoDoFirecheck = {
  /** sha256 da chave: é por ele que o descarte acha a loja. */
  chaveHash: string;
  /** A chave cifrada (lib/cofre): o FireHub precisa dela para desconectar lá. */
  chaveCifrada: string;
  /** A loja do FireCheck ("store" lá) e o nome que aparece. */
  store: string;
  storeName: string;
  /** O login do FireCheck que autorizou. */
  email: string;
  conectadoEm: string;
  conectadoPor: string;
};

/** Onde fica o FireCheck e com que endereço ele chama o FireHub de volta. */
export const URL_DO_FIRECHECK = (process.env.FIRECHECK_API_URL || "https://www.firecheckapp.com.br").replace(/\/+$/, "");
export const URL_DO_FIREHUB_PARA_O_FIRECHECK = (process.env.FIRECHECK_URL_DO_FIREHUB || "https://firehubfood.com.br").replace(/\/+$/, "");

export const hashDaChave = (chave: string) => crypto.createHash("sha256").update(`firecheck:${chave}`).digest("hex");

export function novaChave(): { chave: string; chaveHash: string; chaveCifrada: string } {
  const chave = crypto.randomBytes(32).toString("hex");
  return { chave, chaveHash: hashDaChave(chave), chaveCifrada: cifrar(chave) };
}

export function lerLigacao(v: unknown): LigacaoDoFirecheck | null {
  if (!v || typeof v !== "object") return null;
  const l = v as Record<string, unknown>;
  if (typeof l.chaveHash !== "string" || typeof l.store !== "string") return null;
  return {
    chaveHash: l.chaveHash,
    chaveCifrada: String(l.chaveCifrada || ""),
    store: l.store,
    storeName: String(l.storeName || l.store),
    email: String(l.email || ""),
    conectadoEm: String(l.conectadoEm || ""),
    conectadoPor: String(l.conectadoPor || ""),
  };
}

export const chaveDaLigacao = (l: LigacaoDoFirecheck) => decifrar(l.chaveCifrada);

/** A loja dona da chave que veio no Bearer, ou null. */
export async function lojaDaChave(authorization: string | null): Promise<{ id: string; nome: string; tz: string } | null> {
  const chave = String(authorization || "").replace(/^Bearer\s+/i, "").trim();
  if (chave.length < 32 || chave.length > 1000) return null;
  const loja = await prisma.user.findFirst({
    where: { firecheckIntegracao: { path: ["chaveHash"], equals: hashDaChave(chave) } },
    select: { id: true, storeName: true, name: true, storeTimezone: true },
  });
  if (!loja) return null;
  return { id: loja.id, nome: loja.storeName || loja.name || "Loja", tz: loja.storeTimezone || "America/Sao_Paulo" };
}

// ── Casar o nome do descarte ──────────────────────────────────────────────

const PALAVRAS_DE_LIGACAO = new Set(["de", "da", "do", "das", "dos", "com", "e", "a", "o"]);

/** "Esfirra de Carne " → "esfirra carne"; tira acento, pontuação e "de/da/com". */
export function normalizarNome(nome: string): string {
  return String(nome || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((p) => p && !PALAVRAS_DE_LIGACAO.has(p))
    .join(" ");
}

/** Plural simples ("esfirras" → "esfirra"), para "6 esfirras de carne" casar. */
const singular = (nome: string) => nome.split(" ").map((p) => (p.length > 3 && p.endsWith("s") ? p.slice(0, -1) : p)).join(" ");

export type ProdutoComFicha = { id: string; nome: string; ficha: { stockItemId: string; quantidade: number }[] };
export type InsumoDoDescarte = { id: string; nome: string; unidade: string };

export type Casamento =
  | { tipo: "PRODUTO"; produto: ProdutoComFicha }
  | { tipo: "INSUMO"; insumo: InsumoDoDescarte }
  | { tipo: "NADA" };

/**
 * Produto com ficha primeiro (é o que o funcionário joga fora: esfirra pronta),
 * depois insumo. Nome igual depois de normalizar; não serve, igual no singular.
 * Nada de "parecido": casar errado tira do estoque o que não saiu.
 */
export function casarItem(item: string, produtos: ProdutoComFicha[], insumos: InsumoDoDescarte[]): Casamento {
  const alvo = normalizarNome(item);
  if (!alvo) return { tipo: "NADA" };
  for (const comparar of [(s: string) => s, singular]) {
    const a = comparar(alvo);
    const p = produtos.find((x) => x.ficha.length > 0 && comparar(normalizarNome(x.nome)) === a);
    if (p) return { tipo: "PRODUTO", produto: p };
    const i = insumos.find((x) => comparar(normalizarNome(x.nome)) === a);
    if (i) return { tipo: "INSUMO", insumo: i };
  }
  return { tipo: "NADA" };
}

const UNIDADES: Record<string, { base: string; fator: number }> = {
  g: { base: "g", fator: 1 }, kg: { base: "g", fator: 1000 },
  ml: { base: "ml", fator: 1 }, l: { base: "ml", fator: 1000 },
  un: { base: "un", fator: 1 }, und: { base: "un", fator: 1 }, unid: { base: "un", fator: 1 }, unidade: { base: "un", fator: 1 }, unidades: { base: "un", fator: 1 },
};

/**
 * A quantidade do descarte na unidade do insumo. Unidade vazia = a do insumo.
 * Unidades que não se convertem (un × kg) devolvem null: melhor não baixar do
 * que baixar 3 kg de queijo quando jogaram fora 3 fatias.
 */
export function naUnidadeDoInsumo(quantidade: number, unidade: string | null | undefined, doInsumo: string): number | null {
  const de = String(unidade || "").trim().toLowerCase();
  const para = String(doInsumo || "").trim().toLowerCase();
  if (!de || de === para) return quantidade;
  const a = UNIDADES[de];
  const b = UNIDADES[para];
  if (!a || !b || a.base !== b.base) return null;
  return (quantidade * a.fator) / b.fator;
}

// ── Registrar ─────────────────────────────────────────────────────────────

export type DescarteRecebido = {
  idExterno: string;
  item: string;
  quantidade: number | null;
  unidade: string | null;
  valorEstimado: number | null;
  motivo: string | null;
  funcionario: string | null;
  registradoEm: Date;
  foto: string | null;
};

const texto = (v: unknown, max: number) => {
  const s = typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
  return s ? s.slice(0, max) : null;
};
const numero = (v: unknown) => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(",", ".")) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** Valida o corpo que o FireCheck manda. Devolve o erro em texto quando não serve. */
export function lerDescarte(corpo: unknown): DescarteRecebido | string {
  if (!corpo || typeof corpo !== "object") return "Corpo inválido";
  const c = corpo as Record<string, unknown>;
  const idExterno = texto(c.idExterno, 100);
  if (!idExterno) return "idExterno obrigatório";
  const item = texto(c.item, 200);
  if (!item) return "item obrigatório";
  const quando = c.registradoEm ? new Date(String(c.registradoEm)) : new Date();
  const quantidade = numero(c.quantidade);
  const valorEstimado = numero(c.valorEstimado);
  const foto = texto(c.foto, 2000);
  return {
    idExterno,
    item,
    quantidade: quantidade != null && quantidade > 0 ? quantidade : null,
    unidade: texto(c.unidade, 20),
    valorEstimado: valorEstimado != null && valorEstimado >= 0 ? valorEstimado : null,
    motivo: texto(c.motivo, 500),
    funcionario: texto(c.funcionario, 120),
    registradoEm: Number.isNaN(quando.getTime()) ? new Date() : quando,
    foto: foto && /^https?:\/\//i.test(foto) ? foto : null,
  };
}

export type ResultadoDoDescarte = {
  repetido: boolean;
  situacao: "PRODUTO" | "INSUMO" | "SEM_CORRESPONDENCIA";
  casouCom: string | null;
  valor: number | null;
  baixas: number;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

export async function registrarDescarte(loja: { id: string; tz: string }, d: DescarteRecebido): Promise<ResultadoDoDescarte> {
  const jaVeio = await prisma.descarteDoFirecheck.findUnique({ where: { franchiseeId_idExterno: { franchiseeId: loja.id, idExterno: d.idExterno } } });
  if (jaVeio) return { repetido: true, situacao: jaVeio.situacao as ResultadoDoDescarte["situacao"], casouCom: jaVeio.casouCom, valor: jaVeio.valor, baixas: 0 };

  const [produtos, insumosDb, insumos, entradas] = await Promise.all([
    prisma.menuProduct.findMany({
      where: { franchiseeId: loja.id, active: true, NOT: { id: { startsWith: "ifood-" } }, recipeItems: { some: {} } },
      select: { id: true, name: true, recipeItems: { select: { stockItemId: true, quantityConsumed: true } } },
    }),
    prisma.stockItem.findMany({ where: { franchiseeId: loja.id, NOT: { active: false } }, select: { id: true, name: true, unit: true } }),
    insumosParaCusto(loja.id),
    entradasComCusto(loja.id, loja.tz),
  ]);
  const custos = custosNoDia(insumos, entradas, hojeNaLoja(loja.tz));
  const casou = casarItem(
    d.item,
    produtos.map((p) => ({ id: p.id, nome: p.name, ficha: p.recipeItems.map((r) => ({ stockItemId: r.stockItemId, quantidade: r.quantityConsumed })) })),
    insumosDb.map((i) => ({ id: i.id, nome: i.name, unidade: i.unit })),
  );

  // O que sai de cada insumo.
  let baixas: { stockItemId: string; quantidade: number }[] = [];
  let situacao: ResultadoDoDescarte["situacao"] = "SEM_CORRESPONDENCIA";
  let casouCom: string | null = null;
  if (casou.tipo === "PRODUTO" && d.quantidade != null) {
    situacao = "PRODUTO";
    casouCom = casou.produto.nome;
    baixas = casou.produto.ficha.map((f) => ({ stockItemId: f.stockItemId, quantidade: f.quantidade * d.quantidade! }));
  } else if (casou.tipo === "INSUMO" && d.quantidade != null) {
    const q = naUnidadeDoInsumo(d.quantidade, d.unidade, casou.insumo.unidade);
    if (q != null) {
      situacao = "INSUMO";
      casouCom = casou.insumo.nome;
      baixas = [{ stockItemId: casou.insumo.id, quantidade: q }];
    }
  }
  baixas = baixas.filter((b) => b.quantidade > 0);

  let valor: number | null = null;
  if (situacao !== "SEM_CORRESPONDENCIA") {
    const semCusto = baixas.some((b) => custos.get(b.stockItemId)?.custo == null);
    valor = semCusto ? null : r2(baixas.reduce((s, b) => s + b.quantidade * (custos.get(b.stockItemId)!.custo as number), 0));
  }

  const nota = [
    `Descarte do FireCheck: ${d.quantidade != null ? `${d.quantidade} ${d.unidade || ""} `.replace(/\s+/g, " ") : ""}${d.item}`.trim(),
    d.motivo ? `motivo: ${d.motivo}` : null,
    d.funcionario ? `por ${d.funcionario}` : null,
  ].filter(Boolean).join(" · ").slice(0, 500);

  try {
    await prisma.$transaction(async (tx) => {
      // A linha do descarte vai primeiro: duas chegadas ao mesmo tempo batem no
      // unique aqui, antes de qualquer baixa.
      const linha = await tx.descarteDoFirecheck.create({
        data: {
          franchiseeId: loja.id, idExterno: d.idExterno, item: d.item, quantidade: d.quantidade, unidade: d.unidade,
          valorEstimado: d.valorEstimado, motivo: d.motivo, funcionario: d.funcionario, foto: d.foto,
          registradoEm: d.registradoEm, situacao, casouCom, valor,
        },
        select: { id: true },
      });
      for (const b of baixas) {
        await tx.stockTransaction.create({
          data: {
            stockItemId: b.stockItemId,
            franchiseeId: loja.id,
            quantity: -b.quantidade,
            type: "WASTE",
            notes: nota,
            unitCost: custos.get(b.stockItemId)?.custo ?? null,
            sourceRef: `firecheck:${linha.id}:${b.stockItemId}`,
          },
        });
        await tx.stockItem.update({ where: { id: b.stockItemId }, data: { quantity: { decrement: b.quantidade } } });
      }
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const primeiro = await prisma.descarteDoFirecheck.findUnique({ where: { franchiseeId_idExterno: { franchiseeId: loja.id, idExterno: d.idExterno } } });
      if (primeiro) return { repetido: true, situacao: primeiro.situacao as ResultadoDoDescarte["situacao"], casouCom: primeiro.casouCom, valor: primeiro.valor, baixas: 0 };
    }
    throw e;
  }
  return { repetido: false, situacao, casouCom, valor, baixas: baixas.length };
}

/** O que o FireCheck oferece no campo "item" do descarte: produtos com ficha, depois insumos. */
export async function itensParaODescarte(lojaId: string) {
  const [produtos, insumos] = await Promise.all([
    prisma.menuProduct.findMany({
      where: { franchiseeId: lojaId, active: true, isCombo: false, NOT: { id: { startsWith: "ifood-" } }, recipeItems: { some: {} } },
      select: { name: true }, orderBy: { name: "asc" }, take: 500,
    }),
    prisma.stockItem.findMany({
      where: { franchiseeId: lojaId, NOT: { active: false } },
      select: { name: true, unit: true }, orderBy: { name: "asc" }, take: 500,
    }),
  ]);
  const vistos = new Set<string>();
  const itens: { nome: string; tipo: "PRODUTO" | "INSUMO"; unidade: string }[] = [];
  for (const p of produtos) {
    const k = normalizarNome(p.name);
    if (vistos.has(k)) continue;
    vistos.add(k);
    itens.push({ nome: p.name, tipo: "PRODUTO", unidade: "un" });
  }
  for (const i of insumos) {
    const k = normalizarNome(i.name);
    if (vistos.has(k)) continue;
    vistos.add(k);
    itens.push({ nome: i.name, tipo: "INSUMO", unidade: i.unit });
  }
  return itens;
}
