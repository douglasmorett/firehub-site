import { prisma } from "@/lib/prisma";
import { lerPontoDaLoja } from "@/lib/ponto-da-loja";
import type { QuemEsta } from "@/lib/crm/acesso";
import {
  LIMITES_DO_DIA, STATUS_DA_MARCACAO, dentroDaCaixa, diaDaCotaDoGoogle, nomeDaCidade,
  type CaixaDaCidade, type LojaDoMapa, type StatusDaMarcacao, type TipoDeUso,
} from "./regras";

/**
 * Mapa de prospecção — o lado do servidor: as lojas do FireHub na cidade, as
 * marcações dos vendedores e o contador do dia (ver lib/prospeccao/regras.ts).
 *
 * Do Google só guardamos o place_id (é o que os termos do Google deixam
 * guardar); nome, endereço e telefone vêm do Google na hora, na tela.
 */

const INSTRUCOES = [
  `CREATE TABLE IF NOT EXISTS "ProspeccaoMarcacao" (
     "placeId" TEXT NOT NULL,
     "cidade" TEXT NOT NULL,
     "status" TEXT NOT NULL,
     "nota" TEXT NOT NULL DEFAULT '',
     "vendedorId" TEXT,
     "vendedorNome" TEXT,
     "historico" JSONB NOT NULL DEFAULT '[]',
     "atualizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     CONSTRAINT "ProspeccaoMarcacao_pkey" PRIMARY KEY ("placeId")
   )`,
  `CREATE INDEX IF NOT EXISTS "ProspeccaoMarcacao_cidade_idx" ON "ProspeccaoMarcacao" ("cidade")`,
  `CREATE TABLE IF NOT EXISTS "ProspeccaoUso" (
     "dia" TEXT NOT NULL,
     "tipo" TEXT NOT NULL,
     "quem" TEXT NOT NULL,
     "qtd" INTEGER NOT NULL DEFAULT 0,
     CONSTRAINT "ProspeccaoUso_pkey" PRIMARY KEY ("dia", "tipo", "quem")
   )`,
];

let pronto = false;
async function garantirEstrutura(): Promise<void> {
  if (pronto) return;
  for (const sql of INSTRUCOES) await prisma.$executeRawUnsafe(sql);
  pronto = true;
}

// ── A cidade ────────────────────────────────────────────────────────────────

const caixas = new Map<string, { caixa: CaixaDaCidade | null; em: number }>();

/**
 * O retângulo da cidade, pelo Nominatim (grátis). Guardado em memória por um
 * dia; sem resposta, a busca vai sem restrição de área (o termo já diz a cidade).
 */
export async function caixaDaCidade(cidade: string): Promise<CaixaDaCidade | null> {
  const chave = nomeDaCidade(cidade);
  if (!chave) return null;
  const guardada = caixas.get(chave);
  if (guardada && Date.now() - guardada.em < 24 * 3600_000) return guardada.caixa;
  let caixa: CaixaDaCidade | null = null;
  try {
    const u = new URL("https://nominatim.openstreetmap.org/search");
    u.searchParams.set("q", `${cidade}, Brasil`);
    u.searchParams.set("format", "json");
    u.searchParams.set("limit", "5");
    u.searchParams.set("countrycodes", "br");
    const r = await fetch(u, {
      headers: { "User-Agent": "FireHub-DeliveryEngine/2.1 (contato@firehubfood.com.br)", "Accept-Language": "pt-BR" },
      signal: AbortSignal.timeout(6000),
    });
    if (r.ok) {
      const lista = (await r.json()) as { boundingbox?: string[]; addresstype?: string; class?: string }[];
      // A cidade (boundary/município), não uma rua com o mesmo nome.
      const achou = lista.find((l) => ["city", "town", "municipality", "village"].includes(String(l.addresstype)))
        || lista.find((l) => l.class === "boundary") || lista[0];
      const bb = achou?.boundingbox?.map(Number);
      if (bb && bb.length === 4 && bb.every(Number.isFinite)) caixa = { sul: bb[0], norte: bb[1], oeste: bb[2], leste: bb[3] };
    }
  } catch {
    // Sem a caixa, segue sem restrição de área.
  }
  caixas.set(chave, { caixa, em: Date.now() });
  return caixa;
}

