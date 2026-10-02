/**
 * GET /api/store-customer/reconhecer?phone=&franchiseeId=
 *
 * O cardápio chama quando o cliente termina de digitar o WhatsApp no
 * checkout: devolve o nome e os endereços em que ESTA loja já entregou para
 * ele, para a tela perguntar "é este endereço?" em vez de pedir tudo de novo.
 * A regra (o que conta, como se lê o endereço gravado, o que sai) mora em
 * lib/cliente-reconhecido.ts.
 *
 * É pública por telefone, como a consulta de pedidos ao lado (GET da rota
 * pai). Por isso:
 *   - só pedidos desta loja (nunca de outra);
 *   - teto de consultas por origem (varrer telefones não pode ser barato);
 *   - nenhum saldo, histórico ou dado de outra loja — só nome e endereço, que
 *     é o que o dono do produto decidiu oferecer (02/10/2026, Showrrascão).
 *
 * Resposta: { cliente: { nome, enderecos: [...] } | null }.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";
import { reconhecerCliente, telefoneParaReconhecer } from "@/lib/cliente-reconhecido";
import { mesmoTelefone } from "@/lib/telefone";

export const dynamic = "force-dynamic";

const semCache = { "Cache-Control": "no-store" };

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const telefone = telefoneParaReconhecer(searchParams.get("phone"));
  const franchiseeId = String(searchParams.get("franchiseeId") || "").trim();
  if (!telefone || !franchiseeId) return NextResponse.json({ cliente: null }, { headers: semCache });

  const ip = getClientIp(req);
  const { allowed } = checkRateLimit(`reconhecer:${ip}`, { windowMs: 60_000, maxRequests: 15 });
  if (!allowed) {
    return NextResponse.json({ error: "Muitas consultas. Aguarde 1 minuto.", cliente: null }, { status: 429, headers: semCache });
  }

  try {
    const final = telefone.slice(-8);
    const [pedidos, cadastros] = await Promise.all([
      prisma.customerOrder.findMany({
        where: {
          franchiseeId,
          OR: [{ customerPhone: { contains: final } }, { customerPhone: telefone }, { customerPhone: `55${telefone}` }],
        },
        orderBy: { createdAt: "desc" },
        take: 40,
        select: {
          customerName: true,
          customerPhone: true,
          customerAddress: true,
          customerLatLng: true,
          deliveryType: true,
          createdAt: true,
          status: true,
          source: true,
          ifoodOrderId: true,
          ifoodReference: true,
          openDeliveryChannel: true,
          openDeliveryOrderId: true,
        },
      }),
      // O cadastro (site, robô ou importação) dá o nome de quem ainda não
      // pediu por aqui. `endsWith` nos 8 finais + mesmoTelefone fecha o DDD.
      prisma.storeCustomer.findMany({
        where: { phone: { endsWith: final } },
        select: { name: true, phone: true },
        take: 5,
      }),
    ]);
    const cadastro = cadastros.find((c) => mesmoTelefone(c.phone, telefone));
    const cliente = reconhecerCliente(pedidos, telefone, cadastro?.name);
    return NextResponse.json({ cliente }, { headers: semCache });
  } catch (e: any) {
    // Reconhecer é conforto, não requisito: sem resposta, o cliente digita.
    console.warn(`[reconhecer] falhou na loja ${franchiseeId}: ${e?.message || e}`);
    return NextResponse.json({ cliente: null }, { headers: semCache });
  }
}
