import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { garantirEstruturaDoCrm } from "@/lib/garantir-colunas";
import { gravarMensagem } from "@/lib/crm/mensagens";
import { configDoAtendimento } from "@/lib/atendimento/config";
import { agendarRespostaDoRobo } from "@/lib/atendimento/robo";
import { extensaoDoSuporte, salvarArquivoDoSuporte, TAMANHO_MAXIMO_DO_SUPORTE } from "@/lib/storage";
import {
  COOKIE_DO_SUPORTE, JANELA_DO_CLIENTE_MS, MAXIMO_DO_CLIENTE_NA_JANELA, contatoDoToken, contatoNovoDoSite,
  lerMidiaDoSite, mensagensDoSite, opcoesDoCookie, podeCriarContato, textoDoAudio, tokenDoContato,
} from "@/lib/atendimento/site";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * /api/suporte — o suporte pelo navegador (app/suporte, lib/atendimento/site.ts).
 *
 * GET → a conversa de quem está com o cookie (ou { entrou: false }).
 * POST { entrar: token }                 → entra pelo link pessoal (?c=) e grava o cookie.
 * POST { nome, telefone, loja }          → começa pelo link genérico (contato novo) e grava o cookie.
 * POST { texto }                         → mensagem do cliente; o robô responde (robo.ts).
 * POST { midia: dataURL, nomeDoArquivo } → foto, PDF ou áudio (o áudio é transcrito para o robô).
 */