// ── As lojas do FireHub ─────────────────────────────────────────────────────

/** As cidades onde já temos loja, para a lista do filtro (mais lojas primeiro). */
export async function cidadesComLojas(): Promise<{ nome: string; lojas: number }[]> {
  const linhas = await prisma.user.findMany({
    where: { role: "FRANCHISEE", ownerId: null, city: { not: null } },
    select: { city: true },
  });
  const porCidade = new Map<string, { nome: string; lojas: number }>();
  for (const l of linhas) {
    const chave = nomeDaCidade(l.city);
    if (!chave) continue;
    const c = porCidade.get(chave) || { nome: l.city!.trim(), lojas: 0 };
    c.lojas++;
    porCidade.set(chave, c);
  }
  return [...porCidade.values()].sort((a, b) => b.lojas - a.lojas || a.nome.localeCompare(b.nome));
}

/** As lojas do FireHub na cidade: pelo nome da cidade no cadastro OU pelo ponto dentro da caixa. */
export async function lojasDoMapa(cidade: string, caixa: CaixaDaCidade | null): Promise<LojaDoMapa[]> {
  const chave = nomeDaCidade(cidade);
  const [lojas, produtos] = await Promise.all([
    prisma.user.findMany({
      where: { role: "FRANCHISEE", ownerId: null },
      select: {
        id: true, name: true, storeName: true, email: true, city: true, storeAddress: true,
        storeLatLng: true, slug: true, vendedor: { select: { name: true } },
      },
    }),
    prisma.menuProduct.groupBy({ by: ["franchiseeId"], _count: { _all: true } }),
  ]);
  const qtd = new Map(produtos.map((p) => [p.franchiseeId, p._count._all]));
  const saida: LojaDoMapa[] = [];
  for (const l of lojas) {
    const ponto = lerPontoDaLoja(l.storeLatLng);
    const pelaCidade = !!chave && nomeDaCidade(l.city) === chave;
    const peloPonto = !!(ponto && caixa && dentroDaCaixa(ponto, caixa));
    if (!pelaCidade && !peloPonto) continue;
    saida.push({
      id: l.id,
      nome: l.storeName || l.name || l.email,
      lat: ponto?.lat ?? null,
      lng: ponto?.lng ?? null,
      endereco: l.storeAddress || null,
      slug: l.slug || null,
      semCardapio: !qtd.get(l.id),
      vendedor: l.vendedor?.name || null,
    });
  }
  return saida;
}

// ── As marcações dos vendedores ─────────────────────────────────────────────

export type Marcacao = {
  placeId: string;
  status: StatusDaMarcacao;
  nota: string;
  vendedor: string | null;
  atualizadoEm: string;
  historico: { em: string; por: string | null; status: StatusDaMarcacao; nota: string }[];
};

export async function marcacoesDaCidade(cidade: string): Promise<Marcacao[]> {
  await garantirEstrutura();
  const linhas = await prisma.$queryRaw<{ placeId: string; status: string; nota: string; vendedorNome: string | null; atualizadoEm: Date; historico: unknown }[]>`
    SELECT "placeId", status, nota, "vendedorNome", "atualizadoEm", historico
    FROM "ProspeccaoMarcacao" WHERE cidade = ${nomeDaCidade(cidade)}`;
  return linhas.map((l) => ({
    placeId: l.placeId,
    status: (STATUS_DA_MARCACAO as readonly string[]).includes(l.status) ? (l.status as StatusDaMarcacao) : "oportunidade",
    nota: l.nota,
    vendedor: l.vendedorNome,
    atualizadoEm: l.atualizadoEm.toISOString(),
    historico: Array.isArray(l.historico) ? (l.historico as Marcacao["historico"]) : [],
  }));
}

