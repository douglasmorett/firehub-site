import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

/**
 * /api/store/eta-config
 *
 * Guarda a configuracao do ETA dinamico POR LOJA, no servidor.
 *
 * Antes, a quantidade de motoboys vivia so no chrome.storage.local da extensao,
 * ou seja: por perfil de navegador, nao por loja. Isso tinha duas falhas praticas
 * — quem gerencia duas lojas no mesmo navegador compartilhava o numero, e limpar
 * os dados do Chrome ou trocar de maquina fazia voltar silenciosamente ao padrao
 * 2, que e justamente o valor que joga a loja em "PAUSAR" no primeiro pico.
 *
 * O valor PERSISTE ate alguem mudar (nao reseta diariamente).
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-store-token",
};

const DEFAULT_MOTOBOYS = 2;
const MAX_MOTOBOYS = 50;

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

/** Resolve a loja alvo a partir da sessao do painel ou do token da extensao. */
async function resolveStore(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const sessionUserId = (session?.user as any)?.id as string | undefined;

  const urlToken = req.nextUrl.searchParams.get("token") || req.headers.get("x-store-token");

  let user: { id: string; ownerId: string | null; role: string; name: string | null } | null = null;

  if (sessionUserId) {
    user = await prisma.user.findUnique({
      where: { id: sessionUserId },
      select: { id: true, ownerId: true, role: true, name: true },
    });
  }

  if (!user && urlToken) {
    // O token aceita SOMENTE o id (cuid). Antes aceitava tambem o e-mail e o
    // ifoodMerchantId: quem soubesse o e-mail da loja escrevia configuracao
    // dela. E-mail nao e credencial.
    user = await prisma.user.findFirst({
      where: { id: urlToken },
      select: { id: true, ownerId: true, role: true, name: true },
    });
  }

  if (!user) return null;

  // A configuracao pertence a loja (franqueado dono), nao ao funcionario logado.
  let storeId = user.ownerId || user.id;

  // ADMIN operando uma loja especifica segue o mesmo padrao do resto do app.
  if (user.role === "ADMIN") {
    const activeStoreId =
      req.nextUrl.searchParams.get("storeId") || req.cookies.get("firehub_active_store")?.value;
    if (activeStoreId && activeStoreId !== "all") storeId = activeStoreId;
  }

  return { storeId, actorId: user.id, storeName: user.name };
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await resolveStore(req);
    if (!ctx) {
      return NextResponse.json({ error: "Loja nao identificada" }, { status: 401, headers: corsHeaders });
    }

    const store = await prisma.user.findUnique({
      where: { id: ctx.storeId },
      select: { etaConfig: true, name: true },
    });

    const cfg = (store?.etaConfig as any) || {};
    const motoboysCount =
      typeof cfg.motoboysCount === "number" && cfg.motoboysCount > 0
        ? cfg.motoboysCount
        : DEFAULT_MOTOBOYS;

    return NextResponse.json(
      {
        success: true,
        motoboysCount,
        updatedAt: cfg.updatedAt || null,
        isDefault: typeof cfg.motoboysCount !== "number",
        storeId: ctx.storeId,
        storeName: store?.name || ctx.storeName || null,
      },
      { headers: corsHeaders }
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Erro ao ler configuracao de ETA" },
      { status: 500, headers: corsHeaders }
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    const ctx = await resolveStore(req);
    if (!ctx) {
      return NextResponse.json({ error: "Loja nao identificada" }, { status: 401, headers: corsHeaders });
    }

    const body = await req.json().catch(() => ({}));
    const raw = Number(body?.motoboysCount);

    if (!Number.isFinite(raw) || !Number.isInteger(raw) || raw < 1 || raw > MAX_MOTOBOYS) {
      return NextResponse.json(
        { error: `motoboysCount deve ser um inteiro entre 1 e ${MAX_MOTOBOYS}` },
        { status: 400, headers: corsHeaders }
      );
    }

    const current = await prisma.user.findUnique({
      where: { id: ctx.storeId },
      select: { etaConfig: true },
    });
    if (!current) {
      return NextResponse.json({ error: "Loja nao encontrada" }, { status: 404, headers: corsHeaders });
    }

    const merged = {
      ...((current.etaConfig as any) || {}),
      motoboysCount: raw,
      updatedAt: new Date().toISOString(),
      updatedBy: ctx.actorId,
    };

    await prisma.user.update({
      where: { id: ctx.storeId },
      data: { etaConfig: merged },
    });

    return NextResponse.json(
      { success: true, motoboysCount: raw, updatedAt: merged.updatedAt },
      { headers: corsHeaders }
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Erro ao salvar configuracao de ETA" },
      { status: 500, headers: corsHeaders }
    );
  }
}
