/**
 * BILL NO ESTOQUE (além de compra, saída e consulta, que estão em
 * ferramentas.ts) — "contei 12 coca lata e 3 kg de mussarela", "o mínimo da
 * mussarela é 5 kg", "qual a ficha da pizza calabresa?".
 *
 *   contagem_de_estoque → a CONTAGEM da tela Estoque › Contagem
 *                         (lib/cmv/contagem-no-banco.ts): o contado entra na
 *                         contagem do dia e, ao fechar, a diferença vira o
 *                         movimento AJUSTE com histórico — não é compra nem
 *                         saída. Regras do dia:
 *                           - contagem ABERTA (a equipe contando): o Bill só
 *                             grava o contado nela; quem fecha é a tela;
 *                           - sem contagem: o Bill abre uma RÁPIDA, grava e
 *                             fecha (nunca COMPLETA: ela é a base do CMV do DRE);
 *                           - FECHADA pelo Bill: reabre, soma o novo e fecha de
 *                             novo (o que já tinha sido contado fica com o
 *                             saldo de agora, para não voltar no tempo);
 *                           - FECHADA pela tela: não mexe (reabrir pela tela).
 *   estoque_minimo      → `StockItem.minQuantity`, o campo do "estoque baixo"
 *                         (PUT api/store/estoque/items).
 *   ficha_tecnica       → a ficha do produto com o custo de HOJE de cada
 *                         insumo, pela conta da aba Margens
 *                         (prepararCustoDosItens, lib/financeiro).
 */
import { Type } from "@google/genai";
import { prisma } from "@/lib/prisma";
import { converter, normalizarUnidade } from "@/lib/unidades";
import { lerNumeroBr } from "@/lib/cmv/numero";
import { ContagemRecusadaError, abrirContagem, fecharContagemNoBanco, gravarContados, reabrirContagem } from "@/lib/cmv/contagem-no-banco";
import { diaQueAContagemFecha } from "@/lib/cmv/semana-do-cmv";
import { lerMeta } from "@/lib/cmv/cmv-real";
import { prepararCustoDosItens } from "@/lib/financeiro/cmv-do-financeiro";
import { margemDaFicha } from "@/lib/estoque/analise";
import { SEM_PRODUTO_DE_INTEGRACAO } from "@/lib/cardapio-interno";
import { PREFIXO_DA_MEIA } from "@/lib/meio-a-meio";
import { naLoja } from "@/lib/relatorios/base";
import type { ContextoDoAssessor } from "../ferramentas";
import { PARAMETRO_CONFIRMADO, pedirConfirmacao, reais, registrarNoBill, type ModuloDoBill, type Resultado } from "../modulo";
import { escolherPeloNome, fusoDaLoja } from "./equipe";

const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
const qtd = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, "").replace(".", ","));
const diaBr = (dia: string) => dia.split("-").reverse().join("/");

/**
 * Diferença que merece a pergunta antes de gravar: mais de 30% do que havia
 * (a variação de todo dia fica abaixo disso) e pelo menos R$ 30 — sem custo
 * conhecido, pergunta sempre que passa dos 30%.
 */
export function diferencaGrande(sistema: number, contado: number, custoUnitario: number | null | undefined): boolean {
  const dif = Math.abs(contado - sistema);
  if (dif < 1e-9) return false;
  const base = Math.max(Math.abs(sistema), Math.abs(contado));
  if (base > 0 && dif / base < 0.3) return false;
  return custoUnitario == null || !(custoUnitario > 0) || dif * custoUnitario >= 30;
}

type Insumo = { id: string; name: string; unit: string; quantity: number; unitCost: number | null; minQuantity: number | null; nome: string };

async function insumosDaLoja(ctx: ContextoDoAssessor): Promise<Insumo[]> {
  const itens = await prisma.stockItem.findMany({
    where: { franchiseeId: ctx.franchiseeId, NOT: { active: false } },
    select: { id: true, name: true, unit: true, quantity: true, unitCost: true, minQuantity: true },
    orderBy: { name: "asc" },
  });
  return itens.map((i) => ({ ...i, nome: i.name }));
}

