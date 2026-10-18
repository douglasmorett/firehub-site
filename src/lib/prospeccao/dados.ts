import { prisma } from "@/lib/prisma";
import { lerPontoDaLoja } from "@/lib/ponto-da-loja";
import type { QuemEsta } from "@/lib/crm/acesso";
import {
  STATUS_DA_MARCACAO, consultaDaCidade, dentroDaCaixa, diaDaCotaDoGoogle, lojaDoLugar, nomeDaCidade,
  type CaixaDaCidade, type LojaDoMapa, type StatusDaMarcacao,
} from "./regras";
import {
  DIAS_DO_CACHE, MAXIMO_POR_CHAMADA, SKUS, TETO_DE_CHAMADAS_POR_CIDADE, TIPOS_DE_COMIDA,
  aplicarRespostas, celulasRaiz, circuloDaCelula, consultaDoOverpass, cruzarComOsm, escolherLote, estimarChamadas,
  faltamEstimadas, juntarLugares, lerRespostaDoOverpass, mesDaCotaDoGoogle, paraGuardar, percentualDaVarredura,
  quandoContinua, vagas, vagasDaVarredura,
  type Celula, type EstadoDaVarredura, type LugarDoMapa, type MotivoDaPausa, type Ponto,
  type RespostaDaCelula, type ResumoDaVarredura, type Sku, type UsoDoGoogle,
} from "./varredura";

/**
 * Mapa de prospecção — o lado do servidor: as lojas do FireHub na cidade, as
 * marcações dos vendedores, a VARREDURA da cidade com o cache de 30 dias e o
 * uso do Google por dia e por SKU (ver lib/prospeccao/regras.ts e varredura.ts).
 *
 * A varredura roda UMA vez por cidade e a equipe toda usa: o navegador de quem
 * varre chama o Google (a chave é de navegador, presa aos domínios do FireHub)
 * e devolve cada lote aqui; a fila de células, o lote em andamento e o uso
 * do dia ficam no banco (ProspeccaoCidade, ProspeccaoUsoDia).
 *
 * CUSTO ZERO (Douglas, 18/10/2026: "não quero pagar nada"): nenhum caminho
 * passa do grátis do mês nem da trava do dia — sem vaga, pausa e continua.
 *
 * TERMOS DO GOOGLE, À RISCA: do Google o banco guarda só o place_id e o ponto
 * (lat/lng, até 30 dias). Nome, endereço, tipo e link NÃO entram no banco: o
 * nome chega na hora (na varredura e nos nomes por perto), serve para casar com
 * as lojas e o OpenStreetMap e é descartado; a tela busca e guarda em memória.
 * Do OpenStreetMap guardamos tudo (ODbL, atribuição na tela).
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
  // O uso do Google por dia e por SKU (o mês é a soma dos dias; dia e mês do Pacífico).
  `CREATE TABLE IF NOT EXISTS "ProspeccaoUsoDia" (
     "dia" TEXT NOT NULL,
     "sku" TEXT NOT NULL,
     "qtd" INTEGER NOT NULL DEFAULT 0,
     CONSTRAINT "ProspeccaoUsoDia_pkey" PRIMARY KEY ("dia", "sku")
   )`,
  // A varredura da cidade: a fila de células, o lote que alguém está buscando e o resultado.
  `CREATE TABLE IF NOT EXISTS "ProspeccaoCidade" (
     "cidade" TEXT NOT NULL,
     "nome" TEXT NOT NULL,
     "caixa" JSONB NOT NULL,
     "populacao" INTEGER,
     "osm" INTEGER NOT NULL DEFAULT 0,
     "estado" TEXT NOT NULL DEFAULT 'nova',
     "motivo" TEXT,
     "detalhe" TEXT,
     "pendentes" JSONB NOT NULL DEFAULT '[]',
     "lote" JSONB NOT NULL DEFAULT '[]',
     "loteDe" TEXT,
     "loteAte" TIMESTAMP(3),
     "chamadas" INTEGER NOT NULL DEFAULT 0,
     "estimativa" INTEGER,
     "saturadas" JSONB NOT NULL DEFAULT '[]',
     "iniciadaEm" TIMESTAMP(3),
     "varridaEm" TIMESTAMP(3),
     "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     CONSTRAINT "ProspeccaoCidade_pkey" PRIMARY KEY ("cidade")
   )`,
  // Os lugares da cidade. Google: SÓ id + ponto (+ a loja nossa que casou), e saem em 30 dias.
  // OpenStreetMap: nome, endereço, tipo e telefone (ODbL) e o lugar do Google que é o mesmo (googleId).
  `CREATE TABLE IF NOT EXISTS "ProspeccaoLugar" (
     "cidade" TEXT NOT NULL,
     "id" TEXT NOT NULL,
     "origem" TEXT NOT NULL,
     "lat" DOUBLE PRECISION NOT NULL,
     "lng" DOUBLE PRECISION NOT NULL,
     "lojaId" TEXT,
     "nome" TEXT,
     "endereco" TEXT,
     "tipo" TEXT,
     "telefone" TEXT,
     "googleId" TEXT,
     "vistoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     CONSTRAINT "ProspeccaoLugar_pkey" PRIMARY KEY ("cidade", "id")
   )`,
];

let pronto = false;
async function garantirEstrutura(): Promise<void> {
  if (pronto) return;
  for (const sql of INSTRUCOES) await prisma.$executeRawUnsafe(sql);
  pronto = true;
}

// ── A cidade ────────────────────────────────────────────────────────────────

export type CidadeNoMapa = { caixa: CaixaDaCidade; populacao: number | null };
const cidades = new Map<string, { achou: CidadeNoMapa | null; em: number }>();

const AGENTE = { "User-Agent": "FireHub-DeliveryEngine/2.1 (contato@firehubfood.com.br)", "Accept-Language": "pt-BR" };

/**
 * O retângulo e a população da cidade, pelo Nominatim (grátis). Guardado em
 * memória por um dia. Só vale o município (city/town/boundary): rua com o
 * nome da cidade não é a cidade. Sem resposta, `null` — não dá para varrer.
 */
