import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  descricaoDoTamanho, ehPerguntaDeBorda, ehPerguntaDeSabores, errosDaMontagem, limparMontagem,
  nomeDoTamanho, perguntasDoTamanho, type MontagemDaPizza,
} from "@/lib/pizza-por-tamanho";

/**
 * O passo a passo "Cadastrar pizza" (components/admin/CadastroDePizza) grava
 * aqui, de uma vez e numa transação só: os sabores, as bordas e um produto por
 * tamanho com as perguntas montadas (lib/pizza-por-tamanho.ts). Pelo
 * /api/admin/menu-products seriam dezenas de chamadas soltas, e uma falha no
 * meio deixava meia pizzaria cadastrada.
 *
 * Também serve para EDITAR o que ele mesmo montou (adicionar sabor, mudar
 * preço): o que vem com `id` é atualizado — só se for desta loja e do tipo
 * certo —, e as outras perguntas que o lojista pôs no tamanho ficam como estão.
 */

/** A loja de quem está logado: funcionário grava na do dono; ADMIN, na loja ativa. */
async function lojaDaSessao(req: NextRequest): Promise<{ loja: string } | { erro: NextResponse }> {
  const session = await getServerSession(authOptions);
  if (!session) return { erro: NextResponse.json({ error: "Não autorizado" }, { status: 401 }) };
  const user = await prisma.user.findUnique({
    where: { email: session.user?.email || "" },
    select: { id: true, role: true, ownerId: true },
  });
  if (!user) return { erro: NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 }) };
  if (user.role === "ADMIN") {
    const ativa = req.nextUrl.searchParams.get("storeId") || req.cookies.get("firehub_active_store")?.value || null;
    if (!ativa || ativa === "all") return { erro: NextResponse.json({ error: "Escolha a loja antes de cadastrar a pizza." }, { status: 400 }) };
    return { loja: ativa };
  }
  return { loja: user.ownerId || user.id };
}

