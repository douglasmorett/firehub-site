/**
 * Usar uma pergunta em outros produtos (src/lib/copiar-pergunta.ts): o que
 * não pode ser copiado, para onde a pergunta pode ir, pular/substituir, a
 * ordem no destino e os preços da opção (por canal e promoção) na cópia.
 * Sem banco.
 *
 *   npx tsx scripts/teste-copiar-pergunta.ts
 */
import {
  copiaDoGrupo,
  destinosDaPergunta,
  jaTemAPergunta,
  motivoParaNaoCopiar,
  planoNoDestino,
  tituloNormalizado,
} from "../src/lib/copiar-pergunta";

let ok = 0, falhas = 0;
function confere(nome: string, cond: boolean, detalhe?: unknown) {
  if (cond) ok++;
  else { falhas++; console.log(`✖ ${nome}`, detalhe === undefined ? "" : JSON.stringify(detalhe)); }
}

const op = (id: string, extra: Record<string, unknown> = {}) => ({ menuProductId: id, menuProduct: { id, name: id, active: true }, ...extra });
const adicionais = {
  id: "g-adic", title: "Adicionais", maxQty: 4, minQty: 0, priceRule: null, sortOrder: 1,
  items: [
    op("catupiry", { additionalPrice: 3, additionalPriceDelivery: 3.5, additionalPriceSalao: null, promoAdditionalPrice: 2, sortOrder: 1, optionNote: "40g" }),
    op("bacon", { additionalPrice: 4, additionalPriceTotem: 4.9, maxPerItem: 2, sortOrder: 0, precoPorEscolha: { Grande: 5 } }),
  ],
};
const loja = "loja-1";
const pastelCarne = { id: "p-carne", name: "Pastel de Carne", category: "Pastéis", franchiseeId: loja, active: true, isCombo: false, comboGroups: [adicionais] };
const pastelQueijo = { id: "p-queijo", name: "Pastel de Queijo", category: "pastéis ", franchiseeId: loja, active: true, isCombo: false, comboGroups: [{ id: "q1", title: " adicionais", sortOrder: 0, items: [op("bacon")] }] };
const pastelFrango = { id: "p-frango", name: "Pastel de Frango", category: "Pastéis", franchiseeId: loja, active: true, isCombo: false, comboGroups: [] };
const coca = { id: "coca", name: "Coca", category: "Bebidas", franchiseeId: loja, active: true, isCombo: false, price: 6, comboGroups: [] };
const catupiry = { id: "catupiry", name: "Catupiry", category: "Adicionais", franchiseeId: loja, active: true, apenasEmCombo: true, comboGroups: [] };
const bacon = { id: "bacon", name: "Bacon", category: "Adicionais", franchiseeId: loja, active: true, price: 0, comboGroups: [] };
const espelho = { id: "ifood-1", name: "Pastel iFood", category: "iFood", franchiseeId: loja, active: false, comboGroups: [] };
const deOutraLoja = { id: "x", name: "Pastel da vizinha", category: "Pastéis", franchiseeId: "loja-2", active: true, comboGroups: [] };
const cardapio = [pastelCarne, pastelQueijo, pastelFrango, coca, catupiry, bacon, espelho, deOutraLoja];

// ── travas ──────────────────────────────────────────────────────────────────
confere("Adicionais pode ser copiada", motivoParaNaoCopiar(adicionais, pastelCarne) === null);
const fixo = { title: "Vem no combo", minQty: 4, maxQty: 4, items: [op("xs")] };
confere("item fixo do combo não é copiado", !!motivoParaNaoCopiar(fixo, { id: "c1", isCombo: true }));
confere("mesma forma fora de combo é pergunta comum (sabor único)", motivoParaNaoCopiar(fixo, { id: "pa", isCombo: false }) === null);
confere("meio a meio não é copiado", !!motivoParaNaoCopiar({ title: "Meio a meio? Escolha a outra metade (cobra metade do preço de cada)", items: [op("m")] }, pastelCarne));
confere("sabores da pizza montada não são copiados", !!motivoParaNaoCopiar({ title: "Escolha até 2 sabores", priceRule: "MEDIA", items: [op("s")] }, pastelCarne));
confere("borda da pizza montada não é copiada", !!motivoParaNaoCopiar({ title: "Borda recheada?", items: [op("b")] }, pastelCarne));
confere("\"Escolha o sabor\" sem regra de pizza pode ser copiada", motivoParaNaoCopiar({ title: "Escolha o sabor", priceRule: null, items: [op("s")] }, pastelCarne) === null);
confere("pergunta sem opção não é copiada", !!motivoParaNaoCopiar({ title: "Vazia", items: [] }, pastelCarne));

