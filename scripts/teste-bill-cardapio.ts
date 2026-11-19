/**
 * O Bill no cadastro do cardápio (lib/assessor/modulos/cardapio.ts).
 *
 * Sem LOJA: a parte pura (preço, hora, foto nossa, montagem do antes/depois,
 * cadastro) e as ferramentas de verdade com o banco trocado por um falso em
 * memória — confirmação antes de mexer em preço, só produto da loja, foto só
 * do /uploads, categoria nova junto, e o "desfaz" voltando exatamente o antes.
 *
 *   npx tsx scripts/teste-bill-cardapio.ts
 *
 * Com LOJA=<id>: só LEITURA no banco de verdade (toda escrita é bloqueada
 * antes de sair): lista categorias, monta uma edição de preço num produto real
 * e mostra a pergunta de confirmação que o dono receberia.
 *
 *   LOJA=<id> npx tsx --env-file=.env scripts/teste-bill-cardapio.ts
 */
import assert from "node:assert/strict";

const LOJA = process.env.LOJA || "";
// Sem LOJA, banco que não existe: se alguma consulta escapar do falso, falha na hora.
if (!LOJA) process.env.DATABASE_URL = "postgresql://teste@127.0.0.1:1/teste";

const copia = <T>(x: T): T => JSON.parse(JSON.stringify(x));

// ── Um "where" do Prisma, só o que o módulo usa ──────────────────────────────
function casa(linha: any, where: any): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, cond]: [string, any]) => {
    if (k === "AND") return (cond as any[]).every((w) => casa(linha, w));
    if (k === "OR") return (cond as any[]).some((w) => casa(linha, w));
    if (k === "NOT") return (Array.isArray(cond) ? cond : [cond]).every((w) => !casa(linha, w));
    if (k === "comboGroup") return true;
    const v = linha[k] ?? null;
    if (cond === null || typeof cond !== "object") return v === (cond ?? null);
    const ci = cond.mode === "insensitive";
    const norm = (x: any) => (ci ? String(x ?? "").toLowerCase() : x);
    if ("in" in cond) return cond.in.map(norm).includes(norm(v));
    if ("startsWith" in cond) return String(v ?? "").startsWith(cond.startsWith);
    if ("equals" in cond) return norm(v) === norm(cond.equals);
    if ("not" in cond) return v !== cond.not;
    return true;
  });
}

