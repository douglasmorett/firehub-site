import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";

// POST: Login or Register
export async function POST(req: Request) {
  const body = await req.json();
  const { action, phone, password, name, address } = body;

  // Rate limiting: 5 tentativas por minuto por IP
  const ip = getClientIp(req);
  const { allowed } = checkRateLimit(`customer:${ip}`, { windowMs: 60_000, maxRequests: 5 });
  if (!allowed) {
    return NextResponse.json({ error: "Muitas tentativas. Aguarde 1 minuto." }, { status: 429 });
  }

  if (!phone || !password) {
    return NextResponse.json({ error: "Telefone e senha são obrigatórios." }, { status: 400 });
  }

  const cleanPhone = phone.replace(/\D/g, "");

  if (action === "register") {
    if (!name) return NextResponse.json({ error: "Nome é obrigatório." }, { status: 400 });

    const existing = await prisma.storeCustomer.findUnique({ where: { phone: cleanPhone } });
    if (existing) return NextResponse.json({ error: "Este telefone já possui uma conta. Faça login." }, { status: 409 });

    if (password.length < 6) return NextResponse.json({ error: "A senha deve ter no mínimo 6 caracteres." }, { status: 400 });

    const hashedPw = await bcrypt.hash(password, 12);
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
