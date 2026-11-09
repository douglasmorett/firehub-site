/** Backspace/desfazer no KDS: callbacks REAIS por AST, estado/storage em memória.
 * Sem rede, banco, pedidos reais ou impressão.
 *   npx tsx scripts/teste-kds-backspace.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import {
  baixaRecenteNoKds, chaveDaBaixaNoKds, controleDoTecladoNumerico,
  desfazerPeloTeclado, focoProtegidoNoKds,
} from "../src/lib/kds-teclado";

const source = readFileSync(process.env.FIREHUB_KDS_BASE || "src/app/store/kds/tela/page.tsx", "utf8");
const ast = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function find(test: (n: ts.Node) => boolean, parent: ts.Node = ast) {
  const found: ts.Node[] = [];
  const visit = (n: ts.Node) => { if (test(n)) found.push(n); ts.forEachChild(n, visit); };
  visit(parent);
  assert.equal(found.length, 1, "trecho de produção real e único");
  return found[0];
}
const registration = find(n => ts.isCallExpression(n) && n.expression.getText(ast) === "document.addEventListener" && n.arguments[0]?.getText(ast) === '"keydown"');
const keyboardEffect = ts.findAncestor(registration, n => ts.isCallExpression(n) && n.expression.getText(ast) === "useEffect")!;
const keyboard = (find(n => ts.isVariableDeclaration(n) && n.name.getText(ast) === "handleKeyDown", keyboardEffect) as ts.VariableDeclaration).initializer!.getText(ast);
const undoInitializer = (find(n => ts.isVariableDeclaration(n) && n.name.getText(ast) === "undoLastCompletedOrder") as ts.VariableDeclaration).initializer as ts.CallExpression;
const undoSource = undoInitializer.arguments[0].getText(ast);
const stampUpdater = find(n => ts.isCallExpression(n) && n.expression.getText(ast) === "setLastCompletedOrder" &&
  !!n.arguments[0] && n.arguments[0].getText(ast).includes("{ ...atual, carimbados }")) as ts.CallExpression;
const markInitializer = (find(n => ts.isVariableDeclaration(n) && n.name.getText(ast) === "markAsPronto") as ts.VariableDeclaration).initializer as ts.CallExpression;
const markBody = (markInitializer.arguments[0] as ts.ArrowFunction).body as ts.Block;
const successIndex = markBody.statements.findIndex(n => ts.isVariableStatement(n) && n.declarationList.declarations.some(d => d.name.getText(ast) === "success"));
assert.ok(successIndex >= 0, "resposta real do envio de baixa encontrada");
const afterMarkSent = `async () => { ${markBody.statements.slice(successIndex).map(n => n.getText(ast)).join("\n")} }`;
const loadEffect = find(n => ts.isCallExpression(n) && n.expression.getText(ast) === "useEffect" && !!n.arguments[0] &&
  n.arguments[0].getText(ast).includes("localStorage.getItem(chaveDaBaixa)") && n.arguments[0].getText(ast).includes("setLastCompletedOrder")) as ts.CallExpression;

function execute(text: string, deps: Record<string, unknown>): any {
  const js = ts.transpileModule(`const value = ${text};`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function("deps", `const {${Object.keys(deps).join(",")}} = deps; ${js}; return value;`)(deps);
}
type Baixa = { order: { id: string; dailyOrderNumber: number }; previousStage: "production" | "finishing"; em: number; escopo: string; carimbados?: string[] };
const NOW = 1_800_000_000_000;
const scopeA = chaveDaBaixaNoKds("conta-a", "loja-a", "production", "tela-pizza", "Pizza");
const saved = (changes: Partial<Baixa> = {}): Baixa => ({
  order: { id: "ultimo-id", dailyOrderNumber: 148 }, previousStage: "production",
  em: NOW - 1000, escopo: scopeA, carimbados: ["item-ultimo"], ...changes,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((r, j) => { resolve = r; reject = j; });
  return { promise, resolve, reject };
}
function screen(options: { stage?: string; key?: string; last?: Baixa | null; response?: { ok: boolean; status: number; body?: unknown }; fetchError?: boolean; fetchGate?: Promise<void>; jsonGate?: Promise<unknown> } = {}) {
  const stage = options.stage ?? "production";
  const chaveDaBaixa = options.key ?? scopeA;
  let last = options.last === undefined ? saved() : options.last;
  let undoing = false, refreshes = 0, modal = false, jsonCalls = 0;
  const writes: Array<{ url: string; init: any; payload: any }> = [];
  const toasts: any[] = [], errors: unknown[] = [];
  const storage = new Map<string, string>();
  if (last) storage.set(chaveDaBaixa, JSON.stringify(last));
  const completedOrderIdsRef = { current: new Set(["anterior-id", "ultimo-id"]) };
  const exitingOrderIdsRef = { current: new Set(["ultimo-id"]) };
  const baixasEmAndamentoRef = { current: new Map<string, Promise<boolean>>() };
  const desfazendoRef = { current: false };
  const escopoAtualDaBaixaRef = { current: chaveDaBaixa };
  const toastTimerRef: { current: number | null } = { current: null };
  const lastJsonRef = { current: "json-antigo" }, geracaoRef = { current: 3 };
  const timers = new Map<number, () => void>();
  let timerId = 0;
  const localStorage = {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, value: string) => storage.set(k, value),
    removeItem: (k: string) => storage.delete(k),
  };
  const deps = () => ({
    stage, chaveDaBaixa, escopoDaBaixa: chaveDaBaixa, chaveDaTela: stage === "production" ? "tela-pizza" : "tela-expedicao",
    lastCompletedOrder: last, isUndoing: undoing, desfazendoRef, escopoAtualDaBaixaRef,
    baixaRecenteNoKds, desfazerPeloTeclado, focoProtegidoNoKds, controleDoTecladoNumerico,
    Date: class extends Date { static now() { return NOW; } },
    setIsUndoing: (value: boolean) => { undoing = value; },
    setLastCompletedOrder: (value: any) => { last = typeof value === "function" ? value(last) : value; },
    getDisplayOrderNumber: (order: { dailyOrderNumber: number }) => order.dailyOrderNumber,
    setToast: (value: any) => toasts.push(value), toastTimerRef,
    setTimeout: (callback: () => void) => { timers.set(++timerId, callback); return timerId; },
    clearTimeout: (id: number) => timers.delete(id),
    localStorage, baixasEmAndamentoRef, completedOrderIdsRef, exitingOrderIdsRef,
    setExitingOrderIds: (ids: Set<string>) => { assert.equal(ids.has("ultimo-id"), false); },
    lastJsonRef, geracaoRef,
    fetchOrders: async () => { refreshes++; },
    AbortController,
    fetch: async (url: string, init: any) => {
      assert.equal(url, "/api/kds", "nenhuma outra API, impressão ou mensagem");
      assert.equal(init.method, "PUT");
      writes.push({ url, init, payload: JSON.parse(init.body) });
      if (options.fetchGate) await options.fetchGate;
      if (options.fetchError) throw new Error("rede indisponível simulada");
      const response = options.response ?? { ok: true, status: 200, body: {} };
      return { ...response, json: async () => { jsonCalls++; return options.jsonGate ? await options.jsonGate : response.body ?? {}; } };
    },
    console: { error: (...values: unknown[]) => errors.push(values) },
    document: { querySelector: () => modal ? {} : null },
    filteredOrders: [{ id: "outro-id" }],
    markAsPronto: () => assert.fail("Backspace não pode dar outra baixa"),
    mudarZoom: () => assert.fail("Backspace não muda zoom"),
    scrollUp: () => assert.fail("Backspace não rola"), scrollDown: () => assert.fail("Backspace não rola"),
    scrollContainerRef: { current: {} }, ultimaBaixaPorTeclaRef: { current: 0 },
    INTERVALO_ENTRE_BAIXAS_POR_TECLA_MS: 500, posicaoDesdeRef: { current: new Map() }, TOQUE_PROTEGIDO_MS: 500,
  });
  const promises: Promise<unknown>[] = [];
  const newUndo = () => execute(undoSource, deps()) as () => Promise<void>;
  const press = (event: any) => {
    execute(keyboard, { ...deps(), undoLastCompletedOrder: () => { const promise = newUndo()(); promises.push(promise); return promise; } })(event);
    return event;
  };
  return {
    press, newUndo, writes, toasts, storage, promises, errors, completedOrderIdsRef, exitingOrderIdsRef,
    baixasEmAndamentoRef, desfazendoRef, escopoAtualDaBaixaRef, lastJsonRef, geracaoRef, timers,
    localStorage,
    load: () => execute(loadEffect.arguments[0].getText(ast), deps())(),
    setModal: (value: boolean) => { modal = value; },
    switchScope: (next: Baixa) => { last = next; escopoAtualDaBaixaRef.current = next.escopo; storage.set(next.escopo, JSON.stringify(next)); },
    get last() { return last; }, get undoing() { return undoing; }, get refreshes() { return refreshes; },
    get jsonCalls() { return jsonCalls; },
  };
}
const event = (changes: Record<string, unknown> = {}) => ({
  key: "Backspace", code: "Backspace", location: 0, repeat: false, isComposing: false,
  ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, defaultPrevented: false,
  target: { nodeType: 1, isContentEditable: false, closest: () => null },
  preventDefault() { this.defaultPrevented = true; }, ...changes,
});
const check = async (name: string, test: () => unknown | Promise<unknown>) => { await test(); console.log(`ok ${name}`); };

async function main() {
await check("escopo separa conta, visão, etapa e id da tela, com nome como fallback", () => {
  const base = ["conta-a", "loja-a", "production", "tela-pizza", "Pizza"] as [string, string, string, string, string];
  assert.equal(chaveDaBaixaNoKds(...base), scopeA);
  for (let i = 0; i < base.length - 1; i++) {
    const changed = [...base] as typeof base; changed[i] += "-outra";
    assert.notEqual(chaveDaBaixaNoKds(...changed), scopeA);
  }
  assert.equal(chaveDaBaixaNoKds("conta-a", "loja-a", "production", "tela-pizza", "Outro nome"), scopeA, "renomear não troca id físico");
  assert.notEqual(chaveDaBaixaNoKds("conta-a", "loja-a", "production", "", "Pizza"), chaveDaBaixaNoKds("conta-a", "loja-a", "production", "", "Burger"));
  assert.equal(chaveDaBaixaNoKds("", "loja-a", "production", "tela-pizza", "Pizza"), "", "sem conta não há histórico compartilhado");
  assert.notEqual(chaveDaBaixaNoKds("a_b", "c", "production", "t", "n"), chaveDaBaixaNoKds("a", "b_c", "production", "t", "n"), "componentes não colidem por delimitador");
});
await check("somente baixa recente do mesmo escopo e etapa é elegível", () => {
  assert.equal(baixaRecenteNoKds(saved(), scopeA, "production", NOW), true);
  for (const value of [null, saved({ em: NOW + 1 }), saved({ em: NOW - 30 * 60 * 1000 - 1 }), saved({ em: NaN }), saved({ escopo: "outra-conta" }), saved({ previousStage: "finishing" })]) {
    assert.equal(baixaRecenteNoKds(value, scopeA, "production", NOW), false);
  }
});
await check("Backspace por key ou code em teclado normal/numérico e aliases preservados", () => {
  for (const changes of [{}, { code: "", location: 3 }, { key: "Unidentified" }, { key: "z", code: "KeyZ" }, { key: "u", code: "KeyU" }, { key: "Z", code: "KeyZ", ctrlKey: true }]) {
    assert.equal(desfazerPeloTeclado(event(changes)), true);
  }
  for (const changes of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }, { shiftKey: true }, { key: "u", code: "KeyU", ctrlKey: true }, { key: "z", code: "KeyZ", altKey: true }, { key: "Delete", code: "Delete" }]) {
    assert.equal(desfazerPeloTeclado(event(changes)), false);
  }
});
await check("handler Backspace desfaz exclusivamente último id com tela e itens corretos", async () => {
  const s = screen(); const e = s.press(event()); await Promise.all(s.promises);
  assert.equal(e.defaultPrevented, true);
  assert.equal(s.writes.length, 1);
  assert.deepEqual(s.writes[0].payload, { orderId: "ultimo-id", action: "revert_production", tela: "tela-pizza", itens: ["item-ultimo"] });
  assert.equal(s.writes[0].init.credentials, "include");
  assert.equal(s.completedOrderIdsRef.current.has("anterior-id"), true);
  assert.equal(s.completedOrderIdsRef.current.has("ultimo-id"), false);
  assert.equal(s.exitingOrderIdsRef.current.has("ultimo-id"), false);
  assert.equal(s.last, null); assert.equal(s.storage.has(scopeA), false);
  assert.equal(s.refreshes, 1); assert.equal(s.lastJsonRef.current, ""); assert.equal(s.geracaoRef.current, 4);
  assert.equal(s.toasts.at(-1).tipo, "desfeito"); assert.equal(s.undoing, false); assert.equal(s.desfazendoRef.current, false);
});
await check("Backspace sem última baixa consome navegação do navegador e não envia PUT", async () => {
  const s = screen({ last: null }); const e = s.press(event()); await Promise.all(s.promises);
  assert.equal(e.defaultPrevented, true); assert.equal(s.writes.length, 0); assert.equal(s.last, null);
});
await check("finalização usa revert_finishing e a própria tela", async () => {
  const key = chaveDaBaixaNoKds("conta-a", "loja-a", "finishing", "tela-expedicao", "Expedição");
  const s = screen({ stage: "finishing", key, last: saved({ previousStage: "finishing", escopo: key }) });
  s.press(event({ key: "Unidentified", location: 3 })); await Promise.all(s.promises);
  assert.equal(s.writes[0].payload.action, "revert_finishing"); assert.equal(s.writes[0].payload.tela, "tela-expedicao");
});
await check("foco, composição, repetição, modais e modificadores não desfazem", async () => {
  for (const overrides of [{ repeat: true }, { isComposing: true }, { defaultPrevented: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true }, { shiftKey: true },
    { target: { nodeType: 1, isContentEditable: true, closest: () => null } },
    ...["input", "textarea", "select", "button", "a[href]", "[role=dialog]"].map(tag => ({ target: { nodeType: 1, isContentEditable: false, closest: () => ({ tag }) } }))]) {
    const s = screen(); s.press(event(overrides)); await Promise.all(s.promises);
    assert.equal(s.writes.length, 0); assert.ok(s.last);
  }
  const s = screen(); s.setModal(true); const e = s.press(event());
  assert.equal(e.defaultPrevented, false); assert.equal(s.writes.length, 0);
});
await check("baixa em andamento termina antes do único desfazer e entrega carimbos novos", async () => {
  const s = screen(); const pending = deferred<boolean>(); s.baixasEmAndamentoRef.current.set("ultimo-id", pending.promise);
  const undo = s.newUndo(); const first = undo(); const duplicate = undo();
  assert.equal(s.writes.length, 0); assert.equal(s.desfazendoRef.current, true);
  s.storage.set(scopeA, JSON.stringify(saved({ carimbados: ["item-resposta-da-baixa"] })));
  pending.resolve(true); await Promise.all([first, duplicate]);
  assert.equal(s.writes.length, 1); assert.deepEqual(s.writes[0].payload.itens, ["item-resposta-da-baixa"]);
});
await check("baixa que falhou não gera desfazer nem toca outro pedido", async () => {
  const s = screen(); s.baixasEmAndamentoRef.current.set("ultimo-id", Promise.resolve(false));
  await s.newUndo()(); assert.equal(s.writes.length, 0); assert.equal(s.last, null); assert.equal(s.refreshes, 0);
  assert.equal(s.completedOrderIdsRef.current.has("anterior-id"), true);
});
await check("troca de conta/tela durante espera não envia desfazer para a visão nova", async () => {
  for (const arrived of [true, false]) {
    const s = screen(); const pending = deferred<boolean>(); s.baixasEmAndamentoRef.current.set("ultimo-id", pending.promise);
    const undo = s.newUndo()();
    const next = saved({ escopo: "outra-conta-ou-tela", order: { id: "pedido-da-outra-tela", dailyOrderNumber: 150 } });
    s.switchScope(next);
    pending.resolve(arrived); await undo;
    assert.equal(s.writes.length, 0); assert.equal(s.refreshes, 0); assert.equal(s.desfazendoRef.current, false);
    assert.equal(s.last, next); assert.equal(s.storage.get(next.escopo), JSON.stringify(next)); assert.equal(s.toasts.length, 0);
  }
});
await check("troca de escopo durante fetch ou json preserva estado da tela nova em 200/409/500", async () => {
  for (const phase of ["fetch", "json"]) for (const status of [200, 409, 500]) {
    const pending = deferred<any>();
    const s = screen({ response: { ok: status === 200, status }, ...(phase === "fetch" ? { fetchGate: pending.promise } : { jsonGate: pending.promise }) });
    const undo = s.newUndo()();
    await Promise.resolve();
    assert.equal(s.writes.length, 1);
    if (phase === "json") assert.equal(s.jsonCalls, 1, "json realmente em andamento antes da troca");
    const next = saved({ escopo: "escopo-novo", order: { id: "novo-id", dailyOrderNumber: 151 } });
    s.switchScope(next);
    pending.resolve(phase === "fetch" ? undefined : { parceiroAvisado: true, error: "Já entregue" });
    await undo;
    assert.equal(s.last, next); assert.equal(s.storage.get(next.escopo), JSON.stringify(next));
    assert.equal(s.storage.has(scopeA), true, "a resposta antiga não limpa histórico enquanto outra visão está ativa");
    assert.equal(s.refreshes, 0); assert.equal(s.toasts.length, 0); assert.equal(s.errors.length, 0);
    assert.equal(s.lastJsonRef.current, "json-antigo"); assert.equal(s.geracaoRef.current, 3);
    assert.equal(s.completedOrderIdsRef.current.has("ultimo-id"), true);
    assert.equal(s.exitingOrderIdsRef.current.has("ultimo-id"), true);
    assert.equal(s.desfazendoRef.current, false); assert.equal(s.undoing, false);
  }
});
await check("falha de fetch após trocar escopo não injeta erro ou toast na visão nova", async () => {
  const pending = deferred<void>(); const s = screen({ fetchGate: pending.promise });
  const undo = s.newUndo()();
  const next = saved({ escopo: "escopo-novo", order: { id: "novo-id", dailyOrderNumber: 152 } });
  s.switchScope(next); pending.reject(new Error("rede caiu na requisição antiga")); await undo;
  assert.equal(s.last, next); assert.equal(s.storage.get(next.escopo), JSON.stringify(next));
  assert.equal(s.toasts.length, 0); assert.equal(s.errors.length, 0); assert.equal(s.refreshes, 0);
});
await check("objeto de outro escopo não apaga storage válido da chave atual", async () => {
  const s = screen({ last: saved({ escopo: "escopo-anterior" }) });
  const valid = JSON.stringify(saved({ order: { id: "pedido-valido-atual", dailyOrderNumber: 153 } }));
  s.storage.set(scopeA, valid); await s.newUndo()();
  assert.equal(s.writes.length, 0); assert.equal(s.storage.get(scopeA), valid);
});
await check("updater real dos carimbos não altera pedido de mesmo id em outro escopo", () => {
  const updater = execute(stampUpdater.arguments[0].getText(ast), { order: { id: "ultimo-id" }, chaveDaBaixa: scopeA, carimbados: ["carimbo-antigo"] });
  const current = saved({ escopo: "outra-visao", carimbados: ["carimbo-atual"] });
  assert.equal(updater(current), current, "React mantém o objeto atual sem sobrescrever carimbos");
  const sameScope = saved(); assert.deepEqual(updater(sameScope).carimbados, ["carimbo-antigo"]);
});
await check("resposta real da baixa em escopo antigo limpa falha sem afetar nova tela ou outro id", async () => {
  const newScope = chaveDaBaixaNoKds("conta-b", "loja-b", "production", "tela-pizza", "Pizza");
  for (const outcome of ["falha", "precisa-confirmar", "sucesso"]) for (const oldStoredId of ["ultimo-id", "outro-id-mais-recente"]) for (const newStoredId of ["id-da-tela-nova", "ultimo-id"]) {
    const storage = new Map([
      [scopeA, JSON.stringify(saved({ order: { id: oldStoredId, dailyOrderNumber: 148 } }))],
      [newScope, JSON.stringify(saved({ escopo: newScope, order: { id: newStoredId, dailyOrderNumber: 154 } }))],
    ]);
    const oldValue = storage.get(scopeA), newValue = storage.get(newScope);
    const completedOrderIdsRef = { current: new Set(["ultimo-id", "outro-id-mais-recente"]) };
    const exitingOrderIdsRef = { current: new Set(["ultimo-id", "outro-id-mais-recente"]) };
    const baixasEmAndamentoRef = { current: new Map([["ultimo-id", Promise.resolve(true)], ["outro-id-mais-recente", Promise.resolve(true)]]) };
    const noUi = () => assert.fail("resposta antiga não pode alterar UI, avisos ou consultar a tela nova");
    const deps = {
      envio: Promise.resolve(outcome !== "falha"), order: { id: "ultimo-id" }, chaveDaBaixa: scopeA,
      escopoAtualDaBaixaRef: { current: newScope },
      faltamNaProducao: outcome === "precisa-confirmar" ? [{ item: "Item de teste", tela: "Outra produção" }] : null,
      baixasEmAndamentoRef, exitingOrderIdsRef, completedOrderIdsRef,
      localStorage: { getItem: (key: string) => storage.get(key) ?? null, removeItem: (key: string) => storage.delete(key) },
      setExitingOrderIds: noUi, setLastCompletedOrder: noUi, setOrders: noUi, setToast: noUi, setConfirmarFim: noUi, fetchOrders: noUi,
      geracaoRef: { current: 10 }, lastJsonRef: { current: "tela-nova" },
    };
    await execute(afterMarkSent, deps)();
    assert.equal(baixasEmAndamentoRef.current.has("ultimo-id"), false);
    assert.equal(exitingOrderIdsRef.current.has("ultimo-id"), false);
    assert.equal(completedOrderIdsRef.current.has("ultimo-id"), outcome === "sucesso");
    assert.equal(baixasEmAndamentoRef.current.has("outro-id-mais-recente"), true);
    assert.equal(exitingOrderIdsRef.current.has("outro-id-mais-recente"), true);
    assert.equal(completedOrderIdsRef.current.has("outro-id-mais-recente"), true);
    assert.equal(storage.get(newScope), newValue, "chave atual intacta inclusive se pedido tem o mesmo id");
    if (outcome !== "sucesso" && oldStoredId === "ultimo-id") assert.equal(storage.has(scopeA), false);
    else assert.equal(storage.get(scopeA), oldValue, "sucesso ou histórico mais recente da tela antiga preservados");
    assert.equal(deps.geracaoRef.current, 10); assert.equal(deps.lastJsonRef.current, "tela-nova");
  }
});
await check("500 ou queda da rede preserva última baixa para tentar novamente", async () => {
  for (const options of [{ response: { ok: false, status: 500 } }, { fetchError: true }]) {
    const s = screen(options); await s.newUndo()();
    assert.equal(s.writes.length, 1); assert.ok(s.last); assert.equal(s.storage.has(scopeA), true);
    assert.equal(s.refreshes, 0); assert.equal(s.toasts.at(-1).tipo, "erro");
    assert.equal(s.undoing, false); assert.equal(s.desfazendoRef.current, false);
  }
});
await check("409 informa recusa e remove baixa que já não pode ser desfeita", async () => {
  const s = screen({ response: { ok: false, status: 409, body: { error: "Pedido já entregue" } } });
  await s.newUndo()(); assert.equal(s.writes.length, 1); assert.equal(s.last, null); assert.equal(s.storage.has(scopeA), false);
  assert.equal(s.toasts.at(-1).tipo, "erro"); assert.match(s.toasts.at(-1).label, /Pedido já entregue/); assert.equal(s.refreshes, 0);
});
await check("estado expirado ou de outro escopo não envia PUT, inclusive após recarga", async () => {
  for (const last of [saved({ em: NOW - 30 * 60 * 1000 - 1 }), saved({ escopo: "outra-conta" }), saved({ previousStage: "finishing" })]) {
    const s = screen({ last }); await s.newUndo()(); assert.equal(s.writes.length, 0);
    s.storage.set(scopeA, JSON.stringify(last)); s.load(); assert.equal(s.last, null);
  }
  const valid = screen(); valid.load(); assert.equal(valid.last?.order.id, "ultimo-id");
});
console.log("OK: Backspace/aliases, foco, escopo/30min, handler e undo reais, últimoID, tela/itens, concorrência, sucesso e falhas; nenhuma impressão/rede real.");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
