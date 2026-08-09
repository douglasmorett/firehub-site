/**
 * POST /api/invoices/manual
 * Insere uma nota fiscal manualmente (sem IA), para casos onde a foto falha.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const userEmail = session.user?.email || "unknown";

  try {
    const { description, supplier, value, date, category, expenseCategory } = await req.json();

    if (!description?.trim()) {
      return NextResponse.json({ error: "Descrição obrigatória" }, { status: 400 });
    }
    if (!value || isNaN(parseFloat(value)) || parseFloat(value) <= 0) {
      return NextResponse.json({ error: "Valor inválido" }, { status: 400 });
    }

    const fullDescription = supplier
      ? `${description} — Fornecedor: ${supplier}`
      : description;

    const dbUser = await prisma.user.findUnique({
      where: { email: session.user?.email || "" },
      select: { id: true, ownerId: true }
    });
    const targetFranchiseeId = dbUser?.ownerId || dbUser?.id || null;

    const invoice = await prisma.purchaseInvoice.create({
      data: {
        franchiseeId:   targetFranchiseeId,
        description:    fullDescription,
        imageUrl:       "",
        aiValue:        parseFloat(value),
        aiCategory:     expenseCategory || "Outros",
        aiRawText:      `Inserção manual. Valor: R$ ${parseFloat(value).toFixed(2)}`,
        invoiceDate:    date ? new Date(date + "T12:00:00") : new Date(),
        status:         "APPROVED",
        category:       category || "BUSINESS",
        uploadedBy:     userEmail,
        source:         "manual",
        rejectionReason: null,
      },
    });

    return NextResponse.json({ success: true, invoice });
  } catch (err: any) {
    console.error("[Manual Invoice]", err);
    return NextResponse.json({ error: err.message || "Erro ao salvar nota." }, { status: 500 });
  }
}
