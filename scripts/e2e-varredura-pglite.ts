/**
 * A varredura no SERVIDOR (lib/prospeccao/dados.ts, o SQL de verdade) contra o
 * PGlite local, com o Google, o Nominatim e o Overpass falsos — nada sai para
 * a rede e nada encosta no banco de produção.
 *
 *   cd C:\Users\Micro\crm-teste && npx pglite-server --db=./dados-cobertura --port=5451 --max-connections=10
 *   DATABASE_URL=<o PGlite: usuário/senha padrão dele, 127.0.0.1:5451/postgres?sslmode=disable&connection_limit=1&pgbouncer=true> npx tsx scripts/e2e-varredura-pglite.ts
 *
 * Confere: custo zero (teto do dia e do mês, sem caminho para pagar), a
 * retomada amanhã e no dia 1º, e que NADA do conteúdo do Google (nome,
 * endereço, tipo) vai para o banco — só place_id, ponto e a loja nossa.
 * As tabelas da prospecção são criadas no 1º uso (garantirEstrutura); não precisa de prisma db push.
 */
import assert from "node:assert/strict";
import { cidadeFalsa, nearbyFalso } from "./cidade-falsa";

if (!/127\.0\.0\.1:5451/.test(process.env.DATABASE_URL || "")) throw new Error("DATABASE_URL não é o PGlite local (127.0.0.1:5451)");

const RIO = { sul: -22.5624592, norte: -22.3767508, oeste: -42.0635168, leste: -41.8177902 };

// A rede falsa: Nominatim devolve Rio das Ostras; Overpass, 2 lugares (um que o Google também tem).
globalThis.fetch = (async (url: any) => {
  const u = String(url);
  if (u.includes("nominatim")) {
    return new Response(JSON.stringify([{ addresstype: "city", class: "boundary", boundingbox: [RIO.sul, RIO.norte, RIO.oeste, RIO.leste].map(String), extratags: { population: "156491" } }]));
  }
  if (u.includes("overpass")) {
    return new Response(JSON.stringify({ elements: [
      { type: "node", id: 9001, lat: -22.40, lon: -41.85, tags: { amenity: "restaurant", name: "Quiosque Só no OSM", phone: "(22) 99999-1234" } },
      { type: "node", id: 9002, lat: -22.45, lon: -41.88, tags: { amenity: "bar", name: "Bar Duplicado" } },
    ] }));
  }
  throw new Error(`rede falsa: ${u}`);
}) as typeof fetch;

