/**
 * A varredura no SERVIDOR (lib/prospeccao/dados.ts, o SQL de verdade) contra o
 * PGlite local, com o Google, o Nominatim e o Overpass falsos — nada sai para
 * a rede e nada encosta no banco de produção.
 *
 *   cd C:\Users\Micro\crm-teste && npx pglite-server --db=./dados-cobertura --port=5451 --max-connections=10
 *   DATABASE_URL=<o PGlite: usuário/senha padrão dele, 127.0.0.1:5451/postgres?sslmode=disable&connection_limit=1&pgbouncer=true> npx tsx scripts/e2e-varredura-pglite.ts
 *
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
  const { MAXIMO_POR_CHAMADA } = await import("../src/lib/prospeccao/varredura");
  const vendedor = { tipo: "VENDEDOR" as const, id: "vend-1", nome: "Vendedor Teste" };
  const outro = { tipo: "VENDEDOR" as const, id: "vend-2", nome: "Outro" };
  const admin = { tipo: "ADMIN" as const, id: "adm-1", nome: "Douglas" };

  // O Neon roda em UTC; o PGlite pega o fuso do Windows (-03) e desloca as datas cruas em 3 h.
  await prisma.$executeRawUnsafe(`SET TIME ZONE 'UTC'`);
  // Começa do zero (o banco é descartável).
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "ProspeccaoCidade", "ProspeccaoLugar", "ProspeccaoUsoMes", "ProspeccaoMarcacao"`);

  const cidade = cidadeFalsa({ centro: { lat: -22.5175, lng: -41.9455 }, total: 600 });
  cidade.push({ id: "ChIJduplicado1", nome: "Bar Duplicado", endereco: "", lat: -22.45005, lng: -41.88003, tipos: ["bar"], popularidade: 1 });
  const google = (r: Awaited<ReturnType<typeof d.passoDaVarredura>>) => r.lote.map((c) => {
    const veio = nearbyFalso(cidade, { centro: c.centro, raio: c.raio, tipos: c.tiposDaBusca, maximo: c.maximo });
    return {
      celulaId: c.id, bruto: veio.length,
      lugares: veio.filter((l) => !l.fechado).map((l) => ({ id: l.id, nome: l.nome, endereco: l.endereco, lat: l.lat, lng: l.lng, tipo: l.tipos[0], mapsUrl: null, origem: "google" })),
    };
  });

  // 1. Abrir a cidade: prepara (caixa, população, OSM, estimativa), não gasta nada.
  const linha = await d.prepararCidade("Rio das Ostras - RJ");
  assert.ok(linha);
  let resumo = await d.resumoDaCidade(linha!, vendedor);
  assert.equal(resumo.estado, "nova");
  assert.equal(resumo.estimativa, 20 + Math.ceil(1043 * 0.35));
  assert.equal(resumo.osm, 2);
  assert.equal((await d.usoDoMes()).nearby, 0);

  // 2. Sem "continuar", nada começa.
  let r = await d.passoDaVarredura(vendedor, { cidade: "Rio das Ostras - RJ" });
  assert.equal(r.lote.length, 0);
  assert.equal(r.resumo.estado, "nova");

  // 3. O vendedor começa: lote de 8, contado no mês.
  r = await d.passoDaVarredura(vendedor, { cidade: "Rio das Ostras - RJ", continuar: true });
  assert.equal(r.lote.length, 8);
  assert.equal(r.uso.nearby, 8);
  assert.equal(r.resumo.estado, "varrendo");

  // 4. Outra pessoa abre no meio: não pega lote, vê o aviso.
  const r2 = await d.passoDaVarredura(outro, { cidade: "Rio das Ostras - RJ", continuar: true });
  assert.equal(r2.lote.length, 0);
  assert.match(r2.aviso || "", /Outra pessoa/);
  assert.equal(r2.resumo.ocupadaPorOutro, true);

  // 5. Erro do Google numa volta: o que voltou fica, o que não voltou é devolvido ao mês, pausa.
  const resultados = google(r);
  r = await d.passoDaVarredura(vendedor, { cidade: "Rio das Ostras - RJ", resultados: resultados.slice(0, 5), erro: "RESOURCE_EXHAUSTED" });
  assert.equal(r.resumo.estado, "pausada");
  assert.equal(r.resumo.motivo, "google");
  assert.equal(r.uso.nearby, 5);
  assert.equal(r.lote.length, 0);

  // 6. Continua até o fim.
  r = await d.passoDaVarredura(vendedor, { cidade: "Rio das Ostras - RJ", continuar: true });
  let voltas = 0;
  while (r.lote.length) {
    r = await d.passoDaVarredura(vendedor, { cidade: "Rio das Ostras - RJ", resultados: google(r) });
    if (++voltas > 500) throw new Error("não terminou");
  }
  assert.equal(r.resumo.estado, "completa");
  assert.equal(r.resumo.saturadas.length, 0);
  const abertos = cidade.filter((l) => !l.fechado && l.lat >= RIO.sul && l.lat <= RIO.norte && l.lng >= RIO.oeste && l.lng <= RIO.leste);
  assert.equal(r.resumo.lugares, abertos.length);
  assert.ok(r.resumo.varridaEm);
  const gastas = r.uso.nearby;
  assert.equal(r.resumo.chamadas, gastas);
  // A estimativa vira o gasto real (para o "atualizar a cidade").
  assert.equal(r.resumo.estimativa, gastas);

  // 7. Os lugares do mapa: Google + só o que o OSM tem a mais (o duplicado casa com o do Google).
  const lugares = await d.lugaresDaCidade("rio das ostras");
  assert.equal(lugares.filter((l) => l.origem === "google").length, abertos.length);
  assert.deepEqual(lugares.filter((l) => l.origem === "osm").map((l) => l.id), ["osm-node-9001"]);
  assert.equal(lugares.find((l) => l.id === "ChIJduplicado1")?.tambemNoOsm, true);
  assert.equal(lugares.find((l) => l.id === "osm-node-9001")?.telefone, "(22) 99999-1234");

  // 8. Vendedor não atualiza a cidade; varrida, nada mais é gasto.
  r = await d.passoDaVarredura(vendedor, { cidade: "Rio das Ostras - RJ", refazer: true });
  assert.match(r.aviso || "", /Só o administrador/);
  assert.equal(r.resumo.estado, "completa");
  r = await d.passoDaVarredura(vendedor, { cidade: "Rio das Ostras - RJ", continuar: true });
  assert.equal(r.lote.length, 0);
  assert.equal(r.uso.nearby, gastas);

  // 9. Grátis do mês quase no fim: o admin pede para atualizar → precisa autorizar; a cidade continua "completa".
  await prisma.$executeRawUnsafe(`UPDATE "ProspeccaoUsoMes" SET qtd = 4850 WHERE sku = 'nearby'`);
  r = await d.passoDaVarredura(admin, { cidade: "Rio das Ostras - RJ", refazer: true });
  assert.equal(r.precisaAutorizar, true);
  assert.equal(r.resumo.estado, "completa");
  assert.ok(r.resumo.lugares > 0);

  // 10. O admin autoriza: passa do grátis e termina; a autorização some no fim.
  r = await d.passoDaVarredura(admin, { cidade: "Rio das Ostras - RJ", refazer: true, autorizar: true });
  assert.ok(r.lote.length > 0);
  while (r.lote.length) r = await d.passoDaVarredura(admin, { cidade: "Rio das Ostras - RJ", resultados: google(r) });
  assert.equal(r.resumo.estado, "completa");
  assert.equal(r.resumo.liberadoPago, false);
  assert.ok(r.uso.nearby > 4900, "passou do grátis com a autorização");

  // 11. Cidade nova com o grátis acabado: o vendedor não começa (precisa do admin) e nada é gasto.
  const antes = r.uso.nearby;
  globalThis.fetch = (async (url: any) => String(url).includes("nominatim")
    ? new Response(JSON.stringify([{ addresstype: "city", class: "boundary", boundingbox: ["-22.6", "-22.5", "-42.1", "-42.0"], extratags: { population: "50000" } }]))
    : new Response(JSON.stringify({ elements: [] }))) as typeof fetch;
  r = await d.passoDaVarredura(vendedor, { cidade: "Casimiro de Abreu - RJ", continuar: true });
  assert.equal(r.precisaAutorizar, true);
  assert.equal(r.lote.length, 0);
  assert.equal(r.resumo.estado, "nova");
  assert.ok(r.resumo.custoDoQueFalta > 0);
  assert.equal(r.uso.nearby, antes);

  // 12. Pausar no meio: guarda o lote e não entrega outro (nada fica reservado à toa).
  await prisma.$executeRawUnsafe(`UPDATE "ProspeccaoUsoMes" SET qtd = 0 WHERE sku = 'nearby'`);
  r = await d.passoDaVarredura(vendedor, { cidade: "Casimiro de Abreu - RJ", continuar: true });
  assert.ok(r.lote.length > 0);
  const reservadas = r.uso.nearby;
  r = await d.passoDaVarredura(vendedor, { cidade: "Casimiro de Abreu - RJ", resultados: r.lote.map((c) => ({ celulaId: c.id, bruto: MAXIMO_POR_CHAMADA, lugares: [] })), pausar: true });
  assert.equal(r.lote.length, 0);
  assert.equal(r.resumo.estado, "pausada");
  assert.equal(r.resumo.motivo, "interrompida");
  assert.equal(r.uso.nearby, reservadas);

  // 13. O uso do mês por SKU: contato e texto param no grátis; mapa só conta.
  await prisma.$executeRawUnsafe(`INSERT INTO "ProspeccaoUsoMes" (mes, sku, qtd) VALUES ('${r.uso.mes}', 'contato', 980) ON CONFLICT (mes, sku) DO UPDATE SET qtd = 980`);
  assert.equal((await d.reservarNoMes("contato", 1)).ok, false);
  assert.equal((await d.reservarNoMes("texto", 1)).ok, true);
  assert.equal((await d.reservarNoMes("mapa", 1)).ok, true);

  // 14. Termos do Google: lugar do Google com mais de 30 dias sai do cache.
  await prisma.$executeRawUnsafe(`UPDATE "ProspeccaoLugar" SET "vistoEm" = now() - interval '31 days' WHERE id = 'ChIJduplicado1'`);
  await d.prepararCidade("Rio das Ostras - RJ");
  assert.equal((await d.lugaresDaCidade("rio das ostras")).some((l) => l.id === "ChIJduplicado1"), false);

  await prisma.$disconnect();
  console.log(`✅ e2e-varredura-pglite: ok (${abertos.length} lugares, ${gastas} buscas na 1ª varredura, ${voltas} voltas)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
