import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { garantirEstruturaDoCrm } from "@/lib/garantir-colunas";
import { gravarMensagem } from "@/lib/crm/mensagens";
import { configDoAtendimento } from "@/lib/atendimento/config";
import { agendarRespostaDoRobo } from "@/lib/atendimento/robo";
import { chamarPessoa } from "@/lib/atendimento/ferramentas";
import {
  contatoDoPainel, contatoExistenteDoPainel, mensagensDoPainel, JANELA_DO_LOJISTA_MS, MAXIMO_DO_LOJISTA_NA_JANELA,
} from "@/lib/atendimento/painel";

export const dynamic = "force-dynamic";

/**
 * O chat "Suporte FireHub" do balão do painel (components/SuporteDoFireHub.tsx).
 *
 * GET            → a conversa do painel e o estado (robô respondendo, esperando a equipe).
 * GET ?resumo=1  → só quando saiu a última resposta (o balão fechado desenha o aviso).
 * POST { texto } → mensagem do lojista; o robô responde (robo.ts) ou a equipe pela tela do admin.
 * POST { pedirPessoa: true } → chama a equipe direto, sem passar pelo robô.
 *
 * Abrir o balão não cria contato no CRM: só a primeira mensagem cria.
 */

const RESPOSTA_DE_QUEM_PEDIU_PESSOA =
  "Pronto, avisei a nossa equipe. A resposta chega aqui mesmo, neste chat. Se quiser, já vai escrevendo o que precisa que a gente lê tudo.";

async function quemEsta() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return null;
  const u = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, ownerId: true, role: true, name: true },
  });
  // Admin "acessando" uma loja não é a loja falando com o suporte.
  if (!u || (u.role !== "FRANCHISEE" && u.role !== "STAFF")) return null;
  return { lojaId: u.ownerId || u.id, pessoaId: u.id, nome: u.name || null, funcionario: u.role === "STAFF" };
}

async function estadoDaConversa(contato: Awaited<ReturnType<typeof contatoExistenteDoPainel>>) {
  const config = await configDoAtendimento();
  if (!contato) return { mensagens: [], aguardandoPessoa: false, roboAtende: config.roboNoPainel };
  const mensagens = await mensagensDoPainel(contato.id);
  const pausado = !!(contato.roboPausadoAte && contato.roboPausadoAte.getTime() > Date.now());
  return {
    mensagens: mensagens.map((m) => ({
      id: m.id,
      de: m.direcao === "ENTRADA" ? "LOJA" : m.autor === "ROBO" ? "ROBO" : m.autor === "SISTEMA" ? "SISTEMA" : "EQUIPE",
      // O nome de quem respondeu da equipe aparece; o do robô, não (ele é "Assistente").
      nome: m.direcao === "SAIDA" && m.autor !== "ROBO" && m.autor !== "SISTEMA" ? (m.autorNome || "").split(/\s+/)[0] || null : null,
      texto: m.texto,
      em: m.criadoEm.toISOString(),
    })),
    aguardandoPessoa: !!contato.aguardandoHumanoDesde,
    // O balão mostra "digitando…" só quando o robô vai mesmo responder.
    roboAtende: config.roboNoPainel && !contato.roboDesligado && !pausado && !contato.aguardandoHumanoDesde,
  };
}

export async function GET(req: NextRequest) {
  const quem = await quemEsta();
  if (!quem) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!(await garantirEstruturaDoCrm())) return NextResponse.json({ error: "Suporte indisponível agora." }, { status: 503 });

  const contato = await contatoExistenteDoPainel(quem.lojaId);
  if (req.nextUrl.searchParams.get("resumo")) {
    const ultima = contato
      ? await prisma.crmMensagem.findFirst({
          where: { contatoId: contato.id, canal: "PAINEL", direcao: "SAIDA" },
          orderBy: { criadoEm: "desc" },
          select: { criadoEm: true },
        })
      : null;
    return NextResponse.json({ ultimaRespostaEm: ultima?.criadoEm.toISOString() || null });
  }
  return NextResponse.json(await estadoDaConversa(contato));
}

export async function POST(req: NextRequest) {
  const quem = await quemEsta();
  if (!quem) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!(await garantirEstruturaDoCrm())) return NextResponse.json({ error: "Suporte indisponível agora." }, { status: 503 });

  const b = await req.json().catch(() => ({}));
  const pedirPessoa = b?.pedirPessoa === true;
  const texto = typeof b?.texto === "string" ? b.texto.trim().slice(0, 2000) : "";
  if (!texto && !pedirPessoa) return NextResponse.json({ error: "Escreva a mensagem." }, { status: 400 });

  const contato = await contatoDoPainel(quem.lojaId);
  if (!contato) return NextResponse.json({ error: "Loja não encontrada." }, { status: 404 });

  const recentes = await prisma.crmMensagem.count({
    where: { contatoId: contato.id, canal: "PAINEL", direcao: "ENTRADA", criadoEm: { gte: new Date(Date.now() - JANELA_DO_LOJISTA_MS) } },
  });
  if (recentes >= MAXIMO_DO_LOJISTA_NA_JANELA) {
    return NextResponse.json({ error: "Muitas mensagens em pouco tempo. Espere a resposta e tente de novo em alguns minutos." }, { status: 429 });
  }

  // Funcionário escrevendo pela loja: a equipe precisa saber que não é o dono.
  const autorNome = quem.nome ? `${quem.nome}${quem.funcionario ? " (funcionário)" : ""}` : quem.funcionario ? "Funcionário" : null;
  await gravarMensagem({
    contatoId: contato.id, direcao: "ENTRADA", autor: "CLIENTE", autorId: quem.pessoaId, autorNome,
    texto: texto || "Quero falar com uma pessoa da equipe.", canal: "PAINEL",
  });

  const config = await configDoAtendimento();
  const paraAEquipe = { ...contato, canalDaConversa: "PAINEL" };
  if (pedirPessoa) {
    if (!contato.aguardandoHumanoDesde) await chamarPessoa(paraAEquipe, "Pediu uma pessoa pelo chat do painel.");
    await gravarMensagem({ contatoId: contato.id, direcao: "SAIDA", autor: "SISTEMA", autorNome: "Sistema", texto: RESPOSTA_DE_QUEM_PEDIU_PESSOA, canal: "PAINEL" });
  } else if (!config.roboNoPainel || contato.roboDesligado) {
    // Ninguém responde sozinho: a conversa precisa chegar a uma pessoa (uma vez só).
    if (!contato.aguardandoHumanoDesde) await chamarPessoa(paraAEquipe, `Escreveu pelo chat do painel: "${texto.slice(0, 200)}"`);
  } else {
    agendarRespostaDoRobo(contato.id);
  }

  const atual = await prisma.crmContato.findUnique({ where: { id: contato.id } });
  return NextResponse.json(await estadoDaConversa(atual));
}
