/**
 * GET /api/validate-coupon?code=X&franchiseeId=Y[&phone=Z&subtotal=N&fee=N]
 *
 * O veredito do servidor sobre um cupom, ANTES do checkout.
 *
 * O site já chamava esta rota como plano B quando não achava o código na
 * lista local — e ela não existia: qualquer cupom fora da lista virava
 * "inválido ou expirado" por um 404. Agora ela é o caminho PRINCIPAL, porque
 * três regras novas dependem de coisas que o navegador não sabe: o dia da loja
 * (validade), quantas vezes este telefone já usou (limite por cliente) e se
 * ele já pediu por aqui (primeiro pedido). A régua é lib/cupons.ts; os fatos
 * vêm de lib/cupons-no-banco.ts; o checkout confere tudo de novo ao gravar.
 *
 * Pública por desenho (o cardápio é público), com o mesmo teto de consultas
 * da busca de pedidos por telefone.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";
import { cuponsComCampanha } from "@/lib/campanha-converter";
import { acharCupom, avaliarCupom, descreverBeneficio } from "@/lib/cupons";
import { fatosDoCupom } from "@/lib/cupons-no-banco";

export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  const { allowed } = checkRateLimit(`validate-coupon:${ip}`, { windowMs: 60_000, maxRequests: 30 });
  if (!allowed) return NextResponse.json({ ok: false, motivo: "Muitas tentativas. Aguarde 1 minuto." }, { status: 429 });

  const p = req.nextUrl.searchParams;
  const code = String(p.get("code") || "").trim().toUpperCase();
  const franchiseeId = p.get("franchiseeId");
  if (!code || !franchiseeId) {
    return NextResponse.json({ ok: false, motivo: "Cupom inválido ou expirado." }, { status: 400 });
  }

  const loja = await prisma.user.findUnique({
    where: { id: franchiseeId },
    select: { storeCoupons: true, storeLoyalty: true, storeTimezone: true },
  });
  if (!loja) return NextResponse.json({ ok: false, motivo: "Cupom inválido ou expirado." }, { status: 404 });

  const cupom = acharCupom(cuponsComCampanha(loja.storeCoupons, loja.storeLoyalty), code);
  if (!cupom) return NextResponse.json({ ok: false, motivo: "Cupom inválido ou expirado." }, { status: 404 });

  const subtotal = Math.max(0, Number(p.get("subtotal")) || 0);
  const taxa = Math.max(0, Number(p.get("fee")) || 0);
  const fatos = await fatosDoCupom(cupom, { franchiseeId, telefone: p.get("phone"), timeZone: loja.storeTimezone, subtotal, taxa });
  const veredito = avaliarCupom(cupom, fatos);

  return NextResponse.json({
    ...veredito,
    code: cupom.code,
    type: cupom.type,
    discount: cupom.discount,
    minOrderValue: cupom.minOrderValue,
    validade: cupom.validade,
    usosPorCliente: cupom.usosPorCliente,
    primeiroPedido: cupom.primeiroPedido,
    beneficio: descreverBeneficio(cupom),
  }, { status: veredito.ok ? 200 : 400 });
}
