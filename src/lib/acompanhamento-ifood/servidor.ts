import { getServerSession } from "next-auth/next";
import { Prisma } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { intervaloDoMes } from "@/lib/billing";
import { garantirEstruturaDeAcompanhamento } from "@/lib/garantir-colunas";
import { mesAtual, somarMeses } from "./regras";

/** O admin logado (e-mail para o "criado por"), ou null. */
export async function adminDaSessao(): Promise<{ email: string } | null> {
  const session = await getServerSession(authOptions);
  if (!session || (session.user as any)?.role !== "ADMIN") return null;
  return { email: String(session.user?.email || "admin") };
}

/** As tabelas existem? Se o boot falhou, tenta de novo antes de ler. */
export async function estruturaPronta(): Promise<boolean> {
  return garantirEstruturaDeAcompanhamento();
}

/** Os campos do relatório que a lista lê — nunca o arquivo (pode ter MB). */
export const SELECT_DO_RELATORIO = {
  id: true, clienteId: true, mes: true, titulo: true, resumo: true, numeros: true,
  status: true, enviadoEm: true, arquivoNome: true, arquivoTipo: true,
  criadoPor: true, createdAt: true, updatedAt: true,
} satisfies Prisma.AcompanhamentoRelatorioSelect;

export type CanalDoMes = { pedidos: number; valor: number; cancelados: number };
export type MesNoFireHub = { mes: string; ifood: CanalDoMes; noventaENove: CanalDoMes; outros: CanalDoMes };

const CANAL_VAZIO = (): CanalDoMes => ({ pedidos: 0, valor: 0, cancelados: 0 });

/**
 * Os pedidos que a loja recebeu PELO FIREHUB nos últimos `meses` meses, por
 * canal: iFood, 99Food e o resto (site, balcão, mesa…). Valor = Σ totalAmount
 * dos não cancelados (a régua do DRE). É o que a integração viu — confere com
 * o portal, não substitui o "Total faturamento" do Financeiro do iFood.
 */
export async function numerosDoFireHub(lojaId: string, meses = 6): Promise<MesNoFireHub[]> {
  const ultimo = mesAtual();
  const primeiro = somarMeses(ultimo, -(meses - 1));
  const desde = intervaloDoMes(primeiro).monthStart;

  const linhas = await prisma.$queryRaw<{ mes: string; canal: string; cancelado: boolean; pedidos: bigint; valor: number | null }[]>`
    SELECT to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') AS mes,
           CASE WHEN source = 'IFOOD' THEN 'IFOOD' WHEN source = '99FOOD' THEN '99FOOD' ELSE 'OUTROS' END AS canal,
           (status = 'CANCELADO') AS cancelado,
           COUNT(*) AS pedidos,
           SUM("totalAmount") AS valor
      FROM "CustomerOrder"
     WHERE "franchiseeId" = ${lojaId} AND "createdAt" >= ${desde}
     GROUP BY 1, 2, 3
  `;

  const porMes = new Map<string, MesNoFireHub>();
  for (let i = 0; i < meses; i++) {
    const mes = somarMeses(primeiro, i);
    porMes.set(mes, { mes, ifood: CANAL_VAZIO(), noventaENove: CANAL_VAZIO(), outros: CANAL_VAZIO() });
  }
  for (const l of linhas) {
    const m = porMes.get(l.mes);
    if (!m) continue;
    const c = l.canal === "IFOOD" ? m.ifood : l.canal === "99FOOD" ? m.noventaENove : m.outros;
    if (l.cancelado) c.cancelados += Number(l.pedidos);
    else {
      c.pedidos += Number(l.pedidos);
      c.valor = Math.round((c.valor + Number(l.valor || 0)) * 100) / 100;
    }
  }
  return [...porMes.values()];
}

/** Nome, logo e endereço público das lojas vinculadas. */
export async function lojasPorId(ids: string[]) {
  if (ids.length === 0) return new Map<string, { nome: string; slug: string | null; logo: string | null; cidade: string | null }>();
  const lojas = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, storeName: true, name: true, email: true, slug: true, storeLogo: true, city: true },
  });
  return new Map(lojas.map((l) => [l.id, { nome: l.storeName || l.name || l.email, slug: l.slug, logo: l.storeLogo, cidade: l.city }]));
}

/** Tipos de arquivo aceitos no relatório. */
export const TIPOS_DO_RELATORIO: Record<string, string> = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  pdf: "application/pdf",
};

/** 8 MB: o proxy do Next corta upload acima de 10 MB sem erro. */
export const LIMITE_DO_ARQUIVO = 8 * 1024 * 1024;

/** O tipo pelo nome do arquivo (o navegador às vezes manda vazio). */
export function tipoDoArquivo(nome: string): string | null {
  const ext = nome.toLowerCase().split(".").pop() || "";
  return TIPOS_DO_RELATORIO[ext] || null;
}
