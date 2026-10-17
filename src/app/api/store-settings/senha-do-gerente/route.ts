/**
 * /api/store-settings/senha-do-gerente — a SENHA DO GERENTE da loja
 * (Minha Loja → Senha do gerente; regra em lib/senha-do-gerente-regras.ts).
 *
 *   GET  → { temSenha, exige, acoes, podeMudar }   qualquer conta da loja (nunca o hash)
 *   PUT  { senhaAtual?, novaSenha?, removerSenha?, exige? }   só o DONO
 *
 * ── Só o dono, e com a senha atual ──────────────────────────────────────────
 * Funcionário (conta de "Equipe & permissões", com ownerId) não muda nada —
 * nem com a caixinha "Minha loja". E como o computador do caixa costuma ficar
 * logado na conta do dono, mudar a senha ou desligar um interruptor de uma
 * loja que JÁ tem senha pede a senha atual do gerente — ou a senha de acesso
 * do dono, para quem esqueceu a do gerente. Sem isso, quem estivesse no caixa
 * desligava a proteção em dois cliques. O freio de tentativas é o mesmo das
 * ações protegidas.
 */
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  ACOES_PROTEGIDAS, algumaLigada, lerExigeSenha, problemaDaNovaSenha,
} from "@/lib/senha-do-gerente-regras";
import { gravarConfigDaSenha, lerConfigDaSenha, resumoDaSenha, senhaAtualConfere } from "@/lib/senha-do-gerente";

export const dynamic = "force-dynamic";

async function quemEsta() {
  const session = await getServerSession(authOptions).catch(() => null);
  const email = session?.user?.email;
  if (!email) return null;
  const u = await prisma.user.findUnique({
    where: { email },
    select: { id: true, ownerId: true, role: true, name: true, email: true },
  });
  if (!u) return null;
  const papel = String(u.role || "").toUpperCase();
  // Dono = a conta da loja (sem ownerId, não STAFF); o ADMIN do FireHub também muda.
  const ehDono = papel === "ADMIN" || (papel !== "STAFF" && !u.ownerId);
  return { lojaId: u.ownerId || u.id, ehDono, quem: u.name || u.email, userId: u.id };
}

export async function GET() {
  const s = await quemEsta();
  if (!s) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const resumo = await resumoDaSenha(s.lojaId);
  return NextResponse.json({ ...resumo, acoes: ACOES_PROTEGIDAS, podeMudar: s.ehDono });
}

export async function PUT(req: Request) {
  const s = await quemEsta();
  if (!s) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  if (!s.ehDono) return NextResponse.json({ error: "Só o dono da loja muda a senha do gerente." }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const atual = await lerConfigDaSenha(s.lojaId).catch(() => null);
  const temSenha = Boolean(atual?.hash);

  // ── Loja que já tem senha: prova antes de mexer ───────────────────────────
  if (temSenha) {
    const informada = typeof body?.senhaAtual === "string" ? body.senhaAtual : "";
    if (!informada) {
      return NextResponse.json({ error: "Digite a senha do gerente atual (ou a senha de acesso da sua conta) para mudar." }, { status: 403 });
    }
    const r = await senhaAtualConfere(s.lojaId, informada);
    if (!r.ok) {
      // Esqueceu a do gerente: a senha de login do dono também serve. Freio
      // trancado não abre por aqui — a mensagem da tranca é a que volta.
      const dono = r.status === 429 ? null : await prisma.user.findUnique({ where: { id: s.userId }, select: { password: true } });
      const peloLogin = !!dono?.password && (await bcrypt.compare(informada, dono.password).catch(() => false));
      if (!peloLogin) return NextResponse.json({ error: r.error, codigo: r.codigo }, { status: r.status });
    }
  }

  const exige = lerExigeSenha(body?.exige ?? atual?.exige ?? null);

  // ── Apagar a senha: desliga tudo ──────────────────────────────────────────
  if (body?.removerSenha === true) {
    await gravarConfigDaSenha({ lojaId: s.lojaId, senha: null, exige, quem: s.quem });
    return NextResponse.json({ ok: true, ...(await resumoDaSenha(s.lojaId)) });
  }

  let senha: string | undefined;
  if (typeof body?.novaSenha === "string" && body.novaSenha.length > 0) {
    const problema = problemaDaNovaSenha(body.novaSenha);
    if (problema) return NextResponse.json({ error: problema }, { status: 400 });
    senha = body.novaSenha;
  }
  // Interruptor ligado sem senha nenhuma não protegeria nada (a ação seguiria
  // livre): melhor dizer agora do que deixar o dono achar que trancou.
  if (!temSenha && !senha && algumaLigada(exige)) {
    return NextResponse.json({ error: "Cadastre a senha do gerente antes de ligar o que ela protege." }, { status: 400 });
  }

  try {
    await gravarConfigDaSenha({ lojaId: s.lojaId, senha, exige, quem: s.quem });
  } catch (err: any) {
    console.error("[Senha do gerente] gravar:", err?.message);
    return NextResponse.json({ error: "Não deu para salvar agora. Tente de novo." }, { status: 500 });
  }
  console.log(`[Senha do gerente] loja ${s.lojaId}: ${senha ? "senha trocada, " : ""}exige ${JSON.stringify(exige)} — por ${s.quem}`);
  return NextResponse.json({ ok: true, ...(await resumoDaSenha(s.lojaId)) });
}
