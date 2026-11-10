import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { canTouch, resolveScope } from "@/lib/escopo-do-cardapio";
import { basesDeComplementos, opcoesDaBase, problemaDasOpcoes } from "@/lib/bases-de-complementos";
import { destinosDaPergunta, tituloNormalizado } from "@/lib/copiar-pergunta";
import { refazerMeiasDaLoja } from "@/lib/meio-a-meio-no-banco";

export async function POST(req: NextRequest) {
  const { scope, error } = await resolveScope(req, true);
  if (!scope) return error;
  const body = await req.json().catch(() => null);
  const grupoId = typeof body?.grupoId === "string" ? body.grupoId : "";
  const titulo = String(body?.titulo || "").trim().slice(0, 160);
  const ids: string[] = Array.isArray(body?.produtoIds) ? [...new Set<string>(body.produtoIds.filter((v: unknown) => typeof v === "string" && v))] : [];
  if (!grupoId || !titulo || !ids.length || ids.length > 1000) return NextResponse.json({ error: "Informe a pergunta e os produtos onde ela será usada." }, { status: 400 });
  if (!Array.isArray(body?.opcoes)) return NextResponse.json({ error: "Opções inválidas." }, { status: 400 });
  if (body.opcoes.some((i: any) => !i || ["additionalPrice", "additionalPriceSalao", "additionalPriceDelivery", "additionalPriceTotem", "promoAdditionalPrice"].some(k => i[k] != null && (typeof i[k] !== "number" || !Number.isFinite(i[k]))))) return NextResponse.json({ error: "Preços inválidos." }, { status: 400 });
  const opcoes = opcoesDaBase({ items: body.opcoes });
  const problema = problemaDasOpcoes(opcoes);
  if (problema) return NextResponse.json({ error: problema }, { status: 400 });
  const origem = await prisma.comboGroup.findUnique({ where: { id: grupoId }, select: { menuProduct: { select: { franchiseeId: true } } } });
  const lojaId = origem?.menuProduct.franchiseeId;
  if (!lojaId || !canTouch(scope, lojaId)) return NextResponse.json({ error: "Pergunta não encontrada nesta loja." }, { status: 403 });
  try {
    const resultado = await prisma.$transaction(async tx => {
      const catalogo = await tx.menuProduct.findMany({ where: { franchiseeId: lojaId }, include: { comboGroups: { include: { items: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] } } } } });
      const base = basesDeComplementos(catalogo).find(b => b.membros.some(m => m.grupo.id === grupoId));
      if (!base || !base.editavel || base.revisao !== body.revisao) throw new Error("CADASTRO_ALTERADO");
      if (new Set(base.membros.map(m => m.produto.id)).size !== base.membros.length) throw new Error("DUPLICADA_NO_PRODUTO");
      const anchor = base.membros[0];
      const destinos = destinosDaPergunta(catalogo, anchor.produto, anchor.grupo);
      const permitidos = new Set([anchor.produto.id, ...destinos.mesmaCategoria.map(d => d.produto.id), ...destinos.outras.map(d => d.produto.id), ...base.membros.map(m => m.produto.id)]);
      const porProduto = new Map(catalogo.map(p => [p.id, p]));
      const atuais = new Map(base.membros.map(m => [m.produto.id, m]));
      for (const id of ids) {
        const produto = porProduto.get(id);
        if (!produto || !permitidos.has(id) || opcoes.some(i => i.menuProductId === id)) throw new Error("DESTINO_INVALIDO");
        if ((produto.comboGroups || []).some(g => g.id !== atuais.get(id)?.grupo.id && tituloNormalizado(g.title) === tituloNormalizado(titulo))) throw new Error("JA_TEM_OUTRA_VERSAO");
      }
      if (opcoes.some(i => !porProduto.has(i.menuProductId))) throw new Error("OPCAO_DE_OUTRA_LOJA");
      const regras = new Map<string, { minQty: number | null; maxQty: number }>();
      for (const r of Array.isArray(body.regras) ? body.regras : []) {
        if (!ids.includes(r.produtoId) || !Number.isInteger(r.maxQty) || r.maxQty < 1 || r.maxQty > 999
          || (r.minQty !== null && (!Number.isInteger(r.minQty) || r.minQty < 0 || r.minQty > r.maxQty))) throw new Error("REGRA_INVALIDA");
        regras.set(r.produtoId, { minQty: r.minQty, maxQty: r.maxQty });
      }
      let criados = 0, removidos = 0, atualizados = 0;
      for (const membro of base.membros) if (!ids.includes(membro.produto.id)) {
        await tx.comboGroup.delete({ where: { id: membro.grupo.id } }); removidos++;
      }
      for (const id of ids) {
        const existente = atuais.get(id);
        const regra = regras.get(id);
        if (existente) {
          await tx.comboGroup.update({ where: { id: existente.grupo.id }, data: { title: titulo, ...(regra ?? {}) } });
          // Só os vínculos desta base mudam. Opções/produtos e histórico não são recriados.
          const guardados = await tx.comboGroupItem.findMany({ where: { comboGroupId: existente.grupo.id } });
          const porOpcao = new Map(guardados.map(i => [i.menuProductId, i]));
          await tx.comboGroupItem.deleteMany({ where: { comboGroupId: existente.grupo.id, menuProductId: { notIn: opcoes.map(i => i.menuProductId) } } });
          for (const opcao of opcoes) {
            const dados = { ...opcao, precoPorEscolha: opcao.precoPorEscolha ?? undefined };
            const item = porOpcao.get(opcao.menuProductId);
            if (item) await tx.comboGroupItem.update({ where: { id: item.id }, data: dados as any });
            else await tx.comboGroupItem.create({ data: { ...dados, comboGroupId: existente.grupo.id } as any });
          }
          atualizados++;
        } else {
          const produto = porProduto.get(id)!;
          await tx.comboGroup.create({ data: {
            menuProductId: id, title: titulo, priceRule: anchor.grupo.priceRule,
            minQty: regra ? regra.minQty : anchor.grupo.minQty ?? null, maxQty: regra?.maxQty ?? anchor.grupo.maxQty ?? 1,
            sortOrder: produto.comboGroups.reduce((s, g) => Math.max(s, g.sortOrder + 1), 0),
            items: { create: opcoes.map(i => ({ ...i, precoPorEscolha: i.precoPorEscolha ?? undefined })) as any },
          } }); criados++;
        }
      }
      return { criados, removidos, atualizados };
    }, { isolationLevel: "Serializable", timeout: 30000 });
    await refazerMeiasDaLoja(lojaId).catch(e => console.error("[base complementos] meias:", e?.message));
    const loja = await prisma.user.findUnique({ where: { id: lojaId }, select: { slug: true } }).catch(() => null);
    if (loja?.slug) { try { revalidatePath(`/loja/${loja.slug}`); } catch {} }
    return NextResponse.json({ success: true, ...resultado });
  } catch (e: any) {
    const mensagens: Record<string, string> = {
      CADASTRO_ALTERADO: "O cadastro mudou enquanto você editava. Reabra o grupo para conferir antes de salvar.",
      DUPLICADA_NO_PRODUTO: "Há duas perguntas iguais no mesmo produto. Confira esse produto antes de editar em conjunto.",
      DESTINO_INVALIDO: "Um dos produtos não pode receber esta pergunta.", OPCAO_DE_OUTRA_LOJA: "Uma opção não pertence a esta loja.",
      JA_TEM_OUTRA_VERSAO: "Um produto já tem uma versão diferente desta pergunta. Confira-o antes de vincular.",
      REGRA_INVALIDA: "Confira o mínimo e o máximo de cada produto.",
    };
    if (mensagens[e.message] || ["P2034", "P2025"].includes(e.code)) return NextResponse.json({ error: mensagens[e.message] || mensagens.CADASTRO_ALTERADO }, { status: 409 });
    console.error("[base complementos] falha:", e?.code || e?.name);
    return NextResponse.json({ error: "Não foi possível salvar. Nenhum produto foi alterado parcialmente." }, { status: 500 });
  }
}
