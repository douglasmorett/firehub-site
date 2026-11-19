/**
 * BILL NO CADASTRO DO CARDÁPIO — "muda o preço da calabresa G para 64,90",
 * "põe a coca em promoção por 8,90", "a marmita só de segunda a sexta, das
 * 11h às 14h", foto com "novo produto: X-Tudo 32,90 em Lanches", "essa é a
 * foto da pizza de frango", "cria a categoria Sobremesas".
 *
 * Douglas, 18/11/2026: "ele tem que conseguir buscar no sistema, ativar e usar
 * qualquer coisa pro dono de restaurante".
 *
 * Pausar/reativar e a busca (que dá os ids) continuam em ../cardapio.ts.
 * Grava pelo caminho da tela Cardápio: a regra da promoção, do horário, das
 * colunas, do código PDV e da exclusão é a de lib/produto-do-cardapio.ts
 * (a mesma do api/admin/menu-products); categoria nasce como no POST de
 * api/admin/categories e renomeia por lib/categoria-no-banco.ts (o PUT de lá).
 * Depois de gravar: meio a meio refeito quando o preço muda, vitrine na hora
 * (o cache é de 60 s) e a Keeta relê o cardápio. iFood e 99 têm o cardápio
 * deles: a resposta avisa.
 *
 * Fica no painel: combos, perguntas/adicionais, montagem de pizza, preço por
 * canal, juntar ou apagar categoria. Espelho de integração e a meia pizza
 * ("1/2 …", que acompanha o sabor) não se editam por aqui.
 *
 * Teste: scripts/teste-bill-cardapio.ts
 */
import { Type } from "@google/genai";
import { prisma } from "@/lib/prisma";
import { SEM_PRODUTO_DE_INTEGRACAO, lerHorarioDoProduto, textoDosDias, textoDoHorario } from "@/lib/cardapio-interno";
import { PREFIXO_DA_MEIA } from "@/lib/meio-a-meio";
import { refazerMeiasDaLoja } from "@/lib/meio-a-meio-no-banco";
import { atualizarVitrineDaLoja } from "@/lib/pausar-produtos";
import { avisarKeetaDoCardapio } from "@/lib/keeta/cardapio";
import { lerNumeroBr } from "@/lib/cmv/numero";
import { chaveDaCategoria, planoDeRenomear } from "@/lib/categoria-renomear";
import { gravarRenomeioDaCategoria, produtosDaCategoria } from "@/lib/categoria-no-banco";
import { criarComCodigoPDV, excluirProdutoDaLoja, saneiaHorario, saneiaPromocao, soColunasDoProduto } from "@/lib/produto-do-cardapio";
import type { ContextoDoAssessor } from "../ferramentas";
import { appsDaLoja } from "../pausa-nos-apps";
import { PARAMETRO_CONFIRMADO, pedirConfirmacao, reais, registrarNoBill, semAcento, type ModuloDoBill, type Resultado } from "../modulo";

export const TIPOS_DO_CARDAPIO = {
  EDITADO: "CARDAPIO_PRODUTO_EDITADO",
  CADASTRADO: "CARDAPIO_PRODUTO_CADASTRADO",
  FOTO: "CARDAPIO_FOTO",
  CATEGORIA_CRIADA: "CARDAPIO_CATEGORIA_CRIADA",
  CATEGORIA_RENOMEADA: "CARDAPIO_CATEGORIA_RENOMEADA",
} as const;

const PELO_PAINEL = "faça pelo painel, em Cardápio.";
const DIAS = ["SEG", "TER", "QUA", "QUI", "SEX", "SAB", "DOM"];

// ── PARTE PURA (o teste usa) ────────────────────────────────────────────────

export type ProdutoAtual = {
  id: string; name: string; description: string; price: number; promoPrice: number | null; category: string;
  imageUrl: string | null; availableDays: string | null; availableHours: string | null;
  priceSalao: number | null; priceDelivery: number | null; priceTotem: number | null;
};

const cent = (n: unknown) => Math.round(Number(n) * 100);
const mesmoValor = (a: unknown, b: unknown) =>
  (a == null || b == null) ? a == null && b == null : typeof a === "number" || typeof b === "number" ? cent(a) === cent(b) : String(a) === String(b);

/** "64,90", "R$ 64,90", "64.9", 64.9, "64 reais" → 64.9; o resto → null. */
export function lerPreco(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = lerNumeroBr(typeof v === "string" ? v.replace(/reais|real/gi, "") : v);
  return Number.isFinite(n) ? cent(n) / 100 : null;
}