export async function caixaDaCidade(cidade: string): Promise<CidadeNoMapa | null> {
  const chave = nomeDaCidade(cidade);
  if (!chave) return null;
  const guardada = cidades.get(chave);
  if (guardada && Date.now() - guardada.em < 24 * 3600_000) return guardada.achou;
  let achou: CidadeNoMapa | null = null;
  try {
    const u = new URL("https://nominatim.openstreetmap.org/search");
    u.searchParams.set("q", consultaDaCidade(cidade));
    u.searchParams.set("format", "json");
    u.searchParams.set("limit", "5");
    u.searchParams.set("countrycodes", "br");
    u.searchParams.set("extratags", "1");
    const r = await fetch(u, { headers: AGENTE, signal: AbortSignal.timeout(6000) });
    if (r.ok) {
      const lista = (await r.json()) as { boundingbox?: string[]; addresstype?: string; class?: string; extratags?: { population?: string } }[];
      const l = lista.find((x) => ["city", "town", "municipality", "village"].includes(String(x.addresstype)))
        || lista.find((x) => x.class === "boundary");
      const bb = l?.boundingbox?.map(Number);
      if (bb && bb.length === 4 && bb.every(Number.isFinite)) {
        const pop = Number(String(l?.extratags?.population || "").replace(/\D/g, ""));
        achou = { caixa: { sul: bb[0], norte: bb[1], oeste: bb[2], leste: bb[3] }, populacao: pop > 0 ? pop : null };
      }
    }
  } catch {
    // Sem a caixa, a cidade não é varrida (a tela avisa).
  }
  cidades.set(chave, { achou, em: Date.now() });
  return achou;
}

/** Os lugares de comida do OpenStreetMap na caixa (Overpass, grátis; 1 consulta por cidade a cada 30 dias). */
async function lugaresDoOsm(caixa: CaixaDaCidade): Promise<LugarDoMapa[]> {
  try {
    const r = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: { ...AGENTE, "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(consultaDoOverpass(caixa))}`,
      signal: AbortSignal.timeout(60_000),
    });
    if (!r.ok) return [];
    return lerRespostaDoOverpass(await r.json());
  } catch {
    return [];
  }
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