async function partePura() {
  const m = await import("../src/lib/assessor/modulos/cardapio");

  assert.equal(m.lerPreco("64,90"), 64.9);
  assert.equal(m.lerPreco("R$ 64,90"), 64.9);
  assert.equal(m.lerPreco("1.234,50"), 1234.5);
  assert.equal(m.lerPreco("32 reais"), 32);
  assert.equal(m.lerPreco(59.9), 59.9);
  assert.equal(m.lerPreco("abc"), null);
  assert.equal(m.lerHora("9"), "09:00");
  assert.equal(m.lerHora("18h"), "18:00");
  assert.equal(m.lerHora("9:30"), "09:30");
  assert.equal(m.lerHora("25:00"), null);
  assert.ok(m.fotoNossa("/uploads/produtos/abc-123.jpg"));
  assert.ok(!m.fotoNossa("https://static.ifood.com.br/x.jpg"), "link de fora nunca");
  assert.ok(!m.fotoNossa("/uploads/../.env"));
  assert.equal(m.acharCategoria("sobremesas", ["Pizzas", "Sobremésas"]), "Sobremésas");

  const p: any = {
    id: "p1", name: "Calabresa G", description: "Molho e calabresa", price: 59.9, promoPrice: null, category: "Pizzas",
    imageUrl: null, availableDays: null, availableHours: null, priceSalao: null, priceDelivery: null, priceTotem: null,
  };
  const cats = ["Pizzas", "Bebidas"];

  // Preço: antes → depois, e mexe em preço (pede confirmação).
  let e: any = m.montarEdicao(p, { preco: "64,90" }, cats);
  assert.deepEqual(e.dados, { price: 64.9 });
  assert.deepEqual(e.antes, { price: 59.9 });
  assert.deepEqual(e.linhas, ["preço R$ 59,90 → R$ 64,90"]);
  assert.equal(e.mexeEmPreco, true);

  // Mesmo preço, nada muda.
  e = m.montarEdicao(p, { preco: "59,90" }, cats);
  assert.deepEqual(e.linhas, []);

  // Promoção maior que o preço: recusada; promoção atual que ficaria cara com o preço novo também.
  assert.ok("erro" in m.montarEdicao(p, { precoPromocional: "60" }, cats));
  assert.match((m.montarEdicao({ ...p, promoPrice: 55 }, { preco: "50" }, cats) as any).erro, /tirarPromocao/);
  e = m.montarEdicao({ ...p, promoPrice: 55 }, { preco: "50", tirarPromocao: true }, cats);
  assert.deepEqual(e.dados, { price: 50, promoPrice: null });
  assert.deepEqual(e.antes, { price: 59.9, promoPrice: 55 });

  // Nome, descrição, categoria (sem acento/caixa), e categoria que não existe.
  e = m.montarEdicao(p, { nome: "Calabresa Grande", categoria: "bebidas", descricao: "Nova" }, cats);
  assert.deepEqual(e.dados, { name: "Calabresa Grande", description: "Nova", category: "Bebidas" });
  assert.equal(e.mexeEmPreco, false);
  assert.match((m.montarEdicao(p, { categoria: "Sobremesas" }, cats) as any).erro, /criar_categoria/);

  // Dias e horário no formato que a tela grava; a semana inteira = nulo.
  e = m.montarEdicao(p, { dias: ["SEX", "SAB", "DOM"], horarioDe: "18h", horarioAte: "23" }, cats);
  assert.deepEqual(e.dados, { availableDays: JSON.stringify(["SEX", "SAB", "DOM"]), availableHours: JSON.stringify({ de: "18:00", ate: "23:00" }) });
  assert.deepEqual(e.linhas, ["dias: todo dia → sex, sáb e dom", "horário: o dia todo → das 18:00 às 23:00"]);
  e = m.montarEdicao({ ...p, availableDays: '["SEX"]', availableHours: '{"de":"18:00","ate":"23:00"}' }, { dias: ["TODOS"], horarioODiaTodo: true }, cats);
  assert.deepEqual(e.dados, { availableDays: null, availableHours: null });
  assert.ok("erro" in m.montarEdicao(p, { horarioDe: "18:00", horarioAte: "18:00" }, cats));
  assert.ok("erro" in m.montarEdicao(p, { dias: ["XYZ"] }, cats));

  // O desfazer: volta o antes; recusa se o campo foi mexido de novo depois.
  assert.deepEqual(m.planoDoDesfazer({ price: 64.9, name: "X" }, { price: 59.9 }, { price: 64.9 }), { dados: { price: 59.9 } });
  assert.deepEqual(m.planoDoDesfazer({ price: 70 }, { price: 59.9 }, { price: 64.9 }), { mudouDepois: ["price"] });
  assert.deepEqual(m.planoDoDesfazer({ promoPrice: null }, { promoPrice: 55 }, { promoPrice: null }), { dados: { promoPrice: 55 } });

  // Cadastro: categoria existente pelo nome de lá, nova quando não há; preço e categoria obrigatórios.
  let c: any = m.montarCadastro({ nome: "X-Tudo", preco: "32,90", categoria: "pizzas" }, cats);
  assert.deepEqual(c.dados, { name: "X-Tudo", description: "", price: 32.9, category: "Pizzas", active: true });
  assert.equal(c.categoriaNova, false);
  c = m.montarCadastro({ nome: "Pudim", preco: 12, categoria: "Sobremesas", precoPromocional: "9,90" }, cats);
  assert.equal(c.categoriaNova, true);
  assert.equal(c.dados.promoPrice, 9.9);
  assert.ok("erro" in m.montarCadastro({ nome: "Pudim", categoria: "Sobremesas" }, cats));
  assert.ok("erro" in m.montarCadastro({ nome: "Pudim", preco: 12 }, cats));
  assert.ok("erro" in m.montarCadastro({ nome: "Pudim", preco: 12, categoria: "X", precoPromocional: 12 }, cats));

  console.log("✔ parte pura");
}

