import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/api-key";
import { prisma } from "@/lib/prisma";
import { dispatchOutboundWebhook } from "@/lib/webhook-dispatcher";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ productId: string }> }
) {
  const auth = await authenticateApiKey(req);
  if (!auth) {
    return NextResponse.json({ error: "Não autorizado.", code: "UNAUTHORIZED" }, { status: 401 });
  }

  const { productId } = await params;
  const body = await req.json();
  const { price, active, description, name } = body;

  const existingProduct = await prisma.menuProduct.findFirst({
    where: { id: productId, franchiseeId: auth.franchiseeId },
  });

  if (!existingProduct) {
    return NextResponse.json({ error: "Produto não encontrado ou não pertence a esta loja." }, { status: 404 });
  }

  const updatedProduct = await prisma.menuProduct.update({
    where: { id: productId },
    data: {
      price: typeof price === "number" ? price : undefined,
      active: typeof active === "boolean" ? active : undefined,
      description: typeof description === "string" ? description : undefined,
      name: typeof name === "string" ? name : undefined,
    },
  });

  // Disparar webhook de saída
  dispatchOutboundWebhook(auth.franchiseeId, "menu.updated", {
    productId: updatedProduct.id,
    name: updatedProduct.name,
    price: updatedProduct.price,
    active: updatedProduct.active,
  });

  return NextResponse.json({
    success: true,
    product: {
      id: updatedProduct.id,
      name: updatedProduct.name,
      price: updatedProduct.price,
      active: updatedProduct.active,
      description: updatedProduct.description,
    },
  });
}