async function main() {
  const { prisma } = await import("../src/lib/prisma");
  const d = await import("../src/lib/prospeccao/dados");
  const { MAXIMO_POR_CHAMADA, VARREDURA_POR_DIA, quandoContinua } = await import("../src/lib/prospeccao/varredura");
  const vendedor = { tipo: "VENDEDOR" as const, id: "vend-1", nome: "Vendedor Teste" };
  const outro = { tipo: "VENDEDOR" as const, id: "vend-2", nome: "Outro" };
  const admin = { tipo: "ADMIN" as const, id: "adm-1", nome: "Douglas" };
  const CIDADE = "Rio das Ostras - RJ";

  // O Neon roda em UTC; o PGlite pega o fuso do Windows (-03) e desloca as datas cruas em 3 h.
  await prisma.$executeRawUnsafe(`SET TIME ZONE 'UTC'`);
  // Começa do zero (o banco é descartável).
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "ProspeccaoCidade", "ProspeccaoLugar", "ProspeccaoUsoDia", "ProspeccaoUsoMes", "ProspeccaoMarcacao"`);

  const cidade = cidadeFalsa({ centro: { lat: -22.5175, lng: -41.9455 }, total: 600 });
  cidade.push({ id: "ChIJduplicado1", nome: "Bar Duplicado", endereco: "Rua do Bar, 1", lat: -22.45005, lng: -41.88003, tipos: ["bar"], popularidade: 1 });
  cidade[120].nome = "Pizzaria Forno do Gonzaga";
  const lojas = [{ id: "loja1", nome: "Pizzaria Forno do Gonzaga", lat: cidade[120].lat, lng: cidade[120].lng, endereco: null, slug: "l1", semCardapio: false, vendedor: null }];
  // O navegador manda o que o Google trouxe — COM nome e endereço (é o que o Google devolve).
  const google = (r: Awaited<ReturnType<typeof d.passoDaVarredura>>) => r.lote.map((c) => {
    const veio = nearbyFalso(cidade, { centro: c.centro, raio: c.raio, tipos: c.tiposDaBusca, maximo: c.maximo });
    return {
      celulaId: c.id, bruto: veio.length,
      lugares: veio.filter((l) => !l.fechado).map((l) => ({ id: l.id, nome: l.nome, endereco: l.endereco, lat: l.lat, lng: l.lng, tipo: l.tipos[0], mapsUrl: "https://maps.google.com/?q=x", origem: "google" })),
    };
  });
  type Pedido = Omit<Parameters<typeof d.passoDaVarredura>[1], "cidade">;
  const passo = (q: typeof vendedor | typeof admin, p: Pedido) => d.passoDaVarredura(q, { cidade: CIDADE, ...p }, lojas);
  /** "Vira o dia": o uso de hoje passa para um dia anterior do mesmo mês ("AAAA-MM-00"). */
  const virarODia = async () => {
    const u = await d.usoDoGoogle();
    await prisma.$executeRawUnsafe(`
      INSERT INTO "ProspeccaoUsoDia" (dia, sku, qtd) SELECT '${u.mes}-00', sku, qtd FROM "ProspeccaoUsoDia" WHERE dia = '${u.dia}'
      ON CONFLICT (dia, sku) DO UPDATE SET qtd = "ProspeccaoUsoDia".qtd + EXCLUDED.qtd`);
    await prisma.$executeRawUnsafe(`DELETE FROM "ProspeccaoUsoDia" WHERE dia = '${u.dia}'`);
  };

  // 1. Abrir a cidade: prepara (caixa, população, OSM, estimativa), não gasta nada.
  const linha = await d.prepararCidade(CIDADE);
  assert.ok(linha);
  const resumo = await d.resumoDaCidade(linha!, vendedor);
  assert.equal(resumo.estado, "nova");
  assert.equal(resumo.estimativa, 20 + Math.ceil(1043 * 0.35));
  assert.equal(resumo.osm, 2);
  assert.equal((await d.usoDoGoogle()).noMes.nearby, 0);

  // 2. Sem "continuar", nada começa.
  let r = await passo(vendedor, {});
  assert.equal(r.lote.length, 0);
  assert.equal(r.resumo.estado, "nova");

  // 3. O vendedor começa: lote de 8, contado no dia.
  r = await passo(vendedor, { continuar: true });
  assert.equal(r.lote.length, 8);
  assert.equal(r.uso.hoje.nearby, 8);
  assert.equal(r.resumo.estado, "varrendo");

  // 4. Outra pessoa abre no meio: não pega lote, vê o aviso.
  const r2 = await d.passoDaVarredura(outro, { cidade: CIDADE, continuar: true }, lojas);
  assert.equal(r2.lote.length, 0);
  assert.match(r2.aviso || "", /Outra pessoa/);
  assert.equal(r2.resumo.ocupadaPorOutro, true);

  // 5. Erro do Google numa volta: o que voltou fica, o que não voltou é devolvido ao dia, pausa.
  r = await passo(vendedor, { resultados: google(r).slice(0, 5), erro: "RESOURCE_EXHAUSTED" });
  assert.equal(r.resumo.estado, "pausada");
  assert.equal(r.resumo.motivo, "google");
  assert.equal(r.uso.hoje.nearby, 5);

  // 6. Continua: para na velocidade do dia (115), com a fila guardada e "continua amanhã".
  r = await passo(vendedor, { continuar: true });
  let voltas = 0;
  while (r.lote.length) { r = await passo(vendedor, { resultados: google(r) }); voltas++; }
  assert.equal(r.resumo.estado, "pausada");
  assert.equal(r.resumo.motivo, "trava_do_dia");
  assert.equal(r.uso.hoje.nearby, VARREDURA_POR_DIA);
  assert.ok(r.resumo.pendentes > 0);
  assert.equal(r.resumo.vagasAgora, 0);
  assert.equal(r.resumo.continuaEm, quandoContinua("dia"));
  assert.ok(r.resumo.percentual > 0 && r.resumo.percentual < 100);
  // Sem vaga, "continuar" não entrega lote (nada passa do dia).
  r = await passo(vendedor, { continuar: true });
  assert.equal(r.lote.length, 0);
  assert.equal(r.uso.hoje.nearby, VARREDURA_POR_DIA);

  // 7. Vira o dia: continua da fila guardada até o fim.
  await virarODia();
  r = await passo(vendedor, { continuar: true });
  assert.ok(r.lote.length > 0);
  while (r.lote.length) { r = await passo(vendedor, { resultados: google(r) }); voltas++; }
  assert.equal(r.resumo.estado, "completa");
  assert.equal(r.resumo.saturadas.length, 0);
  const abertos = cidade.filter((l) => !l.fechado && l.lat >= RIO.sul && l.lat <= RIO.norte && l.lng >= RIO.oeste && l.lng <= RIO.leste);
  assert.equal(r.resumo.lugares, abertos.length);
  const gastas = r.resumo.chamadas;
  assert.equal(r.uso.noMes.nearby, gastas);
  assert.equal(r.resumo.estimativa, gastas);

  // 8. TERMOS DO GOOGLE: nenhum nome, endereço, tipo ou link do Google no banco.
  const conteudo = await prisma.$queryRawUnsafe<{ n: number }[]>(`
    SELECT COUNT(*)::int AS n FROM "ProspeccaoLugar"
    WHERE origem = 'google' AND (nome IS NOT NULL OR endereco IS NOT NULL OR tipo IS NOT NULL OR telefone IS NOT NULL)`);
  assert.equal(conteudo[0].n, 0, "conteúdo do Google no banco");
  const colunas = await prisma.$queryRawUnsafe<{ column_name: string }[]>(`SELECT column_name FROM information_schema.columns WHERE table_name = 'ProspeccaoLugar'`);
  assert.ok(!colunas.some((c) => c.column_name === "mapsUrl"), "não há coluna para o link do Google");
  const amostra = abertos.slice(0, 50).map((x) => x.nome.replace(/'/g, "''"));
  const nomesNoBanco = await prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT COUNT(*)::int AS n FROM "ProspeccaoLugar" WHERE nome IN ('${amostra.join("','")}')`);
  assert.equal(nomesNoBanco[0].n, 0, "nome do Google gravado em alguma linha");
  const cidadeNoBanco = await prisma.$queryRawUnsafe<{ t: string }[]>(`SELECT row_to_json(c)::text AS t FROM "ProspeccaoCidade" c`);
  assert.ok(!cidadeNoBanco.some((c) => abertos.slice(0, 50).some((x) => c.t.includes(x.nome))), "nome do Google na linha da cidade");

  // 9. O que os nomes ensinaram fica como id: a loja casada e o OSM duplicado.
  const lugares = await d.lugaresDaCidade("rio das ostras");
  const daLoja = lugares.find((l) => l.id === cidade[120].id);
  assert.equal(daLoja?.lojaId, "loja1");
  assert.equal(daLoja?.nome, "");
  const dup = lugares.find((l) => l.id === "ChIJduplicado1");
  assert.equal(dup?.nome, "");
  assert.equal(dup?.nomeOsm, "Bar Duplicado"); // nome do OpenStreetMap (ODbL), não do Google
  assert.equal(dup?.tambemNoOsm, true);
  assert.deepEqual(lugares.filter((l) => l.origem === "osm").map((l) => l.id), ["osm-node-9001"]);
  assert.equal(lugares.find((l) => l.id === "osm-node-9001")?.telefone, "(22) 99999-1234");

  // 10. Vendedor não atualiza a cidade; varrida, nada mais é gasto.
  r = await passo(vendedor, { refazer: true });
  assert.match(r.aviso || "", /Só o administrador/);
  assert.equal(r.resumo.estado, "completa");

  // 11. Grátis do mês no fim: o admin atualiza, a varredura para no teto do mês e diz "continua em 01/MM".
  await virarODia();
  await prisma.$executeRawUnsafe(`UPDATE "ProspeccaoUsoDia" SET qtd = 4880 WHERE sku = 'nearby'`);
  r = await passo(admin, { refazer: true });
  while (r.lote.length) r = await passo(admin, { resultados: google(r) });
  assert.equal(r.resumo.estado, "pausada");
  assert.equal(r.resumo.motivo, "gratis_do_mes");
  assert.equal(r.uso.noMes.nearby, 4900);
  assert.equal(r.resumo.continuaEm, quandoContinua("mes"));
  // Nem o admin passa: "continuar" não entrega nada.
  r = await passo(admin, { continuar: true });
  assert.equal(r.lote.length, 0);
  assert.equal(r.uso.noMes.nearby, 4900);
  // Os pontos de antes continuam no mapa durante a pausa.
  assert.ok((await d.lugaresDaCidade("rio das ostras")).filter((l) => l.origem === "google").length >= abertos.length);

  // 12. Mês novo (o uso do mês some): continua da fila guardada e termina (em até 2 dias).
  await prisma.$executeRawUnsafe(`DELETE FROM "ProspeccaoUsoDia"`);
  for (let dia = 0; dia < 3 && r.resumo.estado !== "completa"; dia++) {
    if (dia) await virarODia();
    r = await passo(admin, { continuar: true });
    while (r.lote.length) r = await passo(admin, { resultados: google(r) });
  }
  assert.equal(r.resumo.estado, "completa");

  // 13. Pausar no meio: guarda o lote e não entrega outro.
  await prisma.$executeRawUnsafe(`DELETE FROM "ProspeccaoUsoDia"`);
  r = await passo(admin, { refazer: true });
  const reservadas = r.uso.hoje.nearby;
  r = await passo(admin, { resultados: r.lote.map((c) => ({ celulaId: c.id, bruto: MAXIMO_POR_CHAMADA, lugares: [] })), pausar: true });
  assert.equal(r.lote.length, 0);
  assert.equal(r.resumo.estado, "pausada");
  assert.equal(r.resumo.motivo, "interrompida");
  assert.equal(r.uso.hoje.nearby, reservadas);

  // 14. Reservas por SKU: o nome (Pro) e o telefone (Enterprise) dividem a trava do GetPlace; o mês manda no fim.
  await prisma.$executeRawUnsafe(`DELETE FROM "ProspeccaoUsoDia"`);
  const u = await d.usoDoGoogle();
  await prisma.$executeRawUnsafe(`INSERT INTO "ProspeccaoUsoDia" (dia, sku, qtd) VALUES ('${u.dia}', 'contato', 25), ('${u.dia}', 'detalhes', 6)`);
  let rv = await d.reservar("contato", 1);
  assert.equal(rv.ok, false);
  assert.equal(rv.trava, "dia");
  assert.equal((await d.reservar("detalhes", 1)).ok, false);
  await prisma.$executeRawUnsafe(`DELETE FROM "ProspeccaoUsoDia"`);
  await prisma.$executeRawUnsafe(`INSERT INTO "ProspeccaoUsoDia" (dia, sku, qtd) VALUES ('${u.mes}-00', 'contato', 980)`);
  rv = await d.reservar("contato", 1);
  assert.equal(rv.ok, false);
  assert.equal(rv.trava, "mes");
  assert.equal((await d.reservar("nearby", 1)).ok, true); // os nomes por perto
  assert.equal((await d.reservar("texto", 1)).ok, true);
  assert.equal((await d.reservar("mapa", 1)).ok, true);

  // 15. "Buscar também" / nomes por perto: lugar novo entra só como id + ponto.
  await d.guardarLugaresAvulsos(CIDADE, [{ id: "ChIJnovoLugar1", nome: "Marmitaria da Ana", endereco: "Rua X, 1", lat: -22.51, lng: -41.94 }], lojas);
  const novo = await prisma.$queryRawUnsafe<{ nome: string | null; endereco: string | null }[]>(`SELECT nome, endereco FROM "ProspeccaoLugar" WHERE id = 'ChIJnovoLugar1'`);
  assert.deepEqual(novo, [{ nome: null, endereco: null }]);

  // 16. Termos do Google: o ponto com mais de 30 dias sai do cache.
  await prisma.$executeRawUnsafe(`UPDATE "ProspeccaoLugar" SET "vistoEm" = now() - interval '31 days' WHERE id = 'ChIJduplicado1'`);
  await d.prepararCidade(CIDADE);
  assert.equal((await d.lugaresDaCidade("rio das ostras")).some((l) => l.id === "ChIJduplicado1"), false);

  await prisma.$disconnect();
  console.log(`✅ e2e-varredura-pglite: ok (${abertos.length} lugares, ${gastas} buscas em 2 dias a ${VARREDURA_POR_DIA}/dia, ${voltas} voltas)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
