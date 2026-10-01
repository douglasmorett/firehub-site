import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { garantirEstruturaDeDespesas } from "@/lib/garantir-colunas";
import { funcionarioAbre } from "@/lib/permissao-da-tela";

/**
 * Despesas lançadas à mão no DRE (gás, embalagem, conserto, anúncio...).
 *
 * O proxy só barra TELA para funcionário; rota de API não passa por ele. Por
 * isso a regra do financeiro é conferida aqui também: funcionário sem a
 * caixinha "financeiro" não lança nem apaga despesa.
 */
async function lojaDaSessao() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return null;
  const u = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, ownerId: true, email: true, role: true, permissions: true },
  });
  if (!u) return null;
  if (u.role === "STAFF" && !funcionarioAbre("/store/financeiro", u.permissions)) return null;
  return { franchiseeId: u.ownerId || u.id, email: u.email };
}

const DIA = /^\d{4}-\d{2}-\d{2}$/;

/** Mesma leitura do caixa: "150,50", "150.50" e "1.500" dão o que o lojista quis dizer. */
function lerValorEmReais(bruto: unknown): number {
  if (typeof bruto === "number") return bruto;
  const limpo = String(bruto ?? "").trim().replace(/[^\d.,]/g, "");
  if (!limpo) return NaN;
  if (limpo.includes(",")) return Number(limpo.replace(/\./g, "").replace(",", "."));
  const partes = limpo.split(".");
  if (partes.length === 1) return Number(limpo);
  const ultimo = partes[partes.length - 1];
  if (partes.length > 2 || ultimo.length === 3) return Number(partes.join(""));
  return Number(partes.slice(0, -1).join("") + "." + ultimo);
}

/** GET ?de=YYYY-MM-DD&ate=YYYY-MM-DD — as despesas do intervalo (sem filtro: o último ano). */
export async function GET(req: Request) {
  const loja = await lojaDaSessao();
  if (!loja) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  if (!(await garantirEstruturaDeDespesas())) return NextResponse.json({ despesas: [] });

  const url = new URL(req.url);
  const de = url.searchParams.get("de");
  const ate = url.searchParams.get("ate");
  const dia: Record<string, string> = {};
  if (de && DIA.test(de)) dia.gte = de;
  if (ate && DIA.test(ate)) dia.lte = ate;

  const despesas = await prisma.despesaLancada.findMany({
    where: { franchiseeId: loja.franchiseeId, ...(Object.keys(dia).length ? { dia } : {}) },
    orderBy: [{ dia: "desc" }, { createdAt: "desc" }],
  });
  return NextResponse.json({ despesas });
}

/** POST { dia, categoria, descricao?, valor } — lança uma despesa. */
export async function POST(req: Request) {
  const loja = await lojaDaSessao();
  if (!loja) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  if (!(await garantirEstruturaDeDespesas())) {
    return NextResponse.json(
      { error: "O lançamento de despesas ainda não está disponível. Tente de novo em alguns minutos." },
      { status: 503 }
    );
  }

  let corpo: any = {};
  try { corpo = await req.json(); } catch { }

  const dia = String(corpo?.dia ?? "").trim();
  const categoria = String(corpo?.categoria ?? "").trim().slice(0, 60);
  const descricao = String(corpo?.descricao ?? "").trim().slice(0, 200);
  const valor = lerValorEmReais(corpo?.valor);

  if (!DIA.test(dia) || Number.isNaN(Date.parse(dia + "T12:00:00"))) {
    return NextResponse.json({ error: "Informe a data da despesa." }, { status: 400 });
  }
  if (!categoria) {
    return NextResponse.json({ error: "Escolha ou escreva a categoria." }, { status: 400 });
  }
  if (!Number.isFinite(valor) || valor <= 0) {
    return NextResponse.json({ error: "Informe um valor maior que zero." }, { status: 400 });
  }
  if (valor > 1_000_000) {
    return NextResponse.json({ error: "Valor acima do limite. Confira o que foi digitado." }, { status: 400 });
  }

  const despesa = await prisma.despesaLancada.create({
    data: {
      franchiseeId: loja.franchiseeId,
      dia,
      categoria,
      descricao: descricao || null,
      valor: Number(Math.abs(valor).toFixed(2)),
      criadoPor: loja.email || null,
    },
  });
  return NextResponse.json({ ok: true, despesa });
}

/** DELETE ?id= — apaga um lançamento errado. O franchiseeId vai no WHERE da escrita. */
export async function DELETE(req: Request) {
  const loja = await lojaDaSessao();
  if (!loja) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  if (!(await garantirEstruturaDeDespesas())) return NextResponse.json({ error: "Indisponível" }, { status: 503 });

  const id = new URL(req.url).searchParams.get("id") || "";
  if (!id) return NextResponse.json({ error: "Informe o lançamento." }, { status: 400 });

  const { count } = await prisma.despesaLancada.deleteMany({
    where: { id, franchiseeId: loja.franchiseeId },
  });
  if (count === 0) return NextResponse.json({ error: "Lançamento não encontrado." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
