"use client";
import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { nomeDoItemParaComanda } from "@/lib/nome-do-item";

const LOCK_PREFIX = "firehub_autoprinted_v4_";

/**
 * A marca de "já imprimi" é SÓ o id do pedido.
 *
 * Ela era também a referência curta da plataforma (o #ABCD do iFood, o índice
 * do dia do 99Food), e a marca vive 48 h neste localStorage. Só que essas
 * referências REPETEM: no banco, em 7 dias, a Ragnar teve o iFood "4743" às
 * 01:02 e de novo às 06:02 do mesmo dia, e a Brasa tem o 99Food "403001" a
 * "403009" TODO DIA. O segundo pedido com a mesma referência era "já impresso"
 * — e a loja via o #30 e o #32 saírem e o #31 nunca. A referência só serve de
 * chave quando o pedido não tem id, o que não acontece com pedido do banco.
 */
function chavesDoPedido(order: any): string[] {
  if (order?.id) return [String(order.id)];
  return [order?.ifoodReference, order?.openDeliveryReference].filter(Boolean).map(String);
}

function isOrderPrinted(order: any): boolean {
  if (!order) return true;
  if (typeof window === "undefined") return false;

  const memorySet = (window as any).__FIREHUB_PRINTED_IDS__ as Set<string> | undefined;
  const keys = chavesDoPedido(order);

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

  for (const key of chavesDoPedido(order)) {
    memorySet.add(key);
    try {
      localStorage.setItem(LOCK_PREFIX + key, Date.now().toString());
    } catch {}
  }
}

/**
 * Desfaz a reivindicação quando a impressão FALHOU.
 *
 * A reivindicação vem antes de imprimir (e precisa vir: é o que impede dois
 * polls de imprimir o mesmo pedido). Mas, se a impressão falha — Assistente
 * fechado, spooler ocupado, impressora religando — a marca ficava e o pedido
 * nunca mais saía, sem aviso nenhum. Solto, ele volta enquanto estiver dentro
 * dos 30 minutos que a tela considera recente.
 *
 * As tentativas são ESPAÇADAS e NÃO ACABAM. Eram três, uma a cada rodada de
 * 5 s: uma impressora religando ou um spooler travado por 15 segundos
 * bastava para o pedido ser dado por impresso para sempre — e o #31 sumia
 * entre o #30 e o #32. Agora a espera dobra a cada falha (15 s, 30 s, 60 s,
 * até 2 min) e continua enquanto o pedido estiver em andamento, mesmo depois
 * dos 30 minutos que a tela considera "recente": impressora desligada não
 * perde pedido, por mais tempo que fique desligada. Quando o Assistente
 * responde `aguardando`, ele assumiu o pedido como pendente (gravado em
 * disco) e insiste sozinho — aí o navegador para de tentar.
 */
const ESPERA_BASE_MS = 15_000;
const ESPERA_MAX_MS = 2 * 60_000;
const tentativasPorPedido = new Map<string, { falhas: number; naoAntesDe: number }>();

/** Ainda em espera depois de uma falha? Então esta rodada não mexe nele. */
function emEsperaDeNovaTentativa(order: any): boolean {
  const t = tentativasPorPedido.get(chavesDoPedido(order)[0] || "");
  return !!t && Date.now() < t.naoAntesDe;
}

function desfazerReivindicacao(order: any) {
  const memorySet = (window as any).__FIREHUB_PRINTED_IDS__ as Set<string> | undefined;
  for (const key of chavesDoPedido(order)) {
    memorySet?.delete(key);
    try {
      localStorage.removeItem(LOCK_PREFIX + key);
    } catch {}
  }
}

function releaseOrderPrint(order: any, contarFalha = true) {
  if (!order || typeof window === "undefined") return;
  const chave = chavesDoPedido(order)[0] || "";
  if (!contarFalha) {
    // Não havia Assistente para tentar: solta sem gastar tentativa, para que
    // o pedido saia assim que ele voltar (o auto-update reinicia o programa).
    desfazerReivindicacao(order);
    return;
  }
  const atual = tentativasPorPedido.get(chave) || { falhas: 0, naoAntesDe: 0 };
  atual.falhas += 1;
  atual.naoAntesDe = Date.now() + Math.min(ESPERA_BASE_MS * 2 ** Math.min(atual.falhas - 1, 10), ESPERA_MAX_MS);
  tentativasPorPedido.set(chave, atual);
  desfazerReivindicacao(order);
  console.warn(`[GlobalPrint Master] Pedido ${chave} não saiu (${atual.falhas}x); nova tentativa em ${Math.round((atual.naoAntesDe - Date.now()) / 1000)} s.`);
}

