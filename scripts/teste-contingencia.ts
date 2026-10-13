/**
 * Trava as regras do Modo Contingência que não dependem de banco:
 * a volta linha a linha (lib/contingencia/mescla.ts), o catálogo da cópia,
 * o bilhete e o gatilho gerado para a nuvem.
 *
 *   npx tsx scripts/teste-contingencia.ts
 */
import { decidir, iguais, type LinhaDaSaida } from "../src/lib/contingencia/mescla";
import { TABELAS_DA_COPIA, colunasQueNaoDescem, idDoRegistro, tabelaDaCopia } from "../src/lib/contingencia/catalogo";
import { assinarBilhete, lerBilhete } from "../src/lib/contingencia/chave";
import { sqlDaFuncao, tabelasComGatilho } from "../src/lib/contingencia/estrutura-no-banco";

let falhas = 0;
const confere = (oQue: string, ok: boolean, obtido?: unknown) => {
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}`}`);
};

const pedido = tabelaDaCopia("CustomerOrder")!;
const estoque = tabelaDaCopia("StockItem")!;
const contador = tabelaDaCopia("DailyOrderCounter")!;
const usuario = tabelaDaCopia("User")!;
const nada = new Set<string>();

const saida = (o: Partial<LinhaDaSaida>): LinhaDaSaida => ({ seq: "1", tabela: "CustomerOrder", registro: "p1", operacao: "UPDATE", antes: null, depois: null, ...o });

console.log("— A volta, linha a linha —");
{
  const d = decidir(pedido, saida({ operacao: "INSERT", depois: { id: "p9", franchiseeId: "L", status: "NOVO" } }), null, nada);
  confere("pedido novo da loja entra", d.tipo === "inserir" && (d as any).linha.id === "p9", d);
}
{
  const d = decidir(
    pedido,
    saida({ antes: { id: "p1", status: "NOVO", total: 10 }, depois: { id: "p1", status: "PRONTO", total: 10 } }),
    { id: "p1", status: "NOVO", total: 10 },
    nada,
  );
  confere("só a loja mudou: vai como a loja deixou, sem conflito", d.tipo === "atualizar" && (d as any).mudar.status === "PRONTO" && !(d as any).conflitos.length, d);
}
{
  const d = decidir(
    pedido,
    saida({ antes: { id: "p1", status: "NOVO" }, depois: { id: "p1", status: "PRONTO" } }),
    { id: "p1", status: "CANCELADO" },
    nada,
  );
  confere("os dois mudaram: vale a loja e o conflito fica anotado", d.tipo === "atualizar" && (d as any).mudar.status === "PRONTO" && (d as any).conflitos.length === 1, d);
}
{
  const d = decidir(
    pedido,
    saida({ antes: { id: "p1", status: "NOVO" }, depois: { id: "p1", status: "PRONTO" } }),
    { id: "p1", status: "PRONTO" },
    nada,
  );
  confere("os dois chegaram ao mesmo: nada a fazer", d.tipo === "nada", d);
}
{
  const d = decidir(
    estoque,
    saida({ tabela: "StockItem", antes: { id: "e1", quantity: 10 }, depois: { id: "e1", quantity: 7 } }),
    { id: "e1", quantity: 9 },
    nada,
  );
  confere("estoque soma: loja baixou 3, nuvem baixou 1 → 6", d.tipo === "atualizar" && (d as any).mudar.quantity === 6, d);
}
{
  const d = decidir(
    contador,
    saida({ tabela: "DailyOrderCounter", antes: { franchiseeId: "L", dateKey: "k", lastNumber: 142 }, depois: { franchiseeId: "L", dateKey: "k", lastNumber: 150 } }),
    { franchiseeId: "L", dateKey: "k", lastNumber: 144 },
    nada,
  );
  confere("contador do número do pedido fica com o maior", d.tipo === "atualizar" && (d as any).mudar.lastNumber === 150 && !(d as any).conflitos.length, d);
}
{
  const proibidas = new Set(colunasQueNaoDescem(usuario, ["id", "password", "cashOpen", "ifoodAccessToken"]));
  const d = decidir(
    usuario,
    saida({ tabela: "User", antes: { id: "L", cashOpen: true, password: "" }, depois: { id: "L", cashOpen: false, password: "" } }),
    { id: "L", cashOpen: true, password: "$2b$hash" },
    proibidas,
  );
  confere("senha nunca sobe; fechar o caixa sobe", d.tipo === "atualizar" && (d as any).mudar.cashOpen === false && !("password" in (d as any).mudar), d);
  const nova = decidir(usuario, saida({ tabela: "User", operacao: "INSERT", depois: { id: "X" } }), null, proibidas);
  confere("a contingência não cria conta", nova.tipo === "recusar", nova);
}
{
  const d = decidir(pedido, saida({ operacao: "DELETE", antes: { id: "p1", status: "NOVO" } }), { id: "p1", status: "NOVO" }, nada);
  confere("apagado na loja, igual na nuvem: apaga sem conflito", d.tipo === "apagar" && !(d as any).conflitos.length, d);
  const d2 = decidir(pedido, saida({ operacao: "DELETE", antes: { id: "p1", status: "NOVO" } }), { id: "p1", status: "ACEITO" }, nada);
  confere("apagado na loja, mudado na nuvem: apaga e anota", d2.tipo === "apagar" && (d2 as any).conflitos.length === 1, d2);
  const d3 = decidir(pedido, saida({ operacao: "DELETE", antes: { id: "p1" } }), null, nada);
  confere("apagado nos dois: nada", d3.tipo === "nada", d3);
}
{
  const d = decidir(
    pedido,
    saida({ antes: { id: "p1", status: "NOVO", updatedAt: "a" }, depois: { id: "p1", status: "NOVO", updatedAt: "b" } }),
    { id: "p1", status: "NOVO", updatedAt: "c" },
    nada,
  );
  confere("updatedAt nunca é conflito", d.tipo === "atualizar" && !(d as any).conflitos.length, d);
}
{
  // A cada consulta da fila no computador da loja, o User ganha a hora da
  // consulta: na volta isso não sobe nem vira conflito.
  const pulso = decidir(
    usuario,
    saida({
      tabela: "User",
      antes: { id: "L", cashOpen: true, printQueuePolledAt: "10:00:00", updatedAt: "10:00:00" },
      depois: { id: "L", cashOpen: true, printQueuePolledAt: "10:00:03", updatedAt: "10:00:03" },
    }),
    { id: "L", cashOpen: true, printQueuePolledAt: "09:58:00", updatedAt: "09:58:00" },
    nada,
  );
  confere("só o pulso do Assistente mudou: nada sobe", pulso.tipo === "nada", pulso);
  const junto = decidir(
    usuario,
    saida({
      tabela: "User",
      antes: { id: "L", cashOpen: true, printQueuePolledAt: "10:00:00", updatedAt: "10:00:00" },
      depois: { id: "L", cashOpen: false, printQueuePolledAt: "10:00:03", updatedAt: "10:00:03" },
    }),
    { id: "L", cashOpen: true, printQueuePolledAt: "09:58:00", updatedAt: "09:58:00" },
    nada,
  );
  confere(
    "caixa fechado junto com o pulso: sobe o caixa, sem o pulso e sem conflito",
    junto.tipo === "atualizar" && (junto as any).mudar.cashOpen === false && !("printQueuePolledAt" in (junto as any).mudar) && !(junto as any).conflitos.length,
    junto,
  );
}
confere("JSON com chaves em outra ordem é igual", iguais({ a: 1, b: [1, { c: 2, d: 3 }] }, { b: [1, { d: 3, c: 2 }], a: 1 }));

