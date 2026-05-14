import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

// POST: Login or Register
export async function POST(req: Request) {
  const body = await req.json();
  const { action, phone, password, name, address } = body;

  if (!phone || !password) {
    return NextResponse.json({ error: "Telefone e senha são obrigatórios." }, { status: 400 });
  }

  const cleanPhone = phone.replace(/\D/g, "");

  if (action === "register") {
    if (!name) return NextResponse.json({ error: "Nome é obrigatório." }, { status: 400 });

    const existing = await prisma.storeCustomer.findUnique({ where: { phone: cleanPhone } });
    if (existing) return NextResponse.json({ error: "Este telefone já possui uma conta. Faça login." }, { status: 409 });

    const hashedPw = await bcrypt.hash(password, 10);
    const customer = await prisma.storeCustomer.create({
      data: { name, phone: cleanPhone, password: hashedPw, address: address || null }
    });

    return NextResponse.json({ id: customer.id, name: customer.name, phone: customer.phone, address: customer.address });
  }

  // LOGIN
  const customer = await prisma.storeCustomer.findUnique({ where: { phone: cleanPhone } });
  if (!customer) return NextResponse.json({ error: "Conta não encontrada. Crie uma conta." }, { status: 404 });

  const valid = await bcrypt.compare(password, customer.password);
  if (!valid) return NextResponse.json({ error: "Senha incorreta." }, { status: 401 });

  // Return customer data + recent orders
  const orders = await prisma.customerOrder.findMany({
    where: { customerId: customer.id },
    orderBy: { createdAt: "desc" },
    take: 10,
    include: { items: { include: { menuProduct: { select: { name: true } } } } }
  });

  return NextResponse.json({
    id: customer.id,
    name: customer.name,
    phone: customer.phone,
    address: customer.address,
    orders
  });
}