/** O insumo pelo id (só se for desta loja) ou pelo nome falado. */
function acharInsumo(lista: Insumo[], it: { insumoId?: unknown; nome?: unknown; insumo?: unknown }): { um: Insumo } | { erro: Record<string, unknown> } {
  const porId = it.insumoId ? lista.find((x) => x.id === String(it.insumoId)) : null;
  if (porId) return { um: porId };
  const nome = String(it.nome ?? it.insumo ?? "");
  const r = escolherPeloNome(lista, nome);
  if ("um" in r) return r;
  if ("varios" in r) return { erro: { item: nome, erro: "mais de um item com esse nome", opcoes: r.varios.slice(0, 10).map((i) => ({ id: i.id, nome: i.name, unidade: i.unit })) } };
  return { erro: { item: nome, erro: "não está no estoque da loja" } };
}

/** A quantidade dita, na unidade do insumo ("3 kg" de um insumo em g = 3000). */
function naUnidadeDoInsumo(insumo: Insumo, quantidade: unknown, unidade: unknown): number | null {
  const q = lerNumeroBr(quantidade);
  if (!Number.isFinite(q) || q < 0) return null;
  const doInsumo = normalizarUnidade(insumo.unit) || "un";
  return converter(q, normalizarUnidade(unidade as string) || doInsumo, doInsumo);
}

// ── contagem_de_estoque ───────────────────────────────────────────────────

/**
 * Reabre a contagem que o Bill fechou, grava `mudar` (null = tira o contado) e
 * fecha de novo. O que já tinha sido contado e não muda entra com o saldo de
 * AGORA (que já tem o ajuste daquela contagem e o que se mexeu depois): o
 * fechamento de novo não volta esses itens para o número antigo. Sem nada
 * contado no fim, a contagem sai (o "descartar" da tela).
 */
async function refazerContagemDoBill(ctx: ContextoDoAssessor, contagemId: string, mudar: Map<string, number | null>, tz: string) {
  const c = await prisma.contagemDeEstoque.findFirst({ where: { id: contagemId, franchiseeId: ctx.franchiseeId }, include: { itens: { select: { stockItemId: true, contado: true } } } });
  if (!c) throw new ContagemRecusadaError("Essa contagem não existe mais.");
  const jaContados = c.itens.filter((i) => i.contado != null && !mudar.has(i.stockItemId)).map((i) => i.stockItemId);
  const agora = jaContados.length
    ? await prisma.stockItem.findMany({ where: { id: { in: jaContados }, franchiseeId: ctx.franchiseeId }, select: { id: true, name: true, unit: true, quantity: true } })
    : [];
  if (c.status === "FECHADA") await reabrirContagem({ lojaId: ctx.franchiseeId, contagemId });

  const insumos = await prisma.stockItem.findMany({ where: { id: { in: [...mudar.keys()] }, franchiseeId: ctx.franchiseeId }, select: { id: true, name: true, unit: true } });
  await gravarContados({
    contagemId,
    usuarioId: ctx.usuarioId,
    itens: [
      ...insumos.map((i) => ({ insumo: i, contado: mudar.get(i.id) ?? null })),
      ...agora.map((i) => ({ insumo: i, contado: r6(Math.max(0, i.quantity)) })),
    ],
  });
  const sobrou = await prisma.contagemItem.count({ where: { contagemId, contado: { not: null } } });
  if (sobrou === 0) {
    await prisma.contagemDeEstoque.deleteMany({ where: { id: contagemId, franchiseeId: ctx.franchiseeId, status: "ABERTA" } });
    return;
  }
  await fecharContagemNoBanco({ lojaId: ctx.franchiseeId, usuarioId: ctx.usuarioId, contagemId, tz });
}

/** A contagem fechada nasceu no Bill (o primeiro registro dela a criou)? Só essa ele reabre. */
async function ehContagemDoBill(ctx: ContextoDoAssessor, contagemId: string): Promise<boolean> {
  const r = await prisma.assessorRegistro.findFirst({
    where: { franchiseeId: ctx.franchiseeId, tipo: "ESTOQUE_CONTAGEM", desfeitoEm: null, refs: { path: ["contagemId"], equals: contagemId } },
    orderBy: [{ criadoEm: "asc" }, { id: "asc" }],
    select: { refs: true },
  });
  return (r?.refs as any)?.criou === true;
}

