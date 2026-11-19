/**
 * Os módulos EQUIPE, ESTOQUE e FISCAL/APPS do Bill (src/lib/assessor/modulos/).
 *
 * 1) Sem banco: as regras puras (achar pelo nome, diferença grande da
 *    contagem, número do pedido, hora do iFood, saldo do acerto) e o formato
 *    dos três módulos (declarações, gravam, tipos, regras).
 * 2) Com banco (LOJA=<id>), SÓ LEITURA: o Prisma do teste recusa qualquer
 *    gravação e o fetch para fora (SEFAZ, iFood) é bloqueado. Lista equipe,
 *    acerto, mínimo, ficha e notas com falha; e confere que desativar,
 *    contar com diferença grande, emitir nota e fechar o iFood PARAM na
 *    pergunta de confirmação.
 *
 *   npx tsx --env-file=.env scripts/teste-bill-equipe-estoque-fiscal.ts
 *   LOJA=<id> npx tsx --env-file=.env scripts/teste-bill-equipe-estoque-fiscal.ts
 */
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";

process.env.DATABASE_URL ||= "postgresql://sem-banco/teste";

// O banco é o de PRODUÇÃO: o cliente do teste só lê.
const GRAVAM = new Set(["create", "createMany", "createManyAndReturn", "update", "updateMany", "updateManyAndReturn", "upsert", "delete", "deleteMany"]);
const tentativasDeGravar: string[] = [];
(globalThis as any).prisma = new PrismaClient().$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }: any) {
        if (GRAVAM.has(operation)) {
          tentativasDeGravar.push(`${model}.${operation}`);
          throw new Error(`TESTE SÓ LEITURA: ${model}.${operation} bloqueado`);
        }
        return query(args);
      },
    },
    async $executeRaw() { throw new Error("TESTE SÓ LEITURA: $executeRaw bloqueado"); },
    async $executeRawUnsafe() { throw new Error("TESTE SÓ LEITURA: $executeRawUnsafe bloqueado"); },
  },
});
// SEFAZ, Focus, iFood: nenhuma chamada sai daqui.
(globalThis as any).fetch = async (url: unknown) => { throw new Error(`TESTE: fetch bloqueado (${String(url).slice(0, 60)})`); };