// ── destinos ────────────────────────────────────────────────────────────────
const d = destinosDaPergunta(cardapio, pastelCarne, adicionais);
const ids = (l: { produto: { id: string } }[]) => l.map((x) => x.produto.id).sort().join(",");
confere("mesma categoria (sem ligar p/ caixa/acento/espaço): queijo e frango", ids(d.mesmaCategoria) === "p-frango,p-queijo", ids(d.mesmaCategoria));
confere("outras categorias: a Coca", ids(d.outras) === "coca", ids(d.outras));
confere("bloqueados: opções de combo e espelho", ids(d.bloqueados) === "bacon,catupiry,ifood-1", ids(d.bloqueados));
confere("origem e outra loja ficam de fora", ![...d.mesmaCategoria, ...d.outras, ...d.bloqueados].some((x) => x.produto.id === "p-carne" || x.produto.id === "x"));
confere("queijo já tem \"adicionais\"", d.mesmaCategoria.find((x) => x.produto.id === "p-queijo")?.jaTem === true);
confere("frango não tem", d.mesmaCategoria.find((x) => x.produto.id === "p-frango")?.jaTem === false);
confere("título normalizado ignora acento", tituloNormalizado("  Adicionáis  extras ") === "adicionais extras");
confere("jaTemAPergunta com título vazio é falso", !jaTemAPergunta(pastelQueijo, "  "));

// ── a cópia ─────────────────────────────────────────────────────────────────
const c = copiaDoGrupo(adicionais);
confere("título, máximo, mínimo e regra", c.title === "Adicionais" && c.maxQty === 4 && c.minQty === 0 && c.priceRule === null);
confere("opções na ordem arrumada (bacon antes)", c.items.map((i) => i.menuProductId).join(",") === "bacon,catupiry");
confere("sortOrder das opções renumerado", c.items.map((i) => i.sortOrder).join(",") === "0,1");
const cat = c.items.find((i) => i.menuProductId === "catupiry")!;
const bac = c.items.find((i) => i.menuProductId === "bacon")!;
confere("preço e delivery do catupiry", cat.additionalPrice === 3 && cat.additionalPriceDelivery === 3.5 && cat.additionalPriceSalao === null);
confere("promoção da opção vai junto", cat.promoAdditionalPrice === 2);
confere("observação da opção vai junto", cat.optionNote === "40g");
confere("totem e máximo do bacon", bac.additionalPriceTotem === 4.9 && bac.maxPerItem === 2);
confere("precoPorEscolha NÃO vai", !("precoPorEscolha" in bac));
confere("mínimo nulo continua nulo (= exige o máximo)", copiaDoGrupo({ title: "T", maxQty: 2, minQty: null, items: [op("a")] }).minQty === null);
confere("regra MEDIA vai junto", copiaDoGrupo({ title: "T", maxQty: 2, priceRule: "MEDIA", items: [op("a")] }).priceRule === "MEDIA");
confere("promo zero vale (não vira nulo)", copiaDoGrupo({ title: "T", items: [op("a", { promoAdditionalPrice: 0 })] }).items[0].promoAdditionalPrice === 0);

// ── plano no destino ────────────────────────────────────────────────────────
const existentes = [
  { id: "a", title: "Bebida", sortOrder: 0 },
  { id: "b", title: "ADICIONAIS", sortOrder: 1 },
  { id: "c", title: "Molho", sortOrder: 2 },
];
const pulo = planoNoDestino(existentes, "Adicionais", "pular", "fim");
confere("já tem + pular = pula", pulo.pular === true);
const subst = planoNoDestino(existentes, "Adicionais", "substituir", "fim");
confere("substituir apaga só a de mesmo título", !subst.pular && subst.apagar.join(",") === "b", subst);
confere("substituir no fim entra depois do Molho", !subst.pular && subst.sortOrder === 3 && subst.deslocar.length === 0, subst);
const novoFim = planoNoDestino(existentes, "Talheres", "pular", "fim");
confere("pergunta nova no fim = máx + 1", !novoFim.pular && novoFim.sortOrder === 3 && novoFim.apagar.length === 0);
const vazio = planoNoDestino([], "Talheres", "pular", "fim");
confere("produto sem pergunta: entra em 0", !vazio.pular && vazio.sortOrder === 0);
const inicio = planoNoDestino(existentes, "Talheres", "pular", "inicio");
confere("no começo: entra em 0", !inicio.pular && inicio.sortOrder === 0);
confere("no começo: as outras descem uma casa", !inicio.pular && JSON.stringify(inicio.deslocar) === JSON.stringify([{ id: "a", sortOrder: 1 }, { id: "b", sortOrder: 2 }, { id: "c", sortOrder: 3 }]), inicio);
const comFixo = planoNoDestino([{ id: "f", title: "Vem no combo", sortOrder: 0, fixo: true }, { id: "q", title: "Bebida", sortOrder: 1 }], "Talheres", "pular", "inicio");
confere("no começo de combo: depois do item fixo", !comFixo.pular && comFixo.sortOrder === 1 && JSON.stringify(comFixo.deslocar) === JSON.stringify([{ id: "q", sortOrder: 2 }]), comFixo);
const substInicio = planoNoDestino(existentes, "adicionais", "substituir", "inicio");
// O Molho já estava em 2 e continua: só desce quem muda de casa.
confere("substituir no começo: renumera sem a apagada", !substInicio.pular && substInicio.sortOrder === 0 && JSON.stringify(substInicio.deslocar) === JSON.stringify([{ id: "a", sortOrder: 1 }]), substInicio);
const empatados = planoNoDestino([{ id: "x", title: "X", sortOrder: 0 }, { id: "y", title: "Y", sortOrder: 0 }], "Z", "pular", "fim");
confere("sortOrder repetido: fim continua depois de todos", !empatados.pular && empatados.sortOrder === 1);

console.log(`${ok} ok, ${falhas} falha(s)`);
if (falhas > 0) process.exit(1);
