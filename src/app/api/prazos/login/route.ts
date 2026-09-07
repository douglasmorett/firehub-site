/**
 * POST /api/prazos/login — entrada da extensão FireHub Prazos.
 *
 * Conta própria do produto (tabela PrazoConta), não a de loja FireHub: quem
 * compra a extensão pode nunca ter ouvido falar do painel. E-mail e senha
 * vêm do cadastro feito no admin ou pela compra na Cakto.
 *
 * Conta BLOQUEADO/CANCELADO não entra: é aqui e em /calcular que a cobrança
 * corta o uso. A mensagem diz o que fazer (regularizar na Cakto).
 */
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { criarTokenDePrazos } from "@/lib/prazos-token";
import { respostaPrazos, contaPodeUsar, motivoDoBloqueio, contaParaExtensao } from "@/lib/prazos";
import { verificarFreioDeLogin, registrarFalhaDeLogin, limparFreioDeLogin, origemDaRequisicao } from "@/lib/login-throttle";

export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return respostaPrazos({});
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const email = String(body?.email || "").toLowerCase().trim();
    const senha = String(body?.senha ?? body?.password ?? "");
    if (!email || !senha) return respostaPrazos({ error: "E-mail e senha são obrigatórios" }, { status: 400 });

    // Rota aberta (CORS *): mesmo freio de força bruta do login do painel.
    const origem = origemDaRequisicao(req.headers as any);
    const freio = verificarFreioDeLogin(`prazos:${email}`, origem);
    if (freio.bloqueado) {
      return respostaPrazos(
        { error: `Muitas tentativas. Tente de novo em ${Math.ceil(freio.esperarSegundos / 60)} minuto(s).` },
        { status: 429 }
      );
    }

    const conta = await prisma.prazoConta.findFirst({ where: { email: { equals: email, mode: "insensitive" } } });
    const confere = conta ? await bcrypt.compare(senha, conta.senhaHash).catch(() => false) : false;
    if (!conta || !confere) {
      registrarFalhaDeLogin(`prazos:${email}`, origem);
      // Uma só mensagem para "não existe" e "senha errada": não entregar quais
      // e-mails têm conta.
      return respostaPrazos({ error: "E-mail ou senha inválidos" }, { status: 401 });
    }
    limparFreioDeLogin(`prazos:${email}`);

    if (!contaPodeUsar(conta.status)) {
      return respostaPrazos({ error: motivoDoBloqueio(conta.status), status: conta.status }, { status: 402 });
    }

    return respostaPrazos({
      success: true,
      token: criarTokenDePrazos(conta.id),
      conta: contaParaExtensao(conta),
    });
  } catch (err: any) {
    console.error("[Prazos login]", err?.message);
    return respostaPrazos({ error: "Erro ao autenticar" }, { status: 500 });
  }
}