(async () => {
  const { escolherPeloNome, saldoEmPalavras, MODULO_EQUIPE } = await import("../src/lib/assessor/modulos/equipe");
  const { diferencaGrande, MODULO_ESTOQUE } = await import("../src/lib/assessor/modulos/estoque");
  const { lerPedido, horaLocalSemFuso, aindaNaoAcabou, quando, MODULO_FISCAL } = await import("../src/lib/assessor/modulos/fiscal");

  // ── 1. Puro ──
  const lista = [{ nome: "Coca-Cola lata 350ml" }, { nome: "Coca-Cola 2L" }, { nome: "Mussarela" }, { nome: "Mussarela de búfala" }];
  assert.deepEqual(escolherPeloNome(lista, "coca lata"), { um: lista[0] });
  assert.ok("varios" in escolherPeloNome(lista, "coca"));
  assert.deepEqual(escolherPeloNome(lista, "MUSSARELA"), { um: lista[2] }, "nome igual vence o parecido");
  assert.deepEqual(escolherPeloNome(lista, "cocas lata"), { um: lista[0] }, "plural");
  assert.deepEqual(escolherPeloNome(lista, "guaraná"), { nenhum: true });
  assert.deepEqual(escolherPeloNome(lista, ""), { nenhum: true });
  console.log("✓ acha pelo nome (igual vence, palavras, plural, ambíguo)");

  assert.equal(saldoEmPalavras(40), "a loja paga R$ 40,00");
  assert.equal(saldoEmPalavras(-12.5), "ele devolve R$ 12,50");
  assert.equal(saldoEmPalavras(0.001), "acertado (saldo zero)");
  console.log("✓ saldo do acerto em palavras");

  assert.equal(diferencaGrande(10, 12, 5), false, "20% não é grande");
  assert.equal(diferencaGrande(10, 3, 5), true, "70% e R$ 35");
  assert.equal(diferencaGrande(10, 3, 1), false, "70% mas só R$ 7");
  assert.equal(diferencaGrande(10, 3, null), true, "sem custo pergunta");
  assert.equal(diferencaGrande(0, 12, 4), true, "sistema zerado, contou 12");
  assert.equal(diferencaGrande(-5, 10, 3), true, "saldo negativo");
  assert.equal(diferencaGrande(7, 7, 100), false, "igual");
  console.log("✓ diferença grande da contagem");

  assert.deepEqual(lerPedido("#42"), { numero: 42 });
  assert.deepEqual(lerPedido("pedido nº 7"), { numero: 7 });
  assert.deepEqual(lerPedido(" 15 "), { numero: 15 });
  assert.deepEqual(lerPedido("cmtngami90013mo012jox35em"), { id: "cmtngami90013mo012jox35em" });
  assert.deepEqual(lerPedido("nabcdefgh123"), { id: "nabcdefgh123" }, "id que começa com n não perde a letra");
  assert.equal(lerPedido(""), null);
  assert.equal(lerPedido("o de ontem"), null);
  console.log("✓ número do dia ou id do pedido");

  const instante = new Date("2026-11-19T23:30:05Z");
  assert.equal(horaLocalSemFuso(instante, "America/Sao_Paulo"), "2026-11-19T20:30:05");
  assert.equal(horaLocalSemFuso(new Date("2026-11-19T03:05:00Z"), "America/Sao_Paulo"), "2026-11-19T00:05:00", "meia-noite é 00, não 24");
  assert.equal(aindaNaoAcabou("2026-11-19T21:00:00", instante, "America/Sao_Paulo"), true);
  assert.equal(aindaNaoAcabou("2026-11-19T20:00:00", instante, "America/Sao_Paulo"), false);
  assert.equal(aindaNaoAcabou("2026-11-19T23:00:00Z", instante, "America/Sao_Paulo"), false, "com fuso é instante");
  assert.equal(quando("2026-11-20T01:00:00.000Z", "America/Sao_Paulo"), "19/11 22:00");
  assert.equal(quando("2027-11-19T20:30:05", "America/Sao_Paulo"), "19/11 20:30");
  console.log("✓ hora do iFood no relógio da loja");

  const modulos = [MODULO_EQUIPE, MODULO_ESTOQUE, MODULO_FISCAL];
  const esperados: Record<string, string[]> = {
    equipe: ["motoboys", "funcionarios", "acerto_do_motoboy"],
    estoque: ["contagem_de_estoque", "estoque_minimo", "ficha_tecnica"],
    fiscal: ["reemitir_nota_fiscal", "loja_no_ifood"],
  };
  const ctxFalso = { franchiseeId: "x", usuarioId: "x", canal: "PAINEL" as const };
  for (const m of modulos) {
    const nomes = m.declaracoes.map((d) => d.name);
    assert.deepEqual(nomes, esperados[m.nome], m.nome);
    for (const g of m.gravam) assert.ok(nomes.includes(g), `${m.nome}: gravam ${g}`);
    for (const d of m.declaracoes) assert.equal(d.parameters?.type, "OBJECT", `${d.name}: parâmetros OBJECT`);
    const linhas = m.regras.split("\n").filter(Boolean);
    assert.ok(linhas.length >= 3 && linhas.length <= 6, `${m.nome}: ${linhas.length} linhas de regra`);
    assert.ok(m.tipos?.length && m.desfazer, `${m.nome}: tipos e desfazer`);
    assert.equal(await m.executar("ferramenta_de_outro_modulo", {}, ctxFalso), null);
    assert.equal(await m.desfazer!("COMPRA", {}, ctxFalso), null, "tipo de fora não é dele");
  }
  const todosOsNomes = modulos.flatMap((m) => m.declaracoes.map((d) => d.name));
  assert.equal(new Set(todosOsNomes).size, todosOsNomes.length, "nome repetido entre módulos");
  const nota: any = await MODULO_FISCAL.desfazer!("FISCAL_NOTA", { orderId: "p" }, ctxFalso);
  assert.equal(nota.ok, false);
  assert.match(nota.erro, /não se desfaz/);
  console.log("✓ formato dos módulos; nota emitida não se desfaz");

  const LOJA = process.env.LOJA;
  if (!LOJA) {
    console.log("(sem LOJA=<id>: pulei a parte com banco)");
    process.exit(0);
  }

  // ── 2. Com banco, só leitura ──
  const { prisma } = await import("../src/lib/prisma");
  const ctx = { franchiseeId: LOJA, usuarioId: LOJA, canal: "WHATSAPP" as const };
  const rodar = async (m: any, nome: string, args: any) => {
    const r: any = await m.executar(nome, args, ctx);
    assert.ok(r, `${nome} não respondeu`);
    return r;
  };
  const curto = (r: unknown) => JSON.stringify(r).slice(0, 320);

  const mb = await rodar(MODULO_EQUIPE, "motoboys", { acao: "LISTAR" });
  assert.equal(mb.ok, true, curto(mb));
  console.log("✓ motoboys:", mb.resumo, curto(mb.motoboys?.slice(0, 3)));

  const fu = await rodar(MODULO_EQUIPE, "funcionarios", { acao: "LISTAR" });
  assert.equal(fu.ok, true, curto(fu));
  console.log("✓ funcionários:", fu.resumo, curto(fu.equipe?.slice(0, 3)));

  const ac = await rodar(MODULO_EQUIPE, "acerto_do_motoboy", {});
  assert.equal(ac.ok, true, curto(ac));
  console.log("✓ acerto de hoje:", ac.resumo);
  const semana = await rodar(MODULO_EQUIPE, "acerto_do_motoboy", { de: new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10), ate: new Date(Date.now() - 864e5).toISOString().slice(0, 10) });
  assert.equal(semana.ok, true, curto(semana));
  console.log("✓ acerto da semana:", semana.resumo);

  const ativo = mb.motoboys?.find((m: any) => m.ativo);
  if (ativo) {
    const p = await rodar(MODULO_EQUIPE, "motoboys", { acao: "DESATIVAR", motoboyId: ativo.id });
    assert.equal(p.precisaConfirmar, true, curto(p));
    console.log("✓ desativar motoboy para na pergunta:", p.pergunta);
  }
  const pessoa = fu.equipe?.find((p: any) => p.ativo);
  if (pessoa) {
    const p = await rodar(MODULO_EQUIPE, "funcionarios", { acao: "DESATIVAR", id: pessoa.id });
    assert.equal(p.precisaConfirmar, true, curto(p));
    console.log("✓ desativar funcionário para na pergunta:", p.pergunta);
  }

  const insumo = await prisma.stockItem.findFirst({ where: { franchiseeId: LOJA, NOT: { active: false } }, select: { id: true, name: true, quantity: true }, orderBy: { updatedAt: "desc" } });
  if (insumo) {
    const mi = await rodar(MODULO_ESTOQUE, "estoque_minimo", { insumoId: insumo.id, nome: insumo.name });
    assert.equal(mi.ok, true, curto(mi));
    console.log("✓ mínimo:", mi.resumo);

    const naoTem = await rodar(MODULO_ESTOQUE, "contagem_de_estoque", { itens: [{ nome: "item que não existe zzqx", quantidade: 3 }] });
    assert.equal(naoTem.ok, false);
    assert.ok(naoTem.problemas?.length, curto(naoTem));
    console.log("✓ contagem com item desconhecido não grava:", naoTem.erro);

    const muito = Math.abs(insumo.quantity) * 10 + 100000;
    const grande = await rodar(MODULO_ESTOQUE, "contagem_de_estoque", { itens: [{ insumoId: insumo.id, nome: insumo.name, quantidade: muito }] });
    assert.ok(grande.precisaConfirmar === true || /fechada pela tela/.test(grande.erro || ""), curto(grande));
    console.log("✓ contagem com diferença grande para antes de gravar:", grande.pergunta || grande.erro);
  } else console.log("(loja sem insumo: pulei mínimo e contagem)");

  const comFicha = await prisma.menuProduct.findFirst({ where: { franchiseeId: LOJA, origemIntegracao: null, recipeItems: { some: {} } }, select: { id: true, name: true } });
  if (comFicha) {
    const fi = await rodar(MODULO_ESTOQUE, "ficha_tecnica", { produtoId: comFicha.id, produto: comFicha.name });
    assert.equal(fi.ok, true, curto(fi));
    console.log("✓ ficha:", fi.resumo, curto(fi.itens?.slice(0, 3)));
  } else console.log("(loja sem ficha técnica: pulei)");

  const falhas = await rodar(MODULO_FISCAL, "reemitir_nota_fiscal", {});
  assert.equal(falhas.ok, true, curto(falhas));
  console.log("✓ notas com falha:", falhas.resumo);

  const semNota = await prisma.customerOrder.findFirst({
    where: { franchiseeId: LOJA, fiscalStatus: { in: ["FAILED", "PENDING"] }, NOT: { status: { startsWith: "CANCEL" } } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (semNota) {
    const p = await rodar(MODULO_FISCAL, "reemitir_nota_fiscal", { pedido: semNota.id });
    assert.equal(p.precisaConfirmar, true, curto(p));
    console.log("✓ emitir nota para na pergunta:", p.pergunta);
  }

  const ifood = await rodar(MODULO_FISCAL, "loja_no_ifood", { acao: "FECHAR" });
  assert.ok(ifood.precisaConfirmar === true || /não tem iFood/.test(ifood.erro || ""), curto(ifood));
  console.log("✓ fechar iFood para na pergunta:", ifood.pergunta || ifood.erro);

  assert.deepEqual(tentativasDeGravar, [], "nenhuma gravação foi tentada");
  console.log("✓ nada foi gravado");
  process.exit(0);
})().catch((e) => {
  console.error("✗", e);
  process.exit(1);
});