const SEM_DESCRICAO = /\n\[O que (?:a imagem|o arquivo|o vídeo) mostra:[\s\S]*$/;

async function contatoDoCookie(req: NextRequest) {
  const id = contatoDoToken(req.cookies.get(COOKIE_DO_SUPORTE)?.value);
  return id ? prisma.crmContato.findUnique({ where: { id } }) : null;
}

async function estado(contatoId: string) {
  const [contato, mensagens, config] = await Promise.all([
    prisma.crmContato.findUnique({ where: { id: contatoId }, select: { nome: true, nomeDaLoja: true, roboDesligado: true, roboPausadoAte: true, aguardandoHumanoDesde: true } }),
    mensagensDoSite(contatoId),
    configDoAtendimento(),
  ]);
  const pausado = !!(contato?.roboPausadoAte && contato.roboPausadoAte.getTime() > Date.now());
  const roboAtende = config.roboNoPainel && !contato?.roboDesligado && !pausado && !contato?.aguardandoHumanoDesde;
  const ultima = mensagens[mensagens.length - 1];
  return {
    entrou: true,
    nome: contato?.nome || null,
    // Sempre "Suporte FireHub": o nome do robô do WhatsApp não aparece aqui (Douglas, 20/11/2026).
    atendente: "Suporte FireHub",
    // "digitando…" só quando o robô vai mesmo responder a última mensagem do cliente.
    // Atendido por gente (robo.ts não responde no SITE): sem "digitando…" automático.
    digitando: false,
    mensagens: mensagens.map((m) => ({
      id: m.id,
      eu: m.direcao === "ENTRADA",
      // Quem respondeu da equipe não aparece: para o cliente é sempre o Suporte FireHub.
      nome: null,
      tipo: m.tipo,
      texto: m.texto.replace(SEM_DESCRICAO, ""),
      midiaUrl: m.midiaUrl,
      em: m.criadoEm.toISOString(),
    })),
  };
}

function comCookie(res: NextResponse, contatoId: string) {
  res.cookies.set(COOKIE_DO_SUPORTE, tokenDoContato(contatoId), opcoesDoCookie());
  return res;
}

export async function GET(req: NextRequest) {
  if (!(await garantirEstruturaDoCrm())) return NextResponse.json({ error: "Suporte indisponível agora." }, { status: 503 });
  const contato = await contatoDoCookie(req);
  if (!contato) return NextResponse.json({ entrou: false });
  return NextResponse.json(await estado(contato.id));
}

export async function POST(req: NextRequest) {
  if (!(await garantirEstruturaDoCrm())) return NextResponse.json({ error: "Suporte indisponível agora." }, { status: 503 });
  const b = await req.json().catch(() => ({}));

  // ── Entrar pelo link pessoal ──
  if (typeof b?.entrar === "string") {
    const id = contatoDoToken(b.entrar);
    const contato = id ? await prisma.crmContato.findUnique({ where: { id }, select: { id: true } }) : null;
    if (!contato) return NextResponse.json({ error: "Este link de suporte não vale mais. Peça um novo para a nossa equipe." }, { status: 404 });
    return comCookie(NextResponse.json(await estado(contato.id)), contato.id);
  }

  let contato = await contatoDoCookie(req);

  // ── Começar pelo link genérico ──
  if (!contato) {
    const nome = String(b?.nome || "").trim();
    const telefone = String(b?.telefone || "").trim();
    const loja = String(b?.loja || "").trim();
    if (!nome || telefone.replace(/\D/g, "").length < 10) {
      return NextResponse.json({ error: "Preencha o seu nome e o seu WhatsApp com DDD." }, { status: 400 });
    }
    const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "sem-ip";
    if (!podeCriarContato(ip)) return NextResponse.json({ error: "Muitas conversas novas daqui. Tente de novo mais tarde." }, { status: 429 });
    const novo = await contatoNovoDoSite({ nome, telefone, loja });
    return comCookie(NextResponse.json(await estado(novo.id)), novo.id);
  }

  // ── Mensagem do cliente ──
  const recentes = await prisma.crmMensagem.count({
    where: { contatoId: contato.id, canal: "SITE", direcao: "ENTRADA", criadoEm: { gte: new Date(Date.now() - JANELA_DO_CLIENTE_MS) } },
  });
  if (recentes >= MAXIMO_DO_CLIENTE_NA_JANELA) {
    return NextResponse.json({ error: "Muitas mensagens em pouco tempo. Espere a resposta e tente de novo em alguns minutos." }, { status: 429 });
  }
  const autorNome = contato.nome || null;

  if (typeof b?.midia === "string" && b.midia.startsWith("data:")) {
    const m = /^data:([^;,]+)(?:;[^,]*)?;base64,([\s\S]+)$/.exec(b.midia);
    const mime = (m?.[1] || "").toLowerCase();
    if (!m || !extensaoDoSuporte(mime)) return NextResponse.json({ error: "Esse tipo de arquivo não dá para mandar aqui. Mande foto, PDF ou áudio." }, { status: 400 });
    const bytes = Buffer.from(m[2], "base64");
    if (bytes.length > TAMANHO_MAXIMO_DO_SUPORTE) return NextResponse.json({ error: "Arquivo muito grande (máximo 12 MB)." }, { status: 400 });
    const salvo = await salvarArquivoDoSuporte(bytes, mime);
    const audio = mime.startsWith("audio/");
    const imagem = mime.startsWith("image/");
    const nomeDoArquivo = String(b?.nomeDoArquivo || "").trim().slice(0, 80);
    const texto = audio ? await textoDoAudio(m[2], mime) : imagem ? "📷 Imagem" : `📎 ${nomeDoArquivo || "Arquivo"}`;
    const gravada = await gravarMensagem({
      contatoId: contato.id, direcao: "ENTRADA", autor: "CLIENTE", autorNome, canal: "SITE",
      tipo: audio ? "AUDIO" : imagem ? "IMAGEM" : "ARQUIVO", texto, midiaUrl: salvo.url,
    });
    if (gravada && !audio) void lerMidiaDoSite(contato.id, gravada.id, m[2], mime, imagem ? "a imagem" : "o arquivo");
  } else {
    const texto = typeof b?.texto === "string" ? b.texto.trim().slice(0, 2000) : "";
    if (!texto) return NextResponse.json({ error: "Escreva a mensagem." }, { status: 400 });
    await gravarMensagem({ contatoId: contato.id, direcao: "ENTRADA", autor: "CLIENTE", autorNome, texto, canal: "SITE" });
  }

  agendarRespostaDoRobo(contato.id);
  return NextResponse.json(await estado(contato.id));
}
