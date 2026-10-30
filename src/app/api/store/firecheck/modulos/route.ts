/**
 * Os módulos do FireCheck no boleto do FireHub (lib/firecheck-modulos/).
 *
 *   GET  → { estado, conectado, podeContratar, precos }
 *   POST { modulo: "checklists"|"ponto", ligar: true, aceite: { versao } } — liga, com o termo.
 *   POST { modulo, ligar: false } — desliga (no teste, na hora; depois, na virada).
 *   POST { acao: "abrir" } → { url } — o link que entra no FireCheck sem senha.
 *
 * Ligar cria a conta do FireCheck se a loja não tem (mesmo e-mail, senha do
 * FireHub — lib/firecheck-modulos/mesma-conta.ts): não há mais "Criar minha
 * conta". `acao: "criar-conta"` fica só para a tela aberta com a versão velha.
 *
 * Só o dono (ou o ADMIN dentro da loja) mexe — a mesma porta do Bill.
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { lojaDoAssessorDaSessao } from "@/lib/assessor/loja-da-sessao";
import { acessoDoCmv } from "@/lib/cmv/acesso";
import { lerLigacao } from "@/lib/cmv/firecheck";
import {
  DIAS_DE_TESTE_DO_FIRECHECK, PRECO_DO_COMBO, PRECO_POR_MODULO, TermoNaoAceitoError,
  estadoDoFirecheck, ligarOuDesligarModulo, type ModuloDoFirecheck,
} from "@/lib/firecheck-modulos/assinatura";
import { ErroDoFirecheck, conferirAntesDeLigar, garantirContaNoFirecheck, linkParaAbrirOFirecheck, pedirParaSincronizar } from "@/lib/firecheck-modulos/no-firecheck";
import { mesmoEmail } from "@/lib/firecheck-modulos/mesma-conta";

export const dynamic = "force-dynamic";

const MODULOS = new Set(["checklists", "ponto"]);

async function conectado(lojaId: string) {
  const loja = await prisma.user.findUnique({ where: { id: lojaId }, select: { firecheckIntegracao: true, email: true } });
  const l = lerLigacao(loja?.firecheckIntegracao);
  // mesmoLogin: o FireCheck é o do e-mail da loja, e a senha do FireHub entra lá.
  return l && l.store ? { storeName: l.storeName, email: l.email, mesmoLogin: mesmoEmail(l.email, loja?.email) } : null;
}

export async function GET() {
  const r = await acessoDoCmv();
  if (!r.ok) return r.resposta;
  const lojaId = r.acesso.lojaId;
  const [estado, ligacao] = await Promise.all([estadoDoFirecheck(lojaId), conectado(lojaId)]);
  return NextResponse.json({
    estado,
    conectado: ligacao,
    podeContratar: r.acesso.papel !== "STAFF",
    precos: { porModulo: PRECO_POR_MODULO, combo: PRECO_DO_COMBO, diasDeTeste: DIAS_DE_TESTE_DO_FIRECHECK },
  });
}

export async function POST(req: Request) {
  const s = await lojaDoAssessorDaSessao();
  if (!s) return NextResponse.json({ error: "Só o dono da loja liga ou desliga o FireCheck." }, { status: 403 });
  let corpo: any = {};
  try { corpo = await req.json(); } catch {}

  try {
    if (corpo?.acao === "abrir") {
      return NextResponse.json({ ok: true, url: await linkParaAbrirOFirecheck(s.franchiseeId, s.usuarioId) });
    }
    // Tela aberta antes da atualização: o quadro velho mostra esta "senha".
    if (corpo?.acao === "criar-conta") {
      const conta = await garantirContaNoFirecheck(s.franchiseeId, s.usuarioId);
      return NextResponse.json({ ok: true, conta: { ...conta, senha: "a mesma do FireHub" } });
    }

    const modulo = String(corpo?.modulo || "") as ModuloDoFirecheck;
    if (!MODULOS.has(modulo)) return NextResponse.json({ error: "Informe o módulo: checklists ou ponto." }, { status: 400 });
    if (typeof corpo?.ligar !== "boolean") return NextResponse.json({ error: "Informe ligar: true ou false." }, { status: 400 });

    // O aceite fica gravado com quem estava logado, o IP e o navegador — a prova do "concordo".
    let aceite = null;
    if (corpo.ligar) {
      const antes = await estadoDoFirecheck(s.franchiseeId);
      // Religar o que só ia desligar na virada não é contratar de novo: não confere nem pede termo.
      // Loja sem FireCheck ganha a conta aqui mesmo: é "só ativar" (Douglas, 30/10/2026).
      if (!antes.modulos[modulo].ativo) {
        await garantirContaNoFirecheck(s.franchiseeId, s.usuarioId);
        await conferirAntesDeLigar(s.franchiseeId, modulo);
      }
      const session = await getServerSession(authOptions);
      const ip = (req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || null;
      aceite = corpo?.aceite?.versao
        ? { versao: String(corpo.aceite.versao), email: session?.user?.email || null, ip, userAgent: (req.headers.get("user-agent") || "").slice(0, 300) || null }
        : null;
    }
    const estado = await ligarOuDesligarModulo(s.franchiseeId, modulo, corpo.ligar, aceite);
    const sincronizado = await pedirParaSincronizar(s.franchiseeId);
    return NextResponse.json({ ok: true, estado, sincronizado });
  } catch (err: any) {
    if (err instanceof TermoNaoAceitoError) return NextResponse.json({ error: err.message, precisaDoTermo: true }, { status: 400 });
    if (err instanceof ErroDoFirecheck) return NextResponse.json({ error: err.message, ...err.extra }, { status: err.status });
    return NextResponse.json({ error: err?.message || "Erro ao salvar." }, { status: 503 });
  }
}