/** "9", "9h", "9:30", "09h30" → "09:00"/"09:30"; o resto → null. */
export function lerHora(v: unknown): string | null {
  const m = String(v ?? "").trim().toLowerCase().match(/^(\d{1,2})(?:\s*[:h]\s*(\d{2})?)?\s*h?$/);
  if (!m || Number(m[1]) > 23) return null;
  return `${m[1].padStart(2, "0")}:${m[2] || "00"}`;
}

/** A foto tem que ser nossa (/uploads/…), nunca link de fora. */
export const fotoNossa = (url: unknown) => typeof url === "string" && /^\/uploads\/[\w./-]+$/.test(url) && !url.includes("..");

export const diasTxt = (availableDays: unknown) => textoDosDias(availableDays) || "todo dia";
export const horarioTxt = (availableHours: unknown) => textoDoHorario(availableHours) || "o dia todo";

/** A categoria que o dono nomeou, entre as da loja (sem acento e sem caixa). */
export function acharCategoria(nome: unknown, categorias: string[]): string | null {
  const k = semAcento(chaveDaCategoria(nome));
  return k ? categorias.find((c) => semAcento(chaveDaCategoria(c)) === k) ?? null : null;
}

export type Edicao = { dados: Record<string, unknown>; antes: Record<string, unknown>; linhas: string[]; mexeEmPreco: boolean };

/**
 * O que muda no produto, no formato do banco (o mesmo que o PUT grava), com o
 * antes de cada campo para o desfazer. Campo igual ao de hoje não entra.
 */
export function montarEdicao(p: ProdutoAtual, args: any, categorias: string[]): Edicao | { erro: string } {
  const dados: Record<string, unknown> = {};
  const linhas: string[] = [];

  const nome = typeof args?.nome === "string" ? args.nome.replace(/\s+/g, " ").trim() : "";
  if (nome && nome !== p.name) {
    if (nome.startsWith(PREFIXO_DA_MEIA)) return { erro: `Nome não pode começar com "${PREFIXO_DA_MEIA}" (é o da meia pizza).` };
    dados.name = nome;
    linhas.push(`nome: ${p.name} → ${nome}`);
  }
  if (typeof args?.descricao === "string" && args.descricao.trim() !== (p.description || "").trim()) {
    dados.description = args.descricao.trim();
    linhas.push(dados.description ? `descrição: "${dados.description}"` : "descrição apagada");
  }
  if (args?.categoria) {
    const cat = acharCategoria(args.categoria, categorias);
    if (!cat) return { erro: `Não existe a categoria "${args.categoria}" nesta loja. As que existem: ${categorias.join(", ")}. Crie com criar_categoria (se o dono quiser) ou use uma delas.` };
    if (chaveDaCategoria(cat) !== chaveDaCategoria(p.category)) {
      dados.category = cat;
      linhas.push(`categoria: ${p.category} → ${cat}`);
    }
  }

  if (args?.preco !== undefined && args?.preco !== null && args?.preco !== "") {
    const preco = lerPreco(args.preco);
    if (preco == null || preco <= 0) return { erro: `Preço inválido: "${args.preco}".` };
    if (cent(preco) !== cent(p.price)) {
      dados.price = preco;
      linhas.push(`preço ${reais(p.price)} → ${reais(preco)}`);
    }
  }
  if (args?.tirarPromocao === true) {
    if (p.promoPrice != null) {
      dados.promoPrice = null;
      linhas.push(`promoção de ${reais(p.promoPrice)} sai (volta a ${reais(Number(dados.price ?? p.price))})`);
    }
  } else if (args?.precoPromocional !== undefined && args?.precoPromocional !== null && args?.precoPromocional !== "") {
    const promo = lerPreco(args.precoPromocional);
    if (promo == null || promo <= 0) return { erro: `Preço promocional inválido: "${args.precoPromocional}". Para tirar a promoção, use tirarPromocao.` };
    if (p.promoPrice == null || cent(promo) !== cent(p.promoPrice)) {
      dados.promoPrice = promo;
      linhas.push(`promoção ${p.promoPrice != null ? reais(p.promoPrice) : "nenhuma"} → ${reais(promo)} (de ${reais(Number(dados.price ?? p.price))} por ${reais(promo)})`);
    }
  }
  // A mesma regra da tela: promoção só se for MENOR que o preço de venda.
  const precoFinal = Number(dados.price ?? p.price);
  const promoFinal = "promoPrice" in dados ? (dados.promoPrice as number | null) : p.promoPrice;
  if (promoFinal != null && cent(promoFinal) >= cent(precoFinal)) {
    return {
      erro: "promoPrice" in dados
        ? `A promoção (${reais(promoFinal)}) tem que ser menor que o preço de venda (${reais(precoFinal)}).`
        : `A promoção atual (${reais(promoFinal)}) ficaria maior que o preço novo (${reais(precoFinal)}): pergunte se tira a promoção (tirarPromocao) ou muda ela junto.`,
    };
  }

  if (args?.dias !== undefined && args?.dias !== null) {
    const lista = (Array.isArray(args.dias) ? args.dias : String(args.dias).split(/[\s,]+/)).map((d: unknown) => semAcento(String(d)).toUpperCase().trim()).filter(Boolean);
    const invalidos = lista.filter((d: string) => d !== "TODOS" && !DIAS.includes(d));
    if (invalidos.length) return { erro: `Dia inválido: ${invalidos.join(", ")}. Use SEG, TER, QUA, QUI, SEX, SAB, DOM ou TODOS.` };
    const dias = DIAS.filter((d) => lista.includes(d));
    // Nenhum dia, TODOS ou a semana inteira = vende todo dia (nulo, como a tela grava).
    const novo = lista.includes("TODOS") || dias.length === 0 || dias.length === DIAS.length ? null : JSON.stringify(dias);
    if (diasTxt(novo) !== diasTxt(p.availableDays)) {
      dados.availableDays = novo;
      linhas.push(`dias: ${diasTxt(p.availableDays)} → ${diasTxt(novo)}`);
    }
  }
  if (args?.horarioODiaTodo === true || args?.horarioDe || args?.horarioAte) {
    let novo: string | null = null;
    if (args?.horarioODiaTodo !== true) {
      const h = lerHorarioDoProduto({ de: lerHora(args?.horarioDe), ate: lerHora(args?.horarioAte) });
      if (!h) return { erro: "Horário do produto: diga o início e o fim (ex.: 11:00 e 14:00), diferentes um do outro." };
      novo = JSON.stringify(h);
    }
    if (horarioTxt(novo) !== horarioTxt(p.availableHours)) {
      dados.availableHours = novo;
      linhas.push(`horário: ${horarioTxt(p.availableHours)} → ${horarioTxt(novo)}`);
    }
  }

  const antes: Record<string, unknown> = {};
  for (const k of Object.keys(dados)) antes[k] = (p as any)[k] ?? null;
  return { dados, antes, linhas, mexeEmPreco: "price" in dados || "promoPrice" in dados };
}

