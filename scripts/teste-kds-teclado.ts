/** Handlers e zoom reais do KDS, sem API, pedido real ou navegador. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { controleDoTecladoNumerico, desfazerPeloTeclado, focoProtegidoNoKds } from "../src/lib/kds-teclado";

const source = readFileSync("src/app/store/kds/tela/page.tsx", "utf8");
const ast = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function find(test: (n: ts.Node) => boolean, parent: ts.Node = ast) {
  const nodes: ts.Node[] = [];
  const visit = (n: ts.Node) => { if (test(n)) nodes.push(n); ts.forEachChild(n, visit); };
  visit(parent); assert.equal(nodes.length, 1, "trecho real único"); return nodes[0];
}
function handler(target: string) {
  const registration = find(n => ts.isCallExpression(n) && n.expression.getText(ast) === `${target}.addEventListener` && n.arguments[0]?.getText(ast) === '"keydown"');
  const effect = ts.findAncestor(registration, n => ts.isCallExpression(n) && n.expression.getText(ast) === "useEffect") as ts.CallExpression;
  return (find(n => ts.isVariableDeclaration(n) && n.name.getText(ast) === "handleKeyDown", effect) as ts.VariableDeclaration).initializer!.getText(ast);
}
function execute(text: string, deps: Record<string, unknown>) {
  const js = ts.transpileModule(`const value = ${text};`, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
  return new Function("d", `const {${Object.keys(deps).join(",")}}=d;${js};return value;`)(deps);
}
const zoomInitializer = (find(n => ts.isVariableDeclaration(n) && n.name.getText(ast) === "mudarZoom") as ts.VariableDeclaration).initializer as ts.CallExpression;
const scrollInitializer = (name: string) => ((find(n => ts.isVariableDeclaration(n) && n.name.getText(ast) === name) as ts.VariableDeclaration).initializer as ts.CallExpression).arguments[0].getText(ast);
const limits = (name: string) => Number((find(n => ts.isVariableDeclaration(n) && n.name.getText(ast) === name) as ts.VariableDeclaration).initializer!.getText(ast));
const storage = new Map<string, string>();
function screen(stage = "production", key = "kds-zoom:p1") {
  let zoom = 1, modal = false;
  const scrolls: number[] = [], completed: string[] = [];
  let undone = 0, windowScroll = 0;
  const scrollContainerRef: { current: null | { scrollBy: (v: { top: number }) => void } } = { current: { scrollBy: v => scrolls.push(v.top) } };
  const window = { scrollBy: () => windowScroll++ };
  const mudarZoom = execute(zoomInitializer.arguments[0].getText(ast), {
    ZOOM_MIN: limits("ZOOM_MIN"), ZOOM_MAX: limits("ZOOM_MAX"), chaveDoZoom: key,
    setZoom: (change: (n: number) => number) => { zoom = change(zoom); },
    localStorage: { setItem: (k: string,v: string) => storage.set(k,v), removeItem: (k: string) => storage.delete(k) },
  });
  const scrollUp = execute(scrollInitializer("scrollUp"), { scrollContainerRef, window });
  const scrollDown = execute(scrollInitializer("scrollDown"), { scrollContainerRef, window });
  const ultimaBaixaPorTeclaRef = { current: 0 };
  const deps = { stage, mudarZoom, scrollUp, scrollDown, scrollContainerRef,
    focoProtegidoNoKds, controleDoTecladoNumerico, desfazerPeloTeclado, document: { querySelector: () => modal ? {} : null },
    filteredOrders: Array.from({ length: 9 }, (_,i) => ({ id: String(i+1) })),
    markAsPronto: (o: { id: string }) => completed.push(o.id), lastCompletedOrder: {}, undoLastCompletedOrder: () => undone++,
    ultimaBaixaPorTeclaRef, INTERVALO_ENTRE_BAIXAS_POR_TECLA_MS: 500, posicaoDesdeRef: { current: new Map() }, TOQUE_PROTEGIDO_MS: 500,
  };
  const documentHandler = execute(handler("document"), deps), windowHandler = execute(handler("window"), deps);
  return { press: (e: any) => { documentHandler(e); windowHandler(e); return e; }, get zoom() { return zoom; }, scrolls, completed,
    get undone() { return undone; }, get windowScroll() { return windowScroll; }, modal: (v: boolean) => { modal=v; }, ref: scrollContainerRef, resetDebounce: () => { ultimaBaixaPorTeclaRef.current=0; } };
}
const event = (code: string, key: string, overrides: Record<string, unknown> = {}) => ({
  code,key,location:3,keyCode:0,ctrlKey:false,altKey:false,metaKey:false,shiftKey:false,
  repeat:false,isComposing:false,defaultPrevented:false,target:{ nodeType:1,isContentEditable:false,closest:()=>null },
  preventDefault() { this.defaultPrevented=true; }, ...overrides,
});

for (const stage of ["production","finishing"]) {
  const s=screen(stage);
  assert.equal(s.press(event("NumpadAdd","+")).defaultPrevented,true); assert.equal(s.zoom,1.1);
  s.press(event("NumpadSubtract","-")); assert.equal(s.zoom,1); assert.equal(storage.has("kds-zoom:p1"),false);
  s.press(event("NumpadDivide","/")); s.press(event("NumpadMultiply","*"));
  assert.deepEqual(s.scrolls,[-350,350]); assert.equal(s.windowScroll,0); assert.deepEqual(s.completed,[]);
  for(let i=0;i<20;i++)s.press(event("NumpadAdd","+")); assert.equal(s.zoom,1.5); assert.equal(storage.get("kds-zoom:p1"),"1.5");
  for(let i=0;i<20;i++)s.press(event("NumpadSubtract","-")); assert.equal(s.zoom,0.5);
}
const s=screen();
for(let n=1;n<=9;n++) { s.resetDebounce(); s.press(event(`Numpad${n}`,String(n))); }
assert.deepEqual(s.completed,["1","2","3","4","5","6","7","8","9"]);
for(const [code,key,n] of [["Numpad8","ArrowUp","8"],["Numpad2","ArrowDown","2"],["Numpad9","PageUp","9"],["Numpad3","PageDown","3"]]) {
  s.resetDebounce(); s.press(event(code,key)); assert.equal(s.completed.at(-1),n);
}
assert.deepEqual(s.scrolls,[],"Num Lock desligado não executa baixa e rolagem ao mesmo tempo");
s.resetDebounce(); s.press(event("Digit1","1",{location:0})); assert.equal(s.completed.at(-1),"1");
const count=s.completed.length; s.press(event("NumpadEnter","Enter")); s.press(event("Numpad1","1",{repeat:true})); assert.equal(s.completed.length,count);
s.press(event("KeyZ","z",{ctrlKey:true})); assert.equal(s.undone,1,"desfazer existente preservado");
s.press(event("ArrowDown","ArrowDown",{location:0})); assert.deepEqual(s.scrolls,[350],"controle remoto continua rolando");
for(const overrides of [{ctrlKey:true},{altKey:true},{metaKey:true},{shiftKey:true},{repeat:true},{isComposing:true},{defaultPrevented:true},
  {target:{nodeType:1,isContentEditable:true,closest:()=>null}},
  ...["input","textarea","select","button","a[href]","[role=slider]","[role=dialog]"].map(tag=>({target:{nodeType:1,isContentEditable:false,closest:()=>({tag})}}))]) {
  const protectedScreen=screen(); const e=protectedScreen.press(event("NumpadAdd","+",overrides));
  assert.equal(protectedScreen.zoom,1); assert.deepEqual(protectedScreen.completed,[]);
  if(!(overrides as Record<string,unknown>).defaultPrevented)assert.equal(e.defaultPrevented,false,"evento protegido não é capturado");
}
const modal=screen(); modal.modal(true); assert.equal(modal.press(event("NumpadDivide","/")).defaultPrevented,false); assert.deepEqual(modal.scrolls,[]);
modal.press(event("Numpad1","1")); assert.deepEqual(modal.completed,[]);
for(const [code,key] of [["Slash","/"],["Digit8","*"],["Equal","+"],["Minus","-"]]) {
  const e=screen().press(event(code,key,{location:0,shiftKey:code==="Digit8"})); assert.equal(e.defaultPrevented,false,"teclado normal não comanda zoom/rolagem");
}
const legacy=screen(); legacy.press(event("","/")); assert.deepEqual(legacy.scrolls,[-350],"fallback só para localização numérica");
const absent=screen(""); assert.equal(absent.press(event("NumpadAdd","+")).defaultPrevented,false);
const noContainer=screen(); noContainer.ref.current=null; assert.equal(noContainer.press(event("NumpadDivide","/")).defaultPrevented,false); assert.equal(noContainer.windowScroll,0);
const other=screen("finishing","kds-zoom:f2"); other.press(event("NumpadAdd","+")); assert.equal(storage.get("kds-zoom:f2"),"1.1"); assert.equal(storage.get("kds-zoom:p1"),"0.5");
const hub=readFileSync("src/app/store/kds/KDSHubClient.tsx","utf8"); assert.ok(hub.indexOf("<GuiaDoTeclado />")<hub.indexOf("{/* Empty state */}"),"guia antes das telas");
console.log("OK: handlers/zoom reais; operadores, limites/persistência por tela, números/NumLock, rolagemTV, foco/modais, modificadores e escopo preservados.");
