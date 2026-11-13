/**
 * A IMPORTAÇÃO DO MERCADO gravando no banco — milhares de itens de uma vez.
 *
 * Grava em LOTE (jsonb_to_recordset): linha a linha seriam ~4 idas ao banco
 * por produto, e 5 mil produtos estourariam o tempo de uma requisição.
 *
 * Produto novo do mercado nasce só no PDV (activePDV) — fora do delivery, do
 * totem e do garçom: o cardápio online da loja não ganha 5 mil itens de
 * mercearia sem o dono pedir. Estoque entra com `estoquePausar = false`: o
 * número controla, mas não trava o caixa (o estoque de mercado raramente está
 * certo no primeiro dia). Sem preço, o produto nasce INATIVO (o caixa recusa
 * vender por R$ 0,00) — o dono preenche e ativa.
 */
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { garantirEstruturaDoCaixa, MENSAGEM_SEM_ESTRUTURA } from "./estrutura";
import type { LinhaImportada } from "./importacao/planilha";
import { custoDaUnidade, eanDaUnidade, type NotaDeCompra } from "./importacao/nfe";
import type { RegraDoNcm } from "./importacao/ncm";

const LOTE = 500;
const partes = <T,>(lista: T[], n = LOTE) => Array.from({ length: Math.ceil(lista.length / n) }, (_, i) => lista.slice(i * n, i * n + n));
const chaveDoNome = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

type Existentes = { porEan: Map<string, string>; porPlu: Map<string, string>; porNome: Map<string, string>; ncmDe: Map<string, string | null>; sugerido: Set<string> };

async function existentes(lojaId: string): Promise<Existentes> {
  const produtos = await prisma.menuProduct.findMany({ where: { franchiseeId: lojaId, origemIntegracao: null }, select: { id: true, name: true, ncm: true } });
  const porNome = new Map<string, string>();
  const ncmDe = new Map<string, string | null>();
  for (const p of produtos) {
    if (!porNome.has(chaveDoNome(p.name))) porNome.set(chaveDoNome(p.name), p.id);
    const n = String(p.ncm ?? "").replace(/\D/g, "");
    ncmDe.set(p.id, n.length === 8 ? n : null);
  }
  const codigos = await prisma.$queryRawUnsafe<{ tipo: string; codigo: string; menuProductId: string }[]>(
    `SELECT "tipo", "codigo", "menuProductId" FROM "CaixaMercadoCodigo" WHERE "lojaId" = $1`, lojaId,
  );
  const validos = new Set(produtos.map((p) => p.id));
  const porEan = new Map<string, string>();
  const porPlu = new Map<string, string>();
  for (const c of codigos) {
    if (!validos.has(c.menuProductId)) continue;
    (c.tipo === "PLU" ? porPlu : porEan).set(c.codigo, c.menuProductId);
  }
  const sug = await prisma.$queryRawUnsafe<{ menuProductId: string }[]>(
    `SELECT "menuProductId" FROM "CaixaMercadoProduto" WHERE "lojaId" = $1 AND "ncmSugerido" = true`, lojaId,
  );
  return { porEan, porPlu, porNome, ncmDe, sugerido: new Set(sug.map((s) => s.menuProductId)) };
}

type Novo = { id: string; nome: string; precoCentavos: number; custoCentavos: number | null; ncm: string | null; cest: string | null; estoque: number | null; categoria: string | null };
type Mudanca = { id: string; name?: string | null; price?: number | null; cost?: number | null; ncm?: string | null; cest?: string | null; estoqueQtd?: number | null; category?: string | null };
type Extra = { menuProductId: string; unidade: "UN" | "KG" | null; ncmOrigem: string | null; ncmSugerido: boolean | null };
type Codigo = { tipo: "EAN" | "PLU"; codigo: string; menuProductId: string };

