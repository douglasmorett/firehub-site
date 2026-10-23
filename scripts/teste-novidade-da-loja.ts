/**
 * scripts/teste-novidade-da-loja.ts — a resposta "nada novo" sai da memória
 * enquanto a loja não grava nada (lib/novidade-da-loja.ts), e nunca esconde
 * uma gravação: a marca da loja, a marca geral, o prazo de 15 s e a janela da
 * fila que começa antes invalidam o que estava guardado.
 *
 *   npx tsx scripts/teste-novidade-da-loja.ts
 *
 * Sem banco: a fila usa um banco falso que conta as consultas.
 */
import {
  aoMarcarNovidade, esquecerTudoDaNovidade, lerEnquantoNadaMuda, lojaDaGravacao, marcarNovidade, marcarNovidadeDeOutraInstancia,
  nadaMudouDesde, PRAZO_MS, sqlGravaNaFila, operacaoGrava, gravouAlgo,
} from "../src/lib/novidade-da-loja";
import { filaTemAlgoGuardado, type PerguntaDaFila } from "../src/lib/fila-tem-algo";
import { Prisma } from "@prisma/client";

let ok = 0, falhas = 0;
const confere = (c: boolean, m: string) => { c ? ok++ : falhas++; console.log(c ? "  ✓" : "  ✗", m); };

// Relógio controlado: Date.now() anda só quando o teste manda.
let relogio = 1_800_000_000_000;
Date.now = () => relogio;
const anda = (ms: number) => { relogio += ms; };