async function bancoFalso() {
  const { prisma } = await import("../src/lib/prisma");
  let produtos: any[] = [];
  let categorias: any[] = [];
  let regs: any[] = [];
  let seq = 0;
  const comCampos = (x: any) => ({
    description: "", promoPrice: null, imageUrl: null, availableDays: null, availableHours: null, priceSalao: null, priceDelivery: null, priceTotem: null,
    origemIntegracao: null, active: true, codigoPDV: null, ...x,
  });
  const reset = () => {
    produtos = [
      comCampos({ id: "p1", franchiseeId: "loja", name: "Calabresa G", description: "Molho e calabresa", price: 59.9, category: "Pizzas", codigoPDV: 1 }),
      comCampos({ id: "p2", franchiseeId: "loja", name: "Coca 2L", price: 14, category: "Bebidas", priceDelivery: 16, codigoPDV: 2 }),
      comCampos({ id: "ifood-1", franchiseeId: "loja", name: "Calabresa G", price: 70, category: "Pizzas", origemIntegracao: "IFOOD" }),
      comCampos({ id: "outra-1", franchiseeId: "outra", name: "Calabresa G", price: 50, category: "Pizzas" }),
    ];
    categorias = [{ id: "c1", franchiseeId: "loja", name: "Pizzas", sortOrder: 0 }]; // "Bebidas" é virtual (só no texto)
    regs = [];
  };
  const escolher = (linha: any, select?: any) => (select ? Object.fromEntries(Object.keys(select).map((k) => [k, linha[k] ?? null])) : linha);
  let gravacoes = 0;

  const falso: any = {
    menuProduct: {
      findFirst: async ({ where, select }: any) => { const l = produtos.find((p) => casa(p, where)); return l ? escolher(copia(l), select) : null; },
      findMany: async ({ where, select, distinct }: any) => {
        let ls = produtos.filter((p) => casa(p, where));
        if (distinct) ls = ls.filter((p, i) => ls.findIndex((q) => distinct.every((k: string) => q[k] === p[k])) === i);
        return ls.map((l) => escolher(copia(l), select));
      },
      updateMany: async ({ where, data }: any) => { gravacoes++; const ls = produtos.filter((p) => casa(p, where)); ls.forEach((p) => Object.assign(p, copia(data))); return { count: ls.length }; },
      update: async ({ where, data }: any) => { gravacoes++; const p = produtos.find((x) => x.id === where.id); Object.assign(p, data); return p; },
      create: async ({ data, select }: any) => { gravacoes++; const p = comCampos({ id: `novo${++seq}`, ...copia(data) }); produtos.push(p); return escolher(p, select); },
      delete: async ({ where }: any) => { gravacoes++; produtos = produtos.filter((p) => p.id !== where.id); return {}; },
      aggregate: async ({ where }: any) => ({ _max: { codigoPDV: Math.max(0, ...produtos.filter((p) => casa(p, where)).map((p) => p.codigoPDV || 0)) } }),
    },
    menuCategory: {
      findMany: async ({ where, select }: any) => categorias.filter((c) => casa(c, where)).map((c) => escolher(copia(c), select)),
      findFirst: async ({ where, select }: any) => { const c = categorias.find((x) => casa(x, where)); return c ? escolher(copia(c), select) : null; },
      findUnique: async ({ where }: any) => copia(categorias.find((c) => c.id === where.id) ?? null),
      create: async ({ data, select }: any) => { gravacoes++; const c = { id: `cat${++seq}`, ...copia(data) }; categorias.push(c); return escolher(c, select); },
      update: async ({ where, data }: any) => { gravacoes++; const c = categorias.find((x) => x.id === where.id); Object.assign(c, data); return copia(c); },
      delete: async ({ where }: any) => { gravacoes++; categorias = categorias.filter((c) => c.id !== where.id); return {}; },
      deleteMany: async ({ where }: any) => { gravacoes++; const antes = categorias.length; categorias = categorias.filter((c) => !casa(c, where)); return { count: antes - categorias.length }; },
    },
    comboGroupItem: { count: async () => 0, deleteMany: async () => ({ count: 0 }) },
    comboGroup: { findMany: async () => [] },
    user: {
      findUnique: async () => ({ slug: "loja-teste", printerConfig: null, kdsScreens: null, kdsConfig: null }),
      update: async () => { gravacoes++; return {}; },
    },
    assessorRegistro: { create: async ({ data }: any) => { regs.push(copia(data)); return {}; } },
    $transaction: async (fn: any) => fn(falso),
  };
  for (const k of Object.keys(falso)) Object.defineProperty(prisma, k, { value: falso[k], configurable: true });

  const { MODULO_CARDAPIO: M, TIPOS_DO_CARDAPIO: T } = await import("../src/lib/assessor/modulos/cardapio");
  const ctx: any = { franchiseeId: "loja", usuarioId: "dono", canal: "WHATSAPP", telefone: "5522999990000" };
  const rodar = async (nome: string, args: any, c = ctx) => (await M.executar(nome, args, c)) as any;
  const desfazerUltimo = async () => { const r = regs[regs.length - 1]; return (await M.desfazer!(r.tipo, r.refs, ctx)) as any; };
  const prod = (id: string) => produtos.find((p) => p.id === id);

  // 0. O contrato: tudo que grava está em `gravam`, os tipos têm o prefixo, e nome desconhecido não é deste módulo.
  const nomes = M.declaracoes.map((d: any) => d.name);
  assert.deepEqual([...M.gravam].sort(), [...nomes].sort());
  assert.ok(M.tipos!.every((t) => t.startsWith("CARDAPIO_")));
  assert.equal(await M.executar("buscar_no_cardapio", {}, ctx), null);
  assert.equal(await M.desfazer!("ENTREGA", {}, ctx), null);

  // 1. "Muda o preço da calabresa G para 64,90": pergunta primeiro, nada gravado.
  reset(); gravacoes = 0;
  let r = await rodar("editar_produto", { produtoId: "p1", preco: "64,90" });
  assert.equal(r.precisaConfirmar, true);
  assert.equal(r.pergunta, "Calabresa G: preço R$ 59,90 → R$ 64,90. Confirma?");
  assert.equal(gravacoes, 0);
  assert.equal(prod("p1").price, 59.9);
  // Com o sim: grava, registra com o antes, e o desfaz volta exatamente.
  r = await rodar("editar_produto", { produtoId: "p1", preco: "64,90", confirmado: true });
  assert.equal(r.ok, true, r.erro);
  assert.equal(r.resumo, "Calabresa G: preço R$ 59,90 → R$ 64,90.");
  assert.equal(prod("p1").price, 64.9);
  assert.equal(prod("ifood-1").price, 70, "o espelho do iFood não muda");
  assert.equal(regs[0].tipo, T.EDITADO);
  assert.deepEqual(regs[0].refs.antes, { price: 59.9 });
  let d = await desfazerUltimo();
  assert.equal(d.ok, true, d.erro);
  assert.equal(prod("p1").price, 59.9);

  // 2. Mexido de novo depois do Bill: não desfaz por cima.
  await rodar("editar_produto", { produtoId: "p1", preco: 61, confirmado: true });
  prod("p1").price = 63;
  d = await desfazerUltimo();
  assert.equal(d.ok, false);
  assert.match(d.erro, /mexido de novo/);
  assert.equal(prod("p1").price, 63);

  // 3. Sem confirmação para nome/descrição/categoria/horário; desfaz volta tudo.
  reset();
  r = await rodar("editar_produto", { produtoId: "p1", nome: "Calabresa Grande", categoria: "bebidas", dias: ["SEX", "SAB"], horarioDe: "18:00", horarioAte: "23:00" });
  assert.equal(r.ok, true, r.erro);
  assert.equal(prod("p1").name, "Calabresa Grande");
  assert.equal(prod("p1").category, "Bebidas");
  assert.equal(prod("p1").availableDays, '["SEX","SAB"]');
  assert.equal(prod("p1").availableHours, '{"de":"18:00","ate":"23:00"}');
  d = await desfazerUltimo();
  assert.equal(d.ok, true, d.erro);
  assert.deepEqual(
    { name: prod("p1").name, category: prod("p1").category, availableDays: prod("p1").availableDays, availableHours: prod("p1").availableHours },
    { name: "Calabresa G", category: "Pizzas", availableDays: null, availableHours: null },
  );

  // 4. Promoção: pede confirmação; preço por canal aparece no aviso.
  r = await rodar("editar_produto", { produtoId: "p2", preco: 15 });
  assert.match(r.pergunta, /no delivery o preço é próprio \(R\$ 16,00\)/);
  r = await rodar("editar_produto", { produtoId: "p2", precoPromocional: "12,90", confirmado: true });
  assert.equal(prod("p2").promoPrice, 12.9);
  r = await rodar("editar_produto", { produtoId: "p2", tirarPromocao: true, confirmado: true });
  assert.equal(prod("p2").promoPrice, null);
  d = await desfazerUltimo();
  assert.equal(prod("p2").promoPrice, 12.9, "o desfaz devolve a promoção");

  // 5. Só produto da loja: o de outra loja e o espelho do iFood não se editam.
  gravacoes = 0;
  assert.equal((await rodar("editar_produto", { produtoId: "outra-1", preco: 1, confirmado: true })).ok, false);
  assert.equal((await rodar("editar_produto", { produtoId: "ifood-1", preco: 1, confirmado: true })).ok, false);
  assert.equal(gravacoes, 0);

  // 6. Foto: sem foto na mensagem pede a foto; link de fora nunca; a nossa grava e o desfaz volta.
  reset(); gravacoes = 0;
  assert.match((await rodar("trocar_foto_do_produto", { produtoId: "p1" })).erro, /mandar a foto/);
  assert.equal((await rodar("trocar_foto_do_produto", { produtoId: "p1" }, { ...ctx, imagemUrl: "https://static.ifood.com.br/a.jpg" })).ok, false);
  assert.equal(gravacoes, 0);
  r = await rodar("trocar_foto_do_produto", { produtoId: "p1" }, { ...ctx, imagemUrl: "/uploads/produtos/calabresa.jpg" });
  assert.equal(r.ok, true, r.erro);
  assert.equal(prod("p1").imageUrl, "/uploads/produtos/calabresa.jpg");
  assert.equal(regs[0].tipo, T.FOTO);
  d = await desfazerUltimo();
  assert.equal(d.ok, true, d.erro);
  assert.equal(prod("p1").imageUrl, null);

  // 7. Cadastrar com foto e categoria nova: pergunta, grava com código PDV, e o desfaz apaga produto e categoria.
  reset(); gravacoes = 0;
  const comFoto = { ...ctx, imagemUrl: "/uploads/produtos/pudim.jpg" };
  r = await rodar("cadastrar_produto", { nome: "Pudim", preco: "12,90", categoria: "Sobremesas" }, comFoto);
  assert.equal(r.precisaConfirmar, true);
  assert.equal(r.pergunta, 'Produto novo no cardápio: Pudim — R$ 12,90, em Sobremesas (categoria nova), sem descrição, com a foto que você mandou. Confirma?');
  assert.equal(gravacoes, 0);
  r = await rodar("cadastrar_produto", { nome: "Pudim", preco: "12,90", categoria: "Sobremesas", confirmado: true }, comFoto);
  assert.equal(r.ok, true, r.erro);
  const pudim = prod(r.produtoId);
  assert.deepEqual(
    { name: pudim.name, price: pudim.price, category: pudim.category, imageUrl: pudim.imageUrl, codigoPDV: pudim.codigoPDV, franchiseeId: pudim.franchiseeId, active: pudim.active },
    { name: "Pudim", price: 12.9, category: "Sobremesas", imageUrl: "/uploads/produtos/pudim.jpg", codigoPDV: 3, franchiseeId: "loja", active: true },
  );
  assert.ok(categorias.some((c) => c.name === "Sobremesas" && c.franchiseeId === "loja"));
  d = await desfazerUltimo();
  assert.equal(d.ok, true, d.erro);
  assert.equal(prod(r.produtoId), undefined);
  assert.ok(!categorias.some((c) => c.name === "Sobremesas"));

  // 8. Cadastrar em categoria virtual existente ("bebidas") não cria linha; a foto de fora fica de fora.
  reset();
  r = await rodar("cadastrar_produto", { nome: "Guaraná 2L", preco: 12, categoria: "bebidas", confirmado: true }, { ...ctx, imagemUrl: "https://x.com/a.jpg" });
  assert.equal(prod(r.produtoId).category, "Bebidas");
  assert.equal(prod(r.produtoId).imageUrl, null);
  assert.match(r.observacao, /foto não estava salva/);
  assert.equal(categorias.length, 1);

  // 9. Categoria: cria (recusa repetida), desfaz; renomeia a virtual levando os produtos, desfaz volta a ser virtual.
  reset();
  r = await rodar("criar_categoria", { nome: "Sobremesas" });
  assert.equal(r.ok, true, r.erro);
  assert.equal((await rodar("criar_categoria", { nome: "sobremesas" })).ok, false);
  assert.equal((await rodar("criar_categoria", { nome: "Bebidas" })).ok, false, "a virtual também conta");
  d = await desfazerUltimo();
  assert.equal(d.ok, true, d.erro);
  assert.equal(categorias.length, 1);

  r = await rodar("renomear_categoria", { categoria: "bebidas", novoNome: "Refrigerantes" });
  assert.equal(r.ok, true, r.erro);
  assert.equal(prod("p2").category, "Refrigerantes");
  assert.ok(categorias.some((c) => c.name === "Refrigerantes"));
  d = await desfazerUltimo();
  assert.equal(d.ok, true, d.erro);
  assert.equal(prod("p2").category, "Bebidas");
  assert.deepEqual(categorias.map((c) => c.name), ["Pizzas"], "a linha criada pelo renomear sai");
  // Renomear para uma que já existe juntaria as duas: fica para o painel.
  assert.match((await rodar("renomear_categoria", { categoria: "Bebidas", novoNome: "pizzas" })).erro, /juntaria/);

  console.log("✔ ferramentas com o banco falso");
}