async function contagemDeEstoque(args: any, ctx: ContextoDoAssessor): Promise<Resultado> {
  const ditos: any[] = Array.isArray(args?.itens) ? args.itens : [];
  if (!ditos.length) return { ok: false, erro: "Diga o que foi contado (item e quantidade)." };

  const lista = await insumosDaLoja(ctx);
  const contados = new Map<string, { insumo: Insumo; contado: number }>();
  const problemas: Record<string, unknown>[] = [];
  for (const it of ditos) {
    const a = acharInsumo(lista, it);
    if ("erro" in a) { problemas.push(a.erro); continue; }
    const q = naUnidadeDoInsumo(a.um, it?.quantidade, it?.unidade);
    if (q === null) { problemas.push({ item: a.um.name, erro: `quantidade inválida ou em unidade que não converte (o item é controlado em ${a.um.unit})` }); continue; }
    contados.set(a.um.id, { insumo: a.um, contado: r6(q) });
  }
  if (problemas.length) return { ok: false, erro: "Nada foi gravado: confira com o dono os itens abaixo.", problemas };

  const tz = await fusoDaLoja(ctx);
  const loja = await prisma.user.findUnique({ where: { id: ctx.franchiseeId }, select: { storeHours: true } });
  const dia = diaQueAContagemFecha(new Date(), tz, loja?.storeHours);
  const existente = await prisma.contagemDeEstoque.findUnique({
    where: { franchiseeId_dia: { franchiseeId: ctx.franchiseeId, dia } },
    include: { itens: { select: { stockItemId: true, contado: true } } },
  });
  if (existente?.status === "FECHADA" && !(existente.tipo === "RAPIDA" && (await ehContagemDoBill(ctx, existente.id)))) {
    return { ok: false, erro: `A contagem de ${diaBr(dia)} já foi fechada pela tela. Para mudar, reabra em Estoque › Contagem.` };
  }

  const diferencas = [...contados.values()].map(({ insumo, contado }) => ({
    item: insumo.name,
    sistema: `${qtd(insumo.quantity)} ${insumo.unit}`,
    contado: `${qtd(contado)} ${insumo.unit}`,
    diferenca: `${contado - insumo.quantity >= 0 ? "+" : ""}${qtd(r6(contado - insumo.quantity))} ${insumo.unit}`,
    valor: insumo.unitCost ? reais(Math.abs(contado - insumo.quantity) * insumo.unitCost) : undefined,
    grande: diferencaGrande(insumo.quantity, contado, insumo.unitCost),
  }));
  const grandes = diferencas.filter((d) => d.grande);
  if (grandes.length) {
    const pergunta = pedirConfirmacao(args, `Diferença grande na contagem: ${grandes.map((d) => `${d.item} (sistema ${d.sistema}, contado ${d.contado}${d.valor ? `, ${d.valor}` : ""})`).join("; ")}. O estoque passa a ser o contado.`);
    if (pergunta) return { ...pergunta, diferencas };
  }

  const anteriores = Object.fromEntries([...contados.keys()].map((id) => [id, existente?.itens.find((i) => i.stockItemId === id)?.contado ?? null]));
  const novos = new Map([...contados.entries()].map(([id, c]) => [id, c.contado]));
  let contagemId = "";
  let criou = false;
  let fechada = true;

  try {
    if (existente?.status === "ABERTA") {
      // A equipe está contando na tela: o contado entra nela e quem fecha é a tela.
      contagemId = existente.id;
      fechada = false;
      await gravarContados({ contagemId, usuarioId: ctx.usuarioId, itens: [...contados.values()].map((c) => ({ insumo: c.insumo, contado: c.contado })) });
    } else if (existente) {
      contagemId = existente.id;
      await refazerContagemDoBill(ctx, contagemId, novos, tz);
    } else {
      let id: string;
      try {
        id = (await abrirContagem({ lojaId: ctx.franchiseeId, usuarioId: ctx.usuarioId, dia, tipo: "RAPIDA" })).id;
      } catch (e) {
        // Loja sem item marcado "contar todo dia": a rápida nasce só com o que o dono contou.
        if (!(e instanceof ContagemRecusadaError) || !e.message.startsWith("Nenhum item")) throw e;
        id = (await prisma.contagemDeEstoque.create({ data: { franchiseeId: ctx.franchiseeId, dia, tipo: "RAPIDA", criadoPor: ctx.usuarioId } })).id;
      }
      contagemId = id;
      criou = true;
      await gravarContados({ contagemId, usuarioId: ctx.usuarioId, itens: [...contados.values()].map((c) => ({ insumo: c.insumo, contado: c.contado })) });
      await fecharContagemNoBanco({ lojaId: ctx.franchiseeId, usuarioId: ctx.usuarioId, contagemId, tz });
    }
  } catch (e) {
    // A contagem que o Bill abriu e não fechou não fica pela metade na tela.
    if (criou && contagemId) await prisma.contagemDeEstoque.deleteMany({ where: { id: contagemId, franchiseeId: ctx.franchiseeId, status: "ABERTA" } }).catch(() => null);
    if (e instanceof ContagemRecusadaError) return { ok: false, erro: e.message };
    throw e;
  }

  const resumo = `Contagem de ${diaBr(dia)}: ${[...contados.values()].map((c) => `${c.insumo.name} ${qtd(c.contado)} ${c.insumo.unit}`).join(", ")}`;
  await registrarNoBill(ctx, "ESTOQUE_CONTAGEM", resumo, { contagemId, dia, criou, fechada, anteriores });
  return {
    ok: true,
    resumo,
    diferencas: diferencas.map(({ grande: _g, ...d }) => d),
    observacao: fechada
      ? "Contagem fechada: o estoque de cada item agora é o contado (a diferença ficou no histórico de contagens, como ajuste)."
      : "Havia uma contagem aberta na tela: o contado entrou nela. O estoque muda quando a contagem for fechada em Estoque › Contagem.",
  };
}