console.log("\n— Catálogo e bilhete —");
confere("toda tabela tem chave", TABELAS_DA_COPIA.every((t) => t.chave.length > 0));
confere("pai/avô sempre com recorte de foto", TABELAS_DA_COPIA.every((t) => (t.loja.tipo === "pai" || t.loja.tipo === "avo") ? !!t.foto : true));
confere("senha do garçom desce, a do painel não", colunasQueNaoDescem(tabelaDaCopia("Waiter")!, ["passwordHash"]).length === 0 && colunasQueNaoDescem(usuario, ["password"]).includes("password"));
confere("token de fora não desce por regra geral", colunasQueNaoDescem(tabelaDaCopia("Motoboy")!, ["id", "pushToken"]).includes("pushToken"));
confere("registro de chave composta", idDoRegistro(contador, { franchiseeId: "L", dateKey: "k" }) === '["L","k"]');

const segredo = "segredo-de-teste";
const b = assinarBilhete({ v: 1, loja: "L", tipo: "painel", email: "a@b.c", exp: Date.now() + 60_000 }, segredo);
confere("bilhete bom abre", lerBilhete(b, segredo, "L")?.email === "a@b.c");
confere("bilhete de outra loja não abre", lerBilhete(b, segredo, "OUTRA") === null);
confere("bilhete com outro segredo não abre", lerBilhete(b, "outro", "L") === null);
confere("bilhete adulterado não abre", lerBilhete(b.replace(/^./, (c) => (c === "e" ? "f" : "e")), segredo, "L") === null);
const vencido = assinarBilhete({ v: 1, loja: "L", tipo: "painel", email: "a@b.c", exp: Date.now() - 1 }, segredo);
confere("bilhete vencido não abre", lerBilhete(vencido, segredo, "L") === null);

console.log("\n— Gatilho da nuvem —");
for (const t of tabelasComGatilho()) {
  const sql = sqlDaFuncao(t);
  const ok = sql.includes("EXCEPTION WHEN OTHERS") && sql.includes(`'${t.nome}'`) && sql.includes(`NOT EXISTS (SELECT 1 FROM "Contingencia" LIMIT 1)`);
  if (!ok) confere(`gatilho de ${t.nome} protegido e com atalho`, false, sql.slice(0, 200));
}
confere(`${tabelasComGatilho().length} gatilhos protegidos (erro engolido, saída rápida sem loja ativada)`, true);
confere("User só anota mudança fora do printQueuePolledAt", sqlDaFuncao(usuario).includes("printQueuePolledAt"));

console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo certo.");
if (falhas) process.exit(1);
