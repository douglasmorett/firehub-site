import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

export async function PUT(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const body = await req.json();
  const data: any = {};

  const currentUser = await prisma.user.findUnique({
    where: { email: session.user?.email || "" }
  });
  if (!currentUser) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  const isSecondary = currentUser.role === "STAFF" || Boolean((currentUser as any).ownerId);

  // Nome, Cidade e E-mail só podem ser alterados pela conta principal (não secundária)
  if (!isSecondary) {
    if (body.name !== undefined) data.name = body.name.trim();
    if (body.city !== undefined) data.city = body.city.trim();
    if (body.email !== undefined && body.email.trim()) {
      const cleanEmail = body.email.trim().toLowerCase();
      if (cleanEmail !== currentUser.email) {
        const existing = await prisma.user.findUnique({ where: { email: cleanEmail } });
        if (existing) {
          return NextResponse.json({ error: "Este e-mail já está em uso por outra conta." }, { status: 400 });
        }
        data.email = cleanEmail;
      }
    }
  }

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
    "repasseConfig",     // Configurações de Repasse Automático (Brendi Flow)
    "deliveryConfig",    // Configurações de Entrega / Frete Grátis
  ]) {
    if (body[key] !== undefined) data[key] = body[key];
  }
  if (body.storeDeliveryOnly !== undefined) data.storeDeliveryOnly = body.storeDeliveryOnly;
  if (body.autoAcceptOrders !== undefined) data.autoAcceptOrders = Boolean(body.autoAcceptOrders);
  if (body.storeAlertSound !== undefined) data.storeAlertSound = body.storeAlertSound;
  if (body.ifoodSyncDeliveryTime !== undefined) data.ifoodSyncDeliveryTime = Boolean(body.ifoodSyncDeliveryTime);

  const updatedUser = await prisma.user.update({ where: { id: currentUser.id }, data });

  // ── Sincronizar cidade e dados da loja para todos os funcionários da equipe ──
  if (data.city !== undefined || data.storeName !== undefined || data.cpfCnpj !== undefined) {
    const staffUpdates: any = {};
    if (data.city !== undefined) staffUpdates.city = data.city;
    if (data.storeName !== undefined) staffUpdates.storeName = data.storeName;
    if (data.cpfCnpj !== undefined) staffUpdates.cpfCnpj = data.cpfCnpj;

    await prisma.user.updateMany({
      where: { ownerId: currentUser.id },
      data: staffUpdates,
    });
  }

  // ── Sincronização automática do tempo de preparo/entrega com o iFood ──
  let ifoodSyncResult: any = null;

  if (updatedUser.ifoodSyncDeliveryTime) {
    try {
      const zones = (updatedUser.deliveryZones as any[]) || [];
      console.log(`[iFood Sync] Toggle ativo. Zonas salvas: ${zones.length}`, JSON.stringify(zones));

      if (zones.length === 0) {
        ifoodSyncResult = { success: false, error: "Nenhuma zona de entrega configurada. Configure pelo menos uma zona antes de sincronizar." };
      } else {
        const times = zones.map(z => Number(z.time)).filter(t => t > 0);
        console.log(`[iFood Sync] Tempos válidos encontrados: ${times.length}`, times);

        if (times.length === 0) {
          ifoodSyncResult = { success: false, error: "Nenhum tempo de entrega válido nas zonas configuradas." };
        } else {
          const mainTime = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
          console.log(`[iFood Sync] Tempo médio calculado: ${mainTime} min`);
          const { ifoodFetch, updateIfoodPreparationTime } = await import("@/lib/ifood-api");

          // 1. Descobrir lojas autorizadas ativas no iFood
          const listRes = await ifoodFetch("/merchant/v1.0/merchants");
          let targetIds: string[] = [];

          if (listRes.ok) {
            const listData = await listRes.json();
            const listArr = Array.isArray(listData) ? listData : [listData];
            targetIds = listArr.map((m: any) => m.id || m.merchantId).filter(Boolean);
          } else {
            console.warn(`[iFood Sync] Falha ao listar lojas: ${listRes.status} ${listRes.statusText}`);
          }

          if (updatedUser.ifoodMerchantId && !targetIds.includes(updatedUser.ifoodMerchantId)) {
            targetIds.push(updatedUser.ifoodMerchantId);
          }

          if (process.env.IFOOD_MERCHANT_UUID && !targetIds.includes(process.env.IFOOD_MERCHANT_UUID)) {
            targetIds.push(process.env.IFOOD_MERCHANT_UUID);
          }

          console.log(`[iFood Sync] Lojas encontradas no iFood:`, targetIds);

          if (targetIds.length === 0) {
            ifoodSyncResult = { success: false, error: "Nenhuma loja iFood encontrada. Verifique se a integração iFood está configurada." };
          } else {
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
                console.log(`[iFood Sync] ✅ Sincronizado com sucesso: ${mainTime} min para loja ${mId}`);
                break;
              } else {
                lastError = res.error || "Erro ao atualizar";
                console.warn(`[iFood Sync] ❌ Falha para loja ${mId}: ${lastError}`);
              }
            }

            if (!syncSuccess) {
              ifoodSyncResult = { success: false, error: lastError || "Nenhuma loja autorizada respondeu com sucesso" };
            }
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