async function main() {
  console.log("Sinal da loja");
  esquecerTudoDaNovidade();
  anda(10);
  const t0 = Date.now();
  confere(nadaMudouDesde(["A"], t0), "loja sem gravação depois de t0: nada mudou");
  anda(5);
  marcarNovidade("A");
  confere(!nadaMudouDesde(["A"], t0), "gravação da loja A depois de t0: mudou");
  confere(nadaMudouDesde(["B"], t0), "a gravação da A não mexe na B");
  confere(!nadaMudouDesde(["B", "A"], t0), "visão com A e B (Todas as lojas): mudou");
  anda(5);
  const t1 = Date.now();
  marcarNovidade(null);
  confere(!nadaMudouDesde(["B"], t1 - 1), "gravação sem loja vale para todas");

  console.log("Resposta guardada");
  esquecerTudoDaNovidade();
  anda(10);
  let leituras = 0;
  const ler = async () => { leituras++; return { lista: [leituras] }; };
  const r1 = await lerEnquantoNadaMuda("k", ["A"], ler);
  const r2 = await lerEnquantoNadaMuda("k", ["A"], ler);
  confere(leituras === 1 && r2.lista[0] === 1, "segunda pergunta sem novidade não vai ao banco");
  r2.lista.push(99);
  const r3 = await lerEnquantoNadaMuda("k", ["A"], ler);
  confere(r3.lista.length === 1, "cada chamada recebe uma cópia (mexer numa não muda a guardada)");
  anda(1);
  marcarNovidade("A");
  anda(1);
  await lerEnquantoNadaMuda("k", ["A"], ler);
  confere(leituras === 2, "novidade da loja: vai ao banco de novo");
  anda(PRAZO_MS);
  await lerEnquantoNadaMuda("k", ["A"], ler);
  confere(leituras === 3, "15 s sem novidade: vai ao banco mesmo assim (gravação de fora do processo)");
  const naoGuarda = await lerEnquantoNadaMuda("k2", ["A"], ler, () => false);
  await lerEnquantoNadaMuda("k2", ["A"], ler, () => false);
  confere(leituras === 5 && !!naoGuarda, "o que `guardar` recusa não fica guardado");
  // Gravação DURANTE a leitura: a hora anotada é a de antes, então não guarda velho.
  const lerComGravacao = async () => { leituras++; anda(3); marcarNovidade("A"); anda(3); return { lista: [leituras] }; };
  await lerEnquantoNadaMuda("k3", ["A"], lerComGravacao);
  const antes = leituras;
  await lerEnquantoNadaMuda("k3", ["A"], ler);
  confere(leituras === antes + 1, "gravação durante a leitura invalida o que acabou de ser lido");
  let erro = false;
  try { await lerEnquantoNadaMuda("k4", ["A"], async () => { throw new Error("banco fora"); }); } catch { erro = true; }
  confere(erro, "erro do banco sobe (não vira lista vazia guardada)");

  console.log("Quem grava");
  confere(operacaoGrava("update") && operacaoGrava("createMany") && operacaoGrava("deleteMany") && !operacaoGrava("findMany") && !operacaoGrava("count"), "operações de gravação × leitura");
  confere(lojaDaGravacao({ where: { id: "p1" } }, { id: "p1", franchiseeId: "L1" }) === "L1", "loja pelo resultado do update");
  confere(lojaDaGravacao({ data: { franchiseeId: "L2" } }, { count: 3 }) === "L2", "loja pelo data do createMany");
  confere(lojaDaGravacao({ where: { franchiseeId: { in: ["a", "b"] } } }, { count: 2 }) === null, "where com várias lojas: sem loja (vale para todas)");
  confere(lojaDaGravacao({ where: { id: "i1" } }, { id: "i1", orderId: "p1" }) === null, "item do pedido: sem loja (vale para todas)");
  confere(sqlGravaNaFila(Prisma.sql`UPDATE "CustomerOrder" SET "routeSequence" = ${1} WHERE "id" = ${"x"}`), "SQL $executeRaw UPDATE CustomerOrder");
  confere(sqlGravaNaFila(Prisma.sql`/* fh:marcar-em-emissao */ UPDATE "CustomerOrder" SET x = 1`), "SQL com comentário na frente");
  confere(sqlGravaNaFila(['INSERT INTO "AcrescimoDoPedido" ("id") VALUES ($1)', "x"]), "SQL $executeRawUnsafe INSERT acréscimo");
  confere(sqlGravaNaFila(Prisma.sql`\n    INSERT INTO "TransferenciaDoPedido" ("id") VALUES (${"x"})`), "INSERT transferência com quebra de linha");
  confere(sqlGravaNaFila(['DELETE FROM "PrintRequest" WHERE 1=1']), "DELETE PrintRequest");
  confere(sqlGravaNaFila([Prisma.sql`UPDATE "CustomerOrder" SET "fiscalStatus" = ${"x"} WHERE id = ${"y"}`]), "$executeRaw chamado com o objeto Prisma.sql (NFC-e)");
  confere(!gravouAlgo({ count: 0 }) && !gravouAlgo(0), "updateMany/deleteMany/$executeRaw que não mexeu em nada não conta");
  confere(gravouAlgo({ count: 2 }) && gravouAlgo(1) && gravouAlgo([]) && gravouAlgo({ id: "p", count: 0 }), "o resto conta (na dúvida, mexeu)");
  confere(!sqlGravaNaFila(Prisma.sql`SELECT 1`), "SELECT não conta");
  confere(!sqlGravaNaFila(Prisma.sql`SELECT * FROM "CustomerOrder" WHERE id = ${"x"}`), "SELECT do pedido não conta");
  confere(!sqlGravaNaFila(Prisma.sql`UPDATE "CustomerOrderPayment" SET x = 1`), "outra tabela com o mesmo começo de nome não conta");
  confere(!sqlGravaNaFila(Prisma.sql`UPDATE "User" SET "printQueuePolledAt" = now()`), "carimbo do Assistente (User) não conta");

  console.log("Fila do Assistente guardada");
  esquecerTudoDaNovidade();
  anda(10);
  let consultas = 0;
  let resposta = { pedidos: false, avulsas: false };
  const banco = { $queryRaw: async <T,>() => { consultas++; return [resposta] as unknown as T; } };
  const pergunta = (desdeMsAtras: number, p: Partial<PerguntaDaFila> = {}): PerguntaDaFila => ({
    franchiseeId: "LOJA", desde: new Date(Date.now() - desdeMsAtras), desdeDaAvulsa: new Date(Date.now() - 7_200_000),
    statusQueNaoEntram: ["CANCELADO"], tambemPeloFimDoKds: false, ...p,
  });
  let r = await filaTemAlgoGuardado(banco, pergunta(1_800_000));
  confere(consultas === 1 && r?.pedidos === false, "primeira consulta vai ao banco");
  anda(3_000);
  r = await filaTemAlgoGuardado(banco, pergunta(1_800_000));
  confere(consultas === 1 && r?.pedidos === false && r?.avulsas === false, "3 s depois, sem novidade: \"nada\" sem consulta");
  anda(3_000);
  await filaTemAlgoGuardado(banco, pergunta(1_800_000 + 60_000));
  confere(consultas === 2, "janela que começa ANTES (atraso do Assistente): vai ao banco");
  anda(3_000);
  await filaTemAlgoGuardado(banco, pergunta(1_800_000, { tambemPeloFimDoKds: true }));
  confere(consultas === 3, "outra regra de janela (fim do KDS): chave própria, vai ao banco");
  anda(3_000);
  marcarNovidade("OUTRA");
  await filaTemAlgoGuardado(banco, pergunta(1_800_000));
  confere(consultas === 3, "pedido de OUTRA loja não acorda esta fila");
  anda(1);
  marcarNovidade("LOJA");
  resposta = { pedidos: true, avulsas: false };
  anda(1);
  r = await filaTemAlgoGuardado(banco, pergunta(1_800_000));
  confere(consultas === 4 && r?.pedidos === true, "pedido novo da loja: vai ao banco e acha");
  anda(3_000);
  r = await filaTemAlgoGuardado(banco, pergunta(1_800_000));
  confere(consultas === 5 && r?.pedidos === true, "\"sim\" nunca é guardado: pergunta de novo até sair");
  resposta = { pedidos: false, avulsas: false };
  anda(3_000);
  await filaTemAlgoGuardado(banco, pergunta(1_800_000));
  anda(PRAZO_MS);
  await filaTemAlgoGuardado(banco, pergunta(1_800_000));
  confere(consultas === 7, "15 s depois do último \"nada\": confere no banco");
  const falhando = { $queryRaw: async <T,>(): Promise<T> => { consultas++; throw new Error("banco fora"); } };
  anda(PRAZO_MS);
  const rf = await filaTemAlgoGuardado(falhando, pergunta(1_800_000));
  confere(rf === null, "erro na pré-consulta: null (a rota segue pelo caminho de sempre)");

  console.log("\nEntre instâncias (o gancho do lib/laco-entre-instancias.ts)");
  {
    const levadas: (string | null)[] = [];
    aoMarcarNovidade((l) => levadas.push(l));
    marcarNovidade("LOJA");
    marcarNovidade(null);
    confere(JSON.stringify(levadas) === JSON.stringify(["LOJA", null]), "a marca daqui vai para as outras (loja e \"todas\")");
    const antes = Date.now();
    anda(1);
    marcarNovidadeDeOutraInstancia("FORA");
    confere(!nadaMudouDesde(["FORA"], antes), "a marca que veio de fora invalida o que esta instância guardou");
    confere(levadas.length === 2, "…e não volta para o banco (sem eco)");
    aoMarcarNovidade(() => { throw new Error("banco fora"); });
    let estourou = false;
    try { marcarNovidade("LOJA"); } catch { estourou = true; }
    confere(!estourou, "o gancho falhando nunca atrapalha a marca daqui");
    aoMarcarNovidade(undefined);
  }

  console.log(`\n${ok} ok, ${falhas} falha(s)`);
  process.exit(falhas ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