// ── O uso do Google por dia e por SKU (a cota grátis é da equipe toda) ────

type Executor = Pick<typeof prisma, "$queryRaw" | "$executeRaw">;

/** O que se usou hoje e no mês (dia e mês do Google: hora do Pacífico). */
export async function usoDoGoogle(db: Executor = prisma): Promise<UsoDoGoogle> {
  await garantirEstrutura();
  const dia = diaDaCotaDoGoogle();
  const mes = mesDaCotaDoGoogle();
  const linhas = await db.$queryRaw<{ dia: string; sku: string; qtd: number }[]>`
    SELECT dia, sku, qtd FROM "ProspeccaoUsoDia" WHERE dia LIKE ${`${mes}-%`}`;
  const vazio = () => Object.fromEntries((Object.keys(SKUS) as Sku[]).map((k) => [k, 0])) as Record<Sku, number>;
  const uso: UsoDoGoogle = { dia, mes, hoje: vazio(), noMes: vazio() };
  for (const l of linhas) {
    if (!(l.sku in SKUS)) continue;
    uso.noMes[l.sku as Sku] += Number(l.qtd);
    if (l.dia === dia) uso.hoje[l.sku as Sku] += Number(l.qtd);
  }
  return uso;
}

/** Soma (ou devolve, com qtd negativa) consultas de hoje no SKU. */
async function somarHoje(db: Executor, sku: Sku, qtd: number): Promise<void> {
  if (!qtd) return;
  await db.$executeRaw`
    INSERT INTO "ProspeccaoUsoDia" (dia, sku, qtd) VALUES (${diaDaCotaDoGoogle()}, ${sku}, ${Math.max(0, qtd)})
    ON CONFLICT (dia, sku) DO UPDATE SET qtd = GREATEST(0, "ProspeccaoUsoDia".qtd + ${qtd})`;
}

/**
 * Reserva consultas antes de a tela chamar o Google (nomes, contato, "buscar
 * também", abrir o mapa). Sem vaga no dia (a trava do Cloud) ou no mês (o
 * grátis − 2%), não reserva — CUSTO ZERO, sem exceção, nem para o admin.
 */
export async function reservar(sku: Sku, qtd: number): Promise<{ ok: boolean; trava?: "dia" | "mes"; uso: UsoDoGoogle }> {
  const antes = await usoDoGoogle();
  const v = vagas(antes, sku);
  if (qtd > v.qtd) return { ok: false, trava: v.trava, uso: antes };
  await somarHoje(prisma, sku, qtd);
  const uso = await usoDoGoogle();
  return { ok: true, uso };
}

// ── A varredura da cidade ──────────────────────────────────────────────────

/** Quanto tempo o lote fica com quem pegou (a tela volta bem antes disso). */
const SEGUNDOS_DO_LOTE = 120;

export type LinhaDaCidade = {
  cidade: string; nome: string; caixa: CaixaDaCidade; populacao: number | null; osm: number;
  estado: EstadoDaVarredura; motivo: MotivoDaPausa; detalhe: string | null;
  pendentes: Celula[]; lote: Celula[]; loteDe: string | null; loteAte: Date | null;
  chamadas: number; estimativa: number | null; saturadas: Ponto[];
  iniciadaEm: Date | null; varridaEm: Date | null;
};

async function lerCidade(db: Executor, chave: string, travar = false): Promise<LinhaDaCidade | null> {
  const linhas = travar
    ? await db.$queryRaw<LinhaDaCidade[]>`SELECT * FROM "ProspeccaoCidade" WHERE cidade = ${chave} FOR UPDATE`
    : await db.$queryRaw<LinhaDaCidade[]>`SELECT * FROM "ProspeccaoCidade" WHERE cidade = ${chave}`;
  return linhas[0] || null;
}

const venceu = (d: Date | null) => !!d && Date.now() - new Date(d).getTime() > DIAS_DO_CACHE * 86400_000;

/**
 * Deixa a cidade pronta para o mapa: a caixa, a população, o OpenStreetMap e a
 * estimativa (1ª vez: alguns segundos). Varredura começada há mais de 30 dias
 * volta a "nova" — os pontos do Google dela já foram apagados. `null` = a
 * cidade não foi achada no mapa (sem caixa, não dá para varrer).
 */
