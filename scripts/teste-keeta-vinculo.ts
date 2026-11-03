/**
 * scripts/teste-keeta-vinculo.ts — ligar, desligar e TROCAR a loja da Keeta.
 *
 *   npx tsx scripts/teste-keeta-vinculo.ts
 *
 * A tabela KeetaLoja em memória, respondendo às poucas frases de SQL de
 * lib/keeta/lojas.ts. O furo coberto: depois de desligar, a linha guardava a
 * loja antiga da Keeta e recusava qualquer outra para sempre (03/11/2026).
 */
let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : `\n   esperado: ${JSON.stringify(esperado)}\n   obtido:   ${JSON.stringify(obtido)}`}`);
};

process.env.DATABASE_URL ||= "postgresql://banco-falso/teste";
type Linha = { merchantId: string; franchiseeId: string; keetaMerchantId: bigint; nomeNaKeeta: string | null; ativa: boolean; vinculadaPor: string | null };
const tabela: Linha[] = [];
const so = (sql: string) => sql.replace(/\s+/g, " ").trim();
(globalThis as any).prisma = {
  $queryRawUnsafe: async (sql: string, ...p: any[]) => {
    const s = so(sql);
    if (s.includes(`WHERE "merchantId" = $1 AND "ativa" = true`)) return tabela.filter((l) => l.merchantId === p[0] && l.ativa);
    if (s.includes(`WHERE "keetaMerchantId" = $1`)) return tabela.filter((l) => l.keetaMerchantId === p[0]);
    if (s.includes(`WHERE "franchiseeId" = $1`)) return tabela.filter((l) => l.franchiseeId === p[0]);
    throw new Error(`SQL sem resposta no teste: ${s}`);
  },
  $executeRawUnsafe: async (sql: string, ...p: any[]) => {
    const s = so(sql);
    if (s.startsWith("CREATE TABLE")) return 0;
    if (s.startsWith("INSERT")) {
      if (tabela.some((l) => l.keetaMerchantId === p[2] || l.franchiseeId === p[1])) throw new Error("unique");
      tabela.push({ merchantId: p[0], franchiseeId: p[1], keetaMerchantId: p[2], nomeNaKeeta: p[3], ativa: true, vinculadaPor: p[4] });
      return 1;
    }
    if (s.startsWith(`UPDATE "KeetaLoja" SET "keetaMerchantId" = $2`)) {
      if (tabela.some((l) => l.keetaMerchantId === p[1] && l.franchiseeId !== p[0])) throw new Error("unique");
      const l = tabela.find((x) => x.franchiseeId === p[0])!;
      Object.assign(l, { keetaMerchantId: p[1], nomeNaKeeta: p[2], ativa: true, vinculadaPor: p[3] });
      return 1;
    }
    if (s.startsWith(`UPDATE "KeetaLoja" SET "ativa" = true`)) {
      const l = tabela.find((x) => x.franchiseeId === p[0])!;
      Object.assign(l, { ativa: true, nomeNaKeeta: p[1] ?? l.nomeNaKeeta });
      return 1;
    }
    if (s.startsWith(`UPDATE "KeetaLoja" SET "ativa" = false`) && s.includes(`"franchiseeId" = $1`)) {
      const ls = tabela.filter((x) => x.franchiseeId === p[0]);
      ls.forEach((l) => (l.ativa = false));
      return ls.length;
    }
    throw new Error(`SQL sem resposta no teste: ${s}`);
  },
};

(async () => {
  const { gravarVinculo, desligarVinculo, lojaDoMerchant, merchantIdDaLoja } = await import("../src/lib/keeta/lojas");
  const LOJA = "cmvrbhzxx0uacog07r3q9foeg";
  const M = merchantIdDaLoja(LOJA);

  const r1 = await gravarVinculo(LOJA, 159625161, "Entrega Keeta", "teste");
  confere("liga a primeira loja da Keeta", [r1.ok, r1.novo], [true, true]);

  const r2 = await gravarVinculo(LOJA, 159616320, "Entrega própria", "teste");
  confere("ligada: trocar direto é recusado", [r2.ok, /Desligue antes de trocar/.test(r2.motivo || "")], [false, true]);

  await desligarVinculo({ franchiseeId: LOJA });
  const r3 = await gravarVinculo(LOJA, 159616320, "Entrega própria", "teste");
  confere("desligada: troca para a outra loja da Keeta (e pede onboarding)", [r3.ok, r3.reativado, r3.loja?.keetaMerchantId], [true, true, "159616320"]);
  confere("… o pedido do merchant cai na loja nova da Keeta", (await lojaDoMerchant(M))?.keetaMerchantId, "159616320");

  const r4 = await gravarVinculo("outra-loja-do-firehub", 159616320, null, "teste");
  confere("a loja nova da Keeta não liga em outra loja do FireHub", r4.ok, false);

  await desligarVinculo({ franchiseeId: LOJA });
  const r5 = await gravarVinculo(LOJA, 159625161, null, "teste");
  confere("e volta para a primeira, também depois de desligar", [r5.ok, r5.reativado, (await lojaDoMerchant(M))?.keetaMerchantId], [true, true, "159625161"]);

  const r6 = await gravarVinculo(LOJA, 159625161, null, "teste");
  confere("religar a mesma, já ativa, não refaz onboarding", [r6.ok, r6.reativado], [true, false]);

  console.log(falhas ? `\n${falhas} falha(s).` : "\nTudo certo.");
  process.exit(falhas ? 1 : 0);
})();