/** Já falhou antes? Então continua elegível mesmo depois dos 30 minutos. */
function jaFalhouAntes(order: any): boolean {
  return tentativasPorPedido.has(chavesDoPedido(order)[0] || "");
}

export default function GlobalPrintListener() {
  const { data: session } = useSession();
  const lastPollHash = useRef("");
  const isPollingRef = useRef(false);
  const isFirstPollRef = useRef(true);
  const [printerConfig, setPrinterConfig] = useState<any>(null);
  const [configLoaded, setConfigLoaded] = useState(false);

  // Carregar configurações de impressora da loja
  useEffect(() => {
    if (!session?.user) return;
    fetch("/api/store/printer-config")
      .then((res) => res.json())
      .then((data) => {
        if (data && !data.error) setPrinterConfig(data);
      })
      .catch(() => {})
      .finally(() => setConfigLoaded(true));
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
        // Aguarda a config chegar antes de reivindicar qualquer pedido.
        // O efeito reexecuta sozinho quando configLoaded virar true.
        if (!configLoaded) {
          return;
        }

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
            const thirtyMinutesAgo = now - 30 * 60 * 1000;
            const FINAL_STATUSES = ["CANCELADO", "CONCLUIDO", "ENTREGUE", "ENCERRADO", "FINALIZADO"];

            // NA PRIMEIRA CARGA: Marca apenas pedidos antigos (>30min) ou já finalizados como impressos
            if (isFirstPollRef.current) {
              isFirstPollRef.current = false;
              for (const order of orders) {
                const orderTime = order.createdAt ? new Date(order.createdAt).getTime() : now;
                const isFinished = FINAL_STATUSES.includes((order.status || "").toUpperCase());
                const isOld = orderTime < thirtyMinutesAgo || isFinished;
                if (isOld) {
                  claimOrderPrint(order);
                }
              }
              console.log(`[GlobalPrint Master] 🛑 Pedidos antigos/concluídos foram marcados como já impressos. Pedidos recentes serão processados.`);
            }

            for (const order of orders) {
              const statusUpper = (order.status || "").toUpperCase();
              const isFinished = FINAL_STATUSES.includes(statusUpper);
              const orderTime = order.createdAt ? new Date(order.createdAt).getTime() : now;
              // Pedido que já falhou continua na mira até sair ou ser
              // finalizado, por mais velho que fique.
              const isRecent = orderTime > thirtyMinutesAgo || jaFalhouAntes(order);

              if (!isFinished && isRecent) {
                // IGNORAR RASCUNHOS IA (CRIANDO_IA) — Rascunho não deve ser impresso até o pedido ser finalizado pelo cliente!
                if (statusUpper === "CRIANDO_IA" || statusUpper === "AGUARDANDO_PAGAMENTO") continue;

                // ATOMIC CHECK: Se já foi impresso ou reclamado, ignora!
                if (isOrderPrinted(order)) continue;
                // Falhou há pouco: espera o prazo da nova tentativa.
                if (emEsperaDeNovaTentativa(order)) continue;

                // Reivindica atomicamente ANTES de disparar a impressão
                claimOrderPrint(order);

                console.log(
                  `[GlobalPrint Master] 🖨️ Imprimindo NOVO pedido: ${order.customerName} (#${
                    order.ifoodReference || order.openDeliveryReference || order.id?.slice(-4)
                  }) [${order.source}]`
                );

                try {
                  const { printOrder } = await import("@/lib/print");

                  const payStr = (order.paymentMethod || "").toString();
                  const isOfflinePayment = /cobrar|dinheiro|maquin|entrega|pendente|troco/i.test(payStr) || order.isPrepaid === false;

                  const activePrinterConfig = printerConfig || {
                    autoprint: true,
                    printers: [
                      { id: "default", name: "", label: "Padrao", categories: [], copies: 1, paperWidth: "80mm" as const },
                    ],
                  };

                  const formattedOrder = {
                    id: order.id,
                    dailyOrderNumber: order.dailyOrderNumber || order.orderSeqNumber || "—",
                    customerName: order.customerName || "Cliente",
                    customerPhone: order.customerPhone,
                    customerAddress: order.customerAddress,
                    deliveryType: order.deliveryType || "DELIVERY",
                    deliveryBy: order.deliveryBy || "MERCHANT",
                    paymentMethod: payStr,
                    isPrepaid: isOfflinePayment ? false : (order.isPrepaid ?? true),
                    items: (order.items || []).map((i: any) => {
                      const cleanName = nomeDoItemParaComanda(i, i.comboSelections ? "Combo" : "Item");
                      return {
                        name: cleanName,
                        qty: i.quantity || i.qty || 1,
                        price: i.price || 0,
                        notes: i.notes || "",
                        comboSelections: i.comboSelections,
                      };
                    }),
                    totalAmount: order.totalAmount || 0,
                    deliveryFee: order.deliveryFee || 0,
                    discountTotal: order.discountTotal,
                    discountIfood: order.discountIfood,
                    discountMerchant: order.discountMerchant,
                    changeAmount: order.changeAmount,
                    ifoodReference: order.ifoodReference,
                    ifoodPickupCode: order.ifoodPickupCode,
                    // `source` diz de onde o pedido veio, e sem ele o roteamento
                    // não tem como escolher a impressora certa: toda comanda por
                    // este caminho cairia como delivery, inclusive a da mesa. O
                    // campo existia no pedido e só era usado num console.log —
                    // por isso o roteamento por canal (iFood) também nunca valeu
                    // aqui, só na tela de pedidos.
                    source: order.source,
                    // De qual LOJA veio (merchant do iFood, loja do 99Food ou a
                    // própria): a impressora de uma marca filtra por isto.
                    ifoodStoreMerchant: (order as any).ifoodStoreMerchant,
                    food99AppShopId: (order as any).food99AppShopId,
                    food99ShopId: (order as any).food99ShopId,
                    franchiseeId: (order as any).franchiseeId,
                    printerConfig: activePrinterConfig,
                    customBeverageKeywords: activePrinterConfig?.customBeverageKeywords || "",
                    autoBeverageTag: activePrinterConfig?.autoBeverageTag !== false,
                    notes: order.notes,
                    createdAt: order.createdAt,
                  };

                  const storeName = (printerConfig as any)?.storeName || (session.user as any)?.storeName || "FIREHUB";
                  const result = await printOrder(
                    formattedOrder as any,
                    storeName,
                    activePrinterConfig,
                    {},
                    false
                  );

                  if (result.success) {
                    tentativasPorPedido.delete(chavesDoPedido(order)[0] || "");
                  } else if (result.aguardando) {
                    // O Assistente assumiu: o pedido está pendente lá, em
                    // disco, e ele insiste até a impressora responder. A
                    // reivindicação fica, para este navegador não mandar de
                    // novo a cada rodada.
                    tentativasPorPedido.delete(chavesDoPedido(order)[0] || "");
                    console.warn(`[GlobalPrint Master] Pedido ${order.id} pendente no Assistente; ele imprime quando a impressora voltar.`);
                  } else {
                    // Não saiu: solta a reivindicação para tentar de novo, em
                    // vez de dar o pedido por impresso. Com Assistente que
                    // falhou (attempted), conta a tentativa e espera. Sem
                    // Assistente nesta máquina, solta sem contar: ele pode
                    // estar reiniciando (o auto-update faz isso) e o pedido
                    // precisa sair quando ele voltar. As sondas de localhost
                    // ficam em cache em lib/print.ts, então isto não custa
                    // oito chamadas por pedido por rodada.
                    releaseOrderPrint(order, result.attempted);
                    // Fallback para Fila de Impressão na nuvem
                    await fetch("/api/store/print-queue", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        franchiseeId:
                          (session.user as any)?.ownerId || (session.user as any)?.id,
                        order: formattedOrder,
                        storeName,
                        paperWidth:
                          activePrinterConfig?.printers?.[0]?.paperWidth ||
                          activePrinterConfig?.defaultPaperWidth ||
                          "80mm",
                        printerConfig: activePrinterConfig,
                      }),
                    });
                  }
                } catch (err) {
                  releaseOrderPrint(order);
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
        if (active) setTimeout(pollAndPrint, 5000);
      }
    };

    const timer = setTimeout(pollAndPrint, 1500);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [session, printerConfig, configLoaded]);

  return null;
}