export async function POST(req: NextRequest) {
  const sessao = await lojaDaSessao(req);
  if ("erro" in sessao) return sessao.erro;
  const loja = sessao.loja;

  const corpo = await req.json().catch(() => null);
  let m: MontagemDaPizza;
  try {
    m = limparMontagem(corpo?.montagem);
  } catch {
    return NextResponse.json({ error: "Dados da pizza incompletos. Feche e comece de novo." }, { status: 400 });
  }
  const erros = errosDaMontagem(m);
  if (erros.length) return NextResponse.json({ error: erros[0], erros }, { status: 400 });

  // Tamanhos que o lojista tirou na edição: saem de venda (pausados), não somem
  // — pedido antigo e relatório continuam apontando para eles.
  const pausar: string[] = Array.isArray(corpo?.pausar) ? corpo.pausar.map(String) : [];

  // O que veio com id tem que ser DESTA loja e do tipo certo: sabor e borda são
  // opções (apenasEmCombo); tamanho é produto de venda. Senão a tela estava
  // velha (ou o corpo foi forjado) e nada é gravado.
  const citados = [...m.tamanhos, ...m.sabores, ...m.bordas].map((x) => x.id).filter(Boolean) as string[];
  const existentes = await prisma.menuProduct.findMany({
    where: { id: { in: [...citados, ...pausar] }, franchiseeId: loja },
    select: { id: true, isCombo: true, apenasEmCombo: true },
  });
  const porId = new Map(existentes.map((e) => [e.id, e]));
  const opcaoValida = (id?: string | null) => !id || porId.get(id)?.apenasEmCombo === true;
  const tamanhoValido = (id?: string | null) => !id || (porId.has(id) && !porId.get(id)!.isCombo && !porId.get(id)!.apenasEmCombo);
  if (!m.sabores.every((s) => opcaoValida(s.id)) || !m.bordas.every((b) => opcaoValida(b.id)) || !m.tamanhos.every((t) => tamanhoValido(t.id)) || !pausar.every(tamanhoValido)) {
    return NextResponse.json({ error: "O cardápio mudou enquanto você editava. Feche, abra de novo e refaça a mudança." }, { status: 409 });
  }

  const resultado = await prisma.$transaction(async (tx) => {
    // Opção (sabor ou borda): um produto só, usado em todos os tamanhos.
    const gravarOpcao = async (id: string | null | undefined, nome: string, descricao: string) => {
      const dados = { name: nome, description: descricao || nome, category: m.categoria };
      if (id) {
        await tx.menuProduct.update({ where: { id }, data: dados });
        return id;
      }
      const novo = await tx.menuProduct.create({
        data: { ...dados, franchiseeId: loja, price: 0, apenasEmCombo: true, isCombo: false, isBeverage: false, active: true },
        select: { id: true },
      });
      return novo.id;
    };
    const idsDosSabores: string[] = [];
    for (const s of m.sabores) idsDosSabores.push(await gravarOpcao(s.id, s.nome, s.descricao));
    const idsDasBordas: string[] = [];
    for (const b of m.bordas) idsDasBordas.push(await gravarOpcao(b.id, b.nome, `Borda recheada de ${b.nome.replace(/^borda\s+(de\s+)?/i, "")}`));

    const idsDosTamanhos: string[] = [];
    for (let i = 0; i < m.tamanhos.length; i++) {
      const t = m.tamanhos[i];
      const perguntas = perguntasDoTamanho(m, i, idsDosSabores, idsDasBordas);
      const dados = { name: nomeDoTamanho(t.nome), description: descricaoDoTamanho(t), category: m.categoria };
      let id = t.id || null;
      if (id) {
        await tx.menuProduct.update({ where: { id }, data: dados });
        // Troca só as perguntas que esta tela monta; as outras descem para depois delas.
        const antigas = await tx.comboGroup.findMany({ where: { menuProductId: id }, orderBy: { sortOrder: "asc" }, select: { id: true, title: true, priceRule: true } });
        const daPizza = antigas.filter((g) => ehPerguntaDeSabores(g) || ehPerguntaDeBorda(g));
        if (daPizza.length) await tx.comboGroup.deleteMany({ where: { id: { in: daPizza.map((g) => g.id) } } });
        const outras = antigas.filter((g) => !daPizza.includes(g));
        for (let k = 0; k < outras.length; k++) {
          await tx.comboGroup.update({ where: { id: outras[k].id }, data: { sortOrder: perguntas.length + k } });
        }
      } else {
        // Preço 0: quem cobra é o sabor. A ordem do passo a passo (menor → maior) vira a do cardápio.
        const novo = await tx.menuProduct.create({
          data: { ...dados, franchiseeId: loja, price: 0, isCombo: false, isBeverage: false, active: true, sortOrder: i },
          select: { id: true },
        });
        id = novo.id;
      }
      for (let g = 0; g < perguntas.length; g++) {
        const p = perguntas[g];
        await tx.comboGroup.create({
          data: {
            menuProductId: id,
            title: p.title,
            minQty: p.minQty,
            maxQty: p.maxQty,
            priceRule: p.priceRule,
            sortOrder: g,
            items: { create: p.items.map((it, k) => ({ menuProductId: it.id, additionalPrice: it.additionalPrice, sortOrder: k })) },
          },
        });
      }
      idsDosTamanhos.push(id);
    }

    if (pausar.length) await tx.menuProduct.updateMany({ where: { id: { in: pausar }, franchiseeId: loja }, data: { active: false } });
    return { tamanhos: idsDosTamanhos, sabores: idsDosSabores, bordas: idsDasBordas };
  }, { timeout: 30_000, maxWait: 10_000 });

  // A vitrine é cacheada por 60 s: a pizza nova aparece na hora.
  const dono = await prisma.user.findUnique({ where: { id: loja }, select: { slug: true } }).catch(() => null);
  if (dono?.slug) {
    try { revalidatePath(`/loja/${dono.slug}`); } catch {}
  }

  return NextResponse.json({ ok: true, ...resultado });
}