export async function prepararCidade(nome: string): Promise<LinhaDaCidade | null> {
  await garantirEstrutura();
  const chave = nomeDaCidade(nome);
  if (!chave) return null;
  // Os termos do Google: o ponto do lugar só pode ficar 30 dias (o place_id fica, nas marcações).
  await prisma.$executeRaw`
    DELETE FROM "ProspeccaoLugar" WHERE origem = 'google' AND "vistoEm" < ${new Date(Date.now() - DIAS_DO_CACHE * 86400_000)}`;
  const linha = await lerCidade(prisma, chave);
  if (linha && !venceu(linha.iniciadaEm)) return linha;
  if (linha) {
    await prisma.$executeRaw`
      UPDATE "ProspeccaoCidade" SET estado = 'nova', motivo = NULL, detalhe = NULL, pendentes = '[]', lote = '[]',
        "loteDe" = NULL, "loteAte" = NULL, chamadas = 0, saturadas = '[]', "iniciadaEm" = NULL, "varridaEm" = NULL
      WHERE cidade = ${chave}`;
    return lerCidade(prisma, chave);
  }
  const achou = await caixaDaCidade(nome);
  if (!achou) return null;
  const osm = await lugaresDoOsm(achou.caixa);
  await salvarLugares(prisma, chave, osm);
  const estimativa = estimarChamadas(achou.caixa, achou.populacao, osm.length);
  await prisma.$executeRaw`
    INSERT INTO "ProspeccaoCidade" (cidade, nome, caixa, populacao, osm, estimativa)
    VALUES (${chave}, ${nome.trim().slice(0, 80)}, ${JSON.stringify(achou.caixa)}::jsonb, ${achou.populacao}, ${osm.length}, ${estimativa})
    ON CONFLICT (cidade) DO NOTHING`;
  return lerCidade(prisma, chave);
}

/** Grava os lugares. Do Google, SÓ o place_id, o ponto e a loja nossa que casou (paraGuardar). */
async function salvarLugares(db: Executor, chave: string, todos: LugarDoMapa[]): Promise<void> {
  // Os círculos do lote se sobrepõem: o mesmo lugar vem em mais de uma célula (e o ON CONFLICT não aceita repetido).
  const lugares = [...juntarLugares([], todos.map(paraGuardar)).values()];
  if (!lugares.length) return;
  const agora = new Date();
  const ou = (s: string | null | undefined) => (s ? s : null);
  await db.$executeRaw`
    INSERT INTO "ProspeccaoLugar" (cidade, id, nome, endereco, lat, lng, tipo, origem, telefone, "lojaId", "vistoEm")
    SELECT ${chave}, x.id, x.nome, x.endereco, x.lat, x.lng, x.tipo, x.origem, x.telefone, x.loja, ${agora}
    FROM unnest(
      ${lugares.map((l) => l.id)}::text[], ${lugares.map((l) => ou(l.nome))}::text[], ${lugares.map((l) => ou(l.endereco))}::text[],
      ${lugares.map((l) => l.lat)}::float8[], ${lugares.map((l) => l.lng)}::float8[], ${lugares.map((l) => ou(l.tipo))}::text[],
      ${lugares.map((l) => l.origem)}::text[], ${lugares.map((l) => ou(l.telefone))}::text[], ${lugares.map((l) => ou(l.lojaId))}::text[]
    ) AS x(id, nome, endereco, lat, lng, tipo, origem, telefone, loja)
    ON CONFLICT (cidade, id) DO UPDATE SET
      nome = EXCLUDED.nome, endereco = EXCLUDED.endereco, lat = EXCLUDED.lat, lng = EXCLUDED.lng, tipo = EXCLUDED.tipo,
      telefone = EXCLUDED.telefone, "lojaId" = COALESCE(EXCLUDED."lojaId", "ProspeccaoLugar"."lojaId"), "vistoEm" = EXCLUDED."vistoEm"`;
}

