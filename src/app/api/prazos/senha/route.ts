/**
 * POST /api/prazos/senha — o lojista troca a própria senha pela extensão.
 *
 * A senha inicial nasce aleatória (compra na Cakto) ou vem do admin; sem esta
 * rota o lojista ficaria preso a ela. Exige a senha atual: token vazado num
 * PC compartilhado não pode trocar a senha sozinho.
 */
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { respostaPrazos, resolverConta } from "@/lib/prazos";

export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return respostaPrazos({});
}

export async function POST(req: NextRequest) {
  try {
    const conta = await resolverConta(req);
    if (!conta) return respostaPrazos({ error: "Sessão inválida. Entre de novo na extensão." }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const atual = String(body?.senhaAtual ?? "");
    const nova = String(body?.novaSenha ?? "");
    if (!atual || !nova) return respostaPrazos({ error: "Informe a senha atual e a nova" }, { status: 400 });
    if (nova.length < 6) return respostaPrazos({ error: "A nova senha precisa de pelo menos 6 caracteres" }, { status: 400 });
    if (nova.length > 100) return respostaPrazos({ error: "Senha longa demais" }, { status: 400 });

    const confere = await bcrypt.compare(atual, conta.senhaHash).catch(() => false);
    if (!confere) return respostaPrazos({ error: "Senha atual incorreta" }, { status: 401 });

    await prisma.prazoConta.update({ where: { id: conta.id }, data: { senhaHash: await bcrypt.hash(nova, 10) } });
    return respostaPrazos({ success: true });
  } catch (err: any) {
    console.error("[Prazos senha]", err?.message);
    return respostaPrazos({ error: "Erro ao trocar a senha" }, { status: 500 });
  }
}