async function gravar(lojaId: string, novos: Novo[], mudancas: Mudanca[], extras: Extra[], codigos: Codigo[]) {
  const agora = new Date();
  for (const lote of partes(novos)) {
    await prisma.menuProduct.createMany({
      data: lote.map((n) => ({
        id: n.id,
        franchiseeId: lojaId,
        name: n.nome,
        description: "",
        price: n.precoCentavos / 100,
        cost: n.custoCentavos != null ? n.custoCentavos / 100 : null,
        category: n.categoria || "Mercado",
        ncm: n.ncm,
        cest: n.cest,
        active: n.precoCentavos > 0,
        activePDV: true,
        activeDelivery: false,
        activeTotem: false,
        activeGarcom: false,
        ...(n.estoque != null ? { estoqueQtd: Math.max(0, Math.round(n.estoque)), estoqueDesde: agora, estoquePausar: false } : {}),
      })),
    });
  }
  for (const lote of partes(mudancas)) {
    await prisma.$executeRawUnsafe(
      `UPDATE "MenuProduct" AS m SET
         "name" = COALESCE(v."name", m."name"),
         "price" = COALESCE(v."price", m."price"),
         "active" = CASE WHEN v."price" IS NOT NULL AND v."price" > 0 THEN true ELSE m."active" END,
         "cost" = COALESCE(v."cost", m."cost"),
         "ncm" = COALESCE(v."ncm", m."ncm"),
         "cest" = COALESCE(v."cest", m."cest"),
         "category" = COALESCE(v."category", m."category"),
         "estoqueQtd" = COALESCE(v."estoqueQtd", m."estoqueQtd"),
         "estoqueDesde" = CASE WHEN v."estoqueQtd" IS NOT NULL THEN NOW() ELSE m."estoqueDesde" END,
         "estoquePausar" = CASE WHEN v."estoqueQtd" IS NOT NULL THEN false ELSE m."estoquePausar" END,
         "updatedAt" = NOW()
       FROM jsonb_to_recordset($1::jsonb) AS v("id" text, "name" text, "price" float8, "cost" float8, "ncm" text, "cest" text, "category" text, "estoqueQtd" int)
       WHERE m."id" = v."id" AND m."franchiseeId" = $2`,
      JSON.stringify(lote), lojaId,
    );
  }
  for (const lote of partes(extras)) {
    const json = JSON.stringify(lote);
    // Dois passos: a linha nova nasce UN; o UPDATE só troca o que veio (unidade
    // nula = não mexe — a nota de compra não desfaz o KG da planilha).
    await prisma.$executeRawUnsafe(
      `INSERT INTO "CaixaMercadoProduto" ("menuProductId", "lojaId", "unidade", "atualizadoEm")
       SELECT v."menuProductId", $2, 'UN', NOW() FROM jsonb_to_recordset($1::jsonb) AS v("menuProductId" text)
       ON CONFLICT ("menuProductId") DO NOTHING`,
      json, lojaId,
    );
    await prisma.$executeRawUnsafe(
      `UPDATE "CaixaMercadoProduto" AS p SET
         "unidade" = COALESCE(v."unidade", p."unidade"),
         "ncmOrigem" = COALESCE(v."ncmOrigem", p."ncmOrigem"),
         "ncmSugerido" = CASE WHEN v."ncmOrigem" IS NOT NULL THEN COALESCE(v."ncmSugerido", false) ELSE p."ncmSugerido" END,
         "atualizadoEm" = NOW()
       FROM jsonb_to_recordset($1::jsonb) AS v("menuProductId" text, "unidade" text, "ncmOrigem" text, "ncmSugerido" boolean)
       WHERE p."menuProductId" = v."menuProductId" AND p."lojaId" = $2`,
      json, lojaId,
    );
  }
  for (const lote of partes(codigos)) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "CaixaMercadoCodigo" ("lojaId", "tipo", "codigo", "menuProductId", "criadoEm")
       SELECT $2, v."tipo", v."codigo", v."menuProductId", NOW() FROM jsonb_to_recordset($1::jsonb) AS v("tipo" text, "codigo" text, "menuProductId" text)
       ON CONFLICT ("lojaId", "tipo", "codigo") DO UPDATE SET "menuProductId" = EXCLUDED."menuProductId"`,
      JSON.stringify(lote), lojaId,
    );
  }
}

export type ResumoDaImportacao = { criados: number; atualizados: number; codigos: number; avisos: string[] };

/** A planilha do PDV antigo (já lida e mapeada). */
export async function aplicarPlanilha(lojaId: string, itens: LinhaImportada[]): Promise<ResumoDaImportacao> {
  if (!(await garantirEstruturaDoCaixa())) throw new Error(MENSAGEM_SEM_ESTRUTURA);
  const ex = await existentes(lojaId);
  const novos: Novo[] = [];
  const mudancas = new Map<string, Mudanca>();
  const extras = new Map<string, Extra>();
  const codigos = new Map<string, Codigo>();
  const avisos: string[] = [];
  for (const it of itens) {
    let id = it.codigos.map((c) => ex.porEan.get(c)).find(Boolean) || (it.plu ? ex.porPlu.get(it.plu) : undefined) || ex.porNome.get(chaveDoNome(it.descricao));
    if (!id) {
      id = crypto.randomUUID();
      novos.push({ id, nome: it.descricao, precoCentavos: it.precoCentavos ?? 0, custoCentavos: it.custoCentavos, ncm: it.ncm, cest: it.cest, estoque: it.estoque, categoria: it.categoria });
      ex.porNome.set(chaveDoNome(it.descricao), id);
    } else {
      mudancas.set(id, {
        id,
        name: it.descricao,
        price: it.precoCentavos != null ? it.precoCentavos / 100 : null,
        cost: it.custoCentavos != null ? it.custoCentavos / 100 : null,
        ncm: it.ncm,
        cest: it.cest,
        estoqueQtd: it.estoque != null ? Math.max(0, Math.round(it.estoque)) : null,
        category: it.categoria,
      });
    }
    for (const c of it.codigos) { codigos.set(`EAN:${c}`, { tipo: "EAN", codigo: c, menuProductId: id }); ex.porEan.set(c, id); }
    if (it.plu) { codigos.set(`PLU:${it.plu}`, { tipo: "PLU", codigo: it.plu, menuProductId: id }); ex.porPlu.set(it.plu, id); }
    extras.set(id, { menuProductId: id, unidade: it.unidade, ncmOrigem: it.ncm ? "planilha" : null, ncmSugerido: it.ncm ? false : null });
    for (const a of it.avisos) avisos.push(`Linha ${it.linha}: ${a}`);
  }
  await gravar(lojaId, novos, [...mudancas.values()], [...extras.values()], [...codigos.values()]);
  return { criados: novos.length, atualizados: mudancas.size, codigos: codigos.size, avisos: avisos.slice(0, 200) };
}

export type ResumoDasNotas = ResumoDaImportacao & { notas: number; itens: number; ncmCompletados: number; semEan: number; divergencias: string[] };

/**
 * As notas de COMPRA: completa NCM/CEST e o custo pelo EAN; cria o que falta.
 * NCM já vindo da planilha ou do contador NÃO é trocado pelo da nota (vira
 * divergência no resumo); o NCM vazio ou sugerido pela IA é completado.
 */
export async function aplicarNotasDeCompra(lojaId: string, notas: NotaDeCompra[], margemPadrao: number): Promise<ResumoDasNotas> {
  if (!(await garantirEstruturaDoCaixa())) throw new Error(MENSAGEM_SEM_ESTRUTURA);
  const ex = await existentes(lojaId);
  const novos: Novo[] = [];
  const mudancas = new Map<string, Mudanca>();
  const extras = new Map<string, Extra>();
  const codigos = new Map<string, Codigo>();
  const divergencias: string[] = [];
  let itens = 0, ncmCompletados = 0, semEan = 0;
  for (const nota of notas) {
    for (const i of nota.itens) {
      itens++;
      const ean = eanDaUnidade(i);
      if (!ean) semEan++;
      const custo = custoDaUnidade(i);
      const unidade: "UN" | "KG" = /^(KG|KGS|QUILO)$/.test(i.unidadeTributavel || i.unidade) ? "KG" : "UN";
      let id = (ean ? ex.porEan.get(ean) : undefined) || ex.porNome.get(chaveDoNome(i.descricao));
      if (!id) {
        id = crypto.randomUUID();
        const preco = margemPadrao > 0 && custo > 0 ? Math.round(custo * (1 + margemPadrao / 100)) : 0;
        novos.push({ id, nome: i.descricao, precoCentavos: preco, custoCentavos: custo || null, ncm: i.ncm, cest: i.cest, estoque: null, categoria: "Mercado" });
        ex.porNome.set(chaveDoNome(i.descricao), id);
        ex.ncmDe.set(id, i.ncm);
        extras.set(id, { menuProductId: id, unidade, ncmOrigem: i.ncm ? "xml" : null, ncmSugerido: i.ncm ? false : null });
      } else {
        const atual = ex.ncmDe.get(id) ?? null;
        const completa = i.ncm && (!atual || ex.sugerido.has(id));
        if (completa) { ncmCompletados++; ex.ncmDe.set(id, i.ncm); ex.sugerido.delete(id); }
        else if (i.ncm && atual && atual !== i.ncm && divergencias.length < 100) divergencias.push(`${i.descricao}: cadastro ${atual}, nota ${nota.numero ?? "?"} de ${nota.emitente ?? "?"} diz ${i.ncm}`);
        const m = mudancas.get(id) ?? { id };
        mudancas.set(id, { ...m, cost: custo > 0 ? custo / 100 : m.cost ?? null, ...(completa ? { ncm: i.ncm, cest: i.cest } : {}) });
        if (completa) extras.set(id, { menuProductId: id, unidade: null, ncmOrigem: "xml", ncmSugerido: false });
      }
      if (ean) { codigos.set(`EAN:${ean}`, { tipo: "EAN", codigo: ean, menuProductId: id }); ex.porEan.set(ean, id); }
    }
  }
  await gravar(lojaId, novos, [...mudancas.values()], [...extras.values()], [...codigos.values()]);
  return { notas: notas.length, itens, criados: novos.length, atualizados: mudancas.size, codigos: codigos.size, ncmCompletados, semEan, divergencias, avisos: [] };
}

/** As regras do contador: grava por NCM e aplica a todos os produtos daquele NCM. */
export async function aplicarRegrasDoContador(lojaId: string, regras: RegraDoNcm[]): Promise<{ ncms: number; produtos: number }> {
  if (!(await garantirEstruturaDoCaixa())) throw new Error(MENSAGEM_SEM_ESTRUTURA);
  if (regras.length === 0) return { ncms: 0, produtos: 0 };
  let produtos = 0;
  for (const lote of partes(regras)) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "CaixaMercadoRegraNcm" ("lojaId", "ncm", "cfop", "csosn", "pis", "cofins", "cest", "obs", "atualizadoEm")
       SELECT $2, v."ncm", v."cfop", v."csosn", v."pis", v."cofins", v."cest", v."obs", NOW()
         FROM jsonb_to_recordset($1::jsonb) AS v("ncm" text, "cfop" text, "csosn" text, "pis" text, "cofins" text, "cest" text, "obs" text)
       ON CONFLICT ("lojaId", "ncm") DO UPDATE SET "cfop" = EXCLUDED."cfop", "csosn" = EXCLUDED."csosn", "pis" = EXCLUDED."pis",
         "cofins" = EXCLUDED."cofins", "cest" = EXCLUDED."cest", "obs" = EXCLUDED."obs", "atualizadoEm" = NOW()`,
      JSON.stringify(lote), lojaId,
    );
    const n = await prisma.$executeRawUnsafe(
      `UPDATE "MenuProduct" AS m SET
         "cfop" = COALESCE(v."cfop", m."cfop"), "csosn" = COALESCE(v."csosn", m."csosn"),
         "pis" = COALESCE(v."pis", m."pis"), "cofins" = COALESCE(v."cofins", m."cofins"),
         "cest" = COALESCE(v."cest", m."cest"), "updatedAt" = NOW()
       FROM jsonb_to_recordset($1::jsonb) AS v("ncm" text, "cfop" text, "csosn" text, "pis" text, "cofins" text, "cest" text)
       WHERE m."franchiseeId" = $2 AND regexp_replace(COALESCE(m."ncm", ''), '\\D', '', 'g') = v."ncm"`,
      JSON.stringify(lote), lojaId,
    );
    produtos += Number(n);
  }
  return { ncms: regras.length, produtos };
}

