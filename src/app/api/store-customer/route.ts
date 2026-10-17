import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";
import { cupomDePrimeiroPedido, cupomVenceu, descreverBeneficio } from "@/lib/cupons";
import { hojeDaLoja, jaPediuPeloSite } from "@/lib/cupons-no-banco";
import { cashbackDoCliente } from "@/lib/cashback-no-banco";
import { lerCashback, regraNoCanal } from "@/lib/cashback";
import { PEDIDOS_DO_CARDAPIO } from "@/lib/pedidos-do-telefone";
import { ondeEstaoOsPedidosDoTelefone } from "@/lib/pedidos-do-telefone-no-banco";
import { carimbosDoTelefone, trilhaDoTelefone } from "@/lib/premio-no-pedido";
import { carimbosDoCliente } from "@/lib/carimbos";

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

  // ── EXCLUIR A CONTA ──────────────────────────────────────────────────
  //
  // A App Store (5.1.1(v)) e o Google Play exigem que quem cria conta possa
  // apagá-la no próprio app; o app da loja (apps/loja) mostra esta página, então
  // o botão mora aqui. Confere a senha e ANONIMIZA o cadastro em vez de apagar
  // a linha: os pedidos guardam a própria cópia de nome e telefone (exigência
  // fiscal — /privacidade-app), e a linha some de qualquer busca por telefone.
  if (action === "delete") {
    const conta = await prisma.storeCustomer.findUnique({ where: { phone: cleanPhone } });
    const senhaConfere = !!conta && (conta.password || "").length >= 20 && (await bcrypt.compare(password, conta.password));
    if (!conta || !senhaConfere) {
      return NextResponse.json({ error: "Telefone ou senha incorretos." }, { status: 401 });
    }
    await prisma.storeCustomer.update({
      where: { id: conta.id },
      data: {
        name: "Conta excluída",
        phone: `excluida-${conta.id}`,
        password: "",
        address: null,
        birthDate: null,
        cashbackBalance: 0,
        cashbackHistory: Prisma.DbNull,
      },
    });
    return NextResponse.json({ success: true });
  }

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

  // A busca e o tamanho da lista moram em lib/pedidos-do-telefone.ts. Vem UM a
  // mais só para dizer se a lista cortou pedidos (`maisPedidos`). O cartão de
  // carimbos NÃO é mais contado sobre esta lista: vai pronto em `carimbos`,
  // contado no servidor sobre o histórico (é dele que sai o prêmio).
  const encontrados = await prisma.customerOrder.findMany({
    where: await ondeEstaoOsPedidosDoTelefone(franchiseeId, cleanPhone, PEDIDOS_DO_CARDAPIO + 1),
    orderBy: { createdAt: "desc" },
    take: PEDIDOS_DO_CARDAPIO + 1,
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
  const orders = encontrados.slice(0, PEDIDOS_DO_CARDAPIO);
  const maisPedidos = encontrados.length > PEDIDOS_DO_CARDAPIO;

  // `customer: null` de propósito: os dados pessoais só saem pelo login.
  const [trilha, cupomPrimeiroPedido, cashback, carimbos] = await Promise.all([
    trilhaDoCliente(franchiseeId, cleanPhone),
    cupomDePrimeiroPedidoDoCliente(franchiseeId, cleanPhone),
    saldoDeCashbackDoCliente(franchiseeId, cleanPhone),
    carimbosDoCardapio(franchiseeId, cleanPhone),
  ]);
  return NextResponse.json({ orders, maisPedidos, customer: null, trilha, cupomPrimeiroPedido, cashback, carimbos });
}

/**
 * O Cartão de Carimbos deste telefone (lib/carimbos.ts), contado aqui sobre o
 * histórico — a mesma conta que decide o prêmio no checkout e no robô, e que a
 * ficha do cliente mostra à loja. Sai só contagem e prêmio (a rota é pública).
 * `null` = cartão fora do ar nesta loja.
 */
async function carimbosDoCardapio(franchiseeId: string, cleanPhone: string) {
  try {
    const loja = await prisma.user.findUnique({ where: { id: franchiseeId }, select: { storeLoyalty: true } });
    const r = await carimbosDoTelefone(franchiseeId, loja?.storeLoyalty, cleanPhone);
    return r ? carimbosDoCliente(r.regra, r.cartao) : null;
  } catch {
    // O cartão nunca pode derrubar a consulta de pedidos do cliente.
    return null;
  }
}

/**
 * O saldo de cashback deste telefone NESTA loja (lib/cashback.ts), ou null
 * quando a loja não tem cashback. Sai só o valor e o próximo vencimento — o
 * mesmo nível de informação do progresso da trilha, que já sai daqui.
 * Quem pergunta é o cardápio: com o site desmarcado nos canais do cashback,
 * não há saldo a mostrar nem a usar aqui.
 */
async function saldoDeCashbackDoCliente(franchiseeId: string, cleanPhone: string) {
  try {
    const loja = await prisma.user.findUnique({ where: { id: franchiseeId }, select: { storeLoyalty: true } });
    if (!regraNoCanal(lerCashback(loja?.storeLoyalty), "site").ativo) return null;
    return await cashbackDoCliente(franchiseeId, loja?.storeLoyalty, cleanPhone);
  } catch {
    return null;
  }
}

/**
 * O cupom de primeiro pedido que ESTE telefone tem direito nesta loja, ou null.
 *
 * Vai junto da consulta que o cardápio já faz ao reconhecer o telefone (login
 * ou digitado no checkout): é o que permite ao site aplicar o desconto sozinho
 * e avisar "seu primeiro pedido tem X de desconto" — sem código, sem o cliente
 * precisar saber que existe cupom. Quem decide se ele "nunca pediu" é o
 * servidor (lib/cupons-no-banco.ts), pelo telefone; o navegador não tem como.
 *
 * Só sai código e benefício: nada que identifique alguém (a rota é pública).
 */
async function cupomDePrimeiroPedidoDoCliente(franchiseeId: string, cleanPhone: string) {
  try {
    const loja = await prisma.user.findUnique({
      where: { id: franchiseeId },
      select: { storeCoupons: true, storeTimezone: true },
    });
    const cupom = cupomDePrimeiroPedido(loja?.storeCoupons);
    if (!cupom || cupomVenceu(cupom, hojeDaLoja(loja?.storeTimezone))) return null;
    if (await jaPediuPeloSite(franchiseeId, cleanPhone)) return null;
    return {
      code: cupom.code,
      type: cupom.type,
      discount: cupom.discount,
      minOrderValue: cupom.minOrderValue,
      validade: cupom.validade,
      beneficio: descreverBeneficio(cupom),
    };
  } catch {
    // O cupom nunca pode derrubar a consulta de pedidos do cliente.
    return null;
  }
}

/**
 * Onde este telefone está na Trilha Premiada desta loja.
 *
 * Vai junto da consulta de pedidos que o cardápio já faz — uma ida ao servidor
 * em vez de duas. O cálculo é aqui e não no navegador porque a regra do ciclo
 * (lib/trilha-premiada.ts) decide prêmio: no cliente, ela seria editável com o
 * inspetor aberto.
 *
 * Devolve só contagem e prêmio: nada de nome, endereço ou histórico. A rota é
 * pública por telefone (como a consulta de pedidos), e o que sai daqui não
 * identifica ninguém.
 *
 * A conta e a busca moram em lib/premio-no-pedido.ts (`trilhaDoTelefone`), a
 * mesma que a ficha do cliente no painel usa — o lojista lê o número que o
 * cliente vê.
 */
async function trilhaDoCliente(franchiseeId: string, cleanPhone: string) {
  try {
    const loja = await prisma.user.findUnique({
      where: { id: franchiseeId },
      select: { storeLoyalty: true },
    });
    return await trilhaDoTelefone(franchiseeId, loja?.storeLoyalty, cleanPhone);
  } catch {
    // A trilha nunca pode derrubar a consulta de pedidos do cliente.
    return null;
  }
}
