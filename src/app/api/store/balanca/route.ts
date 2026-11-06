import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { lojaDoAssessorDaSessao } from "@/lib/assessor/loja-da-sessao";
import { lojaDaBalancaDaSessao } from "@/lib/balanca/sessao";
import {
  DIAS_DE_TESTE_DA_BALANCA, TermoNaoAceitoError, estadoDaBalanca, ligarOuDesligarBalanca, salvarProdutosDaBalanca,
} from "@/lib/balanca/assinatura";
import { SEM_PRODUTO_DE_INTEGRACAO } from "@/lib/cardapio-interno";
import { precoDoCanal } from "@/lib/preco-por-canal";
import { FIREHUB_PLAN } from "@/lib/firehub-billing";

/**
 * GET  — o estado do módulo, os números da mensalidade (para a tela explicar
 *        que os R$ 197 são à parte) e o cardápio para escolher os produtos
 *        por quilo.
 * POST { ligar: true, aceite: { versao } } — ativa, com o termo aceito (lib/balanca/termo.ts).
 * POST { ligar: false } — desativa (lib/modulo-pago.ts).
 *      Só o dono (ou o ADMIN dentro da loja), a mesma porta do Bill.
 * PUT  { produtos: string[] } — os produtos vendidos por quilo. Marcado, o
 *      produto sai do delivery, do totem, do balcão e do garçom: ele só se
 *      vende pesando. Desmarcado, volta só para onde o lojista ligar de novo.
 */
const publico = (e: Awaited<ReturnType<typeof estadoDaBalanca>>) => ({
  ativo: e.ativo, cobradoEsteMes: e.cobradoEsteMes, testeAte: e.testeAte, emTeste: e.emTeste, jaTestou: e.jaTestou, isento: e.isento, desligaEm: e.desligaEm, fimDoMes: e.fimDoMes,
});

async function cardapio(franchiseeId: string) {
  const produtos = await prisma.menuProduct.findMany({
    where: { franchiseeId, active: true, isCombo: false, ...SEM_PRODUTO_DE_INTEGRACAO },
    select: { id: true, name: true, category: true, price: true, priceSalao: true, priceDelivery: true, priceTotem: true, promoPrice: true },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });
  return produtos.map((p) => ({ id: p.id, nome: p.name, categoria: p.category || "", precoDoQuilo: precoDoCanal(p as any, "salao") }));
}

export async function GET() {
  const s = await lojaDaBalancaDaSessao();
  if (!s) return NextResponse.json({ error: "Seu acesso não abre a balança. Peça ao dono da loja." }, { status: 403 });
  const estado = await estadoDaBalanca(s.franchiseeId);
  return NextResponse.json({
    estado: publico(estado),
    podeContratar: s.podeContratar,
    preco: estado.preco,
    diasDeTeste: DIAS_DE_TESTE_DA_BALANCA,
    produtos: estado.produtos,
    cardapio: await cardapio(s.franchiseeId),
    mensalidade: { percentual: FIREHUB_PLAN.PERCENT_RATE, minimo: FIREHUB_PLAN.MIN_MONTHLY, teto: FIREHUB_PLAN.MAX_MONTHLY },
  });
}

export async function POST(req: Request) {
  const s = await lojaDoAssessorDaSessao();
  if (!s) return NextResponse.json({ error: "Só o dono da loja ativa ou desativa a balança." }, { status: 403 });
  let corpo: any = {};
  try { corpo = await req.json(); } catch {}
  if (typeof corpo?.ligar !== "boolean") return NextResponse.json({ error: "Informe ligar: true ou false." }, { status: 400 });

  // O aceite fica gravado com quem estava logado, o IP e o navegador — a prova do "concordo".
  let aceite = null;
  if (corpo.ligar) {
    const session = await getServerSession(authOptions);
    const ip = (req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || null;
    aceite = corpo?.aceite?.versao
      ? { versao: String(corpo.aceite.versao), email: session?.user?.email || null, ip, userAgent: (req.headers.get("user-agent") || "").slice(0, 300) || null }
      : null;
  }
  try {
    const estado = await ligarOuDesligarBalanca(s.franchiseeId, corpo.ligar, aceite);
    return NextResponse.json({ ok: true, estado: publico(estado) });
  } catch (err: any) {
    if (err instanceof TermoNaoAceitoError) return NextResponse.json({ error: err.message, precisaDoTermo: true }, { status: 400 });
    return NextResponse.json({ error: err?.message || "Erro ao salvar." }, { status: 503 });
  }
}

export async function PUT(req: Request) {
  const s = await lojaDaBalancaDaSessao();
  if (!s) return NextResponse.json({ error: "Seu acesso não abre a balança. Peça ao dono da loja." }, { status: 403 });
  let corpo: any = {};
  try { corpo = await req.json(); } catch {}
  if (!Array.isArray(corpo?.produtos)) return NextResponse.json({ error: "Informe os produtos." }, { status: 400 });
  const pedidos = [...new Set(corpo.produtos.map((id: unknown) => String(id ?? "")).filter(Boolean))] as string[];
  // Só produto desta loja entra na lista.
  const daLoja = pedidos.length
    ? await prisma.menuProduct.findMany({ where: { id: { in: pedidos }, franchiseeId: s.franchiseeId }, select: { id: true } })
    : [];
  const ids = daLoja.map((p) => p.id);
  try {
    await salvarProdutosDaBalanca(s.franchiseeId, ids);
    if (ids.length) {
      await prisma.menuProduct.updateMany({
        where: { id: { in: ids }, franchiseeId: s.franchiseeId },
        data: { activeDelivery: false, activeTotem: false, activePDV: false, activeGarcom: false },
      });
    }
    return NextResponse.json({ ok: true, produtos: ids });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Erro ao salvar." }, { status: 503 });
  }
}
