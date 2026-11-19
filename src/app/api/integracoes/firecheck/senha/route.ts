/**
 * O FireCheck confere aqui a senha do dono de uma loja ligada (Bearer = a
 * chave da ligação, lib/cmv/firecheck.ts): a conta de lá usa a mesma do
 * FireHub (lib/firecheck-modulos/mesma-conta.ts).
 *
 *   POST { email, senha } → { ok, confere }
 *
 * Só o e-mail da PRÓPRIA loja da chave: a rota não serve para testar senha de
 * outra conta. Mesma conferência do login (senha sem espaço nas pontas,
 * bcrypt) e o mesmo freio: conta bloqueada por tentativas no login daqui não
 * confere lá. As falhas não contam aqui: quem conta é o freio do login do
 * FireCheck (a origem seria sempre o servidor dele, e travaria todo mundo).
 */
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { lojaDaChave } from "@/lib/cmv/firecheck";
import { verificarFreioDeLogin } from "@/lib/login-throttle";
import { mesmoEmail } from "@/lib/firecheck-modulos/mesma-conta";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const loja = await lojaDaChave(req.headers.get("authorization"));
  if (!loja) return NextResponse.json({ error: "Chave inválida." }, { status: 401 });
  let corpo: any = {};
  try { corpo = await req.json(); } catch {}
  const email = String(corpo?.email || "");
  const senha = String(corpo?.senha || "").trim();
  const conta = await prisma.user.findUnique({ where: { id: loja.id }, select: { email: true, password: true } });
  if (!conta || !senha || !mesmoEmail(conta.email, email)) return NextResponse.json({ ok: true, confere: false });
  if (verificarFreioDeLogin(conta.email, "firecheck").bloqueado) return NextResponse.json({ ok: true, confere: false });
  const confere = !!conta.password && (await bcrypt.compare(senha, conta.password));
  return NextResponse.json({ ok: true, confere });
}
