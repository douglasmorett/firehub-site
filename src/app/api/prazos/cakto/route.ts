/**
 * POST /api/prazos/cakto — webhook da Cakto: quem paga usa, quem não paga para.
 *
 * A Cakto chama esta rota a cada evento da assinatura. O mapeamento é por
 * palavra no nome do evento/status, tolerante a maiúsculas e a variações
 * (`purchase_approved`, `subscription_renewed`, `subscription_canceled`,
 * `refund`, `chargeback`, `payment_overdue`…), porque o formato exato do
 * payload SÓ é confirmado na primeira compra de teste — por isso cada chamada
 * registra no log as chaves do corpo e o e-mail achado. Se algo não casar,
 * a rota responde 200 com `ignorado: true` (a Cakto não fica reenviando) e o
 * log mostra o que ajustar.
 *
 * ── Segurança ──────────────────────────────────────────────────────────────
 * Sem segredo configurado (CAKTO_WEBHOOK_SECRET) a rota recusa tudo: um
 * webhook aberto deixaria qualquer um ativar conta de graça. O segredo vai na
 * query (`?s=`) ou no header `x-cakto-secret` — a Cakto deixa configurar a
 * URL completa, então a query é o caminho garantido.
 *
 * ── Conta nova pela compra ─────────────────────────────────────────────────
 * Compra aprovada de e-mail sem conta cria a conta com senha aleatória e a
 * manda por e-mail com o link da extensão. Compra de quem já tem conta só
 * muda o status. Nada de senha em log.
 */
import { NextRequest } from "next/server";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { respostaPrazos } from "@/lib/prazos";
import { sendEmail } from "@/lib/mail";

export const dynamic = "force-dynamic";

const LINK_DA_EXTENSAO = "https://firehubfood.com.br/downloads/FireHub-Prazos-Extensao.zip";

function achar(obj: any, chaves: string[], profundidade = 0): string | null {
  if (!obj || typeof obj !== "object" || profundidade > 4) return null;
  for (const k of chaves) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  for (const v of Object.values(obj)) {
    if (v && typeof v === "object") {
      const achado = achar(v, chaves, profundidade + 1);
      if (achado) return achado;
    }
  }
  return null;
}

/** Ativa / bloqueia / cancela, pelo nome do evento ou do status. */
function statusPeloEvento(evento: string): "ATIVO" | "BLOQUEADO" | "CANCELADO" | null {
  const e = evento.toLowerCase();
  if (/refund|chargeback|estorn|reembols/.test(e)) return "BLOQUEADO";
  if (/cancel/.test(e)) return "CANCELADO";
  if (/overdue|late|unpaid|atras|inadimpl|expired|expirad|declined|recusad|failed|falh/.test(e)) return "BLOQUEADO";
  if (/approved|aprovad|paid|pago|renew|renov|active|ativ|complete|conclu/.test(e)) return "ATIVO";
  return null;
}

