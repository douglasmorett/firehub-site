import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { lojaDaSessao } from "@/lib/ifood-token";
import { cifrar, decifrar } from "@/lib/cofre";
import { gerarClientId, gerarClientSecret, gerarMerchantId, urlDeWebhookValida } from "@/lib/open-delivery-saida/credenciais";
import { integracaoDaLoja, urlBaseOD } from "@/lib/open-delivery-saida/eventos";

export const dynamic = "force-dynamic";

/**
 * /api/store/integracoes/open-delivery-saida — a credencial Open Delivery que a
 * loja entrega à logística (Bem Dito), em Minha Loja › API Aberta & Webhooks.
 *
 *   GET                                        → como está + as URLs para passar ao parceiro
 *   POST { acao: "gerar" }                     → cria client_id + client_secret (o segredo volta UMA vez aqui)
 *   POST { acao: "novoSegredo" }               → troca o segredo (o token antigo para de valer)
 *   POST { acao: "mostrarSegredo" }            → mostra o segredo atual (só o dono)
 *   POST { acao: "salvar", webhookUrl?, ativo? } → URL do webhook do parceiro e liga/desliga
 *
 * Funcionário (STAFF) só vê: gerar, trocar e ler o segredo é do dono.
 */

async function quemPede(req: NextRequest) {
  const session = await getServerSession(authOptions).catch(() => null);
  const email = session?.user?.email;
  if (!email) return { erro: NextResponse.json({ error: "Faça login no painel." }, { status: 401 }) };
  const lojaId = await lojaDaSessao(email, req.cookies.get("firehub_active_store")?.value || null);
  if (!lojaId) return { erro: NextResponse.json({ error: "Loja não encontrada." }, { status: 404 }) };
  const u = await prisma.user.findUnique({ where: { email }, select: { role: true } });
  const funcionario = String(u?.role || "").toUpperCase() === "STAFF";
  return { lojaId, funcionario };
}

function resumo(integ: Awaited<ReturnType<typeof integracaoDaLoja>>) {
  if (!integ) return null;
  return {
    parceiro: integ.parceiro,
    clientId: integ.clientId,
    merchantId: integ.merchantId,
    webhookUrl: integ.webhookUrl,
    ativo: integ.ativo,
    ligadoEm: integ.ligadoEm,
    ultimoUsoEm: integ.ultimoUsoEm,
  };
}

function urls() {
  const base = urlBaseOD();
  return { token: `${base}/oauth/token`, base };
}

export async function GET(req: NextRequest) {
  const s = await quemPede(req);
  if (s.erro) return s.erro;
  const integ = await integracaoDaLoja(s.lojaId!);
  let fila: { pendentes: number; desistiu: number; ultimoErro: string | null } | null = null;
  if (integ) {
    const r = await prisma.$queryRawUnsafe<{ pendentes: bigint; desistiu: bigint; ultimoErro: string | null }[]>(
      `SELECT COUNT(*) FILTER (WHERE "webhookStatus" = 'PENDENTE') AS pendentes,
              COUNT(*) FILTER (WHERE "webhookStatus" = 'DESISTIU' AND "createdAt" > now() - interval '24 hours') AS desistiu,
              (SELECT "webhookUltimoErro" FROM "OpenDeliverySaidaEvento"
                WHERE "integracaoId" = $1 AND "webhookUltimoErro" IS NOT NULL ORDER BY "createdAt" DESC LIMIT 1) AS "ultimoErro"
         FROM "OpenDeliverySaidaEvento" WHERE "integracaoId" = $1`,
      integ.id,
    );
    fila = { pendentes: Number(r[0]?.pendentes || 0), desistiu: Number(r[0]?.desistiu || 0), ultimoErro: r[0]?.ultimoErro ?? null };
  }
  return NextResponse.json({
    integracao: resumo(integ),
    urls: urls(),
    webhookPadrao: Boolean(String(process.env.OPEN_DELIVERY_SAIDA_WEBHOOK_URL || "").trim()),
    fila,
    podeEditar: !s.funcionario,
  });
}

export async function POST(req: NextRequest) {
  const s = await quemPede(req);
  if (s.erro) return s.erro;
  if (s.funcionario) return NextResponse.json({ error: "Só o dono da loja mexe nesta credencial." }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const acao = String(body?.acao || "");
  const integ = await integracaoDaLoja(s.lojaId!);

  if (acao === "gerar") {
    if (integ) return NextResponse.json({ error: "Esta loja já tem credencial. Use “Gerar novo segredo”." }, { status: 409 });
    const clientSecret = gerarClientSecret();
    const parceiro = String(body?.parceiro || "Bem Dito").trim().slice(0, 60) || "Bem Dito";
    await prisma.$executeRawUnsafe(
      `INSERT INTO "OpenDeliverySaida" ("id","franchiseeId","parceiro","merchantId","clientId","clientSecretCifrado","ativo","ligadoEm","updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,true,now(),now())`,
      crypto.randomUUID(),
      s.lojaId,
      parceiro,
      gerarMerchantId(),
      gerarClientId(),
      cifrar(clientSecret),
    );
    return NextResponse.json({ ok: true, integracao: resumo(await integracaoDaLoja(s.lojaId!)), clientSecret, urls: urls() });
  }

  if (!integ) return NextResponse.json({ error: "Gere a credencial primeiro." }, { status: 404 });

  if (acao === "novoSegredo") {
    const clientSecret = gerarClientSecret();
    await prisma.$executeRawUnsafe(
      `UPDATE "OpenDeliverySaida" SET "clientSecretCifrado" = $2, "updatedAt" = now() WHERE "id" = $1`,
      integ.id,
      cifrar(clientSecret),
    );
    return NextResponse.json({ ok: true, clientSecret });
  }

  if (acao === "mostrarSegredo") {
    const clientSecret = decifrar(integ.clientSecretCifrado);
    if (!clientSecret) return NextResponse.json({ error: "O segredo não abre neste servidor. Gere um novo segredo." }, { status: 409 });
    return NextResponse.json({ ok: true, clientSecret });
  }

  if (acao === "salvar") {
    let webhookUrl = integ.webhookUrl;
    if (body?.webhookUrl !== undefined) {
      const bruta = String(body.webhookUrl || "").trim();
      if (!bruta) webhookUrl = null;
      else {
        const v = urlDeWebhookValida(bruta);
        if (!v.ok) return NextResponse.json({ error: v.erro }, { status: 400 });
        webhookUrl = v.url;
      }
    }
    const ativo = typeof body?.ativo === "boolean" ? body.ativo : integ.ativo;
    // Religar conta a partir de agora: os pedidos do tempo desligado não viram
    // uma enxurrada de eventos atrasados para a logística.
    const religou = ativo && !integ.ativo;
    await prisma.$executeRawUnsafe(
      `UPDATE "OpenDeliverySaida" SET "webhookUrl" = $2, "ativo" = $3, "updatedAt" = now()
         ${religou ? `, "ligadoEm" = now(), "ultimaVarredura" = NULL` : ""}
       WHERE "id" = $1`,
      integ.id,
      webhookUrl,
      ativo,
    );
    return NextResponse.json({ ok: true, integracao: resumo(await integracaoDaLoja(s.lojaId!)) });
  }

  return NextResponse.json({ error: "Ação desconhecida." }, { status: 400 });
}
