/**
 * A ligação desta loja com o FireCheck dela (lib/cmv/firecheck.ts).
 *
 *   GET    → { conectado, store?, storeName?, email?, conectadoEm?, descartes30d }
 *   POST   { email, senha, confirmo: true } → conecta. Só o dono (ou ADMIN).
 *   DELETE → desconecta aqui e avisa o FireCheck.
 *
 * "Antes de conectar, tem que avisar" (Douglas, 11/10/2026): sem `confirmo`
 * a ligação não sai — a tela mostra que todo descarte daquele FireCheck vai
 * contar como perda NESTA loja. A senha do FireCheck passa por aqui uma vez e
 * não é gravada; o que fica é a chave que o FireCheck devolve em cada descarte.
 */
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { acessoDoCmv } from "@/lib/cmv/acesso";
import {
  URL_DO_FIRECHECK, URL_DO_FIREHUB_PARA_O_FIRECHECK,
  chaveDaLigacao, lerLigacao, novaChave, type LigacaoDoFirecheck,
} from "@/lib/cmv/firecheck";

export const dynamic = "force-dynamic";

const negar = (status: number, error: string) => NextResponse.json({ error }, { status });

async function chamarFirecheck(caminho: string, init: RequestInit): Promise<{ status: number; corpo: any }> {
  const resp = await fetch(`${URL_DO_FIRECHECK}${caminho}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers || {}) },
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
  });
  const corpo = await resp.json().catch(() => ({}));
  return { status: resp.status, corpo };
}

export async function GET() {
  const r = await acessoDoCmv();
  if (!r.ok) return r.resposta;
  const loja = await prisma.user.findUnique({ where: { id: r.acesso.lojaId }, select: { firecheckIntegracao: true } });
  const l = lerLigacao(loja?.firecheckIntegracao);
  if (!l) return NextResponse.json({ conectado: false, podeConectar: r.acesso.papel !== "STAFF", loja: r.acesso.nomeDaLoja });
  const desde = new Date(Date.now() - 30 * 86400000);
  const [descartes30d, ultimos] = await Promise.all([
    prisma.descarteDoFirecheck.count({ where: { franchiseeId: r.acesso.lojaId, createdAt: { gte: desde } } }),
    prisma.descarteDoFirecheck.findMany({
      where: { franchiseeId: r.acesso.lojaId }, orderBy: { registradoEm: "desc" }, take: 5,
      select: { item: true, quantidade: true, unidade: true, situacao: true, casouCom: true, registradoEm: true, funcionario: true },
    }),
  ]);
  return NextResponse.json({
    conectado: true,
    podeConectar: r.acesso.papel !== "STAFF",
    loja: r.acesso.nomeDaLoja,
    store: l.store, storeName: l.storeName, email: l.email, conectadoEm: l.conectadoEm,
    descartes30d, ultimos,
  });
}

export async function POST(req: NextRequest) {
  const r = await acessoDoCmv();
  if (!r.ok) return r.resposta;
  if (r.acesso.papel === "STAFF") return negar(403, "Só o dono da loja conecta o FireCheck.");
  const body = await req.json().catch(() => ({}));
  const email = String(body?.email || "").trim().toLowerCase();
  const senha = String(body?.senha || "");
  if (!email || !senha) return negar(400, "Informe o e-mail e a senha do FireCheck.");
  if (body?.confirmo !== true) return negar(400, "Confirme que os descartes desse FireCheck vão contar como perda nesta loja.");

  const loja = await prisma.user.findUnique({ where: { id: r.acesso.lojaId }, select: { firecheckIntegracao: true } });
  const atual = lerLigacao(loja?.firecheckIntegracao);

  const { chave, chaveHash, chaveCifrada } = novaChave();
  let resp: { status: number; corpo: any };
  try {
    resp = await chamarFirecheck("/api/integracoes/firehub/conectar", {
      method: "POST",
      body: JSON.stringify({
        email, senha,
        firehubLojaId: r.acesso.lojaId,
        firehubLojaNome: r.acesso.nomeDaLoja,
        chave,
        urlDoFirehub: URL_DO_FIREHUB_PARA_O_FIRECHECK,
      }),
    });
  } catch {
    return negar(502, "O FireCheck não respondeu. Tente de novo em instantes.");
  }
  if (resp.status !== 200 || !resp.corpo?.ok || !resp.corpo?.store) {
    const msg = typeof resp.corpo?.error === "string" ? resp.corpo.error : `O FireCheck recusou a conexão (HTTP ${resp.status}).`;
    return negar(resp.status >= 400 && resp.status < 500 ? resp.status : 502, msg);
  }

  // Esta loja estava em OUTRO FireCheck: aquele deixa de mandar para cá.
  if (atual && atual.store !== resp.corpo.store) {
    const antiga = chaveDaLigacao(atual);
    if (antiga) {
      await chamarFirecheck("/api/integracoes/firehub/desconectar", { method: "POST", headers: { Authorization: `Bearer ${antiga}` }, body: "{}" }).catch(() => null);
    }
  }

  const ligacao: LigacaoDoFirecheck = {
    chaveHash, chaveCifrada,
    store: String(resp.corpo.store),
    storeName: String(resp.corpo.storeName || resp.corpo.store),
    email: String(resp.corpo.email || email),
    conectadoEm: atual && atual.store === resp.corpo.store ? atual.conectadoEm : new Date().toISOString(),
    conectadoPor: r.acesso.usuarioId,
  };
  await prisma.user.update({ where: { id: r.acesso.lojaId }, data: { firecheckIntegracao: ligacao as unknown as Prisma.InputJsonValue } });
  return NextResponse.json({ ok: true, conectado: true, store: ligacao.store, storeName: ligacao.storeName, email: ligacao.email, conectadoEm: ligacao.conectadoEm });
}

export async function DELETE() {
  const r = await acessoDoCmv();
  if (!r.ok) return r.resposta;
  if (r.acesso.papel === "STAFF") return negar(403, "Só o dono da loja desconecta o FireCheck.");
  const loja = await prisma.user.findUnique({ where: { id: r.acesso.lojaId }, select: { firecheckIntegracao: true } });
  const l = lerLigacao(loja?.firecheckIntegracao);
  if (!l) return NextResponse.json({ ok: true, conectado: false });
  // Apaga aqui primeiro: mesmo com o FireCheck fora, a chave deixa de valer.
  await prisma.user.update({ where: { id: r.acesso.lojaId }, data: { firecheckIntegracao: Prisma.DbNull } });
  const chave = chaveDaLigacao(l);
  let avisouOFirecheck = false;
  if (chave) {
    const resp = await chamarFirecheck("/api/integracoes/firehub/desconectar", { method: "POST", headers: { Authorization: `Bearer ${chave}` }, body: "{}" }).catch(() => null);
    avisouOFirecheck = resp?.status === 200;
  }
  return NextResponse.json({ ok: true, conectado: false, avisouOFirecheck });
}