export async function POST(req: NextRequest) {
  const segredo = (process.env.CAKTO_WEBHOOK_SECRET || "").trim();
  if (!segredo) {
    console.error("[Prazos Cakto] CAKTO_WEBHOOK_SECRET não configurado; webhook recusado.");
    return respostaPrazos({ error: "webhook não configurado" }, { status: 503 });
  }
  const recebido = (req.nextUrl.searchParams.get("s") || req.headers.get("x-cakto-secret") || "").trim();
  if (!recebido || recebido.length !== segredo.length || !crypto.timingSafeEqual(Buffer.from(recebido), Buffer.from(segredo))) {
    return respostaPrazos({ error: "não autorizado" }, { status: 401 });
  }

  let body: any = null;
  try { body = await req.json(); } catch { body = null; }
  if (!body || typeof body !== "object") return respostaPrazos({ ok: true, ignorado: true, motivo: "corpo vazio" });

  const evento = achar(body, ["event", "type", "event_type", "status", "trigger"]) || "";
  const email = (achar(body, ["email", "customer_email", "buyer_email"]) || "").toLowerCase();
  const nome = achar(body, ["name", "customer_name", "buyer_name", "full_name"]) || "";
  const telefone = achar(body, ["phone", "cellphone", "whatsapp", "mobile", "customer_phone"]) || "";
  const referencia = achar(body, ["subscription_id", "subscriptionId", "purchase_id", "order_id", "transaction_id", "id"]) || "";

  console.log(`[Prazos Cakto] evento="${evento}" email=${email ? email.replace(/(.{2}).+(@.*)/, "$1***$2") : "?"} chaves=${Object.keys(body).slice(0, 12).join(",")}`);

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return respostaPrazos({ ok: true, ignorado: true, motivo: "sem e-mail no payload" });
  }
  const novoStatus = statusPeloEvento(evento);
  if (!novoStatus) {
    return respostaPrazos({ ok: true, ignorado: true, motivo: `evento não mapeado: ${evento}` });
  }

  try {
    const existente = await prisma.prazoConta.findFirst({ where: { email: { equals: email, mode: "insensitive" } } });

    if (existente) {
      await prisma.prazoConta.update({
        where: { id: existente.id },
        data: { status: novoStatus, ...(referencia ? { caktoRef: referencia.slice(0, 120) } : {}) },
      });
      return respostaPrazos({ ok: true, status: novoStatus, contaCriada: false });
    }

    // Só compra aprovada cria conta. Cancelamento/estorno de quem nunca teve
    // conta não tem o que fazer.
    if (novoStatus !== "ATIVO") {
      return respostaPrazos({ ok: true, ignorado: true, motivo: "conta inexistente para evento negativo" });
    }

    const senha = crypto.randomBytes(6).toString("base64url").slice(0, 10);
    const conta = await prisma.prazoConta.create({
      data: {
        email,
        senhaHash: await bcrypt.hash(senha, 10),
        nomeLoja: (nome || email.split("@")[0]).slice(0, 80),
        whatsapp: telefone ? telefone.replace(/\D/g, "").slice(0, 20) : null,
        status: "ATIVO",
        caktoRef: referencia ? referencia.slice(0, 120) : null,
        criadoPor: "cakto",
      },
    });

    const html =
      `<p>Olá${nome ? `, ${nome}` : ""}! Sua assinatura do <b>FireHub Prazos</b> está ativa.</p>` +
      `<p><b>Seu acesso na extensão</b><br>E-mail: ${email}<br>Senha: <code>${senha}</code></p>` +
      `<p><b>Como instalar (3 minutos)</b><br>` +
      `1. Baixe a extensão: <a href="${LINK_DA_EXTENSAO}">${LINK_DA_EXTENSAO}</a> e descompacte numa pasta.<br>` +
      `2. No Chrome, abra <code>chrome://extensions</code>, ligue o <b>Modo do desenvolvedor</b> e clique em <b>Carregar sem compactação</b>, escolhendo a pasta.<br>` +
      `3. Fixe o ícone 🔥, entre com o e-mail e a senha acima, e no painel do seu sistema clique em <b>Marcar colunas</b> nas colunas que contam pedido na cozinha.<br>` +
      `4. Deixe a aba <b>Configurações → Entrega</b> do Portal do Parceiro aberta.</p>` +
      `<p>Qualquer dúvida, responda este e-mail.</p>`;
    await sendEmail({ to: email, subject: "FireHub Prazos — seu acesso à extensão", html }).catch((e) =>
      console.error("[Prazos Cakto] e-mail de boas-vindas falhou:", e?.message)
    );

    return respostaPrazos({ ok: true, status: "ATIVO", contaCriada: true, id: conta.id });
  } catch (err: any) {
    console.error("[Prazos Cakto]", err?.message);
    return respostaPrazos({ error: "falha ao processar" }, { status: 500 });
  }
}
