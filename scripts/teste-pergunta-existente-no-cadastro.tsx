/** Cadastro/reutilização pelos handlers reais, com dois produtos fictícios.
 * Não acessa rede, banco ou dados da loja. Executar com tsx. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import EscolhaDePergunta from "../src/components/admin/EscolhaDePergunta";
import CriarGrupoDeComplementos from "../src/components/admin/CriarGrupoDeComplementos";
import { TrazerPerguntaDeOutro } from "../src/components/admin/UsarPerguntaEmOutros";
import { copiaDoGrupo, motivoParaNaoCopiar, tituloNormalizado } from "../src/lib/copiar-pergunta";
import { ehProdutoDeIntegracao } from "../src/lib/cardapio-interno";
import { dadosDoGrupo } from "../src/lib/grupo-do-combo";

type Linha = Record<string, any>;
const arquivo = (p: string) => ts.createSourceFile(p, readFileSync(p, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const manager = arquivo("src/components/admin/MenuProductManager.tsx");
const picker = arquivo("src/components/admin/UsarPerguntaEmOutros.tsx");
function unico(ast: ts.SourceFile, criterio: (n: ts.Node) => boolean): ts.Node {
  const achados: ts.Node[] = [];
  const visitar = (n: ts.Node) => { if (criterio(n)) achados.push(n); ts.forEachChild(n, visitar); };
  visitar(ast); assert.equal(achados.length, 1, "handler real encontrado sem ambiguidade"); return achados[0];
}
function inicializador(ast: ts.SourceFile, nome: string): string {
  return (unico(ast, n => ts.isVariableDeclaration(n) && n.name.getText(ast) === nome) as ts.VariableDeclaration).initializer!.getText(ast);
}
function executar(fonte: string, deps: Linha): any {
  const js = ts.transpileModule(`function executar(deps: any) { const { ${Object.keys(deps).join(",")} } = deps; return (${fonte}); }`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  return new Function(`${js}; return executar;`)()(deps);
}
function texto(n: any): string { return n == null || typeof n === "boolean" ? "" : typeof n === "string" || typeof n === "number" ? String(n) : Array.isArray(n) ? n.map(texto).join(" ") : texto(n.props?.children); }
function botoes(n: any): any[] { return !n || typeof n !== "object" ? [] : Array.isArray(n) ? n.flatMap(botoes) : [...(n.type === "button" ? [n] : []), ...botoes(n.props?.children)]; }

// As duas escolhas não criam um cadastro de opção nem enviam requisição.
let usou = 0, criou = 0;
const escolha = EscolhaDePergunta({ onUsarExistente: () => usou++, onCriarNova: () => criou++ });
const acoes = botoes(escolha);
acoes.find(b => texto(b).includes("Usar pergunta existente"))!.props.onClick();
assert.deepEqual([usou, criou], [1, 0]);
acoes.find(b => texto(b).includes("Criar nova pergunta"))!.props.onClick();
assert.deepEqual([usou, criou], [1, 1]);

// Item comum novo também passa por Perguntas; opção de combo não ganha construtor.
for (const isCombo of [false, true]) {
  const abas = executar(inicializador(manager, "abasDoForm"), { editandoOpcao: false, isCombo, modoPassos: true });
  assert(abas.some((a: Linha) => a.id === "perguntas"));
}
assert(!executar(inicializador(manager, "abasDoForm"), { editandoOpcao: true, isCombo: false, modoPassos: false }).some((a: Linha) => a.id === "perguntas"));

const bacon = { id: "op-bacon", name: "Bacon", active: true };
const cheddar = { id: "op-cheddar", name: "Cheddar", active: false };
const grupo = { id: "grupo-origem", title: "Adicionais", minQty: 0, maxQty: 4, priceRule: null, items: [
  { menuProductId: cheddar.id, menuProduct: cheddar, additionalPrice: 2, promoAdditionalPrice: 0, maxPerItem: 1, sortOrder: 1 },
  { menuProductId: bacon.id, menuProduct: bacon, additionalPrice: 4, additionalPriceSalao: 4.5, additionalPriceDelivery: 5, additionalPriceTotem: null, maxPerItem: 2, optionNote: "Porção de 30g", sortOrder: 0 },
] };
const origem = { id: "produto-a", name: "Burguer A", category: "Burgers", franchiseeId: "loja-a", active: true, isCombo: false, comboGroups: [grupo] };
const destino = { ...origem, id: "produto-b", name: "Burguer B", comboGroups: [] };
const outra = { ...origem, id: "outra-loja", franchiseeId: "loja-b" };
const antes = structuredClone(origem);

const lista = executar(inicializador(picker, "lista"), { produtos: [origem, destino, outra], produtoAtualId: destino.id, franchiseeId: "loja-a", busca: "adicionais", motivoParaNaoCopiar, tituloNormalizado, ehProdutoDeIntegracao, useMemo: (f: () => any) => f() });
assert.deepEqual(lista.map((l: Linha) => l.produto.id), [origem.id], "não oferece origem de outra loja nem o próprio produto");

let form: Linha[] = [], canal = false, aberto = true;
const trazer = executar(inicializador(manager, "trazerPergunta"), {
  setComboGroups: (f: (g: Linha[]) => Linha[]) => { form = f(form); },
  setPrecosCanalNoCombo: (v: boolean) => { canal = v; }, setTrazendoPergunta: (v: boolean) => { aberto = v; },
});
const click = unico(picker, n => ts.isArrowFunction(n) && n.body.getText(picker).startsWith("onEscolher(copiaDoGrupo(grupo)")) as ts.ArrowFunction;
let fonte: Linha | null = null;
executar(click.getText(picker), { produto: origem, grupo, copiaDoGrupo, onEscolher: (c: Linha, f: Linha) => { fonte = f; trazer(c); } })();
assert.equal((fonte as any).grupo.id, grupo.id);
assert.equal((fonte as any).produto.id, origem.id);
assert.equal(form.length, 1); assert.equal(aberto, false); assert.equal(canal, true);
assert.deepEqual(form[0].items.map((i: Linha) => i.id), [bacon.id, cheddar.id], "reutiliza os mesmos IDs na ordem da pergunta");
const salvo = dadosDoGrupo(form[0], 0);
assert.equal(salvo.minQty, 0); assert.equal(salvo.maxQty, 4); assert.equal(salvo.priceRule, null);
assert.equal(salvo.items.create[0].additionalPrice, 4);
assert.equal(salvo.items.create[0].additionalPriceSalao, 4.5);
assert.equal(salvo.items.create[0].additionalPriceDelivery, 5);
assert.equal(salvo.items.create[0].maxPerItem, 2);
assert.equal(salvo.items.create[0].optionNote, "Porção de 30g");
assert.equal(salvo.items.create[1].promoAdditionalPrice, 0);
assert.equal(cheddar.active, false, "não reativa opção pausada");
form[0].items[0].additionalPrice = 7;
assert.deepEqual(origem, antes, "editar o acréscimo da pergunta no produto B preserva o produto A");

// A porta da aba Complementos entrega a origem ao fluxo nativo de destinos.
const elemento = unico(manager, n => ts.isJsxSelfClosingElement(n) && n.tagName.getText(manager) === "TrazerPerguntaDeOutro") as ts.JsxSelfClosingElement;
const atributo = elemento.attributes.properties.find(a => ts.isJsxAttribute(a) && a.name.getText(manager) === "onEscolher") as ts.JsxAttribute;
const handler = (atributo.initializer as ts.JsxExpression).expression!.getText(manager);
let escolhido: any = null;
executar(handler, { escolhendoPerguntaParaOutros: true, setEscolhendoPerguntaParaOutros: () => {}, setUsandoPergunta: (v: any) => { escolhido = v; }, trazerPergunta: () => { throw Error("não deve preencher formulário neste caminho"); } })(copiaDoGrupo(grupo), { grupo, produto: origem });
assert.equal(escolhido.grupo.id, grupo.id); assert.equal(escolhido.produto.id, origem.id);

// SSR dos componentes reais: descoberta inicial e prévia de valores/pausa.
const novoGrupo = renderToStaticMarkup(<CriarGrupoDeComplementos produtos={[]} catalogo={[]} categorias={[]} onFechar={() => {}} onFeito={() => {}} onUsarExistente={() => {}} />);
assert(novoGrupo.includes("Usar pergunta existente") && novoGrupo.includes("Criar nova pergunta"));
assert(!novoGrupo.includes("Nome da pergunta"), "não começa cadastrando outra pergunta antes de oferecer reutilização");
const html = renderToStaticMarkup(<TrazerPerguntaDeOutro produtos={[origem, destino, outra]} produtoAtualId={destino.id} franchiseeId="loja-a" titulosJaUsados={[]} onEscolher={() => {}} onFechar={() => {}} />);
assert(html.includes("Buscar pergunta existente") && html.includes("Ver opções e valores"));
assert(html.includes("Bacon") && html.includes("Pausada") && html.includes("Delivery:"));
assert(!html.includes("outra-loja"));
assert(html.includes("As regras e os acréscimos ficam em cada produto"), "a prévia não promete sincronização de regras");
console.log("PASS: criar/reutilizar/editar em dois produtos, escolhas do formulário, origem/destinos, preços/regras/pausa e escopo de loja.");
