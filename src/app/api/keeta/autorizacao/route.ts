import { NextRequest, NextResponse } from "next/server";
import { keetaConfigurada } from "@/lib/keeta/api";
import { webhookAssinadoPelaKeeta } from "@/lib/keeta/assinatura";
import { desligarVinculo } from "@/lib/keeta/lojas";
import { guardarPayloadCru } from "@/lib/open-delivery/payload-cru";

/**
 * POST /api/keeta/autorizacao — a Keeta avisa que um lojista autorizou (opType 1)
 * ou revogou (opType 2) o FireHub. URL configurada no Dev Portal da Keeta
 * (webhooks 1301 e 1302).
 *
 * Autorizar NÃO liga a loja sozinho: qual loja do FireHub é aquela loja da
 * Keeta é decisão de gente (rota /api/admin/keeta/vincular). Adivinhar pelo nome
 * é o caminho do pedido caindo no painel da loja errada. O aviso fica no payload
 * cru e no log para quem vai vincular.
 *
 * Revogar desliga o vínculo na hora: sem autorização a Keeta não manda mais nada,
 * e o polling não deve continuar pedindo eventos dessa loja.
 */
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!keetaConfigurada()) return NextResponse.json({ status: 503, title: "Keeta não configurada" }, { status: 503 });
  const cru = await req.text();
  const assinaturaOk = webhookAssinadoPelaKeeta(process.env.KEETA_CLIENT_SECRET || "", cru, req.headers.get("x-app-signature"));
  let corpo: any = null;
  try {
    corpo = JSON.parse(cru);
  } catch {
    return NextResponse.json({ status: 400, title: "corpo não é JSON" }, { status: 400 });
  }
  await guardarPayloadCru({
    canal: "KEETA",
    tipo: "webhook",
    idNoParceiro: corpo?.shopId != null ? String(corpo.shopId) : null,
    payload: { autorizacao: corpo },
    avisos: assinaturaOk ? [] : ["assinatura do webhook de autorização NÃO conferiu"],
  });
  if (!assinaturaOk && process.env.KEETA_WEBHOOK_ASSINATURA === "obrigatoria") {
    return NextResponse.json({ status: 401, title: "assinatura inválida" }, { status: 401 });
  }

  const op = Number(corpo?.opType);
  if (op === 2 && corpo?.shopId != null && assinaturaOk) {
    const n = await desligarVinculo({ keetaMerchantId: corpo.shopId });
    console.log(`[Keeta] 🔌 autorização revogada pela loja ${corpo.shopId} (${corpo.shopName || "?"}) — ${n} vínculo(s) desligado(s)`);
  } else if (op === 1) {
    console.log(`[Keeta] 🔑 loja ${corpo?.shopId} (${corpo?.shopName || "?"}) autorizou o FireHub — falta vincular em /api/admin/keeta/vincular`);
  }
  // A doc pede 200 com JSON e mostra dois formatos diferentes; vão os dois.
  return NextResponse.json({ code: 0, message: "success", status: 0, title: "success" });
}
