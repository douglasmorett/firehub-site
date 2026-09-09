/**
 * POST /api/prazos/cakto — webhook da Cakto: quem paga usa, quem não paga para.
 *
 * A Cakto chama esta rota a cada evento da assinatura, com o formato
 * documentado em docs.cakto.com.br/conceitos/webhooks:
 *   { secret, event, data: { id, status, customer: { name, email, phone },
 *     product: { id, name }, offer: { id, name, price }, subscription… } }
 *
 * Eventos → status da conta:
 *   purchase_approved, subscription_renewed, subscription_resumed → ATIVO
 *   subscription_created → ATIVO só se `data.status` já for pago
 *   subscription_renewal_refused, subscription_paused, refund, chargeback → BLOQUEADO
 *   subscription_canceled → CANCELADO
 *   o resto (pix_gerado, purchase_refused, checkout_abandonment…) → ignorado, 200
 *
 * A cota de lojas vem do nome da oferta ("3 lojas") ou da quantidade
 * comprada; sem nada disso fica 1. Cada chamada registra no log o evento e as
 * chaves do corpo — se a Cakto mudar o formato, o log mostra o que ajustar.
 *
 * ── Segurança ──────────────────────────────────────────────────────────────
 * Sem segredo configurado (CAKTO_WEBHOOK_SECRET) a rota recusa tudo: um
 * webhook aberto deixaria qualquer um ativar conta de graça. O segredo é
 * aceito na query (`?s=`), no header `x-cakto-secret` ou no campo `secret`
 * do corpo (a Cakto manda o segredo do webhook ali). Quando vem a assinatura
 * HMAC (X-Cakto-Signature/X-Cakto-Timestamp) ela também é conferida.
 *
 * ── Conta nova pela compra ─────────────────────────────────────────────────
 * Compra aprovada de e-mail sem conta cria a conta com senha aleatória e a
 * manda por e-mail com o link da extensão. Compra de quem já tem conta só
 * muda o status (e a cota). Nada de senha em log.
 */
import { NextRequest } from "next/server";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { respostaPrazos } from "@/lib/prazos";
import { sendEmail } from "@/lib/mail";

export const dynamic = "force-dynamic";

// Página nossa que manda para a Chrome Web Store (item pkkcnkbkacfiojiapodplkbkmdhhnjag,
// criado em 09/09/2026) e, enquanto a ficha não for aprovada, oferece o arquivo.
// O e-mail já enviado não muda; a página muda. Por isso o link é nosso.
const LINK_DA_EXTENSAO = "https://firehubfood.com.br/prazos/instalar";
const LINK_DO_GUIA = "https://firehubfood.com.br/prazos#instalar";

function igual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/** Ativa / bloqueia / cancela, pelo nome do evento (e status do pedido). */
function statusPeloEvento(evento: string, statusDoPedido: string): "ATIVO" | "BLOQUEADO" | "CANCELADO" | null {
  const e = evento.toLowerCase().trim();
  if (e === "purchase_approved" || e === "subscription_renewed" || e === "subscription_resumed") return "ATIVO";
  if (e === "subscription_created") return /^(paid|approved|active|ativo|pago)$/i.test(statusDoPedido) ? "ATIVO" : null;
  if (e === "subscription_renewal_refused" || e === "subscription_paused" || e === "refund" || e === "chargeback") return "BLOQUEADO";
  if (e === "subscription_canceled" || e === "subscription_cancelled") return "CANCELADO";
  // Nomes fora da lista: tolerância por palavra, para uma variação nova não passar em branco.
  if (/refund|chargeback|estorn|reembols|overdue|unpaid|inadimpl|paused/.test(e)) return "BLOQUEADO";
  if (/cancel/.test(e)) return "CANCELADO";
  if (/approved|aprovad|renewed|renov|resumed/.test(e)) return "ATIVO";
  return null;
}

/**
 * O webhook da Cakto é por produto, mas um erro de configuração lá (ou um
 * webhook antigo reaproveitado) mandaria compra do Evo PDV criar conta de
 * Prazos. Se o payload diz de que produto é e não é o nosso, ignora.
 */
function ehDoProduto(oferta: string, produto: string): boolean {
  const texto = `${oferta} ${produto}`.trim();
  if (!texto) return true;
  return /prazo/i.test(texto);
}

/** "FireHub Prazos — 3 lojas" → 3; quantidade comprada → n; senão 1. */
function cotaDaOferta(oferta: string, produto: string, quantidade: unknown): number {
  const q = Math.floor(Number(quantidade));
  if (Number.isFinite(q) && q >= 1 && q <= 50) return q;
  const m = `${oferta} ${produto}`.match(/(\d{1,2})\s*lojas?\b/i);
  if (m) return Math.min(50, Math.max(1, Number(m[1])));
  return 1;
}

