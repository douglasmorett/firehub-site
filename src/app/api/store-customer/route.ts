import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";

// POST: Login or Register
export async function POST(req: Request) {
  const body = await req.json();
  const { action, phone, password, name, address, birthDate } = body;

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
    // ── CONTA FANTASMA CRIADA PELO ROBÔ ─────────────────────────────────
    //
    // O chatbot grava um StoreCustomer com `password: ""` para guardar o nome
    // de quem pediu pelo WhatsApp. Quando essa mesma pessoa ia criar conta no
    // site, batia neste 409 — e no login `bcrypt.compare(senha, "")` sempre
    // falha. Ou seja: cadastro barrado E login impossível, para sempre. O
    // cliente ficava trancado fora justo do canal que a loja quer priorizar.
    //
    // Hash bcrypt tem 60 caracteres; qualquer coisa menor não veio de um
    // cadastro real. Nesse caso a conta é ASSUMIDA: define-se a senha agora.
    // Não há senha sendo contornada — nunca existiu uma.
    const contaNaoReivindicada = !!existing && (existing.password || "").length < 20;

    if (existing && !contaNaoReivindicada) {
      return NextResponse.json({ error: "Este telefone já possui uma conta. Faça login." }, { status: 409 });
    }

    if (password.length < 6) return NextResponse.json({ error: "A senha deve ter no mínimo 6 caracteres." }, { status: 400 });

    const hashedPw = await bcrypt.hash(password, 12);
    const customer = existing
      ? await prisma.storeCustomer.update({
          where: { id: existing.id },
          data: {
            name,
            password: hashedPw,
            // O que o robô já sabia só é sobrescrito se o cliente digitou algo.
            ...(address ? { address } : {}),
            ...(birthDate ? { birthDate: String(birthDate).trim() } : {}),
          },
        })
      : await prisma.storeCustomer.create({
          data: {
            name,
            phone: cleanPhone,
            password: hashedPw,
            address: address || null,
            birthDate: birthDate ? String(birthDate).trim() : null,
          },
        });

    return NextResponse.json({
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      address: customer.address,
      birthDate: customer.birthDate,
      cashbackBalance: customer.cashbackBalance || 0,
    });
  }

  // LOGIN
  const customer = await prisma.storeCustomer.findUnique({ where: { phone: cleanPhone } });
  if (!customer) return NextResponse.json({ error: "Conta não encontrada. Crie uma conta." }, { status: 404 });

  // Conta que o robô criou e ninguém assumiu ainda: dizer "senha incorreta"
  // manda o cliente tentar a senha para sempre. O caminho é criar a conta.
  if ((customer.password || "").length < 20) {
    return NextResponse.json(
      { error: "Você ainda não tem senha cadastrada. Toque em \"Criar conta\" com este mesmo telefone para definir a sua." },
      { status: 409 }
    );
  }

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
    birthDate: customer.birthDate,
    cashbackBalance: customer.cashbackBalance || 0,
    orders
  });
}

/**
 * GET: acompanhamento dos pedidos pelo telefone, na tela da loja.
 *
 * ── O QUE ESTAVA ERRADO AQUI ────────────────────────────────────────────────
 *
 * Esta rota é PÚBLICA (o cliente digita o telefone e vê os pedidos dele) e
 * devolvia, para qualquer um que passasse um número: nome, ENDEREÇO, saldo de
 * cashback e os 10 últimos pedidos daquele telefone — de TODAS as lojas da
 * plataforma, sem filtro de loja nenhum.
 *
 * Ou seja: um script varrendo faixas de telefone colhia a base de clientes
 * inteira do sistema, com endereço de casa. Vazamento de dado pessoal (LGPD) e,
 * de quebra, cross-tenant: um lojista via a clientela do concorrente.
 *
 * Agora: só os pedidos DAQUELA loja, só os campos que a tela de
 * acompanhamento usa (id, status, total, itens) e com teto de consultas por
 * origem. Nome, endereço e cashback saíram daqui — eles vêm do login do
 * cliente (POST desta mesma rota), que exige senha.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const phone = searchParams.get("phone");
  const franchiseeId = searchParams.get("franchiseeId");
  if (!phone) return NextResponse.json({ error: "Telefone obrigatório" }, { status: 400 });

  // Teto de consultas: sem isto, varrer telefones é só questão de tempo.
  const ip = getClientIp(req);
  const { allowed } = checkRateLimit(`lookup-pedidos:${ip}`, { windowMs: 60_000, maxRequests: 20 });
  if (!allowed) {
    return NextResponse.json({ error: "Muitas consultas. Aguarde 1 minuto." }, { status: 429 });
  }

  const cleanPhone = phone.replace(/\D/g, "");
  if (cleanPhone.length < 8) return NextResponse.json({ orders: [], customer: null });

  // Sem a loja no pedido, a busca não sai daqui: era exatamente o que permitia
  // enxergar pedido de loja alheia.
  if (!franchiseeId) {
    return NextResponse.json({ orders: [], customer: null });
  }

  const orders = await prisma.customerOrder.findMany({
    where: {
      franchiseeId,
      OR: [
        { customerPhone: { contains: cleanPhone.slice(-8) } },
        { customerPhone: cleanPhone }
      ]
    },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      id: true,
      status: true,
      totalAmount: true,
      createdAt: true,
      items: {
        select: {
          quantity: true,
          price: true,
          productName: true,
          // `comboSelections` e `notes` entram para o "repetir pedido" conseguir
          // remontar a sacola do jeito que o cliente pediu da última vez.
          // `active` do produto entra para a tela saber avisar quando um item
          // saiu do cardápio, em vez de repetir um pedido que não pode ser feito.
          comboSelections: true,
          notes: true,
          menuProduct: {
            select: { id: true, name: true, price: true, imageUrl: true, isCombo: true, active: true },
          },
        },
      },
    },
  });

  // `customer: null` de propósito: os dados pessoais só saem pelo login.
  return NextResponse.json({ orders, customer: null });
}