// ── estoque_minimo ────────────────────────────────────────────────────────

async function estoqueMinimo(args: any, ctx: ContextoDoAssessor): Promise<Resultado> {
  const a = acharInsumo(await insumosDaLoja(ctx), args || {});
  if ("erro" in a) return { ok: false, erro: "Item não encontrado no estoque.", ...a.erro };
  const i = a.um;
  const minimoAtual = i.minQuantity != null ? `${qtd(i.minQuantity)} ${i.unit}` : null;
  const situacao = { item: i.name, tem: `${qtd(i.quantity)} ${i.unit}`, minimo: minimoAtual, abaixoDoMinimo: i.minQuantity != null && i.quantity <= i.minQuantity };

  const remover = args?.remover === true;
  if (!remover && (args?.minimo === undefined || args?.minimo === null || args?.minimo === "")) return { ok: true, resumo: `${i.name}: tem ${situacao.tem}, mínimo ${minimoAtual || "não definido"}.`, ...situacao };

  let novo: number | null = null;
  if (!remover) {
    novo = naUnidadeDoInsumo(i, args.minimo, args?.unidade);
    if (novo === null) return { ok: false, erro: `Mínimo inválido ou em unidade que não converte (o item é controlado em ${i.unit}).` };
  }
  if ((i.minQuantity ?? null) === novo) return { ok: true, resumo: `O mínimo de ${i.name} já era ${minimoAtual || "nenhum"}.` };
  // O mesmo campo do cadastro do insumo (PUT api/store/estoque/items).
  await prisma.stockItem.update({ where: { id: i.id, franchiseeId: ctx.franchiseeId }, data: { minQuantity: novo } });
  const resumo = novo === null ? `Mínimo de ${i.name} removido` : `Mínimo de ${i.name}: ${qtd(novo)} ${i.unit}`;
  await registrarNoBill(ctx, "ESTOQUE_MINIMO", resumo, { stockItemId: i.id, anterior: i.minQuantity ?? null });
  return { ok: true, resumo, abaixoDoMinimo: novo !== null && i.quantity <= novo, tem: situacao.tem };
}

// ── ficha_tecnica ─────────────────────────────────────────────────────────

