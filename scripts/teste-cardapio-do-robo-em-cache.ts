/**
 * scripts/teste-cardapio-do-robo-em-cache.ts — o cardápio guardado do robô
 * (lib/cardapio-do-robo-em-cache.ts): reaproveita só com a MESMA versão do
 * banco, relê na hora em que a versão muda (pausar um item muda a versão) e
 * nunca entrega o objeto guardado para ser alterado.
 *
 *   DATABASE_URL="postgresql://banco-falso/teste" NEXTAUTH_SECRET=x npx tsx scripts/teste-cardapio-do-robo-em-cache.ts
 *
 * Com PROVA_NO_BANCO=1 e um DATABASE_URL de verdade, confere no Postgres que a
 * versão é estável e que o SQL roda nas lojas reais. Só LÊ o banco.
 */
export {};

const PROVA_NO_BANCO = process.env.PROVA_NO_BANCO === "1";
if (!PROVA_NO_BANCO) process.env.DATABASE_URL = "postgresql://banco-falso/teste";

let ok = 0, falhas = 0;
const confere = (c: boolean, m: string) => { c ? ok++ : falhas++; console.log(c ? "  ✓" : "  ✗", m); };

async function semBanco() {
  const { lerCardapioDoRobo, sqlDaVersaoDoCardapio } = await import("../src/lib/cardapio-do-robo-em-cache");
  let versao: string | null = "v1";
  let leituras = 0;
  let cardapio = [{ id: "p1", name: "X-Burger", active: true, comboGroups: [{ id: "g1", items: [{ menuProduct: { id: "o1", active: true } }] }] }];
  const db = { $queryRaw: async () => { if (versao === null) throw new Error("sem versão"); return [{ produtos: versao, categorias: "c", grupos: "g", opcoes: "o" }]; } } as any;
  const buscar = async () => { leituras++; return [structuredClone(cardapio), [{ name: "Lanches" }]] as const; };

  console.log("\n[1] Mesma versão: uma leitura só");
  const [a] = await lerCardapioDoRobo(db, "loja1", buscar);
  const [b] = await lerCardapioDoRobo(db, "loja1", buscar);
  confere(leituras === 1, `duas mensagens, uma leitura do cardápio (${leituras})`);
  confere(JSON.stringify(a) === JSON.stringify(b), "o mesmo cardápio nas duas");

  console.log("\n[2] Quem altera o objeto não altera o guardado");
  (b as any)[0].price = 999;
  (b as any)[0].comboGroups[0].items[0].menuProduct.active = false;
  const [c] = await lerCardapioDoRobo(db, "loja1", buscar);
  confere((c as any)[0].price === undefined && (c as any)[0].comboGroups[0].items[0].menuProduct.active === true, "a terceira mensagem recebe o cardápio intacto");

  console.log("\n[3] Pausou um item: a versão muda e a próxima mensagem relê");
  cardapio = [{ ...cardapio[0], active: false }];
  versao = "v2";
  const [d] = await lerCardapioDoRobo(db, "loja1", buscar);
  confere(leituras === 2 && (d as any)[0].active === false, "releu e já vem pausado");

  console.log("\n[4] Outra loja não usa o guardado desta");
  await lerCardapioDoRobo(db, "loja2", buscar);
  confere(leituras === 3, "loja2 lê o próprio cardápio");

  console.log("\n[5] Sem versão (erro no banco): lê direto, sempre");
  versao = null;
  await lerCardapioDoRobo(db, "loja1", buscar);
  await lerCardapioDoRobo(db, "loja1", buscar);
  confere(leituras === 5, `duas leituras diretas (${leituras})`);

  console.log("\n[6] Validade: com a versão igual, passou 60 s relê");
  versao = "v3";
  await lerCardapioDoRobo(db, "loja3", buscar);
  const agoraDeVerdade = Date.now;
  Date.now = () => agoraDeVerdade() + 61_000;
  await lerCardapioDoRobo(db, "loja3", buscar);
  Date.now = agoraDeVerdade;
  confere(leituras === 7, `releu depois da validade (${leituras})`);

  console.log("\n[7] O SQL da versão cobre o cardápio inteiro da loja");
  const sql = sqlDaVersaoDoCardapio("loja1").text;
  confere(["\"MenuProduct\"", "\"MenuCategory\"", "\"ComboGroup\"", "\"ComboGroupItem\""].every((t) => sql.includes(t)), "produtos, categorias, grupos e opções");
  confere(/p::text/.test(sql) && /i::text/.test(sql) && /g::text/.test(sql) && /c::text/.test(sql), "a linha inteira de cada tabela entra no resumo (qualquer coluna mudou = versão nova)");
}

async function noBanco() {
  const { prisma } = await import("../src/lib/prisma");
  const { versaoDoCardapio } = await import("../src/lib/cardapio-do-robo-em-cache");
  const lojas: { id: string }[] = await prisma.$queryRawUnsafe(`SELECT DISTINCT "franchiseeId" AS id FROM "MenuProduct" WHERE "franchiseeId" IS NOT NULL LIMIT 40`);
  let estaveis = 0, nulas = 0;
  for (const { id } of lojas) {
    const [v1, v2] = [await versaoDoCardapio(prisma as any, id), await versaoDoCardapio(prisma as any, id)];
    if (!v1) nulas++;
    else if (v1 === v2) estaveis++;
  }
  confere(nulas === 0, `o SQL roda em ${lojas.length} lojas reais`);
  confere(estaveis >= lojas.length - 2, `versão estável entre duas leituras seguidas (${estaveis}/${lojas.length}; loja mexendo no cardápio agora pode variar)`);
  await prisma.$disconnect();
}

(PROVA_NO_BANCO ? noBanco() : semBanco())
  .then(() => { console.log(`\n${ok} ok, ${falhas} falha(s)`); process.exit(falhas ? 1 : 0); })
  .catch((e) => { console.error(e); process.exit(1); });
