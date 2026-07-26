"use client";
import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";

const LOCK_PREFIX = "firehub_autoprinted_v4_";

function isOrderPrinted(order: any): boolean {
  if (!order) return true;
  if (typeof window === "undefined") return false;

  const memorySet = (window as any).__FIREHUB_PRINTED_IDS__ as Set<string> | undefined;
  const keys = [order.id, order.ifoodReference, order.openDeliveryReference].filter(Boolean);

  for (const key of keys) {
    if (memorySet && memorySet.has(key)) return true;
    try {
      if (localStorage.getItem(LOCK_PREFIX + key)) return true;
    } catch {}
  }
  return false;
}

function claimOrderPrint(order: any) {
  if (!order) return;
  if (typeof window === "undefined") return;

  if (!(window as any).__FIREHUB_PRINTED_IDS__) {
    (window as any).__FIREHUB_PRINTED_IDS__ = new Set<string>();
  }
  const memorySet = (window as any).__FIREHUB_PRINTED_IDS__ as Set<string>;

  const keys = [order.id, order.ifoodReference, order.openDeliveryReference].filter(Boolean);
  for (const key of keys) {
    memorySet.add(key);
    try {
      localStorage.setItem(LOCK_PREFIX + key, Date.now().toString());
    } catch {}
  }
}

export default function GlobalPrintListener() {
  const { data: session } = useSession();
  const lastPollHash = useRef("");
  const isPollingRef = useRef(false);
  const isFirstPollRef = useRef(true);
  const [printerConfig, setPrinterConfig] = useState<any>(null);

  // Carregar configurações de impressora da loja
  useEffect(() => {
    if (!session?.user) return;
    fetch("/api/store/printer-config")
      .then((res) => res.json())
      .then((data) => {
        if (data && !data.error) setPrinterConfig(data);
      })
      .catch(() => {});
  }, [session]);

  useEffect(() => {
    if (!session?.user) return;
    let active = true;

    // Limpeza de locks antigos no localStorage (> 48 horas)
    try {
      const now = Date.now();
      const cutoff = 48 * 60 * 60 * 1000;
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(LOCK_PREFIX)) {
          const val = Number(localStorage.getItem(k) || 0);
          if (val > 0 && now - val > cutoff) {
            localStorage.removeItem(k);
          }
        }
      }
    } catch {}

    const pollAndPrint = async () => {
      if (!active || isPollingRef.current) return;
      isPollingRef.current = true;

      try {
        if (printerConfig?.autoprint === false) {
          return;
        }

        const res = await fetch("/api/customer-order/poll");
        if (res.ok && active) {
          const text = await res.text();
          if (text !== lastPollHash.current) {
            lastPollHash.current = text;
            const orders = JSON.parse(text);

            const now = Date.now();
            const fiveMinutesAgo = now - 5 * 60 * 1000;

            // NO PRIMEIRA CARGA: Marca TODOS os pedidos existentes como JÁ IMPRESSOS para evitar reimprimir pedidos antigos
            if (isFirstPollRef.current) {
              isFirstPollRef.current = false;
              for (const order of orders) {
                claimOrderPrint(order);
              }
              console.log(`[GlobalPrint Master] 🛑 Todos os ${orders.length} pedidos existentes foram marcados como JÁ IMPRESSOS. Apenas NOVOS pedidos a partir de agora serão impressos!`);
              return;
            }

            for (const order of orders) {
              // Regra estrita: Apenas pedidos no status NOVO criados nos últimos 5 minutos
              const isNewOrder = order.status === "NOVO";
              const orderTime = order.createdAt ? new Date(order.createdAt).getTime() : now;
              const isRecent = orderTime > fiveMinutesAgo;

              if (isNewOrder && isRecent) {
                // ATOMIC CHECK: Se já foi impresso ou reclamado, ignora!
                if (isOrderPrinted(order)) continue;

                // Reivindica atomicamente ANTES de disparar a impressão
                claimOrderPrint(order);

                console.log(
                  `[GlobalPrint Master] 🖨️ Imprimindo NOVO pedido: ${order.customerName} (#${
                    order.ifoodReference || order.openDeliveryReference || order.id?.slice(-4)
                  }) [${order.source}]`
                );

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
                          const parsed =
                            typeof i.comboSelections === "string"
                              ? JSON.parse(i.comboSelections)
                              : i.comboSelections;
                          if (Array.isArray(parsed)) {
                            const updated = parsed.map((s: any) => {
                              if (s.name && isBeverageName(s.name) && !s.name.includes("BEBIDA")) {
                                return {
                                  ...s,
                                  name: `${s.name}   [◄ BEBIDA ►]`
                                };
                              }
                              return s;
                            });
                            return typeof i.comboSelections === "string"
                              ? JSON.stringify(updated)
                              : updated;
                          }
                        } catch {}
                        return i.comboSelections;
                      })();

                      const isStandaloneBev =
                        (!comboSels || (Array.isArray(comboSels) && comboSels.length === 0)) &&
                        isBeverageItem(i);
                      const finalName =
                        isStandaloneBev && !rawName.includes("BEBIDA")
                          ? `${rawName}   [◄ BEBIDA ►]`
                          : rawName;

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

                  const activePrinterConfig = printerConfig || {
                    autoprint: true,
                    printers: [
                      { id: "default", name: "", label: "Padrao", categories: [], copies: 1, paperWidth: "80mm" as const },
                    ],
                  };

                  const storeName = (session.user as any)?.storeName || "FIREHUB";
                  const result = await printOrder(
                    formattedOrder as any,
                    storeName,
                    activePrinterConfig,
                    {},
                    false
                  );

                  if (!result.success) {
                    // Fallback para Fila de Impressão na nuvem
                    await fetch("/api/store/print-queue", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        franchiseeId:
                          (session.user as any)?.ownerId || (session.user as any)?.id,
                        order: formattedOrder,
                        storeName,
                        paperWidth: "80mm",
                      }),
                    });
                  }
                } catch (err) {
                  console.warn("[GlobalPrint Master] Erro ao imprimir:", err);
                }
              }
            }
          }
        }
      } catch (err) {
        console.warn("[GlobalPrint Master] Erro no polling:", err);
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
  }, [session, printerConfig]);

  return null;
}
