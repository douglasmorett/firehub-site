/**
 * Opções do acerto dos motoboys, da LOJA (não de um entregador):
 *
 *   PUT { juntarCartaoEVale: true } — débito, crédito e voucher num quadrado só
 *
 * Mora em `User.deliveryConfig.acertoDoMotoboy` (lib/ajustes-do-acerto-regras.ts,
 * `lerOpcoesDoAcerto`). O deliveryConfig guarda coisas de outras telas (frete
 * grátis, áreas de risco, repasse do entregador): aqui só a chave
 * `acertoDoMotoboy` é regravada, o resto fica como está.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { lerOpcoesDoAcerto } from "@/lib/ajustes-do-acerto-regras";
import { quemMexeNoAcerto } from "../sessao";

export const dynamic = "force-dynamic";

export async function PUT(req: Request) {
  const s = await quemMexeNoAcerto();
  if ("erro" in s) return NextResponse.json({ error: s.erro }, { status: s.status });
  if (s.papel === "STAFF") return NextResponse.json({ error: "Só o dono muda as opções do acerto." }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  if (typeof body?.juntarCartaoEVale !== "boolean") return NextResponse.json({ error: "Opção inválida." }, { status: 400 });

  const loja = await prisma.user.findUnique({ where: { id: s.lojaId }, select: { deliveryConfig: true } });
  const atual = loja?.deliveryConfig && typeof loja.deliveryConfig === "object" && !Array.isArray(loja.deliveryConfig)
    ? (loja.deliveryConfig as Record<string, unknown>)
    : {};
  const opcoes = { ...lerOpcoesDoAcerto(atual), juntarCartaoEVale: body.juntarCartaoEVale };
  await prisma.user.update({ where: { id: s.lojaId }, data: { deliveryConfig: { ...atual, acertoDoMotoboy: opcoes } as any } });
  return NextResponse.json({ ok: true, ...opcoes });
}
