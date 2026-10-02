/**
 * scripts/teste-feed-so-o-que-mudou.ts — o "só o que mudou" do feed do painel
 * (/api/customer-order/poll + lib/feed-de-pedidos.ts) devolve a MESMA lista
 * que a resposta completa?
 *
 * Só LÊ o banco. Usa o filtro, a busca de "quem mudou" e a remontagem de
 * verdade (lib/filtro-do-feed.ts, lib/feed-de-pedidos.ts) — não cópias.
 *
 *   npx tsx scripts/teste-feed-so-o-que-mudou.ts            (com DATABASE_URL)
 *
 * Duas provas, nas lojas com mais movimento recente:
 *   1. DECOMPOSIÇÃO (vale até sem movimento): para desde = agora − 2, 10 e 60
 *      min, (lista completa sem os atualizados depois de desde) + delta,
 *      remontada, tem que ser igual à lista completa; e nenhum "removido" pode
 *      estar na lista completa.
 *   2. AO VIVO: lista completa L0 (com o `agora` anotado antes), espera, delta
 *      desde agora0 − 30 s remontado sobre L0, comparado com a completa L1.
 */
import { prisma } from "../src/lib/prisma";
import { DIAS_ATIVO_SEM_PERIODO, filtroDoFeed, idsQueMudaram, soOQueMudou } from "../src/lib/filtro-do-feed";
import { remontarLista } from "../src/lib/feed-de-pedidos";

const SELECT = {
  id: true, status: true, createdAt: true, updatedAt: true, totalAmount: true, printedAt: true, motoboyId: true,
  items: { select: { id: true, quantity: true, price: true, notes: true, productName: true } },
} as const;

type Janela = { lojas: string[]; from: Date; to: Date };

function parametros(j: Janela) {
  const ATIVO_SEM_PERIODO_DESDE = new Date(Date.now() - DIAS_ATIVO_SEM_PERIODO * 24 * 60 * 60 * 1000);
  return { validFranchiseeIds: j.lojas, from: j.from, to: j.to, ATIVO_SEM_PERIODO_DESDE };
}

/** O que a rota faz SEM `desde`. Objetos passam por JSON, como no navegador. */
async function completa(j: Janela) {
  const p = parametros(j);
  const rows = await prisma.customerOrder.findMany({ where: filtroDoFeed(p), select: SELECT, orderBy: { createdAt: "desc" }, take: 200 });
  return JSON.parse(JSON.stringify(rows)) as any[];
}

/** O que a rota faz COM `desde`: { pedidos, removidos } ou null (mudança em massa → completa). */
async function soMudancas(j: Janela, desde: Date) {
  const p = parametros(j);
  const mudados = await idsQueMudaram(prisma, { ...p, desde });
  if (mudados === null) return null;
  const rows = await prisma.customerOrder.findMany({ where: soOQueMudou(filtroDoFeed(p), desde), select: SELECT, orderBy: { createdAt: "desc" }, take: 200 });
  const pedidos = JSON.parse(JSON.stringify(rows)) as any[];
  const voltaram = new Set(pedidos.map((o) => o.id));
  return { pedidos, removidos: mudados.filter((id) => !voltaram.has(id)) };
}

function chave(o: any) {
  const itens = [...(o.items || [])].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return JSON.stringify({ ...o, items: itens });
}

function comparar(nome: string, esperado: any[], obtido: any[]): string[] {
  const erros: string[] = [];
  const ide = esperado.map((o) => o.id).join(","), ido = obtido.map((o) => o.id).join(",");
  if (ide !== ido) {
    const se = new Set(esperado.map((o) => o.id)), so = new Set(obtido.map((o) => o.id));
    const faltam = [...se].filter((x) => !so.has(x)), sobram = [...so].filter((x) => !se.has(x));
    if (faltam.length || sobram.length) erros.push(`${nome}: ids diferentes — faltam ${faltam.length} ${faltam.slice(0, 3)}, sobram ${sobram.length} ${sobram.slice(0, 3)}`);
    else erros.push(`${nome}: mesma lista, ORDEM diferente`);
  }
  const porId = new Map(obtido.map((o) => [o.id, o]));
  for (const o of esperado) {
    const x = porId.get(o.id);
    if (x && chave(x) !== chave(o)) erros.push(`${nome}: conteúdo diferente no pedido ${o.id} (status ${o.status} vs ${x.status}, updatedAt ${o.updatedAt} vs ${x.updatedAt})`);
  }
  return erros;
}