async function soLeitura() {
  const { prisma } = await import("../src/lib/prisma");
  // Toda escrita é recusada antes de chegar ao banco de produção.
  const ESCRITAS = new Set(["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"]);
  for (const modelo of ["menuProduct", "menuCategory", "assessorRegistro", "user", "comboGroupItem", "comboGroup", "productRecipe"]) {
    const original = (prisma as any)[modelo];
    const guardado = new Proxy(original, { get: (alvo, k) => (ESCRITAS.has(String(k)) ? () => { throw new Error(`ESCRITA BLOQUEADA: ${modelo}.${String(k)}`); } : typeof alvo[k] === "function" ? alvo[k].bind(alvo) : alvo[k]) });
    Object.defineProperty(prisma, modelo, { value: guardado, configurable: true });
  }
  for (const k of ["$transaction", "$executeRaw", "$executeRawUnsafe"]) {
    Object.defineProperty(prisma, k, { value: () => { throw new Error(`ESCRITA BLOQUEADA: ${k}`); }, configurable: true });
  }

  const { MODULO_CARDAPIO: M } = await import("../src/lib/assessor/modulos/cardapio");
  const { SEM_PRODUTO_DE_INTEGRACAO } = await import("../src/lib/cardapio-interno");
  const ctx: any = { franchiseeId: LOJA, usuarioId: LOJA, canal: "PAINEL" };
  const produto = await prisma.menuProduct.findFirst({ where: { franchiseeId: LOJA, active: true, price: { gt: 0 }, ...SEM_PRODUTO_DE_INTEGRACAO }, select: { id: true, name: true, price: true }, orderBy: { name: "asc" } });
  if (!produto) { console.log("Loja sem produto ativo."); return; }
  const novo = Math.round((produto.price + 1) * 100) / 100;
  const r: any = await M.executar("editar_produto", { produtoId: produto.id, preco: novo }, ctx);
  console.log("editar_produto (sem confirmar):", r);
  assert.equal(r.precisaConfirmar, true);
  const c: any = await M.executar("cadastrar_produto", { nome: "Produto de teste do Bill", preco: "9,90", categoria: "Categoria que não existe" }, ctx);
  console.log("cadastrar_produto (sem confirmar):", c.pergunta);
  assert.equal(c.precisaConfirmar, true);
  const cat: any = await M.executar("renomear_categoria", { categoria: "categoria-que-nao-existe-xyz", novoNome: "X" }, ctx);
  console.log("categorias da loja:", cat.erro);
  console.log("✔ só leitura na loja", LOJA);
}

(async () => {
  await partePura();
  if (LOJA) await soLeitura();
  else await bancoFalso();
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
