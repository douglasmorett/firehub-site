/**
 * GET /api/cash-session/fechamento-pdf?sessionId=…
 *
 * O fechamento de um caixa JÁ FECHADO em A4, para salvar em PDF e mandar à
 * contabilidade — o "Gerar PDF" do Histórico de caixas (Victor, Pizzaria 17,
 * 14/10/2026). Devolve uma página HTML que abre a janela de impressão sozinha;
 * o PDF sai pelo "Salvar como PDF" do navegador (por que não uma biblioteca:
 * lib/fechamento-a4.ts).
 *
 * Os números são os do Histórico: a conferência GRAVADA (reapurar mudaria um
 * caixa encerrado), as entradas e retiradas da tabela do caixa, e as vendas
 * por tipo apuradas na janela do caixa pela mesma função do papel e da 2ª via
 * (lib/esperado-do-turno.ts).
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { conferenciaGravada } from "@/lib/conferencia-do-caixa";
import { calcularEsperadoDoTurno } from "@/lib/esperado-do-turno";
import { movimentacoesDosCaixas } from "@/lib/movimentacoes-do-caixa";
import { htmlDoFechamentoA4, type VendasDoFechamentoA4 } from "@/lib/fechamento-a4";
import { funcionarioAbre } from "@/lib/permissao-da-tela";

export const dynamic = "force-dynamic";

const pagina = (status: number, texto: string) =>
  new NextResponse(
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Fechamento de caixa</title></head>` +
      `<body style="font-family:Arial,sans-serif;padding:24px;color:#111">${texto}</body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store" } }
  );

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return pagina(401, "Entre no FireHub para gerar o fechamento.");

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, ownerId: true, role: true, permissions: true },
  });
  if (!user) return pagina(404, "Usuário não encontrado.");
  // O mesmo portão da tela do Histórico (proxy.ts → lib/permissao-da-tela.ts):
  // o funcionário sem a caixinha do caixa não abre o histórico, e não pode
  // levar o fechamento por esta porta.
  if (String(user.role || "").toUpperCase() === "STAFF" && !funcionarioAbre("/store/caixa/historico", user.permissions)) {
    return pagina(403, "Sua conta não tem acesso ao Histórico de caixas.");
  }
  // O caixa é da LOJA: o funcionário vê os caixas do dono.
  const lojaId = user.ownerId || user.id;

  const sessionId = new URL(req.url).searchParams.get("sessionId") || "";
  if (!sessionId) return pagina(400, "Informe o caixa.");

  // A sessão TEM que ser desta loja (o id vem do navegador), e fechada: é o
  // Histórico que oferece o botão, e caixa aberto ainda não tem fechamento.
  const caixa = await prisma.cashSession.findFirst({ where: { id: sessionId, franchiseeId: lojaId, status: "CLOSED" } });
  if (!caixa) return pagina(404, "Caixa não encontrado.");

  const dono = await prisma.user.findUnique({
    where: { id: lojaId },
    select: { storeName: true, name: true, storeTimezone: true, cpfCnpj: true, storeAddress: true, storePhone: true },
  });

  // Nulo só quando a tabela não pôde ser lida; caixa sem nenhuma = lista vazia.
  const porCaixa = await movimentacoesDosCaixas(lojaId, [caixa.id]);
  const movimentos = porCaixa ? porCaixa.get(caixa.id) || [] : null;

  // As vendas por tipo: apuradas de novo, como no "Vendas por tipo" do
  // Histórico. Se falhar, o PDF sai com a conferência e diz que faltou isto.
  let vendas: VendasDoFechamentoA4 | null = null;
  try {
    const t = await calcularEsperadoDoTurno(lojaId, caixa, { ate: caixa.closedAt || new Date() });
    vendas = {
      vendas: t.detalhe.vendas,
      recebido: t.detalhe.recebido,
      ponte: t.detalhe.ponte,
      cupomDaPlataforma: t.detalhe.cupomDaPlataforma,
      porTipo: t.detalhe.porTipo,
    };
  } catch (e: any) {
    console.error("[Caixa] PDF do fechamento sem as vendas por tipo:", e?.message);
  }

  // A correção feita depois do fechamento aparece no PDF: a contabilidade
  // precisa saber que o contado não é o da hora.
  let correcoes: { qtd: number; ultima: { em: Date; por: string } | null } = { qtd: 0, ultima: null };
  try {
    const eds = await prisma.cashSessionEdicao.findMany({
      where: { cashSessionId: caixa.id, franchiseeId: lojaId },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true, editadoPor: true, suporte: true },
    });
    const u = eds[eds.length - 1];
    correcoes = { qtd: eds.length, ultima: u ? { em: u.createdAt, por: `${u.editadoPor}${u.suporte ? ` (${u.suporte})` : ""}` } : null };
  } catch (e: any) {
    console.warn("[Caixa] PDF do fechamento sem as correções:", e?.message);
  }

  const html = htmlDoFechamentoA4({
    loja: { nome: dono?.storeName || dono?.name || "", documento: dono?.cpfCnpj, endereco: dono?.storeAddress, telefone: dono?.storePhone },
    fuso: dono?.storeTimezone,
    abertoEm: caixa.openedAt,
    fechadoEm: caixa.closedAt,
    encerradoPor: caixa.closedBy,
    trocoInicial: Number(caixa.openingAmount || 0),
    conf: conferenciaGravada(caixa as unknown as Record<string, unknown>),
    justificativa: caixa.justification,
    observacoes: caixa.notes,
    movimentos,
    vendas,
    correcoes,
    emitido: { em: new Date(), por: session.user.name || session.user.email || "" },
  });

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Dado de caixa: nada de cache compartilhado nem guardado.
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}