/**
 * O que os nomes do Google (que chegam na hora e NÃO são guardados) ensinam:
 * qual loja do FireHub é cada lugar e qual lugar do OpenStreetMap é o mesmo
 * do Google. Grava só os ids (dados nossos), nunca o nome.
 */
async function casarComNomes(db: Executor, chave: string, achados: LugarDoMapa[], lojas: LojaDoMapa[]): Promise<LugarDoMapa[]> {
  const comLoja = achados.map((l) => ({ ...l, lojaId: lojaDoLugar(l, lojas)?.id ?? null }));
  const osm = await db.$queryRaw<LugarDoMapa[]>`
    SELECT id, nome, endereco, lat, lng, origem FROM "ProspeccaoLugar"
    WHERE cidade = ${chave} AND origem = 'osm' AND "googleId" IS NULL`;
  if (osm.length) {
    const pares = parDoOsm(comLoja, osm);
    for (const [osmId, googleId] of pares) {
      await db.$executeRaw`UPDATE "ProspeccaoLugar" SET "googleId" = ${googleId} WHERE cidade = ${chave} AND id = ${osmId}`;
    }
  }
  return comLoja;
}

/** O par OSM → Google (pelo cruzarComOsm, um a um). */
function parDoOsm(google: LugarDoMapa[], osm: LugarDoMapa[]): Map<string, string> {
  const pares = new Map<string, string>();
  for (const o of osm) {
    const { tambemNoOsm } = cruzarComOsm(google, [o]);
    const g = [...tambemNoOsm][0];
    if (g) pares.set(o.id, g);
  }
  return pares;
}

/**
 * Os lugares da cidade para o mapa. Do Google: id, ponto, a loja nossa e o
 * nome do OpenStreetMap do mesmo lugar (se houver) — o nome do Google a tela
 * busca na hora. Do OpenStreetMap: só o que o Google não trouxe.
 */
export async function lugaresDaCidade(nome: string): Promise<LugarDoMapa[]> {
  await garantirEstrutura();
  const chave = nomeDaCidade(nome);
  const linhas = await prisma.$queryRaw<(LugarDoMapa & { googleId: string | null })[]>`
    SELECT id, nome, endereco, lat, lng, tipo, origem, telefone, "lojaId", "googleId" FROM "ProspeccaoLugar" WHERE cidade = ${chave}`;
  const nomeOsm = new Map<string, string>();
  const noOsm = new Set<string>();
  for (const l of linhas) {
    if (l.origem !== "osm" || !l.googleId) continue;
    noOsm.add(l.googleId);
    if (l.nome && l.nome !== "Sem nome") nomeOsm.set(l.googleId, l.nome);
  }
  const saida: LugarDoMapa[] = [];
  for (const l of linhas) {
    if (l.origem === "google") {
      saida.push({
        id: l.id, nome: "", endereco: "", lat: l.lat, lng: l.lng, tipo: null, mapsUrl: null, origem: "google",
        lojaId: l.lojaId, nomeOsm: nomeOsm.get(l.id) ?? null, tambemNoOsm: noOsm.has(l.id),
      });
    } else if (!l.googleId) {
      saida.push({ id: l.id, nome: l.nome || "Sem nome", endereco: l.endereco || "", lat: l.lat, lng: l.lng, tipo: l.tipo, mapsUrl: null, origem: "osm", telefone: l.telefone });
    }
  }
  return saida;
}

const quemSegura = (quem: QuemEsta) => quem.id || quem.tipo;

