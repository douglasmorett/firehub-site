import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const ref = searchParams.get("ref");
  
  if (!ref) return NextResponse.json({ error: "Missing ref" });

  const order = await prisma.customerOrder.findFirst({
    where: {
      ifoodReference: ref
    }
  });

  return NextResponse.json(order);
}
