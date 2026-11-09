/**
 * Divinos, 08/11: a pizza 40 cm é combo; seu seletor escondia os sabores que
 * a pizza 30 cm já usa. Executa a consulta, os filtros e os handlers reais
 * com cadastro fictício em memória, sem rede nem mudança no cardápio da loja.
 *
 *   npx --no-install tsx scripts/teste-reutilizar-sabor-no-combo.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { idsSoDeOpcaoDeCombo } from "../src/lib/cardapio-interno";
import { dadosDoGrupo, comboItemId } from "../src/lib/grupo-do-combo";
import { semOpcoesPausadas } from "../src/lib/opcao-pausada";
import { SEM_ESPELHO } from "../src/lib/espelho-de-integracao";

type Linha = Record<string, any>;
const parse = (path: string) => ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const tela = parse("src/components/admin/MenuProductManager.tsx");
const pagina = parse("src/app/store/cardapio/page.tsx");
const rota = parse("src/app/api/admin/menu-products/route.ts");

function encontrar(ast: ts.SourceFile, teste: (node: ts.Node) => boolean) {
  const encontrados: ts.Node[] = [];
  const visitar = (node: ts.Node) => {
    if (teste(node)) encontrados.push(node);
    ts.forEachChild(node, visitar);
  };
  visitar(ast);
  assert.equal(encontrados.length, 1, "trecho real encontrado sem ambiguidade");
  return encontrados[0];
}
function inicializador(nome: string) {
  return (encontrar(tela, n => ts.isVariableDeclaration(n) && n.name.getText(tela) === nome) as ts.VariableDeclaration).initializer!.getText(tela);
}
function executar(fonte: string, deps: Linha) {
  const js = ts.transpileModule(`function executar(deps: any) { const { ${Object.keys(deps).join(",")} } = deps; return (${fonte}); }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return new Function(`${js}; return executar;`)()(deps);
}

async function main() {
  const nevada = { id: "nevada", name: "Banana Nevada", franchiseeId: "loja", category: "Sabores", price: 0, isCombo: false, apenasEmCombo: true, active: true, origemIntegracao: null };
  const canela = { ...nevada, id: "canela", name: "Banana c/ Canela" };
  const outroSabor = { ...nevada, id: "sabor-pausado", name: "Banana pausada", active: false };
  const bebida = { ...nevada, id: "bebida", name: "Refrigerante", price: 8, apenasEmCombo: false };
  const pergunta = (items: Linha[]) => ({ title: "Escolha até 2 sabores", minQty: 1, maxQty: 2, priceRule: "MEDIA", items });
  const pizza30 = { id: "pizza30", name: "Pizza 30 cm", franchiseeId: "loja", isCombo: false, price: 0, active: true, origemIntegracao: null,
    comboGroups: [pergunta([{ menuProduct: nevada, additionalPrice: 39.9 }, { menuProduct: canela, additionalPrice: 32.9 }])] };
  const pizza40 = { ...pizza30, id: "pizza40", name: "Pizza 40 cm", isCombo: true,
    comboGroups: [pergunta([{ menuProduct: canela, additionalPrice: 47.9 }])] };
  const banco = [nevada, canela, outroSabor, bebida, pizza30, pizza40,
    { ...nevada, id: "fora", franchiseeId: "outra-loja" },
    { ...nevada, id: "espelho", origemIntegracao: "99Food" },
    { ...nevada, id: "outro-combo", isCombo: true }];
  const antes = structuredClone(banco);

  // A lista do servidor continua sendo da loja, sem espelhos e sem combos.
  // Não se alarga essa consulta para resolver o filtro errado do componente.
  const chamada = encontrar(pagina, n => ts.isCallExpression(n)
    && n.expression.getText(pagina) === "prisma.menuProduct.findMany"
    && /isCombo:\s*false/.test(n.arguments[0]?.getText(pagina) || "")) as ts.CallExpression;
  const consulta = executar(chamada.arguments[0].getText(pagina), { franchiseeFilter: { franchiseeId: "loja" }, SEM_ESPELHO });
  assert.deepEqual(consulta.where, { franchiseeId: "loja", origemIntegracao: null, isCombo: false });
  const availableItems = banco.filter(p => Object.entries(consulta.where).every(([k, v]) => p[k as keyof typeof p] === v))
    .map(p => Object.fromEntries(Object.keys(consulta.select).map(k => [k, p[k as keyof typeof p]])));
  const catalogoDeOpcoes = executar(inicializador("catalogoDeOpcoes"), {
    availableItems, opcoesCriadas: [availableItems[0]], useMemo: (f: () => any) => f(),
  });
  assert.equal(catalogoDeOpcoes.filter((p: Linha) => p.id === nevada.id).length, 1, "catálogo deduplica por id");
  const soOpcaoDeCombo = idsSoDeOpcaoDeCombo(banco);
  const ehOpcaoDeCombo = executar(inicializador("ehOpcaoDeCombo"), { soOpcaoDeCombo });
  let grupos: Linha[] = [pergunta([{ id: canela.id, additionalPrice: 47.9 }])];
  const buscar = (isCombo: boolean, buscaOpcao: string, editingId = pizza40.id) => executar(inicializador("candidatos"), {
    catalogoDeOpcoes, editingId, isCombo, ehOpcaoDeCombo, group: grupos[0], buscaOpcao,
  }) as Linha[];
  assert.ok(buscar(true, " banana ").some(p => p.id === nevada.id), "combo encontra o MESMO sabor já usado na pizza 30");
  assert.ok(!buscar(true, "banana").some(p => p.id === canela.id), "opção já usada nesta pergunta não duplica");
  assert.ok(buscar(true, "banana").some(p => p.id === outroSabor.id && p.active === false), "opção pausada pode ser vinculada sem reativá-la");
  assert.ok(!buscar(true, "").some(p => ["fora", "espelho", "outro-combo", pizza40.id].includes(p.id)), "não introduz outra loja, espelho, combo dentro de combo ou o próprio item");
  assert.ok(!buscar(false, "", pizza30.id).some(p => p.id === pizza30.id), "pergunta de item comum também exclui a si mesmo");
  assert.ok(buscar(false, "nevada").some(p => p.id === nevada.id), "item comum continua reutilizando complemento");

  // O que o combo leva é um seletor diferente, de itens FIXOS: preservado.
  const fixos = executar(inicializador("candidatosFixos"), { catalogoDeOpcoes, editingId: pizza40.id, ehOpcaoDeCombo, buscaFixo: "" }) as Linha[];
  assert.ok(!fixos.some(p => p.id === nevada.id), "complemento não vira conteúdo fixo do combo");
  assert.ok(fixos.some(p => p.id === bebida.id), "conteúdo fixo ainda aceita item avulso");

  // Clique e preço executam os handlers do formulário, não uma cópia deles.
  const deps = { setComboGroups: (f: (prev: Linha[]) => Linha[]) => { grupos = f(grupos); } };
  executar(inicializador("addGroupItem"), deps)(0, nevada.id);
  executar(inicializador("addGroupItem"), deps)(0, nevada.id);
  assert.equal(grupos[0].items.length, 2, "vínculo existente não é clonado nem duplicado");
  assert.equal(grupos[0].items.find((p: Linha) => p.id === nevada.id).additionalPrice, 0, "seleção não adivinha o preço de 40 cm");
  executar(inicializador("updateGroupItemPrice"), deps)(0, nevada.id, 55.5); // valor fictício, não preço da loja
  const payload: Linha[] = dadosDoGrupo(grupos[0], 0).items.create;
  assert.equal(payload.find(p => p.menuProductId === nevada.id)?.additionalPrice, 55.5);
  assert.equal(payload.find(p => p.menuProductId === canela.id)?.additionalPrice, 47.9, "preço de opção já existente na 40 fica");
  assert.deepEqual(banco, antes, "seleção e edição do vínculo não criam nem alteram MenuProduct, nem a pizza 30");

  // A mesma identidade persiste nos dois tamanhos: uma pausa serve aos dois.
  const nova40 = { ...pizza40, comboGroups: [{ ...grupos[0], items: payload.map(p => ({ ...p, menuProduct: banco.find(b => b.id === p.menuProductId)! })) }] };
  assert.equal(nova40.comboGroups[0].items.find((p: Linha) => p.menuProductId === nevada.id)?.menuProduct, pizza30.comboGroups[0].items[0].menuProduct);
  nevada.active = false;
  for (const pizza of [pizza30, nova40]) {
    assert.ok(!semOpcoesPausadas(pizza).comboGroups[0].items.some((p: Linha) => p.menuProduct.id === nevada.id), "uma pausa oculta o sabor nos dois tamanhos");
  }
  assert.ok(idsSoDeOpcaoDeCombo(banco).has(nevada.id), "reutilização não põe complemento à venda avulsa");

  // O guard real da API conserva apenas ids da mesma loja no salvamento.
  const guard = encontrar(rota, n => ts.isFunctionDeclaration(n) && n.name?.text === "keepOwnComboItems").getText(rota);
  const prisma = { menuProduct: { findMany: async ({ where }: any) => banco.filter(p => p.franchiseeId === where.franchiseeId && where.id.in.includes(p.id)).map(p => ({ id: p.id })) } };
  const manterDaLoja = executar(`(() => { ${guard}; return keepOwnComboItems; })()`, { prisma, comboItemId });
  const seguro = await manterDaLoja([{ ...grupos[0], items: [...grupos[0].items, { id: "fora", additionalPrice: 1 }] }], "loja");
  assert.deepEqual(seguro[0].items.map((p: Linha) => p.id), [canela.id, nevada.id], "API permite vínculo próprio e descarta outra loja");
  assert.equal(banco.length, antes.length, "nenhum cadastro novo foi necessário");
  console.log("OK: seletor e handlers reais; sabor compartilhado, preços por pergunta, pausa conjunta, itens fixos e escopo preservados.");
}
main().catch(e => { console.error(e); process.exitCode = 1; });