/** Grava o que o vendedor marcou no lugar; o histórico guarda as 30 últimas mudanças. */
export async function marcarLugar(quem: QuemEsta, dados: { placeId: string; cidade: string; status: StatusDaMarcacao; nota: string }): Promise<Marcacao> {
  await garantirEstrutura();
  const cidade = nomeDaCidade(dados.cidade);
  const nota = dados.nota.slice(0, 2000);
  const agora = new Date();
  const anterior = await prisma.$queryRaw<{ historico: unknown }[]>`
    SELECT historico FROM "ProspeccaoMarcacao" WHERE "placeId" = ${dados.placeId}`;
  const historico = [
    { em: agora.toISOString(), por: quem.nome, status: dados.status, nota },
    ...(Array.isArray(anterior[0]?.historico) ? (anterior[0].historico as Marcacao["historico"]) : []),
  ].slice(0, 30);
  await prisma.$executeRaw`
    INSERT INTO "ProspeccaoMarcacao" ("placeId", cidade, status, nota, "vendedorId", "vendedorNome", historico, "atualizadoEm")
    VALUES (${dados.placeId}, ${cidade}, ${dados.status}, ${nota}, ${quem.id}, ${quem.nome}, ${JSON.stringify(historico)}::jsonb, ${agora})
    ON CONFLICT ("placeId") DO UPDATE SET
      cidade = EXCLUDED.cidade, status = EXCLUDED.status, nota = EXCLUDED.nota,
      "vendedorId" = EXCLUDED."vendedorId", "vendedorNome" = EXCLUDED."vendedorNome",
      historico = EXCLUDED.historico, "atualizadoEm" = EXCLUDED."atualizadoEm"`;
  return { placeId: dados.placeId, status: dados.status, nota, vendedor: quem.nome, atualizadoEm: agora.toISOString(), historico };
}

// ── O contador do dia (a cota do Google é da equipe toda) ──────────────────

export type UsoDoDia = { busca: number; contato: number; limites: typeof LIMITES_DO_DIA };

export async function usoDoDia(): Promise<UsoDoDia> {
  await garantirEstrutura();
  const linhas = await prisma.$queryRaw<{ tipo: string; qtd: bigint }[]>`
    SELECT tipo, SUM(qtd)::bigint AS qtd FROM "ProspeccaoUso" WHERE dia = ${diaDaCotaDoGoogle()} GROUP BY tipo`;
  const de = (t: TipoDeUso) => Number(linhas.find((l) => l.tipo === t)?.qtd || 0);
  return { busca: de("busca"), contato: de("contato"), limites: LIMITES_DO_DIA };
}

/**
 * Reserva consultas antes de a tela chamar o Google. Passou do limite do dia,
 * não reserva — a tela avisa "a cota grátis de hoje acabou" em vez do erro do Google.
 */
export async function reservarUso(quem: QuemEsta, tipo: TipoDeUso, qtd: number): Promise<{ ok: boolean; uso: UsoDoDia }> {
  const antes = await usoDoDia();
  if (antes[tipo] + qtd > LIMITES_DO_DIA[tipo]) return { ok: false, uso: antes };
  await prisma.$executeRaw`
    INSERT INTO "ProspeccaoUso" (dia, tipo, quem, qtd) VALUES (${diaDaCotaDoGoogle()}, ${tipo}, ${quem.id || quem.tipo}, ${qtd})
    ON CONFLICT (dia, tipo, quem) DO UPDATE SET qtd = "ProspeccaoUso".qtd + EXCLUDED.qtd`;
  return { ok: true, uso: { ...antes, [tipo]: antes[tipo] + qtd } };
}
