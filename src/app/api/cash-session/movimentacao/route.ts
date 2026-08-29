import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { temEstruturaDeCaixa, garantirEstruturaDeCaixa } from "@/lib/garantir-colunas";

/**
 * Sangria e reforço de caixa.
 *
 * O caixa só conhecia o troco de abertura e a contagem do fechamento. Todo
 * dinheiro que saía no meio do turno (pagar motoboy, comprar gelo, mandar para
 * o cofre) e todo dinheiro que entrava (repor troco) acontecia sem registro —
 * e reaparecia no fechamento como diferença sem explicação.
 *
 * Resolução de loja idêntica ao resto do módulo: `ownerId || id`, e o
 * franchiseeId entra no WHERE da própria escrita.
 */
async function lojaDaSessao() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return null;
  const u = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, ownerId: true, email: true },
  });
  if (!u) return null;
  return { franchiseeId: u.ownerId || u.id, email: u.email };
}

const TIPOS = ["ENTRADA", "SAIDA"] as const;

/** GET — as movimentações do turno aberto, mais os totais que a tela mostra. */
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

export async function GET() {
  const loja = await lojaDaSessao();
  if (!loja) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  // A tabela pode não existir ainda (boot que não conseguiu criar). Nesse caso
  // a tela some com a seção em vez de quebrar o caixa inteiro.
  if (!(await temEstruturaDeCaixa())) {
    return NextResponse.json({ disponivel: false, movimentacoes: [], entradas: 0, saidas: 0, saldo: 0 });
  }

  const turno = await prisma.cashSession.findFirst({
    where: { franchiseeId: loja.franchiseeId, status: "OPEN" },
    orderBy: { openedAt: "desc" },
    select: { id: true },
  });
  if (!turno) {
    return NextResponse.json({ disponivel: true, movimentacoes: [], entradas: 0, saidas: 0, saldo: 0 });
  }

  const movimentacoes = await prisma.cashMovement.findMany({
    where: { cashSessionId: turno.id, franchiseeId: loja.franchiseeId },
    orderBy: { createdAt: "desc" },
  });

  const entradas = movimentacoes.filter(m => m.tipo === "ENTRADA").reduce((s, m) => s + m.valor, 0);
  const saidas = movimentacoes.filter(m => m.tipo === "SAIDA").reduce((s, m) => s + m.valor, 0);

  return NextResponse.json({
    disponivel: true,
    movimentacoes,
    entradas: Number(entradas.toFixed(2)),
    saidas: Number(saidas.toFixed(2)),
    saldo: Number((entradas - saidas).toFixed(2)),
  });
}

/** POST — lança uma entrada ou saída no turno aberto. */
export async function POST(req: Request) {
  const loja = await lojaDaSessao();
  if (!loja) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  // Tenta criar a tabela na hora se o boot não tiver conseguido: é uma rota de
  // escrita, então falhar aqui em silêncio seria perder o lançamento.
  if (!(await temEstruturaDeCaixa())) {
    await garantirEstruturaDeCaixa();
    if (!(await temEstruturaDeCaixa())) {
      return NextResponse.json(
        { error: "O registro de sangria ainda não está disponível nesta loja. Tente de novo em alguns minutos." },
        { status: 503 }
      );
    }
  }

  let corpo: any = {};
  try { corpo = await req.json(); } catch { }
  const tipo = String(corpo?.tipo || "").toUpperCase();
  const descricao = String(corpo?.descricao ?? "").trim().slice(0, 200);

  if (!TIPOS.includes(tipo as any)) {
    return NextResponse.json({ error: "Informe se é uma entrada ou uma saída." }, { status: 400 });
  }

  // Aceita "50,00" e "50.00" — o teclado do celular manda vírgula, e recusar
  // isso faria o operador achar que o sistema não funciona.
  // Mesma leitura da tela (StoreTopNav.valorParaNumero): apagar TODOS os
  // pontos tratava "150.50" como 15050 -- uma sangria de R$ 150,50 virava
  // R$ 15.050,00 no esperado do fechamento. Com virgula, ela e o decimal;
  // sem virgula, o ponto so e milhar quando o grupo final tem tres digitos.
  const valor = lerValorEmReais(corpo?.valor);
  if (!Number.isFinite(valor) || valor <= 0) {
    return NextResponse.json({ error: "Informe um valor maior que zero." }, { status: 400 });
  }
  if (valor > 1_000_000) {
    return NextResponse.json({ error: "Valor acima do limite. Confira o que foi digitado." }, { status: 400 });
  }

  const turno = await prisma.cashSession.findFirst({
    where: { franchiseeId: loja.franchiseeId, status: "OPEN" },
    orderBy: { openedAt: "desc" },
    select: { id: true },
  });
  if (!turno) {
    return NextResponse.json(
      { error: "O caixa está fechado. Abra o caixa antes de lançar entrada ou saída." },
      { status: 400 }
    );
  }

  const mov = await prisma.cashMovement.create({
    data: {
      cashSessionId: turno.id,
      franchiseeId: loja.franchiseeId,
      tipo,
      // Sempre positivo: o sinal é do `tipo`. Guardar negativo faria a mesma
      // sangria contar duas vezes dependendo de quem somasse.
      valor: Number(Math.abs(valor).toFixed(2)),
      descricao: descricao || null,
      criadoPor: loja.email || null,
    },
  });

  return NextResponse.json({ ok: true, movimentacao: mov });
}

/** DELETE — desfaz um lançamento errado, enquanto o turno estiver aberto. */
export async function DELETE(req: Request) {
  const loja = await lojaDaSessao();
  if (!loja) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  if (!(await temEstruturaDeCaixa())) {
    return NextResponse.json({ error: "Indisponível" }, { status: 503 });
  }

  const id = new URL(req.url).searchParams.get("id") || "";
  if (!id) return NextResponse.json({ error: "Informe qual lançamento apagar." }, { status: 400 });

  // Só apaga lançamento DESTA loja e de turno ABERTO: turno fechado já virou
  // conferência assinada, e apagar dali mudaria um número que alguém já bateu.
  const turno = await prisma.cashSession.findFirst({
    where: { franchiseeId: loja.franchiseeId, status: "OPEN" },
    orderBy: { openedAt: "desc" },
    select: { id: true },
  });
  if (!turno) {
    return NextResponse.json({ error: "O caixa está fechado — não dá para apagar lançamento de turno já conferido." }, { status: 400 });
  }

  const { count } = await prisma.cashMovement.deleteMany({
    where: { id, franchiseeId: loja.franchiseeId, cashSessionId: turno.id },
  });
  if (count === 0) {
    return NextResponse.json({ error: "Lançamento não encontrado neste turno." }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