/** O que a tela mostra da varredura (o selo, a estimativa, quanto já foi, quando continua). */
export function resumoDaVarredura(l: LinhaDaCidade, uso: UsoDoGoogle, quem: QuemEsta | null, lugares: number): ResumoDaVarredura {
  const loteVivo = l.lote.length > 0 && !!l.loteAte && new Date(l.loteAte).getTime() > Date.now();
  // Varrendo sem ninguém segurando o lote = a tela de quem varria fechou.
  const parada = l.estado === "varrendo" && !loteVivo;
  const estado: EstadoDaVarredura = parada ? "pausada" : l.estado;
  const motivo: MotivoDaPausa = parada ? "interrompida" : l.motivo;
  const pendentes = l.pendentes.length + (parada ? l.lote.length : 0);
  const faltam = faltamEstimadas({ estado, chamadas: l.chamadas, estimativa: l.estimativa, pendentes });
  const v = vagasDaVarredura(uso);
  return {
    estado, motivo, detalhe: l.detalhe, chamadas: l.chamadas, estimativa: l.estimativa, pendentes,
    saturadas: l.saturadas,
    iniciadaEm: l.iniciadaEm ? new Date(l.iniciadaEm).toISOString() : null,
    varridaEm: l.varridaEm ? new Date(l.varridaEm).toISOString() : null,
    lugares, osm: l.osm, populacao: l.populacao,
    ocupadaPorOutro: loteVivo && (!quem || l.loteDe !== quemSegura(quem)),
    faltamEstimadas: faltam,
    percentual: percentualDaVarredura(l.chamadas, faltam, estado === "completa"),
    vagasAgora: v.qtd,
    // Sem vaga agora: volta amanhã (trava do dia) ou no dia 1º (grátis do mês).
    continuaEm: estado !== "completa" && v.qtd <= 0 ? quandoContinua(v.trava) : null,
  };
}

