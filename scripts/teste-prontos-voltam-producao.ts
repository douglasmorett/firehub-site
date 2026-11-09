/**
 * Divinos, 08/11: ações em massa diziam sucesso, mas PREPARANDO + FINISHED
 * continuava na coluna Prontos. Rota e handler do quadro reais, banco em
 * memória, sem rede, cobrança, impressão ou pedido de cliente.
 *
 *   npx --no-install tsx scripts/teste-prontos-voltam-producao.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { prontoNaCozinha } from "../src/lib/pedidos-na-cozinha";
import { carimboDeStatus } from "../src/lib/order-stages";

process.env.DATABASE_URL = "postgresql://teste@127.0.0.1:1/sem-banco";
process.env.NEXTAUTH_SECRET = "teste-local-sem-rede";

type Linha = Record<string, any>;
let pedido: Linha;
let usuario: Linha;
let lojaIds: string[];
let antesDeGravar: (() => void) | null = null;
let gravacoes = 0;
const efeitos = { venda: 0, estoque: 0, fiscal: 0, notificacao: 0, parceiro: 0 };
const projetar = (linha: Linha, select?: Linha) => Object.fromEntries(
  Object.keys(select || linha).map(k => [k, structuredClone(linha[k] ?? null)]),
);
const prismaFalso = {
  user: { findUnique: async () => ({ ...usuario }) },
  customerOrder: {
    findUnique: async ({ select }: any) => projetar(pedido, select),
    update: async ({ where, data, select }: any) => {
      antesDeGravar?.(); antesDeGravar = null;
      if (Object.entries(where).some(([k, v]) => pedido[k] !== v)) {
        throw Object.assign(new Error("O pedido mudou"), { code: "P2025" });
      }
      const { items, ...campos } = data;
      Object.assign(pedido, structuredClone(campos));
      if (items?.updateMany) {
        for (const item of pedido.items) Object.assign(item, items.updateMany.data);
      }
      gravacoes++;
      return projetar(pedido, select);
    },
  },
};
(globalThis as any).prisma = prismaFalso;
const stub = (caminho: string, valores: Linha) => {
  const arquivo = require.resolve(caminho);
  require.cache[arquivo] = { id: arquivo, filename: arquivo, loaded: true, exports: { __esModule: true, ...valores } } as any;
};
stub("next-auth/next", { getServerSession: async () => ({ user: { email: usuario.email, role: usuario.role } }) });
stub("../src/lib/auth", { authOptions: {} });
stub("../src/lib/loja-ativa", { cookieDaVisao: async () => "all", lojasDaVisao: async () => ({ lojaIds }) });
stub("../src/lib/senha-do-gerente", { exigirSenhaDoGerente: async () => null });
stub("../src/lib/billing", { trackSaleForBilling: async () => { efeitos.venda++; } });
stub("../src/lib/stock", { deductStockForOrder: async () => { efeitos.estoque++; } });
stub("../src/lib/fiscal-automatico", { emitirNfceAutomatica: async () => { efeitos.fiscal++; } });
stub("../src/lib/order-notifications", { sendOrderNotification: async () => { efeitos.notificacao++; } });
stub("../src/lib/acrescimo-segue-o-pai", { acrescimosSeguemOPai: async () => {} });
for (const [caminho, nome] of [
  ["food99-status", "99Food"], ["brendi-status", "Brendi"], ["wabiz-status", "Wabiz"],
  ["keeta/status", "Keeta"], ["cardapioweb/status", "CardapioWeb"],
  ["anotaai/status", "AnotaAi"], ["aiqfome/status", "Aiqfome"],
]) stub(`../src/lib/${caminho}`, {
  [`ehPedido${nome}`]: () => false,
  [`sincronizar${nome}`]: async () => { efeitos.parceiro++; return { erros: [] }; },
});

const horaAnterior = new Date("2026-11-08T20:00:00Z");
function montar(mudancas: Linha = {}) {
  usuario = { id: "loja", email: "loja@teste", role: "LOJA", ownerId: null };
  lojaIds = ["loja"];
  pedido = {
    id: "pedido-teste", franchiseeId: "loja", franchisee: { ownerId: null },
    status: "PREPARANDO", deliveryType: "DELIVERY", source: "ONLINE",
    kdsStage: "FINISHED", readyAt: horaAnterior, kdsFinishedAt: horaAnterior,
    kdsProductionAt: horaAnterior, kdsFinishingAt: horaAnterior, kdsStationId: "tela-antiga",
    kdsTelasProntas: ["producao", "finalizacao"], kdsBaixas: [{ tela: "producao", estagio: "production" }],
    acceptedAt: horaAnterior, totalAmount: 42, paymentPaidAt: horaAnterior,
    items: [{ id: "item-a", prontoEm: horaAnterior }, { id: "item-b", prontoEm: horaAnterior }],
    ...mudancas,
  };
  antesDeGravar = null; gravacoes = 0;
  Object.assign(efeitos, { venda: 0, estoque: 0, fiscal: 0, notificacao: 0, parceiro: 0 });
}

async function main() {
  const { PUT } = await import("../src/app/api/customer-order/status/route");
  const chamar = async (status = "PREPARANDO") => {
    const r = await PUT(new Request("http://teste/api/customer-order/status", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId: pedido.id, status }),
    }));
    return { status: r.status, corpo: await r.json() };
  };

  // Reproduz o clique do vídeo executando o handler do componente, com seus
  // estados em memória. Não duplica a lógica de aplicar a resposta da API.
  const fonte = readFileSync("src/components/customer/StoreOrdersDashboard.tsx", "utf8");
  const ast = ts.createSourceFile("quadro.tsx", fonte, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let handler = "";
  const encontrar = (n: ts.Node) => {
    if (ts.isVariableDeclaration(n) && n.name.getText(ast) === "handleBulkStatusUpdate") handler = n.initializer!.getText(ast);
    ts.forEachChild(n, encontrar);
  };
  encontrar(ast);
  assert.ok(handler, "handler real da ação em massa encontrado");
  montar();
  let quadro: Linha[] = [structuredClone(pedido)];
  const deps = {
    bulkTargetStatus: "PREPARANDO", selectedOrderIds: new Set([pedido.id]), bulkMotivo: "",
    motivoValido: () => true, MENSAGEM_SEM_MOTIVO: "teste", setBulkUpdating: () => {},
    marcarProntoCozinha: () => { throw new Error("Não é marcar pronto"); },
    showToast: () => {}, setSelectedOrderIds: () => {}, setBulkTargetStatus: () => {}, setBulkMotivo: () => {},
    comSenhaDoGerente: async (f: any) => f({}), pedirSenha: () => {},
    fetch: async (_url: string, init: any) => PUT(new Request("http://teste/api/customer-order/status", init)),
    setOrders: (f: any) => { quadro = f(quadro); }, carimboDeStatus,
    router: { refresh: () => {} },
  };
  const executavel = ts.transpileModule(`function executar(deps: any) { const { ${Object.keys(deps).join(",")} } = deps; return (${handler})(); }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  await new Function(`${executavel}; return executar;`)()(deps);
  assert.equal(pedido.kdsStage, "PRODUCTION", "PREPARANDO + FINISHED realmente volta para produção no banco");
  assert.equal(prontoNaCozinha(quadro[0] as any), false, "sai de Prontos no quadro imediatamente, sem esperar poll");
  assert.equal(quadro[0].readyAt, null);
  assert.equal(pedido.readyAt, null); assert.equal(pedido.kdsFinishedAt, null);
  assert.equal(pedido.kdsFinishingAt, null); assert.equal(pedido.kdsStationId, null);
  assert.deepEqual(pedido.kdsTelasProntas, []); assert.deepEqual(pedido.kdsBaixas, []);
  assert.ok(pedido.items.every((i: Linha) => i.prontoEm === null), "itens voltam por fazer no KDS");
  assert.equal(pedido.totalAmount, 42); assert.equal(pedido.paymentPaidAt, horaAnterior);
  assert.deepEqual(efeitos, { venda: 0, estoque: 0, fiscal: 0, notificacao: 0, parceiro: 0 }, "voltar não refatura nem repete efeitos externos");
  const primeiraVolta = structuredClone(pedido);
  const repetido = await chamar();
  assert.equal(repetido.corpo.semMudanca, true); assert.equal(gravacoes, 1);
  assert.deepEqual(pedido, primeiraVolta, "repetir depois da volta é idempotente");
  console.log("ok: fluxo real em massa, carimbos/itens, quadro e repetição");

  for (const alteracoes of [
    { status: "ACEITO" }, { status: "PRONTO", kdsStage: null }, { kdsStage: "READY" },
    { status: "SAIU_ENTREGA", deliveryType: "RETIRADA" },
  ]) {
    montar(alteracoes); const r = await chamar();
    assert.equal(r.status, 200); assert.equal(pedido.kdsStage, "PRODUCTION");
    assert.equal(prontoNaCozinha(pedido as any), false);
  }
  montar({ kdsStage: "FINISHING" });
  const emFinalizacao = await chamar();
  assert.equal(emFinalizacao.corpo.semMudanca, true); assert.equal(pedido.kdsStage, "FINISHING"); assert.equal(gravacoes, 0);
  console.log("ok: pronto por etapa/status/retirada e finalização ainda em andamento preservada");

  montar(); usuario = { id: "funcionario", ownerId: "loja", email: "func@teste", role: "STAFF" };
  assert.equal((await chamar()).status, 200);
  montar({ franchiseeId: "filial" }); lojaIds = ["loja", "filial"];
  assert.equal((await chamar()).status, 200);
  montar({ franchiseeId: "outra-loja" });
  const alheio = structuredClone(pedido);
  assert.equal((await chamar()).status, 403); assert.equal(gravacoes, 0); assert.deepEqual(pedido, alheio);
  console.log("ok: funcionário da loja, grupo autorizado e pedido alheio recusado");

  montar(); antesDeGravar = () => { pedido.status = "SAIU_ENTREGA"; };
  assert.equal((await chamar()).status, 409, "despacho simultâneo não é sobrescrito");
  assert.equal(pedido.status, "SAIU_ENTREGA"); assert.equal(pedido.kdsStage, "FINISHED");
  assert.ok(pedido.items.every((i: Linha) => i.prontoEm), "conflito não apaga os carimbos dos itens");

  montar({ status: "ENTREGUE" });
  assert.equal((await chamar("ENTREGUE")).corpo.semMudanca, true); assert.equal(gravacoes, 0);
  assert.equal(efeitos.venda, 0); assert.equal(efeitos.notificacao, 0);
  montar({ status: "NOVO", kdsStage: null });
  assert.equal((await chamar("ACEITO")).status, 200);
  await new Promise(r => setTimeout(r, 10));
  assert.equal(pedido.kdsStage, "PRODUCTION"); assert.equal(efeitos.estoque, 1); assert.equal(efeitos.notificacao, 1);
  assert.equal((await chamar("ACEITO")).corpo.semMudanca, true); assert.equal(efeitos.estoque, 1);
  console.log("ok: concorrência, conclusão repetida e aceite normal/idempotente");
  console.log("Tudo certo.");
}
main().catch(e => { console.error(e); process.exit(1); });
