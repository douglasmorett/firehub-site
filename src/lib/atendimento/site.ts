import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { chaveDoTelefone, telefoneParaExibir } from "@/lib/crm/telefone";
import { registrarEvento } from "@/lib/crm/contatos";
import { descreverMidia, transcreverAudio } from "./gemini";
import { comecouALer, guardarMidia, midiaQueOModeloLe, terminouDeLer } from "./midias";

/**
 * O SUPORTE PELO NAVEGADOR — firehubfood.com.br/suporte.
 *
 * ── Por que existe ──────────────────────────────────────────────────────────
 *
 * 20/11/2026: o WhatsApp do FireHub foi bloqueado por um dia e ninguém tinha
 * por onde falar com a gente. O Douglas: "um link de suporte parecido com o
 * WhatsApp… a gente manda o link e o cliente consegue falar do mesmo jeito,
 * mandar áudio, tudo normal". É a mesma conversa do CRM (canal SITE): o robô
 * responde (robo.ts), a equipe responde pela tela do atendimento no admin, e
 * nada passa pelo número do WhatsApp.
 *
 * ── Identidade ──────────────────────────────────────────────────────────────
 *
 * O navegador guarda um cookie assinado com o id do contato. Dois jeitos de
 * entrar:
 *   - link genérico (/suporte): a pessoa diz nome, WhatsApp e loja. Isso NÃO
 *     prova quem ela é: nasce um contato novo, sem ligar a uma loja, e o
 *     número informado só vira o telefone do contato se ninguém mais o tiver
 *     (senão fica anotado). O robô a trata como contato não confirmado.
 *   - link pessoal (/suporte?c=<token>): gerado pela equipe para um contato
 *     que já existe (linkDoSuporte). Quem abre continua a conversa DELE.
 * Nenhum dos dois conta como prova da loja para as ferramentas que mexem na
 * conta (ferramentas.ts aceita só o login do painel).
 */

export const COOKIE_DO_SUPORTE = "fh_suporte";
const VALIDADE_DO_COOKIE_S = 180 * 86_400;

function segredo(): string {
  const s = process.env.SUPORTE_SECRET || process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error("Sem segredo para assinar o suporte (SUPORTE_SECRET ou NEXTAUTH_SECRET).");
  return s;
}
const assinar = (contatoId: string) =>
  crypto.createHmac("sha256", segredo()).update(`suporte:v1:${contatoId}`).digest("base64url").slice(0, 22);

export function tokenDoContato(contatoId: string): string {
  return `${contatoId}.${assinar(contatoId)}`;
}

/** O id do contato de um token (cookie ou link), ou null se não confere. */
export function contatoDoToken(token: string | null | undefined): string | null {
  const m = String(token || "").trim().match(/^([A-Za-z0-9_-]{8,40})\.([A-Za-z0-9_-]{10,40})$/);
  if (!m) return null;
  const certa = Buffer.from(assinar(m[1]));
  const veio = Buffer.from(m[2]);
  return certa.length === veio.length && crypto.timingSafeEqual(certa, veio) ? m[1] : null;
}

export function linkDoSuporte(contatoId: string, origem = "https://firehubfood.com.br"): string {
  return `${origem}/suporte?c=${tokenDoContato(contatoId)}`;
}

export function opcoesDoCookie() {
  return { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge: VALIDADE_DO_COOKIE_S };
}

/** Contato novo pelo link genérico (veja "Identidade"). */
export async function contatoNovoDoSite(dados: { nome: string; telefone: string; loja: string }) {
  const chave = chaveDoTelefone(dados.telefone);
  const jaTem = chave ? await prisma.crmContato.findUnique({ where: { telefone: chave }, select: { id: true } }) : null;
  const informado = chave ? telefoneParaExibir(chave) : dados.telefone.slice(0, 30);
  const contato = await prisma.crmContato.create({
    data: {
      telefone: chave && !jaTem ? chave : null,
      nome: dados.nome.slice(0, 120) || null,
      nomeDaLoja: dados.loja.slice(0, 120) || null,
      origem: "SITE",
      notas: jaTem
        ? `Entrou pelo suporte do navegador e disse ser do WhatsApp ${informado}, que já é de outro contato no CRM (não confirmado).`
        : `Entrou pelo suporte do navegador. WhatsApp informado: ${informado || "não informou"}.`,
    },
  });
  await registrarEvento(contato.id, "CADASTRO", "Começou uma conversa pelo suporte do navegador (/suporte).");
  return contato;
}

/** O que a tela do suporte mostra: só o que passou por ela, da mais antiga para a mais nova. */
export async function mensagensDoSite(contatoId: string, limite = 120) {
  const ultimas = await prisma.crmMensagem.findMany({
    where: { contatoId, canal: "SITE" },
    orderBy: { criadoEm: "desc" },
    take: limite,
    select: { id: true, direcao: true, autor: true, autorNome: true, tipo: true, texto: true, midiaUrl: true, criadoEm: true },
  });
  return ultimas.reverse();
}

/**
 * Teto de mensagens do cliente: é chat de gente, e um script colado não pode
 * virar fila de chamadas ao Gemini (o mesmo do chat do painel).
 */
export const MAXIMO_DO_CLIENTE_NA_JANELA = 30;
export const JANELA_DO_CLIENTE_MS = 10 * 60_000;

/** Contatos novos por IP: o link é público. */
const MAXIMO_DE_CONTATOS_POR_IP = 5;
const JANELA_DE_CONTATOS_MS = 60 * 60_000;
export function podeCriarContato(ip: string): boolean {
  const g = globalThis as any;
  if (!g.__suporteContatosPorIp) g.__suporteContatosPorIp = new Map<string, number[]>();
  const mapa: Map<string, number[]> = g.__suporteContatosPorIp;
  const agora = Date.now();
  const lista = (mapa.get(ip) || []).filter((t) => agora - t < JANELA_DE_CONTATOS_MS);
  if (lista.length >= MAXIMO_DE_CONTATOS_POR_IP) return false;
  lista.push(agora);
  mapa.set(ip, lista);
  return true;
}

/** Texto do áudio para a conversa e para o robô (a tela toca o áudio de verdade). */
export async function textoDoAudio(base64: string, mime: string): Promise<string> {
  const transcricao = await transcreverAudio(base64, mime);
  return transcricao ? `🎤 ${transcricao}` : "🎤 Áudio (não consegui transcrever — ouça na conversa)";
}

/**
 * Foto/PDF: grava a descrição na mensagem e guarda os bytes para o robô ver
 * (o mesmo de entrada.ts → lerMidia). Enquanto lê, o robô espera.
 */
export async function lerMidiaDoSite(contatoId: string, mensagemId: string, base64: string, mime: string, oQue: string) {
  if (!midiaQueOModeloLe(mime)) return;
  comecouALer(contatoId, mensagemId);
  try {
    guardarMidia(mensagemId, base64, mime);
    const descricao = await descreverMidia(base64, mime, "");
    if (!descricao) return;
    const atual = await prisma.crmMensagem.findUnique({ where: { id: mensagemId }, select: { texto: true } });
    if (atual) {
      await prisma.crmMensagem.update({ where: { id: mensagemId }, data: { texto: `${atual.texto}\n[O que ${oQue} mostra: ${descricao}]`.slice(0, 8000) } });
    }
  } catch (err: any) {
    console.warn(`[Suporte] Leitura da mídia ${mensagemId} falhou: ${err?.message}`);
  } finally {
    terminouDeLer(contatoId, mensagemId);
  }
}
