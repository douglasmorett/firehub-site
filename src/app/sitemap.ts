import type { MetadataRoute } from "next";
import { prisma } from "@/lib/prisma";
import { todosOsTutoriais } from "@/lib/tutoriais";
import { tutoriaisEnviados } from "@/lib/tutoriais-no-servidor";
import { SITE } from "@/lib/seo";

// Montado a cada pedido (lê o disco dos tutoriais e o banco das lojas): na
// montagem da imagem Docker não há banco, e um sitemap estático congelaria a
// lista de lojas do dia do deploy.
export const dynamic = "force-dynamic";

/** Páginas públicas do FireHub (painéis e telas de operação ficam no robots.ts). */
const PAGINAS: { caminho: string; prioridade: number; frequencia: "daily" | "weekly" | "monthly" | "yearly" }[] = [
  { caminho: "", prioridade: 1, frequencia: "weekly" },
  { caminho: "/cadastro", prioridade: 0.9, frequencia: "monthly" },
  { caminho: "/tutoriais", prioridade: 0.8, frequencia: "weekly" },
  { caminho: "/tutoriais/google-maps", prioridade: 0.5, frequencia: "monthly" },
  { caminho: "/prazos", prioridade: 0.7, frequencia: "monthly" },
  { caminho: "/seja-embaixador", prioridade: 0.6, frequencia: "monthly" },
  { caminho: "/ia", prioridade: 0.6, frequencia: "monthly" },
  { caminho: "/api-docs", prioridade: 0.4, frequencia: "monthly" },
  { caminho: "/links", prioridade: 0.3, frequencia: "monthly" },
  { caminho: "/termos", prioridade: 0.2, frequencia: "yearly" },
  { caminho: "/privacidade", prioridade: 0.2, frequencia: "yearly" },
  { caminho: "/privacidade-app", prioridade: 0.1, frequencia: "yearly" },
  { caminho: "/privacidade-app-firehub", prioridade: 0.1, frequencia: "yearly" },
  { caminho: "/privacidade-entregador", prioridade: 0.1, frequencia: "yearly" },
  { caminho: "/privacidade-extensao", prioridade: 0.1, frequencia: "yearly" },
  { caminho: "/privacidade-prazos", prioridade: 0.1, frequencia: "yearly" },
];

/**
 * Cardápios que entram: loja com pedido nos últimos 45 dias — a que está
 * vendendo. Loja de teste, demonstração ou abandonada fica fora (o cardápio
 * dela continua abrindo pelo link; só não é oferecido ao Google).
 */
async function cardapiosAtivos(): Promise<MetadataRoute.Sitemap> {
  const desde = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
  const lojas = await prisma.user.findMany({
    where: {
      role: "FRANCHISEE",
      slug: { not: null },
      customerOrders: { some: { createdAt: { gte: desde } } },
    },
    select: { slug: true, updatedAt: true },
    orderBy: { slug: "asc" },
  });
  return lojas
    .filter((l) => l.slug && !/(^|-)(teste|test|demo)(-|$)/i.test(l.slug))
    .map((l) => ({
      url: `${SITE}/loja/${encodeURIComponent(l.slug!)}`,
      lastModified: l.updatedAt,
      changeFrequency: "daily" as const,
      priority: 0.6,
    }));
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const fixas: MetadataRoute.Sitemap = PAGINAS.map((p) => ({
    url: `${SITE}${p.caminho}`,
    changeFrequency: p.frequencia,
    priority: p.prioridade,
  }));

  // Só o tutorial com vídeo no servidor: o que ainda não chegou dá 404.
  const enviados = tutoriaisEnviados();
  const ids = new Set(todosOsTutoriais(enviados ? new Set(enviados) : null).flatMap((g) => g.tutoriais.map((t) => t.id)));
  const tutoriais: MetadataRoute.Sitemap = [...ids].map((id) => ({
    url: `${SITE}/tutoriais/${id}`,
    changeFrequency: "monthly" as const,
    priority: 0.6,
  }));

  // Banco fora do ar não derruba o sitemap: sai sem os cardápios desta vez.
  const lojas = await cardapiosAtivos().catch(() => []);

  return [...fixas, ...tutoriais, ...lojas];
}