/** O que o desfazer grava: o antes de cada campo, se o produto ainda está como o Bill deixou. */
export function planoDoDesfazer(atual: Record<string, unknown>, antes: Record<string, unknown>, depois: Record<string, unknown>): { dados: Record<string, unknown> } | { mudouDepois: string[] } {
  const mudouDepois = Object.keys(depois).filter((k) => !mesmoValor(atual[k] ?? null, depois[k] ?? null));
  if (mudouDepois.length) return { mudouDepois };
  return { dados: Object.fromEntries(Object.keys(depois).map((k) => [k, antes[k] ?? null])) };
}

export type Cadastro = { dados: Record<string, unknown>; categoria: string; categoriaNova: boolean; descricao: string };

/** Valida o produto novo: nome, preço, categoria (existente ou nova) e promoção menor que o preço. */
export function montarCadastro(args: any, categorias: string[]): Cadastro | { erro: string } {
  const nome = String(args?.nome ?? "").replace(/\s+/g, " ").trim();
  if (!nome) return { erro: "Diga o nome do produto." };
  if (nome.startsWith(PREFIXO_DA_MEIA)) return { erro: `Nome não pode começar com "${PREFIXO_DA_MEIA}" (é o da meia pizza).` };
  const preco = lerPreco(args?.preco);
  if (preco == null || preco <= 0) return { erro: `Faltou o preço do ${nome}: pergunte ao dono.` };
  const pedida = String(args?.categoria ?? "").replace(/\s+/g, " ").trim();
  if (!pedida) return { erro: `Faltou a categoria do ${nome}. As que existem: ${categorias.join(", ") || "nenhuma"}.` };
  const existente = acharCategoria(pedida, categorias);
  const dados: Record<string, unknown> = {
    name: nome,
    description: String(args?.descricao ?? "").trim(),
    price: preco,
    category: existente ?? pedida,
    active: true,
  };
  const promo = lerPreco(args?.precoPromocional);
  if (promo != null && promo > 0) {
    if (cent(promo) >= cent(preco)) return { erro: `A promoção (${reais(promo)}) tem que ser menor que o preço (${reais(preco)}).` };
    dados.promoPrice = promo;
  }
  return { dados, categoria: String(dados.category), categoriaNova: !existente, descricao: String(dados.description) };
}

// ── BANCO ───────────────────────────────────────────────────────────────────

const CAMPOS = {
  id: true, name: true, description: true, price: true, promoPrice: true, category: true, imageUrl: true,
  availableDays: true, availableHours: true, priceSalao: true, priceDelivery: true, priceTotem: true,
} as const;