export async function POST(req: NextRequest) {
  const segredo = (process.env.CAKTO_WEBHOOK_SECRET || "").trim();
  if (!segredo) {
    console.error("[Prazos Cakto] CAKTO_WEBHOOK_SECRET não configurado; webhook recusado.");
    return respostaPrazos({ error: "webhook não configurado" }, { status: 503 });
  }

  const bruto = await req.text().catch(() => "");
  let body: any = null;
  try { body = bruto ? JSON.parse(bruto) : null; } catch { body = null; }

  const daQuery = (req.nextUrl.searchParams.get("s") || req.headers.get("x-cakto-secret") || "").trim();
  const doCorpo = typeof body?.secret === "string" ? body.secret.trim() : "";
  if (!igual(daQuery, segredo) && !igual(doCorpo, segredo)) {
    return respostaPrazos({ error: "não autorizado" }, { status: 401 });
  }
  // Assinatura HMAC, quando vier. É conferência EXTRA, não a porta: quem
  // autentica é o segredo compartilhado acima (query/header/corpo, por HTTPS).
  // O teste de 07/09/2026 mostrou que a assinatura real da Cakto não bate com
  // a fórmula da documentação (`v1=hmac("{ts}.{corpo}")`), e recusar por isso
  // derrubava a integração inteira. Então: confere as formas conhecidas, e o
  // que não bater vira log — com o suficiente para descobrir a fórmula certa.
  const assinatura = (req.headers.get("x-cakto-signature") || "").trim();
  const ts = (req.headers.get("x-cakto-timestamp") || "").trim();
  if (assinatura) {
    const hmac = (dados: string, saida: "hex" | "base64") =>
      crypto.createHmac("sha256", segredo).update(dados).digest(saida);
    const candidatos: string[] = [];
    for (const base of [ts ? `${ts}.${bruto}` : "", bruto, ts]) {
      if (!base) continue;
      for (const saida of ["hex", "base64"] as const) {
        const h = hmac(base, saida);
        candidatos.push(h, `v1=${h}`, `sha256=${h}`);
      }
    }
    const bate = candidatos.some((c) => igual(assinatura, c));
    if (!bate) {
      console.warn(
        `[Prazos Cakto] assinatura não bate com nenhuma fórmula conhecida (aceito pelo segredo). recebida=${assinatura.slice(0, 24)}… ts=${ts || "-"} tam=${bruto.length}`
      );
    }
  }

  if (!body || typeof body !== "object") return respostaPrazos({ ok: true, ignorado: true, motivo: "corpo vazio" });

  const evento = String(body.event || body.type || body.event_type || "").trim();
  // No disparo "Agrupado" a Cakto manda `data` como LISTA de itens da venda
  // (a documentação mostra objeto, que é o disparo "Individual"). Visto no
  // evento de teste de 07/09/2026: `data` array virava "sem e-mail" e a
  // compra era ignorada em silêncio. Entre vários itens, vale o nosso.
  const nomeDoItem = (x: any) => `${x?.offer?.name || ""} ${x?.product?.name || ""}`;
  const dados: any = Array.isArray(body.data)
    ? body.data.find((x: any) => /prazo/i.test(nomeDoItem(x))) || body.data[0] || {}
    : body.data && typeof body.data === "object"
      ? body.data
      : body;
  const cliente: any = dados.customer && typeof dados.customer === "object" ? dados.customer : {};
  const email = String(cliente.email || dados.customerEmail || dados.email || "").toLowerCase().trim();
  const nome = String(cliente.name || dados.customerName || dados.name || "").trim();
  const telefone = String(cliente.phone || cliente.cellphone || dados.customerCellphone || dados.phone || "").trim();
  const oferta = String(dados.offer?.name || "");
  const produto = String(dados.product?.name || "");
  const statusDoPedido = String(dados.status || "");
  const referencia = String(dados.subscription?.id || dados.subscription_id || dados.id || "").trim();

  console.log(`[Prazos Cakto] evento="${evento}" status="${statusDoPedido}" oferta="${oferta}" email=${email ? email.replace(/(.{2}).+(@.*)/, "$1***$2") : "?"} chaves=${Object.keys(body).slice(0, 12).join(",")}`);

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return respostaPrazos({ ok: true, ignorado: true, motivo: "sem e-mail no payload" });
  }
  if (!ehDoProduto(oferta, produto)) {
    return respostaPrazos({ ok: true, ignorado: true, motivo: `outro produto: ${produto || oferta}` });
  }
  const novoStatus = statusPeloEvento(evento, statusDoPedido);
  if (!novoStatus) {
    return respostaPrazos({ ok: true, ignorado: true, motivo: `evento não mapeado: ${evento || "?"}` });
  }
  const cota = cotaDaOferta(oferta, produto, dados.quantity ?? dados.offer?.quantity);

  try {
    const existente = await prisma.prazoConta.findFirst({ where: { email: { equals: email, mode: "insensitive" } } });

    if (existente) {
      await prisma.prazoConta.update({
        where: { id: existente.id },
        data: {
          status: novoStatus,
          ...(novoStatus === "ATIVO" ? { lojasIncluidas: cota } : {}),
          ...(referencia ? { caktoRef: referencia.slice(0, 120) } : {}),
        },
      });
      return respostaPrazos({ ok: true, status: novoStatus, contaCriada: false, lojasIncluidas: novoStatus === "ATIVO" ? cota : undefined });
    }

    // Só compra aprovada cria conta. Cancelamento/estorno de quem nunca teve
    // conta não tem o que fazer.
    if (novoStatus !== "ATIVO") {
      return respostaPrazos({ ok: true, ignorado: true, motivo: "conta inexistente para evento negativo" });
    }

    const senha = crypto.randomBytes(6).toString("base64url").slice(0, 10);
    // Código do link de ativação: é ele que faz a extensão entrar sem o lojista
    // digitar nada. A senha continua existindo, para o segundo computador e
    // para quem preferir entrar na mão.
    const codigoAtivacao = crypto.randomBytes(18).toString("base64url");
    const conta = await prisma.prazoConta.create({
      data: {
        email,
        senhaHash: await bcrypt.hash(senha, 10),
        nomeLoja: (nome || email.split("@")[0]).slice(0, 80),
        whatsapp: telefone ? telefone.replace(/\D/g, "").slice(0, 20) : null,
        status: "ATIVO",
        lojasIncluidas: cota,
        caktoRef: referencia ? referencia.slice(0, 120) : null,
        ativacaoCodigo: codigoAtivacao,
        criadoPor: "cakto",
        observacoes: oferta ? `Oferta Cakto: ${oferta}`.slice(0, 500) : null,
      },
    });
    const linkAtivacao = `https://firehubfood.com.br/prazos/ativar?t=${codigoAtivacao}`;

    const html =
      `<p>Olá${nome ? `, ${nome}` : ""}! Sua assinatura do <b>FireHub Prazos</b> está ativa` +
      `${cota > 1 ? ` (${cota} lojas por plataforma)` : ""}.</p>` +
      // O e-mail tem UM caminho principal, não uma lista de passos. Instrução
      // longa é o que faz o lojista parar no meio e virar chamado de suporte.
      `<p><b>No computador da loja, faça só isto:</b></p>` +
      `<p style="margin:18px 0"><a href="${LINK_DA_EXTENSAO}" style="background:#FF5722;color:#fff;font-weight:bold;padding:14px 26px;border-radius:10px;text-decoration:none;display:inline-block">1. Instalar a extensão no Chrome</a></p>` +
      `<p style="margin:18px 0"><a href="${linkAtivacao}" style="background:#0F172A;color:#fff;font-weight:bold;padding:14px 26px;border-radius:10px;text-decoration:none;display:inline-block">2. Ativar minha conta</a></p>` +
      `<p>Depois de instalar, clique no botão 2: a extensão entra sozinha, <b>sem você digitar senha nenhuma</b>.</p>` +
      `<p>Aí é só abrir o painel de pedidos do seu sistema, clicar no ícone 🔥 e em <b>Marcar coluna</b>, e clicar na coluna que mostra os pedidos que estão na cozinha. ` +
      `Deixe o <b>Portal do Parceiro (iFood)</b> e/ou o <b>99Food Admin</b> abertos e logados nas suas lojas, e marque na extensão quais devem ter o prazo ajustado.</p>` +
      `<hr style="border:none;border-top:1px solid #E2E8F0;margin:22px 0">` +
      `<p style="font-size:13px;color:#64748B"><b>Guarde para outro computador:</b> e-mail <b>${email}</b>, senha <code>${senha}</code>. ` +
      `O botão de ativar vale uma vez só; nos outros computadores entre com essa senha (dá para trocar dentro da extensão).</p>` +
      `<p style="font-size:13px;color:#64748B">Guia com imagens: <a href="${LINK_DO_GUIA}">${LINK_DO_GUIA}</a> — ou responda este e-mail que a gente instala junto com você.</p>`;
    await sendEmail({ to: email, subject: "FireHub Prazos — seu acesso à extensão", html }).catch((e) =>
      console.error("[Prazos Cakto] e-mail de boas-vindas falhou:", e?.message)
    );

    return respostaPrazos({ ok: true, status: "ATIVO", contaCriada: true, id: conta.id, lojasIncluidas: cota });
  } catch (err: any) {
    console.error("[Prazos Cakto]", err?.message);
    return respostaPrazos({ error: "falha ao processar" }, { status: 500 });
  }
}
