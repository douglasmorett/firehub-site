import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { resolveScope, canTouch } from "@/lib/escopo-do-cardapio";
import { itemFixoDoGrupo } from "@/lib/combo-e-pergunta";
import { refazerMeiasDaLoja } from "@/lib/meio-a-meio-no-banco";
import {
  copiaDoGrupo,
  destinosDaPergunta,
  motivoParaNaoCopiar,
  planoNoDestino,
  type PosicaoDaCopia,
  type SeJaTiver,
} from "@/lib/copiar-pergunta";

/**
 * "📋 Usar em outros produtos": copia UMA pergunta para vários produtos.
 *
 *   POST { grupoId, destinoIds: string[], seJaTiver: "pular"|"substituir", posicao: "fim"|"inicio" }
 *   → { copiados, pulados, recusados: [{ id, motivo }] }
 *
 * O PUT da rota principal apaga e recria TODAS as perguntas do produto; para
 * mexer em 20 produtos de uma vez isto não serve (seria mandar o produto
 * inteiro 20 vezes). Aqui só ENTRA a pergunta nova — e, no "substituir", sai
 * só a de mesmo título. As regras do que pode ir para onde estão em
 * src/lib/copiar-pergunta.ts, as mesmas que a tela usa para montar a lista.
 */
export async function POST(req: NextRequest) {
  const { scope, error } = await resolveScope(req, true);
  if (!scope) return error;

  const body = await req.json().catch(() => null);
  const grupoId = typeof body?.grupoId === "string" ? body.grupoId : "";
  const destinoIds: string[] = Array.isArray(body?.destinoIds)
    ? Array.from(new Set(body.destinoIds.filter((id: unknown) => typeof id === "string" && id)))
    : [];
  const seJaTiver: SeJaTiver = body?.seJaTiver === "substituir" ? "substituir" : "pular";
  const posicao: PosicaoDaCopia = body?.posicao === "inicio" ? "inicio" : "fim";
  if (!grupoId) return NextResponse.json({ error: "Pergunta não informada" }, { status: 400 });
  if (destinoIds.length === 0) return NextResponse.json({ error: "Escolha pelo menos um produto" }, { status: 400 });

  const grupo = await prisma.comboGroup.findUnique({
    where: { id: grupoId },
    include: {
      items: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
      menuProduct: { select: { id: true, name: true, category: true, franchiseeId: true, isCombo: true } },
    },
  });
  if (!grupo) return NextResponse.json({ error: "Pergunta não encontrada" }, { status: 404 });
  const origem = grupo.menuProduct;
  // Produto sem loja não tem cardápio onde a cópia caiba (e o `where` abaixo
  // com franchiseeId nulo juntaria todos os órfãos do banco).
  if (!origem.franchiseeId || !canTouch(scope, origem.franchiseeId)) {
    return NextResponse.json({ error: "Sem permissão para esta pergunta" }, { status: 403 });
  }
  const trava = motivoParaNaoCopiar(grupo, origem);
  if (trava) return NextResponse.json({ error: trava }, { status: 400 });

  // O cardápio INTEIRO da loja da origem: quem é opção de combo só se
  // descobre olhando as perguntas dos outros (idsSoDeOpcaoDeCombo). Produto
  // de outra loja nem entra — o destino tem de ser da mesma loja da opção.
  const catalogo = await prisma.menuProduct.findMany({
    where: { franchiseeId: origem.franchiseeId },
    select: {
      id: true, name: true, category: true, franchiseeId: true, active: true,
      isCombo: true, apenasEmCombo: true,
      price: true, priceSalao: true, priceDelivery: true, priceTotem: true,
      comboGroups: {
        select: {
          id: true, title: true, sortOrder: true, maxQty: true, minQty: true,
          items: { select: { menuProductId: true, maxPerItem: true } },
        },
      },
    },
  });
  const { mesmaCategoria, outras, bloqueados } = destinosDaPergunta(catalogo, origem, grupo);
  const podeIr = new Map([...mesmaCategoria, ...outras].map((d) => [d.produto.id, d.produto]));
  const motivoDoBloqueio = new Map(bloqueados.map((b) => [b.produto.id, b.motivo]));

  const copia = copiaDoGrupo(grupo);
  let copiados = 0;
  let pulados = 0;
  const recusados: { id: string; motivo: string }[] = [];

  for (const id of destinoIds) {
    const destino = podeIr.get(id);
    if (!destino) {
      recusados.push({ id, motivo: id === origem.id ? "É o produto de origem" : motivoDoBloqueio.get(id) || "Produto de outra loja ou inexistente" });
      continue;
    }
    const plano = planoNoDestino(
      destino.comboGroups.map((g) => ({ id: g.id, title: g.title, sortOrder: g.sortOrder, fixo: Boolean(destino.isCombo && itemFixoDoGrupo(g)) })),
      copia.title,
      seJaTiver,
      posicao
    );
    if (plano.pular) { pulados++; continue; }

    // Um produto por transação: se o 7º falhar, os 6 primeiros ficam (e a
    // tela diz quantos foram), mas nenhum produto fica pela metade.
    await prisma.$transaction(async (tx) => {
      if (plano.apagar.length) {
        await tx.comboGroup.deleteMany({ where: { id: { in: plano.apagar }, menuProductId: destino.id } });
      }
      for (const d of plano.deslocar) {
        await tx.comboGroup.update({ where: { id: d.id }, data: { sortOrder: d.sortOrder } });
      }
      const novo = await tx.comboGroup.create({
        data: {
          menuProductId: destino.id,
          title: copia.title,
          maxQty: copia.maxQty,
          minQty: copia.minQty,
          priceRule: copia.priceRule,
          sortOrder: plano.sortOrder,
        },
        select: { id: true },
      });
      if (copia.items.length) {
        await tx.comboGroupItem.createMany({
          data: copia.items.map((it) => ({ ...it, comboGroupId: novo.id })),
        });
      }
    });
    copiados++;
  }

  if (copiados > 0) {
    // Mesma razão do PUT: uma pergunta de tamanho copiada para uma pizza muda
    // a conta das meias dela. Falhar aqui não desfaz a cópia.
    await refazerMeiasDaLoja(origem.franchiseeId).catch((e) =>
      console.error("[copiar-pergunta] meio a meio não refeito:", e?.message || e)
    );
    // A vitrine é cacheada: sem isto a pergunta nova só aparecia para o
    // cliente quando o cache vencesse.
    const loja = await prisma.user.findUnique({ where: { id: origem.franchiseeId || "" }, select: { slug: true } }).catch(() => null);
    if (loja?.slug) {
      try { revalidatePath(`/loja/${loja.slug}`); } catch {}
    }
  }

  return NextResponse.json({ copiados, pulados, recusados });
}
