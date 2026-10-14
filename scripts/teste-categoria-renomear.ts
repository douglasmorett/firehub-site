import { planoDeApagar, planoDeRenomear, renomearNaLista, renomearNasConfigs } from "../src/lib/categoria-renomear";
let falhas = 0;
const ok = (nome: string, cond: boolean) => { if (!cond) falhas++; console.log(`${cond ? "✅" : "❌"} ${nome}`); };
const cats = [{ id: "c1", name: "Pizzas" }, { id: "c2", name: "Bebidas" }];

// Renomear
const real = planoDeRenomear({ atual: cats[0], nomeNovo: " Pizzas Salgadas ", categorias: cats });
ok("real: renomeia a própria linha", real.erro === undefined && real.renomearId === "c1" && real.nomeFinal === "Pizzas Salgadas" && !real.criar && !real.juntarEm);
ok("real: o nome antigo é o da linha", real.erro === undefined && real.nomeAntigo === "Pizzas");
const virt = planoDeRenomear({ atual: null, nomeAntigo: "Esfihas ", nomeNovo: "Esfihas Abertas", categorias: cats });
ok("virtual (Pizzou153): cria a linha, sem 404", virt.erro === undefined && virt.criar && virt.renomearId === null && virt.nomeAntigo === "Esfihas");
const junta = planoDeRenomear({ atual: cats[0], nomeNovo: "bebidas", categorias: cats });
ok("nome que já existe: junta na outra e apaga a antiga", junta.erro === undefined && junta.juntarEm === "c2" && junta.apagarId === "c1" && junta.nomeFinal === "Bebidas" && !junta.criar && !junta.renomearId);
const juntaVirt = planoDeRenomear({ atual: null, nomeAntigo: "Refris", nomeNovo: "BEBIDAS", categorias: cats });
ok("virtual para nome existente: junta, nada a apagar", juntaVirt.erro === undefined && juntaVirt.juntarEm === "c2" && juntaVirt.apagarId === null);
const caixa = planoDeRenomear({ atual: cats[0], nomeNovo: "PIZZAS", categorias: cats });
ok("só trocar maiúscula não é junção", caixa.erro === undefined && caixa.renomearId === "c1" && caixa.nomeFinal === "PIZZAS" && !caixa.juntarEm);
ok("nome vazio = 400", planoDeRenomear({ atual: cats[0], nomeNovo: "  ", categorias: cats }).erro !== undefined);
ok("virtual sem nome antigo = 400", planoDeRenomear({ atual: null, nomeNovo: "X", categorias: cats }).erro !== undefined);

// Apagar
ok("sem produto: apaga", (() => { const p = planoDeApagar({ nome: "Pizzas", produtos: 0 }); return p.erro === undefined && p.moverPara === null; })());
const com = planoDeApagar({ nome: "Pizzas", produtos: 12 });
ok("com produto e sem destino: 409 com a contagem", com.erro !== undefined && com.status === 409 && com.produtos === 12 && com.erro.includes("12 produtos"));
ok("1 produto no singular", planoDeApagar({ nome: "X", produtos: 1 }).erro?.includes("1 produto.") === true);
ok("com destino: move", (() => { const p = planoDeApagar({ nome: "Pizzas", produtos: 3, destino: { id: "c2", name: "Bebidas " } }); return p.erro === undefined && p.moverPara === "Bebidas"; })());
ok("destino igual à própria = 400", planoDeApagar({ nome: "Pizzas", produtos: 3, destino: { id: "", name: "pizzas" } }).erro !== undefined);

// Listas e configs por nome
ok("lista: troca e não repete", JSON.stringify(renomearNaLista(["Pizzas ", "Bebidas"], "pizzas", "Bebidas").lista) === JSON.stringify(["Bebidas"]));
ok("lista sem o nome: não mexe", renomearNaLista(["iFood"], "Pizzas", "X").mudou === false);
const cfg = renomearNasConfigs({
  printerConfig: { autoprint: true, printers: [{ id: "p1", categories: ["Pizzas", "iFood"] }, { id: "p2", categories: [] }] },
  kdsScreens: [{ id: "t1", categoryFilter: ["PIZZAS"] }, { id: "t2", categoryFilter: ["Bebidas"] }],
  kdsConfig: { soNaFinalizacao: ["Bebidas"] },
}, "Pizzas", "Pizzas Salgadas");
ok("impressora renomeada, o resto da config fica", (cfg.printerConfig as any)?.autoprint === true && JSON.stringify((cfg.printerConfig as any).printers[0].categories) === JSON.stringify(["Pizzas Salgadas", "iFood"]));
ok("tela do KDS renomeada", JSON.stringify((cfg.kdsScreens as any)[0].categoryFilter) === JSON.stringify(["Pizzas Salgadas"]));
ok("kdsConfig sem a categoria não é regravado", cfg.kdsConfig === undefined);
ok("config vazia não muda nada", Object.keys(renomearNasConfigs({ printerConfig: null, kdsScreens: null, kdsConfig: null }, "A", "B")).length === 0);

if (falhas) process.exit(1);
console.log("tudo certo");
