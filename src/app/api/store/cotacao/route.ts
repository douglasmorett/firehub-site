import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { lojaDoAssessorDaSessao } from "@/lib/assessor/loja-da-sessao";
import { lojaDaCotacaoDaSessao } from "@/lib/cotacao/sessao";
import {
  DIAS_DE_TESTE_DA_COTACAO, TermoNaoAceitoError, configDaCotacao, estadoDaCotacao, ligarOuDesligarCotacao, salvarConfigDaCotacao,
} from "@/lib/cotacao/assinatura";
import { normalizarAgenda, proximoHorario, resumoDaAgenda } from "@/lib/cotacao/agenda";
import { dadosDaLoja } from "@/lib/cotacao/no-banco";
import { garantirEstruturaDaCotacao } from "@/lib/cotacao/estrutura-no-banco";
import { paraEnvioWhatsApp } from "@/lib/telefone";
import { FIREHUB_PLAN } from "@/lib/firehub-billing";

/**
 * GET  — o estado do módulo, a agenda (com a frase "Toda segunda às 8h…"), o
 *        comprador e quantos fornecedores e produtos já estão cadastrados.
 * POST { ligar: true, aceite: { versao } } — ativa, com o termo aceito (lib/cotacao/termo.ts).
 * POST { ligar: false } — desativa (lib/modulo-pago.ts). Só o dono (ou o
 *      ADMIN dentro da loja), a mesma porta do Bill e da Balança.
 * PUT  { agenda, horasParaResumo, compradorTelefone, compradorNome } — a configuração.
 */
export const dynamic = "force-dynamic";

const publico = (e: Awaited<ReturnType<typeof estadoDaCotacao>>) => ({
  ativo: e.ativo, cobradoEsteMes: e.cobradoEsteMes, testeAte: e.testeAte, emTeste: e.emTeste, jaTestou: e.jaTestou, isento: e.isento, desligaEm: e.desligaEm, fimDoMes: e.fimDoMes,
});

async function montar(franchiseeId: string, podeContratar: boolean) {
  await garantirEstruturaDaCotacao();
  const [estado, config, loja, fornecedores, produtos] = await Promise.all([
    estadoDaCotacao(franchiseeId),
    configDaCotacao(franchiseeId),
    dadosDaLoja(franchiseeId),
    prisma.fornecedor.count({ where: { franchiseeId, ativo: true } }).catch(() => 0),
    prisma.produtoDeCompra.count({ where: { franchiseeId, ativo: true } }).catch(() => 0),
  ]);
  return {
    estado: publico(estado),
    podeContratar,
    preco: estado.preco,
    diasDeTeste: DIAS_DE_TESTE_DA_COTACAO,
    loja: { nome: loja.nome, telefoneDoDono: loja.telefoneDoDono },
    config,
    frase: resumoDaAgenda(config.agenda, loja.nome),
    proximo: proximoHorario(config.agenda, new Date(), loja.tz),
    contagens: { fornecedores, produtos },
    mensalidade: { percentual: FIREHUB_PLAN.PERCENT_RATE, minimo: FIREHUB_PLAN.MIN_MONTHLY, teto: FIREHUB_PLAN.MAX_MONTHLY },
  };
}

export async function GET() {
  const s = await lojaDaCotacaoDaSessao();
  if (!s) return NextResponse.json({ error: "Seu acesso não abre a cotação. Peça ao dono da loja." }, { status: 403 });
  return NextResponse.json(await montar(s.franchiseeId, s.podeContratar));
}

export async function POST(req: Request) {
  const s = await lojaDoAssessorDaSessao();
  if (!s) return NextResponse.json({ error: "Só o dono da loja ativa ou desativa a cotação automática." }, { status: 403 });
  let corpo: any = {};
  try { corpo = await req.json(); } catch {}
  if (typeof corpo?.ligar !== "boolean") return NextResponse.json({ error: "Informe ligar: true ou false." }, { status: 400 });

  // O aceite fica gravado com quem estava logado, o IP e o navegador — a prova do "concordo".
  let aceite = null;
  if (corpo.ligar) {
    const session = await getServerSession(authOptions);
    const ip = (req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || null;
    aceite = corpo?.aceite?.versao
      ? { versao: String(corpo.aceite.versao), email: session?.user?.email || null, ip, userAgent: (req.headers.get("user-agent") || "").slice(0, 300) || null }
      : null;
  }
  try {
    const estado = await ligarOuDesligarCotacao(s.franchiseeId, corpo.ligar, aceite);
    return NextResponse.json({ ok: true, estado: publico(estado) });
  } catch (err: any) {
    if (err instanceof TermoNaoAceitoError) return NextResponse.json({ error: err.message, precisaDoTermo: true }, { status: 400 });
    return NextResponse.json({ error: err?.message || "Erro ao salvar." }, { status: 503 });
  }
}

export async function PUT(req: Request) {
  const s = await lojaDaCotacaoDaSessao();
  if (!s) return NextResponse.json({ error: "Seu acesso não abre a cotação. Peça ao dono da loja." }, { status: 403 });
  let corpo: any = {};
  try { corpo = await req.json(); } catch {}
  const agenda = normalizarAgenda(corpo?.agenda);
  const horas = Math.round(Number(corpo?.horasParaResumo));
  const horasParaResumo = Number.isFinite(horas) ? Math.min(48, Math.max(1, horas)) : 4;
  const digitado = String(corpo?.compradorTelefone ?? "").trim();
  const compradorTelefone = digitado ? paraEnvioWhatsApp(digitado) : "";
  if (digitado && !compradorTelefone) {
    return NextResponse.json({ error: "O WhatsApp do comprador precisa ter DDD, por exemplo (22) 99999-8888." }, { status: 400 });
  }
  const compradorNome = String(corpo?.compradorNome ?? "").trim().slice(0, 60) || null;
  try {
    await salvarConfigDaCotacao(s.franchiseeId, { agenda, horasParaResumo, compradorTelefone: compradorTelefone || null, compradorNome });
    return NextResponse.json(await montar(s.franchiseeId, s.podeContratar));
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Erro ao salvar." }, { status: 503 });
  }
}
