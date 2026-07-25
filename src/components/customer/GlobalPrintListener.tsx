"use client";
import { useEffect, useRef } from "react";
import { useSession } from "next-auth/react";

export default function GlobalPrintListener() {
  const { data: session } = useSession();
  const autoPrintedIdsRef = useRef<Set<string>>(new Set());
  const knownOrderIdsRef = useRef<Set<string>>(new Set());
  const lastPollHash = useRef("");
  const isPollingRef = useRef(false);

  useEffect(() => {
    if (!session?.user) return;

    let active = true;

    const markAutoPrinted = (o: any) => {
      if (!o) return;
      if (o.id) autoPrintedIdsRef.current.add(o.id);
      if (o.ifoodReference) autoPrintedIdsRef.current.add(o.ifoodReference);
      if (o.openDeliveryReference) autoPrintedIdsRef.current.add(o.openDeliveryReference);
    };

    const isAutoPrinted = (o: any) => {
      if (!o) return false;
      return (
        (o.id && autoPrintedIdsRef.current.has(o.id)) ||
        (o.ifoodReference && autoPrintedIdsRef.current.has(o.ifoodReference)) ||
        (o.openDeliveryReference && autoPrintedIdsRef.current.has(o.openDeliveryReference))
      );
    };

    const pollAndPrint = async () => {
      if (!active || isPollingRef.current) return;
      isPollingRef.current = true;

      try {
        const res = await fetch("/api/customer-order/poll");
        if (res.ok && active) {
          const text = await res.text();
          if (text !== lastPollHash.current) {
            lastPollHash.current = text;
            const orders = JSON.parse(text);

            const now = Date.now();
            const tenMinutesAgo = now - 10 * 60 * 1000;

            for (const order of orders) {
              if (isAutoPrinted(order)) continue;

              const isPrintable = order.status !== "CANCELADO" && order.status !== "ENCERRADO";
              const orderTime = order.createdAt ? new Date(order.createdAt).getTime() : now;
              const isRecent = orderTime > tenMinutesAgo;

              if (isPrintable && isRecent) {
                markAutoPrinted(order);
                console.log(`[GlobalPrint] 🖨️ Novo pedido em segundo plano: ${order.customerName} (#${order.ifoodReference || order.openDeliveryReference || order.id?.slice(-4)}) [${order.source}]`);

                try {
                  const { printOrder } = await import("@/lib/print");

                  const formattedOrder = {
                    id: order.id,
                    dailyOrderNumber: order.dailyOrderNumber || order.orderSeqNumber || "—",
                    customerName: order.customerName || "Cliente",
                    customerPhone: order.customerPhone,
                    customerAddress: order.customerAddress,
                    deliveryType: order.deliveryType || "DELIVERY",
                    deliveryBy: order.deliveryBy || "MERCHANT",
                    paymentMethod: order.paymentMethod || "",
                    items: (order.items || []).map((i: any) => {
                      const { isBeverageItem, isBeverageName } = require("@/lib/beverage");
                      const rawName = i.menuProduct?.name || i.name || "Item";
                      const comboSels = (() => {
                        if (!i.comboSelections) return i.comboSelections;
                        try {
                          const parsed = typeof i.comboSelections === "string" ? JSON.parse(i.comboSelections) : i.comboSelections;
                          if (Array.isArray(parsed)) {
                            const updated = parsed.map((s: any) => {
                              if (s.name && isBeverageName(s.name) && !s.name.includes("BEBIDA")) {
                                return { ...s, name: `${s.name}   [BEBIDA]` };
                              }
                              return s;
                            });
                            return typeof i.comboSelections === "string" ? JSON.stringify(updated) : updated;
                          }
                        } catch {}
                        return i.comboSelections;
                      })();

                      const isStandaloneBev = (!comboSels || (Array.isArray(comboSels) && comboSels.length === 0)) && isBeverageItem(i);
                      const finalName = isStandaloneBev && !rawName.includes("BEBIDA") ? `${rawName}   [BEBIDA]` : rawName;

                      return {
                        name: finalName,
                        qty: i.quantity || i.qty || 1,
                        price: i.price || 0,
                        notes: i.notes || "",
                        comboSelections: comboSels,
                      };
                    }),
                    totalAmount: order.totalAmount || 0,
                    deliveryFee: order.deliveryFee || 0,
                    discountTotal: order.discountTotal,
                    discountIfood: order.discountIfood,
                    discountMerchant: order.discountMerchant,
                    changeAmount: order.changeAmount,
                    ifoodReference: order.ifoodReference,
                    openDeliveryReference: order.openDeliveryReference,
                    source: order.source,
                    notes: order.notes,
                    createdAt: order.createdAt,
                  };

                  const defaultPrinterConfig = {
                    autoprint: true,
                    printers: [{ id: "default", name: "", label: "Padrao", categories: [], copies: 1, paperWidth: "80mm" as const }]
                  };

                  const storeName = (session.user as any)?.storeName || "FIREHUB";
                  const result = await printOrder(formattedOrder as any, storeName, defaultPrinterConfig, {}, false);

                  if (!result.success) {
                    // Fallback para Fila de Impressão na nuvem
                    await fetch("/api/store/print-queue", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        franchiseeId: (session.user as any)?.ownerId || (session.user as any)?.id,
                        order: formattedOrder,
                        storeName,
                        paperWidth: "80mm",
                      }),
                    });
                  }
                } catch (err) {
                  console.warn("[GlobalPrint] Erro na auto-impressão:", err);
                }
              }
            }

            knownOrderIdsRef.current = new Set(orders.map((o: any) => o.id));
          }
        }
      } catch (err) {
        console.warn("[GlobalPrint] Polling error:", err);
      } finally {
        isPollingRef.current = false;
        if (active) setTimeout(pollAndPrint, 3500);
      }
    };

    const timer = setTimeout(pollAndPrint, 1500);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [session]);

  return null;
}