/** Produto da própria loja: sem espelho de integração e sem a meia pizza. */
function produtoDaLoja(franchiseeId: string, id: unknown): Promise<ProdutoAtual | null> {
  if (!id) return Promise.resolve(null);
  return prisma.menuProduct.findFirst({
    where: { id: String(id), franchiseeId, AND: [SEM_PRODUTO_DE_INTEGRACAO, { NOT: { name: { startsWith: PREFIXO_DA_MEIA } } }] },
    select: CAMPOS,
  }) as Promise<ProdutoAtual | null>;
}

/** As categorias como a tela mostra: as linhas de MenuCategory + as que só existem no texto do produto. */
async function categoriasDaLoja(franchiseeId: string) {
  const [linhas, produtos] = await Promise.all([
    prisma.menuCategory.findMany({ where: { franchiseeId }, select: { id: true, name: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    prisma.menuProduct.findMany({ where: { franchiseeId, ...SEM_PRODUTO_DE_INTEGRACAO }, select: { category: true }, distinct: ["category"] }),
  ]);
  const nomes = linhas.map((c) => c.name.trim());
  for (const p of produtos) {
    const n = String(p.category || "").trim();
    if (n && !nomes.some((c) => chaveDaCategoria(c) === chaveDaCategoria(n))) nomes.push(n);
  }
  return { linhas, nomes };
}

/** Depois de mexer no cardápio: vitrine na hora e a Keeta relê (em segundo plano, como o after() da rota). */
async function depoisDeGravar(franchiseeId: string, mudouPreco = false) {
  if (mudouPreco) {
    // Preço de pizza mudou: as meias dela cobram a diferença calculada (mesmo passo do PUT).
    await refazerMeiasDaLoja(franchiseeId).catch((e) => console.error("[Assessor] meio a meio não refeito:", e?.message || e));
  }
  await atualizarVitrineDaLoja(franchiseeId);
  void avisarKeetaDoCardapio(franchiseeId).catch((e) => console.error("[Keeta] aviso do cardápio:", e?.message || e));
}

/** iFood e 99 têm o cardápio deles: o que o Bill muda aqui não chega lá. */
async function avisoDosApps(franchiseeId: string): Promise<string | undefined> {
  const apps = await appsDaLoja(franchiseeId).catch(() => null);
  const onde = [apps && (apps.ifood.length || apps.ifoodSoCentral) ? "no iFood" : null, apps?.food99.length ? "na 99" : null].filter(Boolean) as string[];
  if (!onde.length) return undefined;
  const txt = onde.join(" e ");
  return `${txt[0].toUpperCase()}${txt.slice(1)} o cardápio é do app e não muda junto: mude pelo app também.`;
}

const juntar = (...partes: (string | undefined)[]) => partes.filter(Boolean).join(" ");

// ── AS FERRAMENTAS ──────────────────────────────────────────────────────────

async function editarProduto(args: any, ctx: ContextoDoAssessor): Promise<Resultado> {
  const p = await produtoDaLoja(ctx.franchiseeId, args?.produtoId);
  if (!p) return { ok: false, erro: "Produto não encontrado no cardápio desta loja: use buscar_no_cardapio antes." };
  const { nomes } = await categoriasDaLoja(ctx.franchiseeId);
  const e = montarEdicao(p, args, nomes);
  if ("erro" in e) return { ok: false, erro: `${e.erro} Nada foi alterado.` };
  if (!e.linhas.length) return { ok: true, resumo: `${p.name}: já estava assim, nada mudou.` };

  // Preço por canal (salão/delivery/totem) vence o preço de venda naquele canal.
  const canais = ([["salão", p.priceSalao], ["delivery", p.priceDelivery], ["totem", p.priceTotem]] as const).filter(([, v]) => Number(v) > 0);
  const avisoDoCanal = "price" in e.dados && canais.length
    ? `Atenção: ${canais.map(([c, v]) => `no ${c} o preço é próprio (${reais(Number(v))})`).join(", ")} e não muda — isso é pelo painel.`
    : undefined;
  const opcaoEm = "price" in e.dados
    ? await prisma.comboGroupItem.count({ where: { menuProductId: p.id, comboGroup: { menuProduct: { franchiseeId: ctx.franchiseeId } } } }).catch(() => 0)
    : 0;
  const avisoDaOpcao = opcaoEm ? `Ele também é opção dentro de ${opcaoEm} combo(s)/pergunta(s): lá o acréscimo cobrado não muda — se quiser, ajuste pelo painel.` : undefined;

  const descricao = `${p.name}: ${e.linhas.join("; ")}.`;
  if (e.mexeEmPreco) {
    const pergunta = pedirConfirmacao(args, juntar(descricao, avisoDoCanal));
    if (pergunta) return pergunta;
  }

  const dados = { ...e.dados };
  // Rede da rota: a mesma conferência do PUT antes de gravar.
  const erro = saneiaPromocao(dados, p.price) || saneiaHorario(dados);
  if (erro) return { ok: false, erro: `${erro} Nada foi alterado.` };
  soColunasDoProduto(dados);
  const r = await prisma.menuProduct.updateMany({ where: { id: p.id, franchiseeId: ctx.franchiseeId }, data: dados });
  if (!r.count) return { ok: false, erro: "Produto não encontrado no cardápio desta loja." };
  await depoisDeGravar(ctx.franchiseeId, "price" in dados);

  await registrarNoBill(ctx, TIPOS_DO_CARDAPIO.EDITADO, `Cardápio: ${descricao}`, { produtoId: p.id, nome: dados.name ?? p.name, antes: e.antes, depois: dados });
  return {
    ok: true,
    resumo: descricao,
    observacao: juntar("Já vale no site, robô, balcão e totem.", avisoDoCanal, avisoDaOpcao, await avisoDosApps(ctx.franchiseeId)),
  };
}

async function cadastrarProduto(args: any, ctx: ContextoDoAssessor): Promise<Resultado> {
  const { nomes } = await categoriasDaLoja(ctx.franchiseeId);
  const c = montarCadastro(args, nomes);
  if ("erro" in c) return { ok: false, erro: `${c.erro} Nada foi cadastrado.` };
  const foto = fotoNossa(ctx.imagemUrl) ? String(ctx.imagemUrl) : null;
  const semFoto = ctx.imagemUrl && !foto ? "A foto não estava salva no FireHub e ficou de fora: peça para mandar de novo." : undefined;

  const mesmoNome = await prisma.menuProduct.findFirst({
    where: { franchiseeId: ctx.franchiseeId, name: { equals: String(c.dados.name), mode: "insensitive" }, ...SEM_PRODUTO_DE_INTEGRACAO },
    select: { category: true },
  });
  const preco = c.dados.promoPrice != null ? `de ${reais(Number(c.dados.price))} por ${reais(Number(c.dados.promoPrice))}` : reais(Number(c.dados.price));
  const descricao = `${c.dados.name} — ${preco}, em ${c.categoria}${c.categoriaNova ? " (categoria nova)" : ""}${c.descricao ? `, "${c.descricao}"` : ", sem descrição"}${foto ? ", com a foto que você mandou" : ", sem foto"}`;
  const pergunta = pedirConfirmacao(args, juntar(
    `Produto novo no cardápio: ${descricao}.`,
    mesmoNome ? `Atenção: já existe um "${c.dados.name}" em ${mesmoNome.category}.` : undefined,
  ));
  if (pergunta) return pergunta;

  const rest: Record<string, unknown> = { ...c.dados, imageUrl: foto };
  const erro = saneiaPromocao(rest);
  if (erro) return { ok: false, erro: `${erro} Nada foi cadastrado.` };
  soColunasDoProduto(rest);
  // Categoria nova nasce como no "+ Nova categoria" da tela (POST api/admin/categories).
  const categoriaCriada = c.categoriaNova
    ? await prisma.menuCategory.create({ data: { name: c.categoria, emoji: "🍽️", color: "#64748B", imageUrl: null, sortOrder: 0, franchiseeId: ctx.franchiseeId }, select: { id: true } })
    : null;
  const produto = await criarComCodigoPDV(rest, ctx.franchiseeId, () =>
    prisma.menuProduct.create({ data: { ...(rest as any), tags: null, availableDays: null, franchiseeId: ctx.franchiseeId }, select: { id: true, codigoPDV: true } }),
  );
  await depoisDeGravar(ctx.franchiseeId);

  await registrarNoBill(ctx, TIPOS_DO_CARDAPIO.CADASTRADO, `Produto novo no cardápio: ${descricao}`, { produtoId: produto.id, nome: c.dados.name, categoriaCriadaId: categoriaCriada?.id ?? null });
  return {
    ok: true,
    resumo: `Cadastrado: ${descricao}.`,
    produtoId: produto.id,
    codigoPDV: produto.codigoPDV ?? undefined,
    observacao: juntar(
      "Já aparece no site, robô, balcão e totem. Perguntas, adicionais e combo são pelo painel, em Cardápio.",
      semFoto,
      await avisoDosApps(ctx.franchiseeId),
    ),
  };
}

async function trocarFoto(args: any, ctx: ContextoDoAssessor): Promise<Resultado> {
  if (!ctx.imagemUrl) return { ok: false, erro: "Não veio foto nesta mensagem: peça ao dono para mandar a foto do produto aqui na conversa." };
  if (!fotoNossa(ctx.imagemUrl)) return { ok: false, erro: "A foto não ficou salva no FireHub: peça para mandar de novo. Nada foi alterado." };
  const p = await produtoDaLoja(ctx.franchiseeId, args?.produtoId);
  if (!p) return { ok: false, erro: "Produto não encontrado no cardápio desta loja: use buscar_no_cardapio antes." };
  if (p.imageUrl === ctx.imagemUrl) return { ok: true, resumo: `${p.name}: já estava com essa foto.` };

  const dados: Record<string, unknown> = { imageUrl: ctx.imagemUrl };
  soColunasDoProduto(dados);
  await prisma.menuProduct.updateMany({ where: { id: p.id, franchiseeId: ctx.franchiseeId }, data: dados });
  await depoisDeGravar(ctx.franchiseeId);
  const resumo = `${p.name}: ${p.imageUrl ? "foto trocada" : "ganhou foto"}`;
  await registrarNoBill(ctx, TIPOS_DO_CARDAPIO.FOTO, `Cardápio: ${resumo}`, { produtoId: p.id, nome: p.name, antes: p.imageUrl ?? null, depois: ctx.imagemUrl });
  return { ok: true, resumo: `${resumo}.`, observacao: juntar("Já aparece no site, robô e totem.", await avisoDosApps(ctx.franchiseeId)) };
}

async function criarCategoria(args: any, ctx: ContextoDoAssessor): Promise<Resultado> {
  const nome = String(args?.nome ?? "").replace(/\s+/g, " ").trim();
  if (!nome) return { ok: false, erro: "Diga o nome da categoria." };
  const { nomes } = await categoriasDaLoja(ctx.franchiseeId);
  const ja = acharCategoria(nome, nomes);
  if (ja) return { ok: false, erro: `A categoria ${ja} já existe.` };
  // Mesmo create do POST api/admin/categories.
  const cat = await prisma.menuCategory.create({ data: { name: nome, emoji: "🍽️", color: "#64748B", imageUrl: null, sortOrder: 0, franchiseeId: ctx.franchiseeId }, select: { id: true } });
  await registrarNoBill(ctx, TIPOS_DO_CARDAPIO.CATEGORIA_CRIADA, `Categoria nova no cardápio: ${nome}`, { categoriaId: cat.id, nome });
  return { ok: true, resumo: `Categoria ${nome} criada.`, observacao: "Ela aparece para o cliente quando tiver produto dentro." };
}

async function renomearCategoria(args: any, ctx: ContextoDoAssessor): Promise<Resultado> {
  const novoNome = String(args?.novoNome ?? "").replace(/\s+/g, " ").trim();
  if (!novoNome) return { ok: false, erro: "Diga o nome novo da categoria." };
  const { linhas, nomes } = await categoriasDaLoja(ctx.franchiseeId);
  const atual = acharCategoria(args?.categoria, nomes);
  if (!atual) return { ok: false, erro: `Não achei a categoria "${args?.categoria ?? ""}". As que existem: ${nomes.join(", ")}.` };
  if (atual === novoNome) return { ok: true, resumo: `A categoria já se chama ${atual}; nada mudou.` };
  const outra = acharCategoria(novoNome, nomes);
  if (outra && chaveDaCategoria(outra) !== chaveDaCategoria(atual)) {
    return { ok: false, erro: `Já existe a categoria ${outra}: renomear juntaria as duas. Para juntar, ${PELO_PAINEL} Nada foi alterado.` };
  }
  const r = await renomear(ctx.franchiseeId, linhas, atual, novoNome);
  if ("erro" in r) return { ok: false, erro: r.erro };
  await depoisDeGravar(ctx.franchiseeId);
  await registrarNoBill(ctx, TIPOS_DO_CARDAPIO.CATEGORIA_RENOMEADA, `Categoria renomeada: ${atual} → ${r.nomeFinal}`, { de: atual, para: r.nomeFinal, linhaCriadaId: r.linhaCriadaId });
  return {
    ok: true,
    resumo: `Categoria ${atual} → ${r.nomeFinal} (${r.produtos} produto${r.produtos === 1 ? "" : "s"}).`,
    observacao: juntar("Impressora e telas da cozinha seguem com a categoria.", await avisoDosApps(ctx.franchiseeId)),
  };
}

/** Pelo plano e pela gravação do PUT de api/admin/categories; junção fica de fora (o desfazer não a volta). */
async function renomear(franchiseeId: string, linhas: { id: string; name: string }[], de: string, para: string) {
  const linha = linhas.find((c) => chaveDaCategoria(c.name) === chaveDaCategoria(de)) ?? null;
  const plano = planoDeRenomear({ atual: linha, nomeAntigo: de, nomeNovo: para, categorias: linhas });
  if (plano.erro !== undefined) return { erro: plano.erro };
  if (plano.juntarEm) return { erro: `Isso juntaria duas categorias; ${PELO_PAINEL}` };
  const { categoria, ids } = await gravarRenomeioDaCategoria(franchiseeId, plano, {}, { sortOrder: linhas.length });
  return { nomeFinal: plano.nomeFinal, produtos: ids.length, linhaCriadaId: plano.criar ? (categoria as any)?.id ?? null : null };
}

// ── DESFAZER ────────────────────────────────────────────────────────────────

async function desfazer(tipo: string, refs: any, ctx: ContextoDoAssessor): Promise<Resultado | null> {
  const loja = ctx.franchiseeId;

  if (tipo === TIPOS_DO_CARDAPIO.EDITADO || tipo === TIPOS_DO_CARDAPIO.FOTO) {
    const p = await produtoDaLoja(loja, refs?.produtoId);
    if (!p) return { ok: false, erro: `O produto ${refs?.nome ?? ""} não está mais no cardápio.` };
    const antes = tipo === TIPOS_DO_CARDAPIO.FOTO ? { imageUrl: refs.antes ?? null } : refs?.antes || {};
    const depois = tipo === TIPOS_DO_CARDAPIO.FOTO ? { imageUrl: refs.depois ?? null } : refs?.depois || {};
    const plano = planoDoDesfazer(p as any, antes, depois);
    if ("mudouDepois" in plano) return { ok: false, erro: `${p.name} foi mexido de novo depois (${plano.mudouDepois.join(", ")}); ${PELO_PAINEL}` };
    const dados = { ...plano.dados };
    soColunasDoProduto(dados);
    await prisma.menuProduct.updateMany({ where: { id: p.id, franchiseeId: loja }, data: dados });
    await depoisDeGravar(loja, "price" in dados);
    return { ok: true };
  }

  if (tipo === TIPOS_DO_CARDAPIO.CADASTRADO) {
    const p = await prisma.menuProduct.findFirst({ where: { id: String(refs?.produtoId ?? ""), franchiseeId: loja }, select: { id: true } });
    if (p) await excluirProdutoDaLoja(loja, p.id);
    // A categoria que nasceu junto sai se ficou vazia.
    if (refs?.categoriaCriadaId) await apagarCategoriaVazia(loja, String(refs.categoriaCriadaId));
    await depoisDeGravar(loja);
    return { ok: true };
  }

  if (tipo === TIPOS_DO_CARDAPIO.CATEGORIA_CRIADA) {
    const r = await apagarCategoriaVazia(loja, String(refs?.categoriaId ?? ""));
    if (r === "tem-produto") return { ok: false, erro: `A categoria ${refs?.nome} já tem produto; para apagar, ${PELO_PAINEL}` };
    return { ok: true };
  }

  if (tipo === TIPOS_DO_CARDAPIO.CATEGORIA_RENOMEADA) {
    const { linhas, nomes } = await categoriasDaLoja(loja);
    const atual = nomes.find((n) => chaveDaCategoria(n) === chaveDaCategoria(refs?.para));
    if (!atual) return { ok: false, erro: `A categoria ${refs?.para} não existe mais; ${PELO_PAINEL}` };
    if (chaveDaCategoria(refs?.de) !== chaveDaCategoria(refs?.para) && nomes.some((n) => chaveDaCategoria(n) === chaveDaCategoria(refs?.de))) {
      return { ok: false, erro: `Já existe de novo uma categoria ${refs?.de}; ${PELO_PAINEL}` };
    }
    const r = await renomear(loja, linhas, atual, String(refs.de));
    if ("erro" in r) return { ok: false, erro: r.erro };
    // Era só texto nos produtos: a linha que o renomear criou sai e ela volta a ser como era.
    if (refs?.linhaCriadaId) await prisma.menuCategory.deleteMany({ where: { id: String(refs.linhaCriadaId), franchiseeId: loja } });
    await depoisDeGravar(loja);
    return { ok: true };
  }

  return null;
}

/** Apaga a linha da categoria só se nenhum produto da loja está nela. */
async function apagarCategoriaVazia(loja: string, id: string): Promise<"apagada" | "tem-produto" | "nao-existe"> {
  const cat = id ? await prisma.menuCategory.findFirst({ where: { id, franchiseeId: loja }, select: { id: true, name: true } }) : null;
  if (!cat) return "nao-existe";
  if ((await produtosDaCategoria(loja, cat.name)).length) return "tem-produto";
  await prisma.menuCategory.deleteMany({ where: { id: cat.id, franchiseeId: loja } });
  return "apagada";
}

// ── O MÓDULO ────────────────────────────────────────────────────────────────

const PRODUTO_ID = { type: Type.STRING, description: "id vindo de buscar_no_cardapio" };

export const MODULO_CARDAPIO: ModuloDoBill = {
  nome: "cardapio",
  declaracoes: [
    {
      name: "editar_produto",
      description: "Muda um produto do cardápio: preço, preço promocional (ou tira a promoção), nome, descrição, categoria, dias e horário em que vende. Mande só o que muda. Preço e promoção pedem confirmação.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          produtoId: PRODUTO_ID,
          preco: { type: Type.STRING, description: "preço de venda novo: '64,90'" },
          precoPromocional: { type: Type.STRING, description: "preço da promoção (menor que o de venda): '54,90'" },
          tirarPromocao: { type: Type.BOOLEAN, description: "true = acaba a promoção" },
          nome: { type: Type.STRING },
          descricao: { type: Type.STRING, description: "texto novo; '' apaga" },
          categoria: { type: Type.STRING, description: "categoria que já existe na loja" },
          dias: { type: Type.ARRAY, items: { type: Type.STRING, enum: [...DIAS, "TODOS"] }, description: "dias em que vende; ['TODOS'] = todo dia" },
          horarioDe: { type: Type.STRING, description: "HH:MM em que começa a vender" },
          horarioAte: { type: Type.STRING, description: "HH:MM em que para de vender" },
          horarioODiaTodo: { type: Type.BOOLEAN, description: "true = tira o horário (vende o dia todo)" },
          confirmado: PARAMETRO_CONFIRMADO,
        },
        required: ["produtoId"],
      },
    },
    {
      name: "cadastrar_produto",
      description: "Cadastra um produto novo no cardápio. A foto que o dono mandou nesta mensagem entra como foto do produto. Categoria que não existe é criada junto. Pede confirmação.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          nome: { type: Type.STRING },
          preco: { type: Type.STRING, description: "preço de venda: '32,90'" },
          categoria: { type: Type.STRING, description: "categoria existente ou nova" },
          descricao: { type: Type.STRING },
          precoPromocional: { type: Type.STRING, description: "só se o dono disser" },
          confirmado: PARAMETRO_CONFIRMADO,
        },
        required: ["nome", "preco", "categoria"],
      },
    },
    {
      name: "trocar_foto_do_produto",
      description: "Põe a foto que o dono mandou NESTA mensagem como foto do produto.",
      parameters: { type: Type.OBJECT, properties: { produtoId: PRODUTO_ID }, required: ["produtoId"] },
    },
    {
      name: "criar_categoria",
      description: "Cria uma categoria vazia no cardápio (ex.: Sobremesas).",
      parameters: { type: Type.OBJECT, properties: { nome: { type: Type.STRING } }, required: ["nome"] },
    },
    {
      name: "renomear_categoria",
      description: "Muda o nome de uma categoria; os produtos, a impressora e a cozinha vão junto.",
      parameters: {
        type: Type.OBJECT,
        properties: { categoria: { type: Type.STRING, description: "nome de hoje" }, novoNome: { type: Type.STRING } },
        required: ["categoria", "novoNome"],
      },
    },
  ],
  gravam: ["editar_produto", "cadastrar_produto", "trocar_foto_do_produto", "criar_categoria", "renomear_categoria"],
  regras: `
CARDÁPIO: "muda o preço da X para 64,90", "põe X em promoção por 54,90", "tira a promoção", nome, descrição, categoria e "X só de sexta a domingo, das 18h às 23h" = buscar_no_cardapio → editar_produto com o id (só o que muda). Preço e promoção: repita a pergunta de confirmação.
Foto com legenda de produto novo ("novo produto…", "cadastra X por 25 em Lanches") = cadastrar_produto; faltou preço ou categoria, pergunte. Foto com "essa é a foto da X"/"troca a foto da X" = buscar_no_cardapio → trocar_foto_do_produto; sem foto na mensagem, peça a foto.
Categoria: criar_categoria e renomear_categoria. Juntar ou apagar categoria, combos, perguntas/adicionais, montagem de pizza e preço por canal são pelo painel, em Cardápio.
Repita ao dono a observação sobre iFood/99 quando ela vier: o cardápio de lá não muda junto.`,
  tipos: Object.values(TIPOS_DO_CARDAPIO),
  executar: async (nome, args, ctx) => {
    switch (nome) {
      case "editar_produto": return editarProduto(args, ctx);
      case "cadastrar_produto": return cadastrarProduto(args, ctx);
      case "trocar_foto_do_produto": return trocarFoto(args, ctx);
      case "criar_categoria": return criarCategoria(args, ctx);
      case "renomear_categoria": return renomearCategoria(args, ctx);
      default: return null;
    }
  },
  desfazer,
};
