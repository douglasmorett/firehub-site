/**
 * Regressão Karen: executa o sync REAL inteiro, extraído por AST, com ORM em
 * memória. Sem .env, banco, IA, entrega externa, impressão ou mensagens reais.
 *
 *   node scripts/teste-robo-item-sem-cupom.mjs
 *   FIREHUB_SYNC_BASE=<arquivo chatbot-ai.ts anterior> node scripts/teste-robo-item-sem-cupom.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = process.env.FIREHUB_SYNC_BASE || path.join(root, "src/lib/chatbot-ai.ts");
const source = fs.readFileSync(sourcePath, "utf8");
const ast = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const compile = (text) => ts.transpileModule(text, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const extracted = (name) => {
  const node = ast.statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === name);
  assert.ok(node, `função real ${name} presente`);
  return node.getText(ast);
};
let draftBlock;
const findDraftBlock = (node) => {
  if (ts.isIfStatement(node) && node.expression.getText(ast) === "resultadoDoSync?.gravado === true && !resultadoDoSync.finalizado") draftBlock = node.thenStatement;
  ts.forEachChild(node, findDraftBlock);
};
findDraftBlock(ast);
assert.ok(draftBlock, "bloco real de resposta do rascunho presente");

function harness({ drafts = [], extraDeps = {} } = {}) {
  const writes = [];
  const logs = [];
  const calls = [];
  const fail = (what) => { throw new Error(`Efeito não permitido no teste: ${what}`); };
  const db = {
    customerOrder: {
      findMany: async (args) => { calls.push(["customerOrder.findMany", args]); return drafts; },
      create: async ({ data }) => { writes.push(data); return { id: "rascunho-sintetico", ...data }; },
      update: async ({ where, data }) => { writes.push(data); return { id: where.id, ...data }; },
      findUnique: async () => null,
    },
    customerOrderItem: { deleteMany: async (args) => { calls.push(["customerOrderItem.deleteMany", args]); return { count: 1 }; } },
    storeCustomer: { upsert: async () => fail("escrita de cliente não esperada") },
    $queryRaw: async (strings, ...values) => {
      const query = Array.isArray(strings) ? strings.join(" ") : String(strings);
      calls.push(["$queryRaw", query, values]);
      return /COUNT\(/i.test(query) ? [{ n: 0n }] : [];
    },
  };
  const Prisma = {
    DbNull: null,
    empty: "",
    sql: (strings, ...values) => ({ strings, values }),
    join: (values) => values,
  };
  const overrides = {
    prisma: db,
    Prisma,
    conferirEstoque: async () => ({ ok: true }),
    caixaParaPedidoOnline: async () => ({ ok: true }),
    checkAndCleanupStaleAiDrafts: async () => {},
    trackDivergenciaDePreco: async () => {},
    generateDailyOrderNumber: async () => fail("número de pedido real"),
    ...extraDeps,
  };
  const sandbox = {
    console: Object.fromEntries(["log", "warn", "error"].map((level) => [level, (...parts) => logs.push([level, parts.join(" ")])])),
    process: { env: {} },
    fetch: () => fail("rede"),
    setTimeout: () => fail("timer"),
    ...overrides,
  };
  const context = vm.createContext(sandbox);
  const cache = new Map();
  function load(specifier, from = path.join(root, "src/lib/chatbot-ai.ts")) {
    if (specifier === "@prisma/client") return { Prisma };
    if (specifier === "@/lib/prisma" || /(?:^|\/)prisma$/.test(specifier)) return { prisma: db };
    if (!specifier.startsWith(".") && !specifier.startsWith("@/")) fail(`import ${specifier}`);
    const resolved = specifier.startsWith("@/")
      ? path.join(root, "src", specifier.slice(2))
      : path.resolve(path.dirname(from), specifier);
    const file = fs.existsSync(resolved) && fs.statSync(resolved).isFile() ? resolved : `${resolved}.ts`;
    assert.ok(file.startsWith(path.join(root, "src") + path.sep), "import limitado ao código local");
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} };
    cache.set(file, module);
    const run = new vm.Script(`(function(require, module, exports) {\n${compile(fs.readFileSync(file, "utf8"))}\n})`, { filename: file }).runInContext(context);
    run((s) => load(s, file), module, module.exports);
    return module.exports;
  }
  for (const declaration of ast.statements.filter(ts.isImportDeclaration)) {
    const specifier = declaration.moduleSpecifier.text;
    const named = declaration.importClause?.namedBindings;
    if (!named || !ts.isNamedImports(named)) continue;
    for (const item of named.elements) {
      if (item.isTypeOnly || Object.hasOwn(sandbox, item.name.text)) continue;
      Object.defineProperty(sandbox, item.name.text, {
        configurable: true,
        get: () => load(specifier)[item.propertyName?.text || item.name.text],
      });
    }
  }
  const sync = new vm.Script(compile(`${extracted("pedidosQueATagPodeTocar")}\n${extracted("syncAiOrderToDatabase")}\nsyncAiOrderToDatabase;`), { filename: "sync-real-extraido.js" }).runInContext(context);
  const respond = new vm.Script(compile(`(function(resultadoDoSync, cleanText) { ${draftBlock.getText(ast)} return cleanText; })`), { filename: "resposta-real-extraida.js" }).runInContext(context);
  return { sync, respond, writes, logs, calls };
}

const excluded = { id: "calabresa", name: "CALABRESA RUSH", price: 39.99, semCupom: true, comboGroups: [] };
const eligible = { id: "bebida", name: "Bebida", price: 6, semCupom: false, comboGroups: [] };
const fixedCoupon = { code: "PRIMEIROPEDIDO", type: "fixed", discount: 10, active: true, primeiroPedido: true, usosPorCliente: 1 };
const money = (value) => Math.round(value * 100) / 100;
async function scenario({ products = [excluded], coupon = fixedCoupon, finalized = false, minimum = 0, quantity = 1, deliveryFee = 10.50, extraItems = [], harnessOptions, payloadExtras = {}, syncExtras = {} } = {}) {
  const h = harness(harnessOptions);
  const subtotal = products.reduce((sum, p) => sum + p.price * quantity, 0);
  const result = await h.sync({
    franchiseeId: "loja-sintetica",
    customerPhone: "5511900000000",
    customerName: "Cliente WhatsApp",
    storeProducts: products,
    lojaAberta: true,
    minimumOrderValue: minimum,
    payload: {
      items: [...products.map((p) => ({ name: p.name, quantity, price: 0.01 })), ...extraItems],
      deliveryType: "DELIVERY",
      address: "Rua de teste, 1, Bairro de teste",
      deliveryFee,
      totalAmount: money(subtotal + deliveryFee - 10),
      finalized,
      ...payloadExtras,
    },
    cupons: { lista: [coupon], campanha: null, chatbotConfig: {}, timeZone: "America/Sao_Paulo" },
    ...syncExtras,
  });
  assert.equal(h.logs.filter(([level]) => level === "error").length, 0, `nenhum erro silencioso: ${JSON.stringify(h.logs)}`);
  return { ...h, result };
}

let count = 0;
const check = async (name, test) => { await test(); count++; console.log(`ok ${name}`); };

await check("Calabresa 39,99 excluída: total 50,49, sem cupom e com aviso nominal", async () => {
  const { result, writes, respond } = await scenario();
  assert.equal(result.gravado, true);
  assert.equal(result.finalizado, false);
  assert.equal(result.total, 50.49);
  assert.equal(result.cupom, null);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].totalAmount, 50.49);
  assert.equal(writes[0].discountTotal ?? 0, 0);
  assert.equal(writes[0].status, "CRIANDO_IA");
  assert.equal(writes[0].items.create[0].price, 39.99, "preço do cadastro, não o alucinado");
  const answer = respond(result, "1 Calabresa Rush 39,99\nCupom PRIMEIROPEDIDO -R$10\nEntrega R$10,50\nTotal R$40,49. Confirma?");
  assert.match(answer, /CALABRESA RUSH/i);
  assert.match(answer, /Total: R\$ 50,49/);
  assert.match(answer, /n[aã]o aceita cupons nem descontos/i);
  assert.match(result.avisoDosItensSemCupom, /CALABRESA RUSH/);
  assert.match(result.avisoDosItensSemCupom, /n[aã]o aceita cupons nem descontos/i);
  assert.doesNotMatch(answer, /40,49|PRIMEIROPEDIDO|-[ ]?R?\$?[ ]?10|recebemos|em produ[çc][aã]o|registrado na cozinha/i);
  assert.equal(respond(result, "Anotado! Mais alguma coisa?"), "Anotado! Mais alguma coisa?", "não repete aviso a cada item sem resumo");
});

await check("sacola mista: fixo limitado aos R$6 elegíveis", async () => {
  const { result, writes, respond } = await scenario({ products: [excluded, eligible] });
  assert.equal(result.total, 50.49);
  assert.equal(result.cupom.desconto, 6);
  assert.equal(writes[0].discountTotal, 6);
  assert.match(result.avisoDosItensSemCupom, /CALABRESA RUSH/);
  assert.doesNotMatch(result.avisoDosItensSemCupom, /Bebida/);
  const answer = respond(result, "Total: R$46,49 com cupom PRIMEIROPEDIDO de R$10");
  assert.match(answer, /Cupom PRIMEIROPEDIDO: -R\$ 6,00/);
  assert.match(answer, /Total: R\$ 50,49/);
  assert.doesNotMatch(answer, /46,49/);
});

await check("percentual só sobre os itens elegíveis e suas quantidades", async () => {
  const { result } = await scenario({ products: [excluded, eligible], coupon: { ...fixedCoupon, type: "percent", discount: 50 }, quantity: 2 });
  assert.equal(result.cupom.desconto, 6);
  assert.equal(result.total, 96.48);
});

await check("sem exclusão: cupom automático e total anteriores preservados", async () => {
  const { result, writes, respond } = await scenario({ products: [{ ...excluded, semCupom: false }] });
  assert.equal(result.total, 40.49);
  assert.equal(result.cupom.desconto, 10);
  assert.equal(writes[0].discountTotal, 10);
  assert.ok(!result.avisoDosItensSemCupom);
  const correctAnswer = "Total: R$40,49 com o cupom de primeiro pedido";
  assert.equal(respond(result, correctAnswer), correctAnswer, "resposta já correta sem item excluído permanece igual");
});

await check("fechamento abaixo do mínimo50: sem pedido escrito e explica a restrição", async () => {
  const { result, writes } = await scenario({ finalized: true, minimum: 50 });
  assert.equal(result.gravado, false);
  assert.equal(result.regraDeNegocio, true);
  assert.match(result.mensagemParaOCliente, /CALABRESA RUSH/);
  assert.match(result.mensagemParaOCliente, /n[aã]o aceita cupons nem descontos/i);
  assert.match(result.mensagemParaOCliente, /39,99/);
  assert.match(result.mensagemParaOCliente, /50,00/);
  assert.match(result.mensagemParaOCliente, /10,01/);
  assert.equal(writes.length, 0);
});

await check("frete grátis por cupom continua permitido com produto excluído", async () => {
  const { result, respond } = await scenario({ coupon: { ...fixedCoupon, type: "free_shipping" } });
  assert.equal(result.cupom.freteGratis, true);
  assert.equal(result.total, 39.99);
  assert.equal(result.taxaDeEntrega, 0);
  assert.match(respond(result, "Total: R$50,49"), /entrega gr[aá]tis pelo cupom PRIMEIROPEDIDO/);
});

await check("item não reconhecido impede resumo com subtotal incompleto", async () => {
  const { result, respond } = await scenario({ extraItems: [{ name: "Pizza que não existe", quantity: 1 }] });
  assert.equal(result.itensDeFora, 1);
  assert.ok(!result.resumoComItensSemCupom);
  const modelText = "Total: R$90,49. Vou conferir a outra pizza.";
  assert.equal(respond(result, modelText), modelText);
});

await check("brinde dos carimbos continua nos itens do resumo e do rascunho", async () => {
  const { result, writes, respond } = await scenario({
    syncExtras: { carimbos: { storeLoyalty: {} } },
    harnessOptions: { extraDeps: {
      premioDosCarimbosNoPedido: async () => ({
        descontoExtra: 0,
        produtoGratis: { id: "sobremesa-brinde", nome: "Sobremesa grátis" },
        resgate: { descricao: "Sobremesa grátis", valorAplicado: 0 },
      }),
    } },
  });
  assert.equal(writes[0].items.create.length, 2);
  const answer = respond(result, "Total: R$40,49");
  assert.match(answer, /1x Sobremesa grátis/);
  assert.match(answer, /Total: R\$ 50,49/);
  assert.doesNotMatch(answer, /40,49/);
});

await check("reescrita preserva troco herdado e o mostra no resumo", async () => {
  const { result, writes, respond } = await scenario({
    payloadExtras: { paymentMethod: "Dinheiro" },
    harnessOptions: { drafts: [{
      id: "rascunho-anterior", franchiseeId: "loja-sintetica", customerPhone: "5511900000000",
      customerName: "Cliente WhatsApp", status: "CRIANDO_IA", source: "WHATSAPP_IA",
      createdAt: new Date(), totalAmount: 50.49, paymentMethod: "Dinheiro", changeAmount: 100,
      items: [{ menuProductId: "calabresa", productName: excluded.name, quantity: 1, price: 39.99 }],
    }] },
  });
  assert.equal(writes[0].changeAmount, 100);
  assert.match(respond(result, "Total: R$40,49"), /troco para R\$ 100,00/);
});

await check("substituição do resumo preserva aviso de agendamento recusado", async () => {
  const { result, respond } = await scenario();
  const answer = respond({ ...result, avisoDoAgendamento: "Esse horário não está disponível; escolha outro horário." }, "Total: R$40,49");
  assert.match(answer, /Esse horário não está disponível; escolha outro horário\./);
  assert.match(answer, /Total: R\$ 50,49/);
});

await check("aviso simples não substitui pergunta pendente por confirmação", async () => {
  const { result, respond } = await scenario();
  const question = "Essa pizza não aceita cupom. Qual tamanho você quer?";
  assert.equal(respond(result, question), question);
});

console.log(`${count} cenários do sync real aprovados. Nenhum efeito externo permitido.`);