/** NCM sugerido pela IA: grava no produto com a marca "sugerido, conferir". */
export async function gravarNcmsSugeridos(lojaId: string, sugestoes: { id: string; ncm: string }[]): Promise<number> {
  if (!sugestoes.length) return 0;
  await prisma.$executeRawUnsafe(
    `UPDATE "MenuProduct" AS m SET "ncm" = v."ncm", "updatedAt" = NOW()
       FROM jsonb_to_recordset($1::jsonb) AS v("id" text, "ncm" text)
      WHERE m."id" = v."id" AND m."franchiseeId" = $2 AND (m."ncm" IS NULL OR m."ncm" = '')`,
    JSON.stringify(sugestoes), lojaId,
  );
  await gravar(lojaId, [], [], sugestoes.map((s) => ({ menuProductId: s.id, unidade: null, ncmOrigem: "ia", ncmSugerido: true })), []);
  return sugestoes.length;
}

/** Unidade e códigos de UM produto (a tela de conferência do cadastro). */
export async function salvarCodigosDoProduto(lojaId: string, produtoId: string, dados: { unidade: "UN" | "KG"; eans: string[]; plu: string | null; ncmConferido?: boolean }) {
  if (!(await garantirEstruturaDoCaixa())) throw new Error(MENSAGEM_SEM_ESTRUTURA);
  const p = await prisma.menuProduct.findFirst({ where: { id: produtoId, franchiseeId: lojaId }, select: { id: true } });
  if (!p) throw new Error("Produto não encontrado nesta loja.");
  await prisma.$executeRawUnsafe(`DELETE FROM "CaixaMercadoCodigo" WHERE "lojaId" = $1 AND "menuProductId" = $2`, lojaId, produtoId);
  const codigos: Codigo[] = [...new Set(dados.eans)].map((c) => ({ tipo: "EAN" as const, codigo: c, menuProductId: produtoId }));
  if (dados.plu) codigos.push({ tipo: "PLU", codigo: dados.plu, menuProductId: produtoId });
  await gravar(lojaId, [], [], [{ menuProductId: produtoId, unidade: dados.unidade, ncmOrigem: dados.ncmConferido ? "manual" : null, ncmSugerido: dados.ncmConferido ? false : null }], codigos);
}
