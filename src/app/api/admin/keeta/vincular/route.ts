import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { keetaConfigurada, onboardingDaLoja } from "@/lib/keeta/api";
import { gravarVinculo, desligarVinculo, lojaKeetaDoFranqueado, merchantIdDaLoja } from "@/lib/keeta/lojas";

/**
 * /api/admin/keeta/vincular — liga uma loja do FireHub a uma loja da Keeta (só ADMIN).
 *
 *   POST   { lojaId, keetaMerchantId, nome? }  → grava o vínculo e faz o onboarding
 *   GET    ?lojaId=                             → como está
 *   DELETE ?lojaId=                             → desliga (para de pedir eventos)
 *
 * Por que por admin, e não automático na autorização: o webhook da Keeta diz
 * "a loja 159416882 autorizou", não diz qual loja do FireHub ela é. Ligar pelo
 * nome é o caminho do pedido no painel errado (iFood, Pastel → Hakim). A tela
 * de autoatendimento para o lojista vem depois, com o fluxo de URL da Keeta.
 *
 * O onboarding só roda em vínculo NOVO: refazê-lo para um par já registrado
 * apaga o histórico do mapeamento do lado da Keeta.
 */
export const dynamic = "force-dynamic";

async function soAdmin() {
  const session = await getServerSession(authOptions).catch(() => null);
  if (!session?.user?.email) return { erro: NextResponse.json({ error: "Faça login no painel primeiro." }, { status: 401 }) };
  if ((session.user as any)?.role !== "ADMIN") return { erro: NextResponse.json({ error: "Só o admin do FireHub." }, { status: 403 }) };
  return { email: String(session.user.email) };
}

function urlDoWebhook(req: NextRequest): string {
  const base = (process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || `https://${req.headers.get("host")}`).replace(/\/+$/, "");
  return `${base}/api/keeta/webhook`;
}

export async function GET(req: NextRequest) {
  const a = await soAdmin();
  if (a.erro) return a.erro;
  const lojaId = req.nextUrl.searchParams.get("lojaId") || "";
  if (!lojaId) return NextResponse.json({ error: "lojaId" }, { status: 400 });
  return NextResponse.json({ configurada: keetaConfigurada(), merchantId: merchantIdDaLoja(lojaId), vinculo: await lojaKeetaDoFranqueado(lojaId) });
}

export async function POST(req: NextRequest) {
  const a = await soAdmin();
  if (a.erro) return a.erro;
  if (!keetaConfigurada()) return NextResponse.json({ error: "KEETA_CLIENT_ID/KEETA_CLIENT_SECRET não estão no servidor." }, { status: 503 });

  const corpo = await req.json().catch(() => ({}));
  const lojaId = String(corpo?.lojaId || "").trim();
  const keetaMerchantId = Number(corpo?.keetaMerchantId);
  if (!lojaId || !Number.isSafeInteger(keetaMerchantId) || keetaMerchantId <= 0) {
    return NextResponse.json({ error: "Informe lojaId e keetaMerchantId (número da loja na Keeta)." }, { status: 400 });
  }
  const loja = await prisma.user.findUnique({ where: { id: lojaId }, select: { id: true, storeName: true } });
  if (!loja) return NextResponse.json({ error: "Loja do FireHub não encontrada." }, { status: 404 });

  const v = await gravarVinculo(lojaId, keetaMerchantId, corpo?.nome ? String(corpo.nome).slice(0, 200) : null, a.email!);
  if (!v.ok) return NextResponse.json({ error: v.motivo }, { status: 409 });

  if (v.novo) {
    const r = await onboardingDaLoja(v.loja!.merchantId, keetaMerchantId, urlDoWebhook(req));
    if (!r.ok) {
      // Sem onboarding a Keeta não manda evento nenhum: vínculo pela metade só
      // engana ("Ativa" dos dois lados e nenhum pedido — a Pastel no iFood).
      await desligarVinculo({ franchiseeId: lojaId });
      return NextResponse.json({ error: `A Keeta recusou o registro da loja: ${r.erro}` }, { status: 502 });
    }
  }
  console.log(`[Keeta] 🔗 ${loja.storeName || lojaId} ligada à loja ${keetaMerchantId} da Keeta por ${a.email}${v.novo ? " (onboarding feito)" : " (reativada)"}`);
  return NextResponse.json({ ok: true, vinculo: v.loja, onboarding: v.novo });
}

export async function DELETE(req: NextRequest) {
  const a = await soAdmin();
  if (a.erro) return a.erro;
  const lojaId = req.nextUrl.searchParams.get("lojaId") || "";
  if (!lojaId) return NextResponse.json({ error: "lojaId" }, { status: 400 });
  const n = await desligarVinculo({ franchiseeId: lojaId });
  return NextResponse.json({ ok: true, desligados: n });
}
