import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

export async function PUT(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const body = await req.json();
  const data: any = {};

  // CPF/CNPJ (editável pelo dono da loja)
  if (body.cpfCnpj !== undefined) data.cpfCnpj = body.cpfCnpj;

  // Store settings — campos permitidos
  for (const key of [
    "storeName", "storePhone", "storeAddress", "storeBanner", "storeLogo",
    "storeHours", "paymentFees", "deliveryZoneType", "deliveryZones",
    "storeLatLng", "storeCoupons", "storePause",
    "facebookPixelId",   // Meta Pixel ID
    "storeLoyalty",      // Programa de fidelidade/cashback
    "city",              // Cidade / Estado (ex: Rio de Janeiro - RJ)
    "storeTimezone",     // Fuso Horário (ex: America/Sao_Paulo)
  ]) {
    if (body[key] !== undefined) data[key] = body[key];
  }
  if (body.storeDeliveryOnly !== undefined) data.storeDeliveryOnly = body.storeDeliveryOnly;
  if (body.autoAcceptOrders !== undefined) data.autoAcceptOrders = Boolean(body.autoAcceptOrders);
  if (body.storeAlertSound !== undefined) data.storeAlertSound = body.storeAlertSound;
  if (body.ifoodSyncDeliveryTime !== undefined) data.ifoodSyncDeliveryTime = Boolean(body.ifoodSyncDeliveryTime);

  const updatedUser = await prisma.user.update({ where: { email: session.user?.email || "" }, data });

  // ── Sincronização automática do tempo de preparo/entrega com o iFood ──
  let ifoodSyncResult: any = null;

  if (updatedUser.ifoodSyncDeliveryTime) {
    try {
      const zones = (updatedUser.deliveryZones as any[]) || [];
      if (zones.length > 0) {
        const times = zones.map(z => Number(z.time)).filter(t => t > 0);
        if (times.length > 0) {
          const mainTime = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
          const { ifoodFetch, updateIfoodPreparationTime } = await import("@/lib/ifood-api");

          // 1. Descobrir lojas autorizadas ativas no iFood
          const listRes = await ifoodFetch("/merchant/v1.0/merchants");
          let targetIds: string[] = [];

          if (listRes.ok) {
            const listData = await listRes.json();
            const listArr = Array.isArray(listData) ? listData : [listData];
            targetIds = listArr.map((m: any) => m.id || m.merchantId).filter(Boolean);
          }

          if (updatedUser.ifoodMerchantId && !targetIds.includes(updatedUser.ifoodMerchantId)) {
            targetIds.push(updatedUser.ifoodMerchantId);
          }

          if (process.env.IFOOD_MERCHANT_UUID && !targetIds.includes(process.env.IFOOD_MERCHANT_UUID)) {
            targetIds.push(process.env.IFOOD_MERCHANT_UUID);
          }

          console.log(`[iFood Sync] Lojas encontradas no iFood:`, targetIds);

          let syncSuccess = false;
          let lastError = "";

          for (const mId of targetIds) {
            console.log(`[iFood Sync] Tentando sincronizar ${mainTime} min para loja ${mId}...`);
            const res = await updateIfoodPreparationTime(mId, mainTime);
            if (res.success) {
              syncSuccess = true;
              ifoodSyncResult = { success: true, sentMinutes: mainTime, merchantId: mId };
              // Salvar o merchantId funcional no usuário
              await prisma.user.update({
                where: { id: updatedUser.id },
                data: { ifoodMerchantId: mId }
              });
              break;
            } else {
              lastError = res.error || "Erro ao atualizar";
            }
          }

          if (!syncSuccess) {
            ifoodSyncResult = { success: false, error: lastError || "Nenhuma loja autorizada respondeu com sucesso" };
          }
        }
      }
    } catch (err: any) {
      console.error("[iFood Sync] Erro ao sincronizar tempo de preparo com iFood:", err?.message);
      ifoodSyncResult = { success: false, error: err?.message };
    }
  }

  return NextResponse.json({ success: true, ifoodSync: ifoodSyncResult });
}
