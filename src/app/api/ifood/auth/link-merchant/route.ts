import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getIfoodToken } from "@/lib/ifood-api";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  try {
    const { merchantId } = await req.json();
    const cleanMerchantId = merchantId?.trim();

    if (!cleanMerchantId) {
      return NextResponse.json({ error: "ID da loja (Merchant UUID) é obrigatório." }, { status: 400 });
    }

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(cleanMerchantId)) {
      return NextResponse.json({
        error: "ID da loja inválido. Certifique-se de que é um UUID válido do iFood (ex: f2170891-3073-47ea-9e32-947a2336bc8c)."
      }, { status: 400 });
    }

    const token = await getIfoodToken();
    const res = await fetch(`https://merchant-api.ifood.com.br/merchant/v1.0/merchants/${cleanMerchantId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error(`[iFood Link Merchant] Validação falhou para ${cleanMerchantId}: ${res.status} — ${errText}`);
      return NextResponse.json({
        error: `Não foi possível acessar a loja no iFood (HTTP ${res.status}).`,
        details: "Verifique se você já solicitou o acesso a este CNPJ/Merchant ID na aba 'Permissões' do Portal do Desenvolvedor do iFood, e se o restaurante aprovou a solicitação no Portal do Parceiro.",
        raw: errText.slice(0, 200)
      }, { status: 400 });
    }

    const data = await res.json();
    const storeName = data.name || data.shortName || "Loja iFood";

    // Save connection in database
    await prisma.user.update({
      where: { email: session.user.email },
      data: {
        ifoodConnected: true,
        ifoodMerchantId: cleanMerchantId
      }
    });

    return NextResponse.json({
      success: true,
      merchantId: cleanMerchantId,
      storeName,
      message: "Loja vinculada com sucesso!"
    });
  } catch (err: any) {
    console.error("[iFood Link Merchant Error]", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