async function fichaTecnica(args: any, ctx: ContextoDoAssessor): Promise<Resultado> {
  const produtos = (await prisma.menuProduct.findMany({
    where: { franchiseeId: ctx.franchiseeId, AND: [SEM_PRODUTO_DE_INTEGRACAO, { NOT: { name: { startsWith: PREFIXO_DA_MEIA } } }] },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  })).map((p) => ({ ...p, nome: p.name }));
  const porId = args?.produtoId ? produtos.find((p) => p.id === String(args.produtoId)) : null;
  const r = porId ? { um: porId } : escolherPeloNome(produtos, String(args?.produto || ""));
  if ("varios" in r) return { ok: false, erro: "Mais de um produto com esse nome: pergunte qual.", opcoes: r.varios.slice(0, 15).map((p) => ({ id: p.id, nome: p.name })) };
  if (!("um" in r)) return { ok: false, erro: "Produto não encontrado no cardápio." };

  const tz = await fusoDaLoja(ctx);
  const [p, loja, custos] = await Promise.all([
    prisma.menuProduct.findFirst({
      where: { id: r.um.id, franchiseeId: ctx.franchiseeId },
      select: { id: true, name: true, price: true, isCombo: true, cost: true, recipeItems: { select: { stockItemId: true, quantityConsumed: true, stockItem: { select: { name: true, unit: true } } } } },
    }),
    prisma.user.findUnique({ where: { id: ctx.franchiseeId }, select: { financialGoals: true } }),
    prepararCustoDosItens(ctx.franchiseeId, tz),
  ]);
  if (!p) return { ok: false, erro: "Produto não encontrado no cardápio." };

  const hoje = naLoja(new Date(), tz).dia;
  const doDia = custos.custosDosIngredientes(hoje);
  const preco = Number(p.price) || 0;
  const total = custos.custoDoItem({ produtoId: p.id, nome: p.name, quantidade: 1, preco, escolhas: null }, hoje);
  const m = margemDaFicha(preco, total.custo);
  const teto = lerMeta(loja?.financialGoals, "cmvPct", 40);
  const itens = p.recipeItems.map((l) => {
    const q = Number(l.quantityConsumed) || 0;
    const c = doDia[l.stockItemId]?.custo;
    return { insumo: l.stockItem.name, quantidade: `${qtd(q)} ${l.stockItem.unit}`, custo: c != null ? reais(q * c) : "sem custo" };
  });
  const falta = total.custo != null ? undefined
    : total.faltas[0]?.motivo === "SEM_FICHA" ? "sem ficha técnica nem custo digitado"
    : total.faltas.map((f) => `${f.nome} sem custo`).join(", ") || "sem custo";

  return {
    ok: true,
    resumo: total.custo != null
      ? `${p.name}: custo ${reais(total.custo)}, preço ${reais(preco)}${m ? `, CMV ${String(m.cmvPct).replace(".", ",")}% (meta ${teto}%)` : ""}.`
      : `${p.name}: ${falta}.`,
    produto: p.name,
    preco: reais(preco),
    combo: p.isCombo || undefined,
    itens: itens.length ? itens : undefined,
    custoTotal: total.custo != null ? reais(total.custo) : null,
    origemDoCusto: total.fonte === "CADASTRO" ? "custo digitado no produto" : total.fonte === "FICHA" ? "ficha técnica × custo de hoje do insumo" : undefined,
    margem: m ? reais(m.margem) : undefined,
    cmvPct: m?.cmvPct,
    acimaDaMeta: m ? m.margem < 0 || m.cmvPct > teto : undefined,
    falta,
    observacao: p.isCombo ? "Combo: o custo sai das opções escolhidas em cada venda; aqui vale a escolha padrão." : undefined,
  };
}

// ── O módulo ──────────────────────────────────────────────────────────────