async function lojasComMovimento(n: number): Promise<string[]> {
  const desde = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const g = await prisma.customerOrder.groupBy({
    by: ["franchiseeId"], where: { updatedAt: { gte: desde } },
    _count: { _all: true }, orderBy: { _count: { franchiseeId: "desc" } }, take: n,
  });
  return g.map((x) => x.franchiseeId);
}

async function main() {
  const lojas = await lojasComMovimento(4);
  console.log("lojas testadas:", lojas.length, lojas);
  // O "dia" da loja como a tela de pedidos manda (from/to em ISO) e o padrão
  // do ouvinte de impressão (últimas 24 h).
  const hoje0 = new Date(); hoje0.setHours(0, 0, 0, 0);
  const hoje1 = new Date(); hoje1.setHours(23, 59, 59, 999);
  const janelas = (loja: string): Array<[string, Janela]> => [
    ["tela de pedidos (hoje)", { lojas: [loja], from: hoje0, to: hoje1 }],
    ["ouvinte de impressão (24 h)", { lojas: [loja], from: new Date(Date.now() - 24 * 3600e3), to: new Date(Date.now() + 24 * 3600e3) }],
  ];

  let falhas = 0, provas = 0;

  // 1. DECOMPOSIÇÃO
  for (const loja of lojas) {
    for (const [nome, j] of janelas(loja)) {
      for (const min of [2, 10, 60]) {
        const desde = new Date(Date.now() - min * 60e3);
        const full = await completa(j);
        const delta = await soMudancas(j, desde);
        provas++;
        if (!delta) { console.log(`  [${loja.slice(-6)}] ${nome} desde −${min}min: mudança em massa → completa (ok)`); continue; }
        const base = new Map(full.filter((o) => new Date(o.updatedAt) < desde).map((o) => [o.id, o]));
        const remontada = remontarLista(base, delta.pedidos, delta.removidos);
        const erros = comparar(`${loja.slice(-6)} ${nome} −${min}min`, full, remontada);
        const removidoValido = delta.removidos.filter((id) => full.some((o) => o.id === id));
        if (removidoValido.length) erros.push(`removido que ainda está na lista: ${removidoValido}`);
        if (erros.length) { falhas++; erros.forEach((e) => console.log("  ✗", e)); }
        else console.log(`  ✓ [${loja.slice(-6)}] ${nome} desde −${min}min: ${full.length} pedidos, ${delta.pedidos.length} mudaram, ${delta.removidos.length} saíram`);
      }
    }
  }

  // 2. AO VIVO
  const espera = Number(process.env.ESPERA_S || 90);
  const L0: Record<string, { agora: Date; lista: any[] }> = {};
  for (const loja of lojas) for (const [nome, j] of janelas(loja)) {
    const agora = new Date();
    L0[loja + nome] = { agora, lista: await completa(j) };
  }
  console.log(`\nao vivo: esperando ${espera} s…`);
  await new Promise((r) => setTimeout(r, espera * 1000));
  for (const loja of lojas) for (const [nome, j] of janelas(loja)) {
    const { agora, lista } = L0[loja + nome];
    const delta = await soMudancas(j, new Date(agora.getTime() - 30_000));
    const L1 = await completa(j);
    provas++;
    if (!delta) { console.log(`  [${loja.slice(-6)}] ${nome}: mudança em massa → completa (ok)`); continue; }
    const remontada = remontarLista(new Map(lista.map((o) => [o.id, o])), delta.pedidos, delta.removidos);
    const erros = comparar(`${loja.slice(-6)} ${nome} ao vivo`, L1, remontada);
    if (erros.length) {
      // Corrida: algo gravado entre o delta e a completa L1 — a rodada seguinte pega.
      const tardios = L1.filter((o) => new Date(o.updatedAt).getTime() > Date.now() - 5000).length;
      falhas++; erros.forEach((e) => console.log("  ✗", e, tardios ? `(${tardios} gravado(s) nos últimos 5 s — possível corrida)` : ""));
    } else console.log(`  ✓ [${loja.slice(-6)}] ${nome} ao vivo: ${L1.length} pedidos, ${delta.pedidos.length} mudaram, ${delta.removidos.length} saíram`);
  }

  console.log(`\n${provas - falhas}/${provas} provas iguais${falhas ? ` — ${falhas} DIFERENTE(S)` : ""}`);
  await prisma.$disconnect();
  process.exit(falhas ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(2); });