export async function resumoDaCidade(linha: LinhaDaCidade, quem: QuemEsta | null): Promise<ResumoDaVarredura> {
  const [uso, total] = await Promise.all([
    usoDoGoogle(),
    prisma.$queryRaw<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM "ProspeccaoLugar" WHERE cidade = ${linha.cidade} AND origem = 'google'`,
  ]);
  return resumoDaVarredura(linha, uso, quem, Number(total[0]?.n || 0));
}

export type CelulaParaBuscar = Celula & { centro: Ponto; raio: number; tiposDaBusca: string[]; maximo: number };

export type PedidoDaVarredura = {
  cidade: string;
  /** Começar (cidade nova) ou continuar (pausada). Qualquer um da equipe. */
  continuar?: boolean;
  /** Só o admin: varrer de novo uma cidade já varrida (dentro do grátis, como sempre). */
  refazer?: boolean;
  /**
   * As células do lote que voltaram: quantos lugares vieram (bruto, com os
   * fechados) e os lugares. O nome que vem junto serve SÓ para casar com as
   * lojas e o OpenStreetMap na hora; não é guardado.
   */
  resultados?: { celulaId: string; bruto: number; lugares: unknown[] }[];
  /** O Google recusou (trava do dia, chave): as células que faltaram voltam para a fila. */
  erro?: string;
  /** A pessoa tocou em Pausar: guarda o lote e não entrega outro. */
  pausar?: boolean;
};

export type RespostaDaVarredura = {
  resumo: ResumoDaVarredura;
  lote: CelulaParaBuscar[];
  uso: UsoDoGoogle;
  aviso?: string;
};

const ID_DO_LUGAR = /^[A-Za-z0-9_-]{10,300}$/;

/** O lugar que a tela mandou, conferido (só Google: o OSM é o servidor que busca). O nome vem só para casar. */
function lugarValido(l: any): LugarDoMapa | null {
  if (!l || typeof l.id !== "string" || !ID_DO_LUGAR.test(l.id) || l.id.startsWith("osm-")) return null;
  const lat = Number(l.lat), lng = Number(l.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { id: l.id, nome: String(l.nome || "").slice(0, 200), endereco: "", lat, lng, tipo: null, mapsUrl: null, origem: "google" };
}

/** As lojas do FireHub da cidade, guardadas 10 min em memória (o passo da varredura roda a cada poucos segundos). */
const lojasEmMemoria = new Map<string, { lojas: LojaDoMapa[]; em: number }>();
async function lojasDaCidade(chave: string, caixa: CaixaDaCidade): Promise<LojaDoMapa[]> {
  const g = lojasEmMemoria.get(chave);
  if (g && Date.now() - g.em < 600_000) return g.lojas;
  const lojas = await lojasDoMapa(chave, caixa);
  lojasEmMemoria.set(chave, { lojas, em: Date.now() });
  return lojas;
}

type Saida = { linha: LinhaDaCidade; lote: Celula[]; aviso?: string };

/**
 * Um passo da varredura: guarda o que o lote trouxe, divide as células cheias
 * e entrega o próximo lote — dentro do que o dia e o mês deixam (CUSTO ZERO).
 * Sem vaga, pausa com a fila guardada e volta amanhã ou no dia 1º. Uma
 * pessoa por vez segura o lote da cidade. `lojas` só nos testes e na prévia.
 */
export async function passoDaVarredura(quem: QuemEsta, pedido: PedidoDaVarredura, lojasDadas?: LojaDoMapa[]): Promise<RespostaDaVarredura> {
  const preparada = await prepararCidade(pedido.cidade);
  if (!preparada) throw new Error("Não achei essa cidade no mapa. Escreva como \"Cidade - UF\".");
  const chave = preparada.cidade;
  const eu = quemSegura(quem);
  const admin = quem.tipo === "ADMIN";
  const lojas = lojasDadas ?? (pedido.resultados?.length ? await lojasDaCidade(chave, preparada.caixa) : []);

  const saida = await prisma.$transaction(async (tx): Promise<Saida> => {
    const l = (await lerCidade(tx, chave, true))!;
    const agora = new Date();
    let { pendentes, lote, saturadas, chamadas, estado, motivo, detalhe, iniciadaEm, varridaEm, estimativa } = l;
    const loteVivo = lote.length > 0 && !!l.loteAte && new Date(l.loteAte).getTime() > agora.getTime();

    // 1. O que o lote trouxe (só de quem segura o lote).
    if ((pedido.resultados || pedido.erro) && l.loteDe === eu && lote.length) {
      const doLote = new Set(lote.map((c) => c.id));
      const respostas: RespostaDaCelula[] = [];
      const achados: LugarDoMapa[] = [];
      for (const r of pedido.resultados || []) {
        if (!doLote.has(r?.celulaId)) continue;
        respostas.push({ celulaId: r.celulaId, bruto: Math.max(0, Math.min(MAXIMO_POR_CHAMADA, Math.floor(Number(r.bruto) || 0))) });
        for (const x of (Array.isArray(r.lugares) ? r.lugares : []).slice(0, MAXIMO_POR_CHAMADA)) {
          const v = lugarValido(x);
          if (v) achados.push(v);
        }
      }
      await salvarLugares(tx, chave, await casarComNomes(tx, chave, achados, lojas));
      const r = aplicarRespostas(pendentes, lote, respostas);
      // A célula que não voltou (o Google recusou) não foi cobrada: devolve ao dia.
      const naoVoltaram = lote.length - r.respondidas;
      if (naoVoltaram) { await somarHoje(tx, "nearby", -naoVoltaram); chamadas -= naoVoltaram; }
      pendentes = r.pendentes;
      saturadas = [...saturadas, ...r.saturadas.map((c) => circuloDaCelula(c).centro)];
      lote = [];
      if (pedido.erro) { estado = "pausada"; motivo = "google"; detalhe = String(pedido.erro).slice(0, 160); }
    } else if (loteVivo && l.loteDe !== eu) {
      return { linha: l, lote: [], aviso: "Outra pessoa da equipe está varrendo esta cidade agora. Os lugares aparecem conforme ela avança." };
    } else if (lote.length) {
      // Lote abandonado (a tela fechou): volta para a fila; a chamada pode ter sido feita, fica contada.
      pendentes = [...lote, ...pendentes];
      lote = [];
    }

    // 2. Começar, continuar, refazer. `parar` = não entrega lote agora (mas grava o que mudou acima).
    const uso = await usoDoGoogle(tx);
    const vaga = vagasDaVarredura(uso);
    let parar: { aviso?: string } | null = null;
    const refazer = !!pedido.refazer && admin && estado !== "varrendo";
    if (pedido.refazer && !admin) parar = { aviso: "Só o administrador atualiza uma cidade já varrida." };
    else if (pedido.pausar) parar = {};
    if (parar || (estado === "completa" && !refazer)) {
      parar = parar || {};
    } else if (estado === "nova" || refazer) {
      if (!pedido.continuar && !refazer) parar = {};
      else {
        pendentes = celulasRaiz(l.caixa);
        saturadas = [];
        chamadas = 0;
        iniciadaEm = agora;
        varridaEm = null;
        estado = "varrendo";
        motivo = null; detalhe = null;
      }
    } else if (estado === "pausada" || (estado === "varrendo" && !pedido.resultados)) {
      if (!pedido.continuar) parar = {};
      else { estado = "varrendo"; motivo = null; detalhe = null; }
    }

    // 3. O próximo lote, dentro do que sobra hoje e no mês (e do limite contra laço).
    let novo: Celula[] = [];
    if (!parar && estado === "varrendo") {
      const escolha = escolherLote(pendentes, Math.min(vaga.qtd, TETO_DE_CHAMADAS_POR_CIDADE - chamadas));
      novo = escolha.lote;
      pendentes = escolha.pendentes;
      if (!novo.length && pendentes.length) {
        // Sem vaga: pausa com a fila guardada; volta amanhã (dia) ou no dia 1º (mês).
        estado = "pausada";
        motivo = TETO_DE_CHAMADAS_POR_CIDADE - chamadas <= 0 ? "teto_da_cidade" : vaga.trava === "mes" ? "gratis_do_mes" : "trava_do_dia";
      } else if (!novo.length) {
        estado = "completa";
        varridaEm = agora;
        // A próxima estimativa (atualizar a cidade) é o que esta gastou de verdade.
        estimativa = chamadas;
        // O que o Google não trouxe nesta varredura fechou ou mudou: sai do cache.
        if (iniciadaEm) await tx.$executeRaw`DELETE FROM "ProspeccaoLugar" WHERE cidade = ${chave} AND origem = 'google' AND "vistoEm" < ${iniciadaEm}`;
      }
      if (novo.length) { await somarHoje(tx, "nearby", novo.length); chamadas += novo.length; }
    } else if (estado === "varrendo") {
      // Parou sem lote na mão: fica "pausada" para quem abrir depois ver o porquê.
      estado = "pausada";
      motivo = motivo || "interrompida";
    }

    await tx.$executeRaw`
      UPDATE "ProspeccaoCidade" SET
        estado = ${estado}, motivo = ${motivo}, detalhe = ${detalhe},
        pendentes = ${JSON.stringify(pendentes)}::jsonb, lote = ${JSON.stringify(novo)}::jsonb,
        "loteDe" = ${novo.length ? eu : null}, "loteAte" = ${novo.length ? new Date(agora.getTime() + SEGUNDOS_DO_LOTE * 1000) : null},
        chamadas = ${chamadas}, saturadas = ${JSON.stringify(saturadas)}::jsonb,
        "iniciadaEm" = ${iniciadaEm}, "varridaEm" = ${varridaEm}, estimativa = ${estimativa}
      WHERE cidade = ${chave}`;
    return { linha: (await lerCidade(tx, chave))!, lote: novo, ...(parar || {}) };
  }, { timeout: 20_000 });

  return {
    resumo: await resumoDaCidade(saida.linha, quem),
    lote: saida.lote.map(paraBuscar),
    uso: await usoDoGoogle(),
    aviso: saida.aviso,
  };
}

function paraBuscar(c: Celula): CelulaParaBuscar {
  const { centro, raio } = circuloDaCelula(c);
  return { ...c, centro, raio, tiposDaBusca: c.tipos || [...TIPOS_DE_COMIDA], maximo: MAXIMO_POR_CHAMADA };
}

/**
 * "Buscar também" e os nomes por perto: os lugares novos entram no cache da
 * cidade (só id + ponto), para a equipe toda. O nome serve só para casar.
 */
export async function guardarLugaresAvulsos(cidade: string, lugares: unknown[], lojasDadas?: LojaDoMapa[]): Promise<number> {
  await garantirEstrutura();
  const chave = nomeDaCidade(cidade);
  const linha = chave ? await lerCidade(prisma, chave) : null;
  if (!linha) return 0;
  const validos = lugares.slice(0, 60).map(lugarValido).filter((l): l is LugarDoMapa => !!l);
  const lojas = lojasDadas ?? (await lojasDaCidade(chave, linha.caixa));
  await salvarLugares(prisma, chave, await casarComNomes(prisma, chave, validos, lojas));
  return validos.length;
}