async function desfazer(tipo: string, refs: any, ctx: ContextoDoAssessor): Promise<Resultado | null> {
  if (tipo === "ESTOQUE_MINIMO") {
    await prisma.stockItem.updateMany({ where: { id: String(refs.stockItemId), franchiseeId: ctx.franchiseeId }, data: { minQuantity: refs.anterior ?? null } });
    return { ok: true };
  }
  if (tipo === "ESTOQUE_CONTAGEM") {
    const anteriores = new Map<string, number | null>(Object.entries(refs.anteriores || {}).map(([id, v]) => [id, v == null ? null : Number(v)]));
    const c = await prisma.contagemDeEstoque.findFirst({ where: { id: String(refs.contagemId), franchiseeId: ctx.franchiseeId }, select: { id: true, status: true } });
    if (!c) return { ok: false, erro: "Essa contagem não existe mais." };
    try {
      if (!refs.fechada) {
        // Foi na contagem aberta da tela: volta o contado de antes, se ela ainda está aberta.
        if (c.status !== "ABERTA") return { ok: false, erro: "A contagem já foi fechada na tela: corrija por Estoque › Contagem (reabrir)." };
        const insumos = await prisma.stockItem.findMany({ where: { id: { in: [...anteriores.keys()] }, franchiseeId: ctx.franchiseeId }, select: { id: true, name: true, unit: true } });
        await gravarContados({ contagemId: c.id, usuarioId: ctx.usuarioId, itens: insumos.map((i) => ({ insumo: i, contado: anteriores.get(i.id) ?? null })) });
        return { ok: true };
      }
      // Fechada pelo Bill: reabrir desfaz o AJUSTE (o estoque volta ao de antes)
      // e o fechamento de novo leva só o que sobra contado.
      await refazerContagemDoBill(ctx, c.id, anteriores, await fusoDaLoja(ctx));
      return { ok: true };
    } catch (e) {
      if (e instanceof ContagemRecusadaError) return { ok: false, erro: e.message };
      throw e;
    }
  }
  return null;
}

export const MODULO_ESTOQUE: ModuloDoBill = {
  nome: "estoque",
  declaracoes: [
    {
      name: "contagem_de_estoque",
      description: "O dono CONTOU o estoque ('tem 12 coca lata', 'contei 3 kg de mussarela'): grava como contagem (o estoque passa a ser o contado, a diferença fica no histórico de contagens). NÃO é compra nem saída.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          itens: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                insumoId: { type: Type.STRING, description: "id da lista ESTOQUE DA LOJA, se souber" },
                nome: { type: Type.STRING, description: "nome do item como o dono disse" },
                quantidade: { type: Type.NUMBER, description: "o que ele contou" },
                unidade: { type: Type.STRING, description: "un, kg, g, l, ml — a que ele disse" },
              },
              required: ["nome", "quantidade"],
            },
          },
          confirmado: PARAMETRO_CONFIRMADO,
        },
        required: ["itens"],
      },
    },
    {
      name: "estoque_minimo",
      description: "Consulta ou define o estoque MÍNIMO de um item (o que faz ele aparecer como 'estoque baixo'). Sem 'minimo' só consulta.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          insumoId: { type: Type.STRING },
          nome: { type: Type.STRING, description: "nome do item como o dono disse" },
          minimo: { type: Type.NUMBER, description: "novo mínimo; omita para só consultar" },
          unidade: { type: Type.STRING, description: "unidade do mínimo dito (un, kg, g, l, ml)" },
          remover: { type: Type.BOOLEAN, description: "true = tirar o mínimo do item" },
        },
        required: ["nome"],
      },
    },
    {
      name: "ficha_tecnica",
      description: "A ficha técnica de um produto do cardápio: insumos, quantidades e custo de hoje, com margem e CMV. Só leitura.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          produto: { type: Type.STRING, description: "nome do produto como o dono disse" },
          produtoId: { type: Type.STRING, description: "id de buscar_no_cardapio, quando houver mais de um" },
        },
        required: ["produto"],
      },
    },
  ],
  gravam: ["contagem_de_estoque", "estoque_minimo"],
  regras: [
    "Estoque: 'contei/tem X de Y' é contagem_de_estoque (o estoque vira o contado); 'comprei/chegou' é registrar_compra; 'perdeu/venceu' é registrar_saida.",
    "Contagem com diferença grande volta precisaConfirmar com as diferenças: mostre ao dono e só chame de novo com confirmado=true depois do sim.",
    "Item não achado ou com mais de um nome parecido: nada é gravado; pergunte qual é.",
    "'Mínimo/estoque baixo de X' = estoque_minimo; 'quanto custa fazer / ficha da X' = ficha_tecnica (mudar ficha é no painel).",
  ].join("\n"),
  executar: async (nome, args, ctx) => {
    if (nome === "contagem_de_estoque") return contagemDeEstoque(args, ctx);
    if (nome === "estoque_minimo") return estoqueMinimo(args, ctx);
    if (nome === "ficha_tecnica") return fichaTecnica(args, ctx);
    return null;
  },
  tipos: ["ESTOQUE_CONTAGEM", "ESTOQUE_MINIMO"],
  desfazer,
};
