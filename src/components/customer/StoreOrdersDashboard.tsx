"use client";
import React, { useState, useEffect, useRef, useCallback, useMemo, memo } from "react";
import { useRouter } from "next/navigation";
import { isBeverageItem, isBeverageName } from "@/lib/beverage";
import { nomeDoItem, nomeDoItemParaComanda } from "@/lib/nome-do-item";
import { parseComboSelections, safeParseCombo } from "@/lib/parse-combo";
import { Clock, MapPin, Phone, User, ChevronDown, ChevronUp, Search, ShoppingBag, ExternalLink, Settings, Store, Package, Bell, ToggleLeft, ToggleRight, GripVertical, Zap, ZapOff, Timer, CalendarClock, Printer, Copy, MessageCircle, FileText } from "lucide-react";
import RoteirizacaoModal from "@/components/customer/RoteirizacaoModal";
import { getDisplayOrderNumber } from "@/lib/order-sequence";
import { isStoreOpen } from "@/lib/store-hours";

const STATUS_CONFIG: Record<string, { label: string; emoji: string; color: string; bg: string }> = {
  NOVO: { label: "Novos Pedidos", emoji: "🔔", color: "#3B82F6", bg: "#EFF6FF" },
  CRIANDO_IA: { label: "🤖 IA criando pedido...", emoji: "🤖", color: "#7C3AED", bg: "#F3E8FF" },
  ACEITO: { label: "Aceito", emoji: "✅", color: "#10B981", bg: "#ECFDF5" },
  PREPARANDO: { label: "Em Preparo", emoji: "👨‍🍳", color: "#F59E0B", bg: "#FFFBEB" },
  SAIU_ENTREGA: { label: "Em Transporte/Finalizados", emoji: "🛵", color: "#8B5CF6", bg: "#F5F3FF" },
  ENTREGUE: { label: "Entregue", emoji: "📦", color: "#10B981", bg: "#ECFDF5" },
  CANCELADO: { label: "Cancelado", emoji: "❌", color: "#EF4444", bg: "#FEF2F2" },
  ENCERRADO: { label: "Encerrado", emoji: "🔒", color: "#6B7280", bg: "#F3F4F6" },
};

const PAYMENT_LABELS: Record<string, string> = {
  CREDIT: "Crédito (Cobrar na Entrega)",
  CREDITO: "Crédito (Cobrar na Entrega)",
  DEBIT: "Débito (Cobrar na Entrega)",
  DEBITO: "Débito (Cobrar na Entrega)",
  PIX: "Pix",
  CASH: "Dinheiro",
  DINHEIRO: "Dinheiro",
  VOUCHER: "Voucher (Cobrar na Entrega)",
  DIGITAL_WALLET: "iFood App (Pago Online)",
  ONLINE: "Pago Online",
  IFOOD_PAY: "iFood Pay (Pago Online)",
  OTHER: "Pago Online",
  "OTHER (Online)": "iFood App (Pago Online)",
  "other (online)": "iFood App (Pago Online)",
  MEAL_VOUCHER: "Vale Refeição (Cobrar na Entrega)",
  FOOD_VOUCHER: "Vale Alimentação (Cobrar na Entrega)",
  credit_card: "Crédito (Cobrar na Entrega)",
  debit_card: "Débito (Cobrar na Entrega)",
  pix: "Pix",
  cash: "Dinheiro",
  digital_wallet: "iFood App (Pago Online)",
  other: "Pago Online",
};
const translatePayment = (method: string) => PAYMENT_LABELS[method] || PAYMENT_LABELS[method.toUpperCase()] || method;

const cleanAddress = (addr: string | null) => {
  if (!addr) return "";
  return addr.replace(/\s*-\s*null\s*$/gi, "").replace(/\s*-\s*undefined\s*$/gi, "").trim();
};

const cleanAddressForMap = (addr: string | null, city?: string): string => {
  if (!addr) return city || "";
  let clean = cleanAddress(addr).trim();

  // Remove pontos e traços finais desnecessários
  clean = clean.replace(/[\.,\s\-]+$/, "");

  // Separa por traços ou vírgulas
  const parts = clean.split(/[-–—,]/).map(p => p.trim()).filter(Boolean);

  const cleanParts: string[] = [];

  for (const part of parts) {
    // Filtra pontos de referência e complementos que impedem a localização no Google Maps
    if (
      /^(ref|referencia|referência|ponto de ref|ponto de referencia|ponto de referência|comp|complemento|ao lado|proximo|próximo|prox|apto|apt|ap|bloco|bl|qd|lote|lt|fundos|frente|casa\s*\d+)/i.test(part) ||
      /^(ref|referencia|referência|comp|complemento)\s*:/i.test(part) ||
      /^ao lado d/i.test(part) ||
      /^pr[óo]ximo/i.test(part)
    ) {
      continue;
    }

    // Normaliza número (ex: n51, N51, nº 51 -> 51)
    let fixedPart = part.replace(/\bn[ºo]?\s*(\d+)\b/gi, "$1");

    // Expande abreviações comuns para melhorar a precisão no Google Maps
    fixedPart = fixedPart
      .replace(/\bR\.\s*/gi, "Rua ")
      .replace(/\bAv\.\s*/gi, "Avenida ")
      .replace(/\bRes\.\s*/gi, "Residencial ")
      .replace(/\bTv\.\s*/gi, "Travessa ")
      .replace(/\bEst\.\s*/gi, "Estrada ")
      .replace(/\bPq\.\s*/gi, "Parque ");

    if (fixedPart.trim()) {
      cleanParts.push(fixedPart.trim());
    }
  }

  let result = cleanParts.join(", ");

  // Garante que a cidade está no parâmetro de busca se informado
  if (city && !result.toLowerCase().includes(city.toLowerCase())) {
    result += `, ${city}`;
  }

  return result || clean;
};

export interface PartnerDeliveryInfo {
  isPartner: boolean;
  partnerName: string;
  pickupCode?: string;
}

/**
 * Estados que o iFood emite para um entregador DELE, ao longo da corrida.
 *
 * `CONCLUDED` não está aqui de propósito: quem grava esse valor é o próprio
 * FireHub, ao concluir o pedido, e não o iFood ao mover um entregador. Tratá-lo
 * como prova de entrega parceira transformava todo pedido finalizado — inclusive
 * os entregues pelo motoboy da loja — em "Motoboy iFood".
 */
const ESTADOS_DE_ENTREGADOR_IFOOD = new Set([
  "REQUESTED", "ASSIGNED", "GOING_TO_ORIGIN", "ARRIVED_AT_ORIGIN",
  "COLLECTED", "DISPATCHED", "ARRIVED_AT_DESTINATION", "DELIVERED", "FAILED",
]);

export const getPartnerDeliveryInfo = (order: any): PartnerDeliveryInfo => {
  if (!order) return { isPartner: false, partnerName: "" };

  const dBy = (order.deliveryBy || order.deliveredBy || "").toString().toUpperCase().trim();
  const dMode = (order.deliveryMode || "").toString().toUpperCase().trim();
  const src = (order.source || "").toString().toUpperCase().trim();
  const odChannel = (order.openDeliveryChannel || "").toString().toUpperCase().trim();
  const pickupCode = order.ifoodPickupCode || order.openDeliveryPickupCode || undefined;

  // 1. Se explicitamente marcado como entrega própria da loja
  if (dBy === "MERCHANT" || dBy === "LOJA" || dBy === "PROPRIO" || dBy === "MERCHANT_DELIVERY") {
    return { isPartner: false, partnerName: "" };
  }

  // 2. 99Food
  if (src === "99FOOD" || odChannel === "99FOOD" || src.includes("99") || dBy.includes("99")) {
    const is99Partner = (
      dBy === "99FOOD" || dBy === "99_FOOD" || dBy.includes("99") ||
      dBy === "LOGISTICS" || dBy === "PARTNER" || dMode === "LOGISTIC" || dMode === "PARTNER"
      // pickupCode removido daqui pelo mesmo motivo da regra do iFood.
    );
    if (is99Partner) {
      return { isPartner: true, partnerName: "99Food", pickupCode };
    }
  }

  // 3. iFood
  if (src === "IFOOD" || dBy.includes("IFOOD")) {
    const isIfoodPartner = (
      dBy === "IFOOD" || dBy === "IFOOD_LOGISTICS" || dBy === "IFOOD_DELIVERY" || dBy === "LOGISTICS" ||
      dBy.includes("IFOOD") || dBy.includes("LOGISTICS") || dMode === "LOGISTIC" || dMode === "PARTNER" ||
      // ⚠️ `pickupCode` NÃO entra mais nesta conta.
      //
      // O iFood emite código também em ENTREGA PRÓPRIA: é o código que o
      // cliente informa ao entregador para confirmar o recebimento (o painel
      // do iFood chama de "Confirmação de entrega"). Medido em produção em
      // 23/08/2026 na Hakim: 73 dos 80 pedidos do dia tinham código, e 70
      // deles eram entrega da própria loja.
      //
      // Enquanto `deliveryBy` vinha "MERCHANT" a regra 1 blindava esses 70. Mas
      // pedido criado por /api/ifood/rescue-orders nascia sem `deliveryBy`, caía
      // aqui, e o código sozinho o transformava em "entrega parceira". Foi o que
      // aconteceu com o pedido #94 (iFood #8288, Luciana Ribeiro): a tela mandou
      // NÃO enviar motoboy da loja, ninguém entregou, e o cliente cancelou por
      // atraso.
      //
      // Entrega parceira se prova por quem vai entregar — `deliveryBy` explícito
      // ou um entregador do iFood atribuído — nunca pela existência de um código.
      //
      // ⚠️ E "tem status ≠ UNASSIGNED" NÃO prova entregador. O próprio FireHub
      // carimbava `ifoodDriverStatus = "CONCLUDED"` em TODO pedido do iFood ao
      // concluir, inclusive nos entregues pelo motoboy da loja. Resultado: o
      // pedido saía certo com o nome do entregador e, ao virar Finalizado,
      // trocava para "Motoboy iFood" — a tela mandava "não enviar motoboy da
      // loja" num pedido que era da loja, e o entregador que fez a corrida
      // sumia do registro que fecha o pagamento dele. Eram 4.130 pedidos na
      // base quando isto foi medido, em 03/09/2026.
      //
      // Agora só contam os estados que o iFood emite para um entregador DELE.
      // CONCLUDED ficou de fora de propósito: quem carimba é a gente, não eles.
      Boolean(order.ifoodDriverName) || ESTADOS_DE_ENTREGADOR_IFOOD.has(String(order.ifoodDriverStatus || "").toUpperCase())
    );
    if (isIfoodPartner) {
      return { isPartner: true, partnerName: "iFood", pickupCode };
    }
  }

  // 4. JotaJá ou outros canais Open Delivery com logística parceira
  // Mesma correção da regra 3: código de coleta não prova entrega parceira.
  if (dBy === "LOGISTICS" || dBy === "PARTNER" || dMode === "LOGISTIC" || dMode === "PARTNER") {
    const pName = src === "JOTAJA" ? "JotaJá" : (odChannel || src || "Parceiro");
    return { isPartner: true, partnerName: pName, pickupCode };
  }

  return { isPartner: false, partnerName: "" };
};

export const isIfoodMotoboy = (order: any): boolean => {
  return getPartnerDeliveryInfo(order).isPartner;
};

const getItemEffectivePrice = (item: any, allItems: any[] = [], orderTotalAmount: number = 0, deliveryFee: number = 0, discountTotal: number = 0): number => {
  if (item?.price && item.price > 0) return item.price;

  if (item?.comboSelections) {
    const parsed = safeParseCombo(item.comboSelections);
    if (parsed.length > 0) {
      const comboSum = parsed.reduce((acc: number, s: any) => acc + ((s.price || s.unitPrice || s.addition || 0) * (s.quantity || 1)), 0);
      if (comboSum > 0) return comboSum;
    }
  }

  const otherItemsSum = (allItems || []).reduce((sum: number, it: any) => {
    if (it.id === item?.id) return sum;
    return sum + (it.price || 0) * (it.quantity || 1);
  }, 0);

  const expectedSubtotal = (orderTotalAmount || 0) - (deliveryFee || 0) + (discountTotal || 0);
  const diff = expectedSubtotal - otherItemsSum;
  const zeroPriceItems = (allItems || []).filter(it => !it.price || it.price === 0);

  if (zeroPriceItems.length === 1 && diff > 0 && (item?.quantity || 1) > 0) {
    return diff / (item?.quantity || 1);
  }

  return item?.price || 0;
};

const getNeighborhoodOnly = (addr: string | null) => {
  if (!addr) return "";
  const cleaned = cleanAddress(addr).trim();
  if (!cleaned) return "";

  const isIgnoredPart = (str: string) => {
    const s = str.trim().toLowerCase();
    if (!s || s === "brasil" || s === "brazil") return true;
    if (/^\d{5}-?\d{3}$/.test(s) || /^\d{8}$/.test(s)) return true; // CEP
    // Cities & States
    if (/^(rio das ostras|macaé|macae|cabo frio|buzios|búzios|casimiro|casimiro de abreu|niteroi|niterói|rio de janeiro|sp|rj|mg|rs|pr|sc|ba|go|pe|ce|pa|ma|pb|es|am|rn|al|pi|mt|ms|df|ac|ap|ro|rr|se|to)$/i.test(s)) return true;
    // Complement / Reference / Apartment / Lot / Block prefixes
    if (/^(comp|complemento|ref|referencia|ponto de referencia):/i.test(s)) return true;
    if (/^(apto|apt|ap|bloco|bl|quadra|qd|lote|lt)\s*:?\s*\d+[a-z]?$/i.test(s)) return true;
    if (/^casa\s*(:|\d+|fundo|fundos|frente|cima|baixo)/i.test(s)) return true;
    // Standalone numbers or house number notations (e.g. "718", "437", "Nº 718", "No 437", "718A", "S/N", "SN")
    if (/^(n[ºo]?\s*|nº?\s*|num\s*|numero\s*|número\s*)?\d+\s*[-/]?\s*[a-z]?$/i.test(s)) return true;
    if (/^\d+\s*[-/]?\s*\d+$/.test(s)) return true;
    if (/^s\/?n$/i.test(s)) return true;
    return false;
  };

  // Split by hyphens, dashes, or commas
  const parts = cleaned.split(/[-–—,]/).map(p => p.trim()).filter(Boolean);

  // First check if any part explicitly starts with "Bairro" or "B."
  for (const p of parts) {
    if (/^bairro:?\s+/i.test(p)) {
      return p.replace(/^bairro:?\s+/i, "").trim();
    }
  }

  // Filter out country, CEP, city, state, complement, and house numbers
  const candidates = parts.filter(p => {
    if (isIgnoredPart(p)) return false;
    // Skip street name prefixes if starting with street type keywords
    if (/^(rua|r\.|av\.|avenida|alameda|praça|praca|estrada|rodovia|travessa|servidao|servidão|tv\.|vila|v\.)\b/i.test(p)) {
      return false;
    }
    return true;
  });

  if (candidates.length > 0) {
    const neighborhood = candidates[candidates.length - 1];
    return neighborhood.replace(/^bairro:?\s+/i, "").trim();
  }

  // Fallback: If no neighborhood candidate was found (e.g. address is only street and number),
  // filter out house numbers/CEP/city and return the street name
  const nonIgnoredParts = parts.filter(p => !isIgnoredPart(p));
  if (nonIgnoredParts.length > 0) {
    return nonIgnoredParts[0];
  }

  return cleaned;
};

// Mapping columns to statuses for drag-and-drop
const COLUMN_STATUS_MAP: Record<string, string> = {
  "col-novos": "NOVO",
  "col-preparo": "PREPARANDO",
  "col-transporte": "SAIU_ENTREGA",
  "col-finalizado": "ENTREGUE",
  "col-cancelados": "CANCELADO"
};

const DashboardColumn = memo(function DashboardColumn({
  columnId,
  title,
  emoji,
  color,
  count,
  columnOrders,
  dragOverColumn,
  selectedOrderIds,
  onToggleSelectColumn,
  onDragOver,
  onDragLeave,
  onDrop,
  headerExtra,
  headerBelow,
  children,
  isTabActive = true,
}: any) {
  const isOver = dragOverColumn === columnId;
  const canDrop = true;
  const hasOrders = columnOrders && columnOrders.length > 0;
  const isAllSelected = hasOrders && columnOrders.every((o: any) => selectedOrderIds.has(o.id));

  return (
    <div
      data-droppable={columnId}
      onDragOver={canDrop ? onDragOver : undefined}
      onDragLeave={canDrop ? onDragLeave : undefined}
      onDrop={canDrop ? onDrop : undefined}
      className={`dashboard-kanban-column ${!isTabActive ? "is-hidden-tab" : ""}`}
      style={{
        flex: "1 1 0px", minWidth: "180px",
        background: isOver ? "#EFF6FF" : "#F8FAFC",
        borderRadius: "14px",
        border: isOver ? "2.5px dashed #3B82F6" : "1px solid #E2E8F0",
        display: "flex", flexDirection: "column",
        minHeight: "calc(100vh - 175px)", maxHeight: "calc(100vh - 175px)",
        boxShadow: isOver ? "0 0 24px rgba(59, 130, 246, 0.25)" : "0 1px 3px 0 rgba(0,0,0,0.05)",
        transition: "border-color 0.15s ease, background 0.15s ease",
      }}
    >
      <div style={{ padding: "0.75rem 0.85rem", borderBottom: "1px solid #E2E8F0", display: "flex", justifyContent: "space-between", alignItems: "center", background: "#fff", borderRadius: "14px 14px 0 0", gap: "0.35rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", minWidth: 0 }}>
          {hasOrders && (
            <input
              type="checkbox"
              checked={isAllSelected}
              onChange={() => onToggleSelectColumn && onToggleSelectColumn(columnOrders)}
              style={{ width: 16, height: 16, cursor: "pointer", accentColor: "#3B82F6", flexShrink: 0 }}
              title="Selecionar / Desmarcar todos desta coluna"
            />
          )}
          <h3 style={{ fontWeight: 700, fontSize: "0.92rem", margin: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{emoji} {title}</h3>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", flexShrink: 0 }}>
          {headerExtra}
          <span id={columnId === "col-preparo" ? "firehub-em-producao-count-badge" : undefined} data-column-count={count} style={{ background: color, color: "#fff", borderRadius: "20px", padding: "2px 8px", fontSize: "0.78rem", fontWeight: 700, minWidth: "24px", textAlign: "center" }}>{count}</span>
        </div>
      </div>
      {headerBelow}
      <div style={{ flex: 1, overflowY: "auto", overscrollBehaviorY: "contain", padding: "0.6rem" }}>
        {count === 0 ? (
          <div style={{ textAlign: "center", padding: "4rem 0", color: "#94A3B8", fontSize: "0.9rem" }}>
            <Package size={36} style={{ opacity: 0.25, marginBottom: "0.75rem" }} />
            <p>{isOver ? "Solte aqui!" : "Nenhum pedido"}</p>
          </div>
        ) : children}
        {count > 0 && isOver && (
          <div style={{ textAlign: "center", padding: "1rem", color: "#3B82F6", fontWeight: 700, fontSize: "0.85rem", border: "2px dashed #93C5FD", borderRadius: "10px", margin: "0.5rem 0" }}>
            ↓ Solte aqui para mover ↓
          </div>
        )}
      </div>
    </div>
  );
});

const DashboardOrderCard = memo(function DashboardOrderCard({
  order,
  expanded,
  isLoading,
  isDragging,
  now,
  seqNum,
  timeAlertConfig,
  selectedOrderIds,
  motoboys,
  assigningId,
  onToggleSelectOrder,
  onToggleExpand,
  onUpdateStatus,
  onConfirmarPagamento,
  onAssignMotoboy,
  onOpenCancelModal,
  onOpenPrintModal,
  onOpenReceiptModal,
  onOpenDeliveryModal,
  onFetchIfoodDriverQuote,
  onDragStart,
  onDragEnd,
  setOrders,
}: any) {
  const st = STATUS_CONFIG[order.status] || STATUS_CONFIG.NOVO;
  const elapsedMs = now.getTime() - new Date(order.createdAt).getTime();
  const elapsedMins = Math.max(0, Math.floor(elapsedMs / 60000));

  const isFinished = order.status === "ENTREGUE" || order.status === "CANCELADO" || order.status === "ENCERRADO";
  const createdTime = new Date(order.createdAt).getTime();
  const rawSchedTime = order.scheduledDatetime ? new Date(order.scheduledDatetime).getTime() : 0;
  // Um agendamento verdadeiro de data futura deve ser superior ao horário de criação (+ 2 min)
  const isRealScheduled = rawSchedTime > createdTime + 2 * 60000;

  const isTakeoutOrder =
    order.deliveryType === "RETIRADA" ||
    order.deliveryType === "TAKEOUT" ||
    String(order.deliveryType || "").toUpperCase().includes("RETIRADA") ||
    String(order.notes || "").toUpperCase().includes("RETIRADA");

  const defaultMinutes = isTakeoutOrder ? 40 : 45;

  const deadline = isRealScheduled
    ? new Date(order.scheduledDatetime)
    : new Date(createdTime + defaultMinutes * 60000);
  const remainingMs = deadline ? deadline.getTime() - now.getTime() : null;
  const remainingMins = remainingMs !== null ? Math.floor(remainingMs / 60000) : null;

  const isInProduction = order.status === "ACEITO" || order.status === "PREPARANDO";
  const redActive = timeAlertConfig?.redEnabled && Number(timeAlertConfig.redMinutes) > 0;
  const yellowActive = timeAlertConfig?.yellowEnabled && Number(timeAlertConfig.yellowMinutes) > 0;
  const redThreshold = redActive ? Number(timeAlertConfig.redMinutes) : null;
  const yellowThreshold = yellowActive ? Number(timeAlertConfig.yellowMinutes) : null;

  let isRedAlert = false;
  let isYellowAlert = false;

  if (isInProduction && remainingMins !== null) {
    if (redThreshold !== null && remainingMins <= redThreshold) {
      isRedAlert = true;
    } else if (yellowThreshold !== null && remainingMins <= yellowThreshold) {
      isYellowAlert = true;
    }
  }

  const isLate = !isFinished && remainingMins !== null && remainingMins < 0;
  const isUrgent = !isFinished && remainingMins !== null && remainingMins <= 5 && remainingMins >= 0;

  const timerLabel = isFinished
    ? (elapsedMins < 60 ? `${elapsedMins}min` : `${Math.floor(elapsedMins / 60)}h${elapsedMins % 60}min`)
    : remainingMins !== null
      ? (isLate ? `⚠️ -${Math.abs(remainingMins)}min atrasado` : `⏱️ ${remainingMins}min restante${remainingMins !== 1 ? "s" : ""}`)
      : (elapsedMins < 60 ? `${elapsedMins}min` : `${Math.floor(elapsedMins / 60)}h${elapsedMins % 60}min`);
  const timerColor = isLate ? "#EF4444" : isUrgent ? "#F59E0B" : "#64748B";

  const canDrag = order.status !== "CANCELADO" && order.status !== "ENTREGUE" && order.status !== "ENCERRADO";

  const isAiCreating = order.status === "CRIANDO_IA";
  const cardBackground = isDragging
    ? "#DBEAFE"
    : isAiCreating
      ? "#FAF5FF"
      : isRedAlert
        ? "#FEF2F2"
        : isYellowAlert
          ? "#FFFBEB"
          : "#fff";

  const cardBorder = isDragging
    ? "2.5px solid #2563EB"
    : isAiCreating
      ? "2px dashed #A855F7"
      : isRedAlert
        ? "2.5px solid #EF4444"
        : isYellowAlert
          ? "2.5px solid #F59E0B"
          : isLate
            ? "1.5px solid #EF4444"
            : isUrgent
              ? "1.5px solid #F59E0B"
              : "1px solid #E2E8F0";

  const cardBoxShadow = isDragging
    ? "0 20px 40px -4px rgba(37, 99, 235, 0.45), 0 0 0 5px rgba(59, 130, 246, 0.2)"
    : isRedAlert
      ? "0 0 16px rgba(239, 68, 68, 0.45), 0 2px 8px rgba(239, 68, 68, 0.2)"
      : isYellowAlert
        ? "0 0 16px rgba(245, 158, 11, 0.45), 0 2px 8px rgba(245, 158, 11, 0.2)"
        : "0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03)";

  return (
    <div
      draggable={canDrag}
      onDragStart={canDrag ? (e => onDragStart && onDragStart(e, order.id)) : undefined}
      onDragEnd={canDrag ? onDragEnd : undefined}
      onClick={() => onToggleExpand && onToggleExpand(order.id)}
      style={{
        background: cardBackground,
        borderRadius: "14px",
        border: cardBorder,
        marginBottom: "0.75rem",
        overflow: "hidden",
        boxShadow: cardBoxShadow,
        transform: isDragging ? "scale(1.05) rotate(-1.5deg)" : undefined,
        transition: isDragging ? "transform 0.15s ease, box-shadow 0.15s ease" : "box-shadow 0.15s ease, border-color 0.15s ease, background 0.15s ease",
        cursor: canDrag ? (isDragging ? "grabbing" : "grab") : "default",
        userSelect: "none",
        opacity: isDragging ? 0.92 : 1,
      }}
    >
      <div style={{ padding: "0.6rem 0.75rem" }}>
        {/* Header Row com Checkbox, Drag Handle, Nome e Badge do Canal */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: "6px", marginBottom: "4px" }}>
          <input
            type="checkbox"
            checked={selectedOrderIds?.has(order.id) || false}
            onChange={(e) => { e.stopPropagation(); onToggleSelectOrder && onToggleSelectOrder(order.id); }}
            style={{ width: 17, height: 17, cursor: "pointer", accentColor: "#3B82F6", flexShrink: 0, marginTop: "2px" }}
            title="Selecionar pedido"
          />
          {canDrag && (
            <div style={{ color: "#CBD5E1", cursor: "grab", display: "flex", flexShrink: 0, marginTop: "3px" }} onClick={e => e.stopPropagation()}>
              <GripVertical size={14} />
            </div>
          )}
          <div style={{
            fontWeight: 800,
            fontSize: (order.customerName || "").length > 25 ? "0.80rem" : (order.customerName || "").length > 15 ? "0.86rem" : "0.95rem",
            color: "#0F172A",
            flex: 1,
            minWidth: "120px",
            wordBreak: "keep-all",
            overflowWrap: "normal",
            lineHeight: "1.25",
            letterSpacing: "-0.2px"
          }}>
            #{seqNum} — {order.customerName}
          </div>
          {/* Coluna, não linha: o selo do canal em cima e o da loja iFood
              embaixo. Lado a lado, os dois juntos não cabiam na largura da
              coluna do quadro e o nome saía cortado ("Ragnar Burge") — e com
              `flexShrink: 0` não havia largura de tela que resolvesse, porque o
              bloco simplesmente não encolhia. */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "3px", flexShrink: 0, minWidth: 0, marginTop: "1px" }}>
            {/* Brendi ganha roxo (violeta #EDE9FE/#6D28D9) — tom diferente do
                lilás da IA (#F3E8FF/#7C3AED) de propósito: os dois convivem na
                mesma tela e o atendente distingue o canal pela cor.

                O totem caía no default verde "Online", igual ao pedido do site.
                Só que "Online" aqui quer dizer "cliente em casa esperando
                entrega" — e o do totem é o cliente de pé no balcão, com senha na
                mão, esperando ser chamado. O selo errado fazia a equipe tratar
                como delivery quem estava a dois metros do caixa. Ciano por ser a
                única faixa ainda livre entre os canais. */}
            <span style={{
              padding: "2px 7px", borderRadius: "6px", fontSize: "0.68rem", fontWeight: 800, letterSpacing: "0.02em",
              background: order.status === "CRIANDO_IA" || order.source === "WHATSAPP_IA" ? "#F3E8FF" : order.source === "IFOOD" ? "#FEE2E2" : order.source === "BRENDI" ? "#EDE9FE" : order.source === "JOTAJA" ? "#DBEAFE" : order.source === "PDV" ? "#E0E7FF" : order.source === "TOTEM" ? "#CFFAFE" : "#DCFCE7",
              color: order.status === "CRIANDO_IA" || order.source === "WHATSAPP_IA" ? "#7C3AED" : order.source === "IFOOD" ? "#DC2626" : order.source === "BRENDI" ? "#6D28D9" : order.source === "JOTAJA" ? "#1D4ED8" : order.source === "PDV" ? "#4338CA" : order.source === "TOTEM" ? "#0E7490" : "#15803D"
            }}>
              {order.status === "CRIANDO_IA"
                ? "🤖 IA criando..."
                : order.source === "WHATSAPP_IA"
                ? "🤖 IA Whats"
                : order.source === "IFOOD"
                ? `iFood #${order.ifoodReference || ""}`
                : order.source === "BRENDI"
                ? `Brendi #${order.openDeliveryReference || ""}`
                : order.source === "JOTAJA"
                ? `Jotajá #${order.openDeliveryReference || ""}`
                : order.source === "PDV"
                ? "PDV"
                : order.source === "TOTEM"
                ? "🖥️ Totem"
                : "Online"}
            </span>

            {/* DE QUAL loja iFood veio, logo abaixo do selo.
                Só aparece quando a conta tem mais de uma loja conectada — numa
                loja só seria ruído repetido em todo pedido. Sem isto, três
                marcas caem no mesmo painel indistinguíveis: o dono olhou um
                pedido da Ragnar Pizza que tinha acabado de entrar e concluiu
                que não tinha entrado. */}
            {order.source === "IFOOD" && (order as any).ifoodStoreName && (
              <span style={{
                padding: "2px 7px", borderRadius: "6px", fontSize: "0.68rem", fontWeight: 800,
                background: "#FFF7ED", color: "#C2410C", border: "1px solid #FED7AA",
                // Nome de loja não pode sair cortado: se não couber numa linha,
                // quebra em duas. Cortar é pior que ocupar mais altura — o
                // atendente precisa saber em qual saco vai o pedido.
                maxWidth: "100%", whiteSpace: "normal", wordBreak: "break-word",
                textAlign: "right", lineHeight: 1.25,
              }}>
                🏪 {(order as any).ifoodStoreName}
              </span>
            )}
          </div>
        </div>

        {/* Conteúdo Principal — Telefone + Data + Timer */}
        <div style={{ fontSize: "0.82rem", lineHeight: "1.4" }}>
          {/* Telefone e cronômetro dividiam a linha, e só o telefone encolhia:
              `flex: 1` + `minWidth: 0` + ellipsis contra um cronômetro com
              `flexShrink: 0`. Em tela estreita sobravam 57px para um número que
              precisa de 106 — virava "📞 +55 …", e telefone pela metade não
              serve para nada: ninguém liga para meio número.

              Agora a LINHA quebra em vez de o número encolher. O `nowrap` fica
              (número não pode partir no meio dos dígitos), mas com
              `minWidth: fit-content` ele não cede espaço — quem desce para a
              linha de baixo é o cronômetro. */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", flexWrap: "wrap", color: "#64748B", fontSize: "0.75rem", marginBottom: "4px" }}>
            <span style={{ whiteSpace: "nowrap", minWidth: "fit-content", flex: "1 1 auto", fontWeight: 500 }}>
              📞 {order.customerPhone || "—"}
            </span>
            <span style={{ flexShrink: 0, fontSize: "0.74rem", fontWeight: 600, color: "#475569" }}>
              🕒 {new Date(order.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
              <span style={{ margin: "0 4px", color: "#CBD5E1" }}>|</span>
              <span style={{ fontWeight: isLate || isUrgent ? 800 : 700, color: timerColor }}>
                {timerLabel}
              </span>
            </span>
          </div>

          {/* Badge Pronto Cozinha / Botão Marcar como Pronto Cozinha */}
          {order.kdsStage === "FINISHED" || order.kdsStage === "READY" ? (
            <div style={{ marginBottom: "4px" }}>
              <span style={{ padding: "2px 8px", borderRadius: "6px", fontSize: "0.68rem", fontWeight: 700, background: "#DCFCE7", color: "#15803D", display: "inline-block", border: "1px solid #86EFAC" }}>
                ✅ Pronto Cozinha
              </span>
            </div>
          ) : order.status !== "CANCELADO" && order.status !== "ENCERRADO" && order.status !== "AGUARDANDO_PAGAMENTO" ? (
            // Sem AGUARDANDO_PAGAMENTO: esse pedido ainda não tem kdsStage nem
            // comanda na cozinha, então "Pronto Cozinha" prometeria um preparo
            // que não começou. A única ação possível aqui é confirmar o
            // pagamento, e ela está na barra de ações abaixo.
            <div style={{ marginBottom: "4px" }}>
              <button
                onClick={async (e) => {
                  e.stopPropagation();
                  try {
                    const res = await fetch("/api/kds", {
                      method: "PUT",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ orderId: order.id, action: "finish_order" }),
                    });
                    if (res.ok) {
                      setOrders((prev: any[]) => prev.map((o: any) => o.id === order.id ? { ...o, kdsStage: "FINISHED" } : o));
                    } else {
                      const d = await res.json();
                      alert("❌ " + (d.error || "Erro ao atualizar"));
                    }
                  } catch {
                    alert("❌ Erro ao conectar.");
                  }
                }}
                style={{
                  padding: "2px 8px",
                  borderRadius: "6px",
                  fontSize: "0.68rem",
                  fontWeight: 800,
                  background: "#FEF3C7",
                  color: "#B45309",
                  border: "1.5px solid #FCD34D",
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  fontFamily: "inherit",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.05)"
                }}
                title="Clique para marcar este pedido como pronto na cozinha"
              >
                👨‍🍳 Marcar como Pronto Cozinha
              </button>
            </div>
          ) : null}

          {/* Endereço Resumido (Bairro) em caixa verde */}
          {order.customerAddress && (
            <div style={{
              color: "#065F46", fontWeight: 700, fontSize: "0.82rem",
              background: "#ECFDF5", border: "1px solid #A7F3D0",
              padding: "4px 10px", borderRadius: "8px", margin: "4px 0",
              lineHeight: "1.3", wordBreak: "break-word"
            }}>
              📍 {getNeighborhoodOnly(order.customerAddress) || cleanAddress(order.customerAddress)}
            </div>
          )}
          {(order.deliveryType === "RETIRADA" || order.deliveryType === "TAKEOUT" || order.deliveryType === "PICKUP") && (
            <div style={{
              color: "#92400E", fontWeight: 700, fontSize: "0.8rem",
              background: "#FEF3C7", border: "1px solid #FCD34D",
              padding: "5px 10px", borderRadius: "8px", margin: "5px 0"
            }}>
              🏪 Retirada no local
            </div>
          )}
          {order.deliveryType === "MESA" && (
            <div style={{
              color: "#5B21B6", fontWeight: 800, fontSize: "0.8rem",
              background: "#F5F3FF", border: "1px solid #DDD6FE",
              padding: "5px 10px", borderRadius: "8px", margin: "5px 0"
            }}>
              🍽️ {order.customerAddress || "Mesa"}
            </div>
          )}
          {/* O cliente do totem está no balcão AGORA, com a senha na mão, e a
              tela dele prometeu que a cozinha só começa depois do caixa
              confirmar. Sem esta faixa o card fica igual a qualquer outro e o
              atendente não sabe que é ele quem precisa agir. */}
          {order.status === "AGUARDANDO_PAGAMENTO" && (
            <div style={{
              color: "#155E75", fontWeight: 800, fontSize: "0.8rem",
              background: "#ECFEFF", border: "1.5px solid #67E8F9",
              padding: "5px 10px", borderRadius: "8px", margin: "5px 0", lineHeight: 1.35
            }}>
              💰 Aguardando pagamento no balcão — a cozinha só recebe depois de confirmar
            </div>
          )}

          {/* Total + Forma de Pagamento */}
          <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "5px", flexWrap: "wrap" }}>
            <span style={{ fontWeight: 800, fontSize: "0.95rem", color: "#0F172A", flexShrink: 0 }}>
              R$ {order.totalAmount?.toFixed(2).replace('.', ',')}
            </span>
            <span style={{ color: "#CBD5E1", flexShrink: 0 }}>—</span>
            <span
              style={{
                fontWeight: 700,
                fontSize: "0.82rem",
                color: "#334155",
                whiteSpace: "normal",
                wordBreak: "break-word",
                lineHeight: "1.25",
              }}
              title={order.paymentMethod ? translatePayment(order.paymentMethod) : "—"}
            >
              {order.paymentMethod ? translatePayment(order.paymentMethod) : "—"}
            </span>
            {order.changeAmount != null && order.changeAmount > 0 && (
              <span style={{
                fontSize: "0.72rem",
                fontWeight: 700,
                color: "#92400E",
                background: "#FEF3C7",
                border: "1px solid #FCD34D",
                padding: "2px 8px",
                borderRadius: "6px",
                whiteSpace: "nowrap",
                display: "inline-flex",
                alignItems: "center",
                gap: "4px"
              }}>
                💵 Troco p/ R$ {Number(order.changeAmount).toFixed(2).replace('.', ',')}
              </span>
            )}
          </div>

          {/* Banner de Alerta para Entrega Parceira (iFood / 99Food / Parceiros) */}
          {(() => {
            const pInfo = getPartnerDeliveryInfo(order);
            if (!pInfo.isPartner) return null;
            return (
              <div style={{
                marginTop: "6px", padding: "6px 10px", borderRadius: "8px",
                background: "#FEF2F2", border: "1.5px solid #FCA5A5",
                color: "#DC2626", fontWeight: 800, fontSize: "0.75rem",
                display: "flex", flexDirection: "column", gap: "4px"
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span>🛵</span>
                  <span>ENTREGA PARCEIRA {pInfo.partnerName.toUpperCase()} — Entregador da {pInfo.partnerName} (Não enviar motoboy da loja!)</span>
                </div>
                {pInfo.pickupCode && (
                  <div style={{
                    marginTop: "2px", padding: "5px 10px", borderRadius: "6px",
                    background: "#FFF", border: "2px dashed #7C3AED",
                    color: "#581C87", fontWeight: 800, fontSize: "0.85rem",
                    display: "flex", flexDirection: "column", alignItems: "center", gap: "2px"
                  }}>
                    <span>🔑 CÓDIGO DE COLETA P/ ENTREGADOR {pInfo.partnerName.toUpperCase()}:</span>
                    <span style={{ fontSize: "1.1rem", color: "#7C3AED", fontWeight: 900, letterSpacing: "0.5px", background: "#F3E8FF", padding: "1px 8px", borderRadius: "4px" }}>
                      #{pInfo.pickupCode}
                    </span>
                  </div>
                )}
              </div>
            );
          })()}
        </div>

        {/* Action Bar (Botões + Motoboy Dropdown Inline + WhatsApp + Print + Receipt) */}
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap",
          marginTop: "8px", paddingTop: "8px", borderTop: "1px solid #E2E8F0",
          gap: "6px"
        }}>
          {/* Left: Status action button + motoboy select */}
          <div style={{ display: "flex", alignItems: "center", gap: "6px", flex: "1 1 140px", minWidth: 0, flexWrap: "wrap" }}>
            {/* O pedido de "Pagar no caixa" morria aqui: ele existia no banco,
                o cliente entregava o dinheiro no balcão e não havia botão
                nenhum em tela nenhuma que carimbasse o pagamento. Este é o
                chamador que faltava para /api/store/orders/confirmar-pagamento
                — a mesma `confirmOrderPayment` do webhook do gateway, para os
                dois caminhos não divergirem no caixa. */}
            {order.status === "AGUARDANDO_PAGAMENTO" && (
              <button
                disabled={isLoading}
                onClick={e => { e.stopPropagation(); onConfirmarPagamento && onConfirmarPagamento(order); }}
                style={{ padding: "5px 12px", borderRadius: "6px", border: "none", background: "#0891B2", color: "#fff", fontWeight: 800, cursor: "pointer", fontSize: "0.75rem", fontFamily: "inherit", whiteSpace: "nowrap" }}
                title="O cliente pagou no balcão — liberar o pedido para a cozinha"
              >
                💵 Recebi o pagamento
              </button>
            )}
            {order.status === "NOVO" && (
              <button disabled={isLoading} onClick={e => { e.stopPropagation(); onUpdateStatus && onUpdateStatus(order.id, "ACEITO"); }} style={{ padding: "4px 12px", borderRadius: "6px", border: "none", background: "#059669", color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: "0.75rem", fontFamily: "inherit", whiteSpace: "nowrap" }}>✅ Aceitar</button>
            )}
            {(order.status === "ACEITO" || order.status === "PREPARANDO") && order.deliveryType === "DELIVERY" && (
              <button disabled={isLoading} onClick={e => { e.stopPropagation(); onUpdateStatus && onUpdateStatus(order.id, "SAIU_ENTREGA"); }} style={{ padding: "4px 12px", borderRadius: "6px", border: "none", background: "#7C3AED", color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: "0.75rem", fontFamily: "inherit", whiteSpace: "nowrap" }}>🛵 Saiu</button>
            )}
            {(order.status === "ACEITO" || order.status === "PREPARANDO") && order.deliveryType !== "DELIVERY" && (
              <button disabled={isLoading} onClick={e => { e.stopPropagation(); onUpdateStatus && onUpdateStatus(order.id, "ENTREGUE"); }} style={{ padding: "4px 12px", borderRadius: "6px", border: "none", background: "#059669", color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: "0.75rem", fontFamily: "inherit", whiteSpace: "nowrap" }}>✅ Pronto</button>
            )}
            {order.status === "SAIU_ENTREGA" && (
              <button disabled={isLoading} onClick={e => { e.stopPropagation(); onUpdateStatus && onUpdateStatus(order.id, "ENTREGUE"); }} style={{ padding: "4px 12px", borderRadius: "6px", border: "none", background: "#059669", color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: "0.75rem", fontFamily: "inherit", whiteSpace: "nowrap" }}>📦 Entregue</button>
            )}
            {order.status === "PRONTO" && (
              <button disabled={isLoading} onClick={e => { e.stopPropagation(); onUpdateStatus && onUpdateStatus(order.id, "ENTREGUE"); }} style={{ padding: "4px 12px", borderRadius: "6px", border: "none", background: "#059669", color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: "0.75rem", fontFamily: "inherit", whiteSpace: "nowrap" }}>🤝 Entregue</button>
            )}
            {order.status === "ENTREGUE" && (
              <span style={{ padding: "3px 10px", borderRadius: "5px", background: "#059669", color: "#fff", fontSize: "0.72rem", fontWeight: 700 }}>
                Entregue
              </span>
            )}
            {order.status === "CANCELADO" && (
              <span style={{ padding: "3px 10px", borderRadius: "5px", background: "#DC2626", color: "#fff", fontSize: "0.72rem", fontWeight: 700 }}>Cancelado</span>
            )}
            {order.status === "ENCERRADO" && (
              <span style={{ padding: "3px 10px", borderRadius: "5px", background: "#6B7280", color: "#fff", fontSize: "0.72rem", fontWeight: 700 }}>Encerrado</span>
            )}

            {/* Motoboy select / Partner Motoboy Badge */}
            {/* TAKEOUT saiu da lista de quem recebe motoboy e entrou na de
                exclusões, ao lado de RETIRADA/BALCAO/MESA — que é o que ele
                sempre foi. Todo canal normaliza TAKEOUT para "RETIRADA" ao
                gravar; o único que grava "TAKEOUT" cru é o totem, então esta
                cláusula na prática só disparava para pedido de balcão: dava para
                despachar com entregador um cliente que estava de pé na loja
                esperando a senha. E atribuir motoboy dispara WhatsApp com
                "Endereço não informado" e, pelo paymentMethod "Cartão
                (Maquininha)", ainda manda o entregador levar maquininha para um
                pedido já pago no totem — cobrança em dobro. O resto do arquivo
                já tratava TAKEOUT como retirada (faixa "🏪 Retirada no local",
                botão de rota, filtro de canal); só esta linha divergia. */}
            {(order.deliveryType === "DELIVERY" || order.deliveryType === "ENTREGA" || !order.deliveryType || order.source === "IFOOD" || order.source === "99FOOD") && order.deliveryType !== "RETIRADA" && order.deliveryType !== "TAKEOUT" && order.deliveryType !== "BALCAO" && order.deliveryType !== "MESA" && (() => {
              const pInfo = getPartnerDeliveryInfo(order);
              return pInfo.isPartner ? (
                <select
                  onClick={e => e.stopPropagation()}
                  onChange={async (e) => {
                    if (!e.target.value) return;
                    await onAssignMotoboy && onAssignMotoboy(order.id, e.target.value);
                  }}
                  style={{
                    padding: "4px 8px", borderRadius: "6px", border: "2px solid #EF4444",
                    fontSize: "0.75rem", fontWeight: 800, color: "#DC2626",
                    background: "#FEF2F2", fontFamily: "inherit",
                    // `maxWidth: 140px` cortava justamente o texto que mais
                    // importa aqui: "🛵 Motoboy 99Food" aparecia como
                    // "🛵 Motoboy 99F…", e a loja não conseguia ler de qual
                    // parceiro é a entrega. `<select>` corta o texto em vez de
                    // quebrar, então largura fixa é sempre aposta contra o
                    // conteúdo — e o nome do parceiro muda (iFood, 99Food).
                    //
                    // `fit-content` no minWidth é o que resolve de verdade: o
                    // item não encolhe abaixo do próprio texto, então o flex
                    // container QUEBRA A LINHA em vez de espremer. Em tela
                    // larga ele cresce; em tela estreita vai para a linha de
                    // baixo inteiro. Nunca cortado.
                    cursor: "pointer", flex: "1 1 auto", minWidth: "fit-content", maxWidth: "100%",
                    boxShadow: "0 0 0 1px #FCA5A5"
                  }}
                  title={`O sistema detectou como Entrega Parceira ${pInfo.partnerName}. Você pode alterar se estiver incorreto.`}
                >
                  <option value="">🛵 Motoboy {pInfo.partnerName}</option>
                  {motoboys?.map((m: any) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              ) : (
                <select
                  value={order.motoboyId || (order as any).motoboy?.id || ""}
                  onChange={e => { e.stopPropagation(); onAssignMotoboy && onAssignMotoboy(order.id, e.target.value); }}
                  disabled={assigningId === order.id}
                  onClick={e => e.stopPropagation()}
                  style={{
                    padding: "4px 8px", borderRadius: "6px",
                    border: (order.status === "CANCELADO" || order.status === "CANCELED") && (order.motoboyId || (order as any).motoboy?.id) ? "2px solid #EF4444" : (order.motoboyId ? "1.5px solid #059669" : "1.5px solid #94A3B8"),
                    fontSize: "0.78rem", fontWeight: 700,
                    color: (order.status === "CANCELADO" || order.status === "CANCELED") && (order.motoboyId || (order as any).motoboy?.id) ? "#991B1B" : (order.motoboyId ? "#047857" : "#1E293B"),
                    background: (order.status === "CANCELADO" || order.status === "CANCELED") && (order.motoboyId || (order as any).motoboy?.id) ? "#FEE2E2" : (order.motoboyId ? "#ECFDF5" : "#F8FAFC"),
                    fontFamily: "inherit",
                    // Mesmo motivo do seletor de parceiro acima: nome de motoboy
                    // não tem tamanho previsível, e `<select>` corta em vez de
                    // quebrar. Cresce com a tela, quebra a linha quando não cabe.
                    cursor: "pointer", flex: "1 1 auto", minWidth: "fit-content", maxWidth: "100%"
                  }}
                  title={(order.status === "CANCELADO" || order.status === "CANCELED") && (order.motoboyId || (order as any).motoboy?.id) ? "Pedido CANCELADO com Motoboy atribuído" : "Atribuir Motoboy da Loja"}
                >
                  <option value="">Motoboy</option>
                  {motoboys?.map((m: any) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                  {/* O motoboy ATRIBUÍDO aparece mesmo se foi desativado depois:
                      sem isto o select mostrava borda verde de "atribuído" com o
                      rótulo vazio "Motoboy", e a loja não via QUEM está com o
                      pedido — justamente o caso em que mais precisa ver. */}
                  {(order.motoboyId || (order as any).motoboy?.id) &&
                    !motoboys?.some((m: any) => m.id === (order.motoboyId || (order as any).motoboy?.id)) &&
                    (order as any).motoboy?.name && (
                    <option value={order.motoboyId || (order as any).motoboy?.id}>
                      {(order as any).motoboy.name} (inativo)
                    </option>
                  )}
                </select>
              );
            })()}

            {/* "puxou 19:42": o ENTREGADOR pegou este pedido pelo app (QR ou
                número) — em oposição a "a loja atribuiu". É a testemunha
                quando dois entregadores discutem quem levou. */}
            {(order as any).motoboyPuxadoEm && order.motoboyId && (
              <span
                title="O entregador puxou este pedido pelo app"
                style={{
                  fontSize: "0.68rem", fontWeight: 800, padding: "2px 7px", borderRadius: 6,
                  background: "#ECFDF5", color: "#047857", border: "1px solid #A7F3D0",
                  whiteSpace: "nowrap",
                }}
              >
                🛵 puxou {new Date((order as any).motoboyPuxadoEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
          </div>

          {/* Right: Icon buttons */}
          <div style={{ display: "flex", alignItems: "center", gap: "4px", flexShrink: 0, flexWrap: "wrap", maxWidth: "100%" }}>
            {/* WhatsApp */}
            {order.customerPhone && order.source !== "IFOOD" && !order.customerPhone.startsWith("0800") && (() => {
              const rawDigits = (order.customerPhone || "").replace(/\s*ID:\s*\d+/i, "").replace(/\D/g, "");
              const waPhone = rawDigits.startsWith("55") ? rawDigits : `55${rawDigits}`;
              return (
                <a
                  href={`https://wa.me/${waPhone}`}
                  target="_blank" rel="noopener noreferrer"
                  onClick={e => e.stopPropagation()}
                  title="WhatsApp do Cliente"
                  style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, borderRadius: "6px", background: "#059669", color: "#fff", textDecoration: "none" }}
                >
                  <MessageCircle size={15} />
                </a>
              );
            })()}

            {/* Print */}
            <button
              onClick={e => {
                e.stopPropagation();
                onOpenPrintModal && onOpenPrintModal(order.id);
              }}
              title="Imprimir"
              style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, borderRadius: "6px", background: "#3B82F6", color: "#fff", border: "none", cursor: "pointer" }}
            >
              <Printer size={15} />
            </button>

            {/* View Receipt Modal */}
            <button
              onClick={e => {
                e.stopPropagation();
                onOpenReceiptModal && onOpenReceiptModal(order.id);
              }}
              title="Ver pedido"
              style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, borderRadius: "6px", background: "#6366F1", color: "#fff", border: "none", cursor: "pointer" }}
            >
              <FileText size={15} />
            </button>

            {/* Delivery Info & Route Map Modal Button */}
            {order.deliveryType !== "TAKEOUT" && order.deliveryType !== "RETIRADA" && order.deliveryType !== "BALCAO" && order.deliveryType !== "MESA" && (
              <button
                onClick={e => {
                  e.stopPropagation();
                  onOpenDeliveryModal && onOpenDeliveryModal(order);
                }}
                title="Informações da Entrega e Rota no Mapa"
                style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, borderRadius: "6px", background: "#8B5CF6", color: "#fff", border: "none", cursor: "pointer", fontSize: "0.9rem" }}
              >
                🛵
              </button>
            )}
          </div>
        </div>
      </div>

      {/* EXPANDED DETAILS */}
      {expanded && (
        <div style={{ padding: "0 0.75rem 0.75rem", borderTop: "1px solid #E2E8F0" }}>
          {order.notes && (
            <div style={{ padding: "8px 12px", background: "#F9FAFB", borderRadius: "8px", border: "1px solid #E5E7EB", fontSize: "0.8rem", color: "#374151", margin: "0.4rem 0" }}>
              {order.notes}
            </div>
          )}

          <div style={{ fontSize: "0.82rem", margin: "0.5rem 0", borderTop: "1px solid #E5E7EB", paddingTop: "0.5rem" }}>
            {order.items?.map((item: any) => {
              const comboSels = parseComboSelections(item.comboSelections, item.quantity);
              const nameParts = nomeDoItem(item).split(" | ");
              const mainName = nameParts[0];
              const extras = nameParts.slice(1);
              return (
                <div key={item.id} style={{ padding: "4px 0", borderBottom: "1px solid #F3F4F6" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ color: "#374151", fontWeight: 600 }}>{item.quantity}× {mainName}</span>
                    <span style={{ fontWeight: 600, color: "#1F2937" }}>
                      R$ {(getItemEffectivePrice(item, order.items, order.totalAmount, order.deliveryFee || 0, order.discountTotal || 0) * item.quantity).toFixed(2)}
                    </span>
                  </div>
                  {comboSels.length > 0 && (
                    <div style={{ paddingLeft: "16px", fontSize: "0.75rem", color: "#6B7280", lineHeight: "1.5" }}>
                      {comboSels.map((sel: any, i: number) => (
                        <div key={i}>↳ {sel.quantity > 1 ? `${sel.quantity}x ` : ""}{sel.name}</div>
                      ))}
                    </div>
                  )}
                  {comboSels.length === 0 && extras.length > 0 && (
                    <div style={{ paddingLeft: "16px", fontSize: "0.75rem", color: "#6B7280", lineHeight: "1.5" }}>
                      {extras.map((ext: string, i: number) => (
                        <div key={i}>↳ {ext.trim()}</div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
});

export default function StoreOrdersDashboard({ user, orders: initialOrders, isFranqueado, initialCashSessionOpenedAt, initialMotoboys, activeStoreId }: { user: any; orders: any[]; isFranqueado: boolean; initialCashSessionOpenedAt?: string | null; initialMotoboys?: any[]; activeStoreId?: string }) {
  const router = useRouter();
  const [orders, setOrders] = useState(initialOrders);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedChannels, setSelectedChannels] = useState<{
    ifood: boolean;
    "99food": boolean;
    jotaja: boolean;
    brendi: boolean;
    retirada: boolean;
    site: boolean;
  }>({
    ifood: true,
    "99food": true,
    jotaja: true,
    brendi: true,
    retirada: true,
    site: true,
  });

  const toggleChannel = (ch: "ifood" | "99food" | "jotaja" | "brendi" | "retirada" | "site") => {
    setSelectedChannels(prev => ({
      ...prev,
      [ch]: !prev[ch]
    }));
  };

  const [now, setNow] = useState(new Date());
  const [motoboys, setMotoboys] = useState<any[]>(initialMotoboys || []);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [cancelConfirmId, setCancelConfirmId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancellationReasons, setCancellationReasons] = useState<{ cancelCodeId: string, description: string }[]>([]);
  const [selectedCancelCode, setSelectedCancelCode] = useState<string>("");
  const [loadingReasons, setLoadingReasons] = useState<boolean>(false);
  // === Motoboy iFood state ===
  const [ifoodDriverModalId, setIfoodDriverModalId] = useState<string | null>(null);
  const [ifoodDriverQuote, setIfoodDriverQuote] = useState<any>(null);
  const [ifoodDriverLoading, setIfoodDriverLoading] = useState(false);
  const [ifoodDriverError, setIfoodDriverError] = useState("");
  const [autoAccept, setAutoAccept] = useState(() => {
    if (typeof window !== "undefined") return localStorage.getItem("autoAcceptOrders") === "true";
    return false;
  });
  const [receiptPaperSize, setReceiptPaperSize] = useState<"58mm" | "80mm">("80mm");
  const [dueDateExtraMinutes, setDueDateExtraMinutes] = useState<number>(10);
  const [dueDateReason, setDueDateReason] = useState<string>("OUT_FOR_DELIVERY");
  const [activeColumnTab, setActiveColumnTab] = useState<string>("all");
  const prevOrderCount = useRef(initialOrders.filter(o => o.status === "NOVO").length);
  const ordersRef = useRef(orders);
  ordersRef.current = orders;

  const areOrdersEqual = useCallback((prev: any[], next: any[]) => {
    if (!prev || !next) return false;
    if (prev.length !== next.length) return false;
    for (let i = 0; i < prev.length; i++) {
      const p = prev[i];
      const n = next[i];
      if (
        p.id !== n.id ||
        p.status !== n.status ||
        p.motoboyId !== n.motoboyId ||
        p.paymentMethod !== n.paymentMethod ||
        p.totalAmount !== n.totalAmount ||
        p.notes !== n.notes ||
        p.scheduledDatetime !== n.scheduledDatetime ||
        (p.items?.length || 0) !== (n.items?.length || 0) ||
        p.ifoodDriverStatus !== n.ifoodDriverStatus ||
        p.ifoodDriverName !== n.ifoodDriverName ||
        p.kdsStage !== n.kdsStage
      ) {
        return false;
      }
    }
    return true;
  }, []);

  // === CONFIGURAÇÕES DE ALERTAS VISUAIS DE TEMPO (Amarelo / Vermelho) ===
  const [timeAlertConfig, setTimeAlertConfig] = useState<{
    yellowEnabled: boolean;
    yellowMinutes: number;
    redEnabled: boolean;
    redMinutes: number;
  }>({
    yellowEnabled: true,
    yellowMinutes: 10,
    redEnabled: true,
    redMinutes: 5,
  });
  const [showAlertModal, setShowAlertModal] = useState(false);
  const [showRoteirizacaoModal, setShowRoteirizacaoModal] = useState(false);
  const [showMotoboyLinkModal, setShowMotoboyLinkModal] = useState(false);
  const [copiedMotoboyLink, setCopiedMotoboyLink] = useState(false);
  const [showJotajaManualModal, setShowJotajaManualModal] = useState(false);
  const [jjOrderNumber, setJjOrderNumber] = useState("");
  const [jjCustomerName, setJjCustomerName] = useState("");
  const [jjCustomerPhone, setJjCustomerPhone] = useState("");
  const [jjCustomerAddress, setJjCustomerAddress] = useState("");
  const [jjTotalAmount, setJjTotalAmount] = useState("");
  const [jjPaymentMethod, setJjPaymentMethod] = useState("Dinheiro");

  useEffect(() => {
    fetch("/api/store/time-alert-config")
      .then(r => r.json())
      .then(d => { if (d && d.yellowMinutes !== undefined) setTimeAlertConfig(d); })
      .catch(() => {});
  }, []);

  // === SELEÇÃO E AÇÕES EM MASSA (Bulk Actions) ===
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set());
  const [bulkTargetStatus, setBulkTargetStatus] = useState<string>("");
  const [bulkUpdating, setBulkUpdating] = useState<boolean>(false);

  const toggleSelectOrder = (id: string) => {
    setSelectedOrderIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectColumn = (columnOrders: any[]) => {
    const allIds = columnOrders.map(o => o.id);
    const allSelected = allIds.length > 0 && allIds.every(id => selectedOrderIds.has(id));

    setSelectedOrderIds(prev => {
      const next = new Set(prev);
      if (allSelected) {
        allIds.forEach(id => next.delete(id));
      } else {
        allIds.forEach(id => next.add(id));
      }
      return next;
    });
  };

  const handleBulkStatusUpdate = async () => {
    if (!bulkTargetStatus || selectedOrderIds.size === 0) return;
    setBulkUpdating(true);
    const ids = Array.from(selectedOrderIds);

    try {
      let successCount = 0;
      for (const orderId of ids) {
        const res = await fetch("/api/customer-order/status", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId, status: bulkTargetStatus })
        });
        if (res.ok) successCount++;
      }

      setOrders(prev => prev.map(o => selectedOrderIds.has(o.id) ? { ...o, status: bulkTargetStatus } : o));
      showToast(`${successCount} pedido(s) atualizados com sucesso!`, "#10B981");
      setSelectedOrderIds(new Set());
      setBulkTargetStatus("");
      router.refresh();
    } catch {
      showToast("Erro ao atualizar pedidos em massa.", "#EF4444");
    } finally {
      setBulkUpdating(false);
    }
  };

  // ===== ALTA DEMANDA (Surge Pricing) =====
  const [altaDemanda, setAltaDemanda] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("altaDemanda");
      if (saved) { const p = JSON.parse(saved); if (p.active && new Date(p.expiresAt) > new Date()) return p; }
    }
    return { active: false, extraMinutes: 15, extraFee: 3.0, activatedAt: null, expiresAt: null, logs: [] as any[] };
  });
  const [showAltaDemandaModal, setShowAltaDemandaModal] = useState(false);
  const [adExtraMinutes, setAdExtraMinutes] = useState(15);
  const [adExtraFee, setAdExtraFee] = useState(3.0);
  const [adDuration, setAdDuration] = useState(60); // minutos
  const [showAltaDemandaLog, setShowAltaDemandaLog] = useState(false);
  const [showAgendamentos, setShowAgendamentos] = useState(false);

  // ── O QUE ESTA LOJA MOSTRA NA BARRA ────────────────────────────────────────
  //
  // Mesma regra do `labelFieldsConfig`: Json no User e AUSENTE = TUDO LIGADO.
  // Loja nova nasce com tudo aparecendo, e esconder é opcional — quem só faz
  // delivery não quer "Mesas" e "Pedidos Balcão" ocupando a barra o dia todo,
  // mas ninguém deveria precisar ligar coisa nenhuma para começar a usar.
  const [barraConfig, setBarraConfig] = useState<Record<string, boolean>>(
    () => ((user?.painelPedidosConfig as Record<string, boolean>) || {})
  );
  const [showBarraConfig, setShowBarraConfig] = useState(false);
  const [salvandoBarra, setSalvandoBarra] = useState(false);

  /** Chave ausente = ligada. Só o `false` explícito esconde. */
  const naBarra = (chave: string) => barraConfig[chave] !== false;

  const salvarBarraConfig = async (novo: Record<string, boolean>) => {
    setBarraConfig(novo);           // a tela responde na hora
    setSalvandoBarra(true);
    try {
      await fetch("/api/store-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ painelPedidosConfig: novo }),
      });
    } catch {
      showToast("⚠️ Não consegui salvar a preferência", "#EF4444");
    } finally {
      setSalvandoBarra(false);
    }
  };
  const [scheduleLeadHours, setScheduleLeadHours] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("scheduleLeadHours");
      return saved ? Number(saved) : 1;
    }
    return 1;
  });
  const [allowScheduledOrders, setAllowScheduledOrders] = useState<boolean>(() => {
    return (user as any)?.allowScheduledOrders ?? true;
  });

  const toggleAllowScheduledOrders = async (newValue: boolean) => {
    setAllowScheduledOrders(newValue);
    try {
      const res = await fetch("/api/store-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allowScheduledOrders: newValue }),
      });
      if (res.ok) {
        showToast(newValue ? "🟢 Agendamentos ATIVADOS no site próprio!" : "🔴 Agendamentos DESATIVADOS no site próprio!", newValue ? "#10B981" : "#EF4444");
      } else {
        setAllowScheduledOrders(!newValue);
        showToast("❌ Falha ao atualizar configuração de agendamentos", "#EF4444");
      }
    } catch {
      setAllowScheduledOrders(!newValue);
      showToast("❌ Erro de conexão ao salvar", "#EF4444");
    }
  };
  const [scheduleLeadInput, setScheduleLeadInput] = useState("");
  const [toastMsg, setToastMsg] = useState<{ text: string; color: string } | null>(null);
  const [printSelectOrderId, setPrintSelectOrderId] = useState<string | null>(null);
  const [viewReceiptOrderId, setViewReceiptOrderId] = useState<string | null>(null);
  const [confirmarPagamentoOrder, setConfirmarPagamentoOrder] = useState<any | null>(null);
  const [deliveryInfoModalOrder, setDeliveryInfoModalOrder] = useState<any | null>(null);
  const showToast = (text: string, color = "#10B981") => {
    setToastMsg({ text, color });
    setTimeout(() => setToastMsg(null), 4000);
  };

  const activateAltaDemanda = () => {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + adDuration * 60000);
    const newState = {
      active: true, extraMinutes: adExtraMinutes, extraFee: adExtraFee,
      activatedAt: now.toISOString(), expiresAt: expiresAt.toISOString(),
      logs: [
        ...(altaDemanda.logs || []),
        { activatedAt: now.toISOString(), expiresAt: expiresAt.toISOString(), extraMinutes: adExtraMinutes, extraFee: adExtraFee, duration: adDuration }
      ]
    };
    setAltaDemanda(newState);
    localStorage.setItem("altaDemanda", JSON.stringify(newState));
    setShowAltaDemandaModal(false);
  };

  const deactivateAltaDemanda = () => {
    const newState = { ...altaDemanda, active: false, expiresAt: null };
    setAltaDemanda(newState);
    localStorage.setItem("altaDemanda", JSON.stringify(newState));
  };

  // Auto-desativar quando expirar
  useEffect(() => {
    if (!altaDemanda.active || !altaDemanda.expiresAt) return;
    const remaining = new Date(altaDemanda.expiresAt).getTime() - Date.now();
    if (remaining <= 0) { deactivateAltaDemanda(); return; }
    const t = setTimeout(deactivateAltaDemanda, remaining);
    return () => clearTimeout(t);
  }, [altaDemanda.active, altaDemanda.expiresAt]);

  // Drag state
  const [draggedOrderId, setDraggedOrderId] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  // Default date — will be overridden by cash session openedAt if available
  const _now = new Date();
  const _ref = _now;
  const todayStr = `${_ref.getFullYear()}-${String(_ref.getMonth() + 1).padStart(2, "0")}-${String(_ref.getDate()).padStart(2, "0")}`;
  const [dateFrom, setDateFrom] = useState(todayStr + "T00:00");
  const [dateTo, setDateTo] = useState(todayStr + "T23:59");

  // O período que a tela mostra agora viaja junto do poll, para o servidor
  // devolver só esses pedidos em vez dos 200 mais recentes da loja. Vai por ref
  // porque o loop de polling não é recriado a cada troca de data — o ref deixa
  // a próxima rodada já usar o período novo sem remontar o intervalo.
  const periodoRef = useRef({ from: dateFrom, to: dateTo });
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollAgoraRef = useRef<() => void>(() => {});
  useEffect(() => {
    periodoRef.current = { from: dateFrom, to: dateTo };
    // Trocar o período muda o que o SERVIDOR devolve, não só o que a tela
    // filtra. Sem esta busca imediata, quem escolhesse "semana passada" ficaria
    // olhando para a lista do período anterior até o próximo tick.
    pollAgoraRef.current();
  }, [dateFrom, dateTo]);

  const [cashOpenedAt, setCashOpenedAt] = useState<Date | null>(null);

  // Auto-sync dateFrom with active cash session openedAt (DISABLED - Users want to see only today's orders by default)
  useEffect(() => {
    fetch("/api/cash-session")
      .then(r => r.json())
      .then(d => {
        if (d?.session?.openedAt) {
          const opened = new Date(d.session.openedAt);
          setCashOpenedAt(opened);
        } else {
          setCashOpenedAt(null);
        }
      })
      .catch(() => {});
  }, [user.cashOpen]);
  const [showResumo, setShowResumo] = useState(false);
  const storeName = user.storeName || user.name;
  const storeStatus = isStoreOpen(user.storeHours as any);
  const storeUrl = user.slug ? `/loja/${user.slug}` : null;

  const [printerConfig, setPrinterConfig] = useState<any>(null);

  useEffect(() => {
    fetch("/api/store/printer-config")
      .then(r => r.json())
      .then(d => { if (d) setPrinterConfig(d); })
      .catch(() => {});
  }, []);

  // Espelha a largura REAL configurada em /store/impressoras no preview do recibo,
  // para o seletor do modal parar de divergir do que sai na impressora.
  useEffect(() => {
    const w = (printerConfig as any)?.printers?.[0]?.paperWidth
           || (printerConfig as any)?.defaultPaperWidth;
    if (w === "58mm" || w === "80mm") setReceiptPaperSize(w);
  }, [printerConfig]);

  const printingInProgressRef = useRef<Set<string>>(new Set());

  /**
   * `semValores` é parâmetro à parte, e não derivado de `type`, de propósito.
   *
   * `type` já nascia "cozinha" e é o que toda impressão AUTOMÁTICA passa. Ligar
   * o comportamento nele tiraria o preço de todo cupom que a loja imprime
   * sozinha — que não é o que ninguém pediu. Só o botão "Cupom da Cozinha" pede.
   */
  const handlePrint = async (order: any, type: "cozinha" | "completo" = "cozinha", isManual = false, semValores = false) => {
    if (!order) return;
    if (order.status === "CRIANDO_IA") {
      showToast("⚠️ O pedido ainda está sendo montado pela IA no WhatsApp. Aguarde a finalização para imprimir.", "#F59E0B");
      return;
    }
    const orderKey = order.id || order.ifoodReference || order.openDeliveryReference;
    if (!isManual && orderKey && (printingInProgressRef.current.has(orderKey) || isAutoPrinted(order))) {
      console.log(`[Print] ⚠️ Impressão já em andamento ou pedido já impresso para ${orderKey}. Ignorando chamada duplicada.`);
      return;
    }
    if (orderKey) printingInProgressRef.current.add(orderKey);
    if (isManual && orderKey) printingInProgressRef.current.delete(orderKey);

    markAutoPrinted(order);

    const seqNum = getDisplayOrderNumber(order);

    // 1. Prepara dados do pedido
    // Espalha a config REAL por baixo do fallback: o formato antigo descartava
    // o objeto inteiro quando `printers` estava vazio — e com ele iam flags
    // como a do QR do motoboy, justamente na loja de uma impressora só.
    const activeConfig = printerConfig && printerConfig.printers?.length > 0
      ? printerConfig
      : { ...(printerConfig || {}), autoprint: true, printers: [{ id: "default", name: "", label: "Padrao", categories: [], copies: 1, paperWidth: "80mm" }] };

    const payStr = (order.paymentMethod || "").toString();
    const isOfflinePayment = /cobrar|dinheiro|maquin|entrega|pendente|troco/i.test(payStr) || order.isPrepaid === false;

    const formattedOrder = {
      id: order.id,
      dailyOrderNumber: seqNum,
      customerName: order.customerName || "Cliente",
      customerPhone: order.customerPhone,
      customerAddress: order.customerAddress,
      deliveryType: order.deliveryType || "DELIVERY",
      deliveryBy: order.deliveryBy || "MERCHANT",
      paymentMethod: translatePayment(payStr),
      isPrepaid: isOfflinePayment ? false : (order.isPrepaid ?? true),
      items: (order.items || []).map((i: any) => {
        const cleanName = nomeDoItemParaComanda(i);
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
      // A loja de origem tem que chegar na comanda: com três marcas na mesma
      // impressora, o papel precisa dizer de qual delas é o pedido.
      ifoodStoreName: (order as any).ifoodStoreName,
      openDeliveryReference: order.openDeliveryReference,
      source: order.source,
      notes: order.notes,
      createdAt: order.createdAt,
    };

    let printedLocally = false;

    // 2. Tenta enviar diretamente para o Assistente FireHub de Impressão Térmica RAW
    try {
      const { printOrder } = await import("@/lib/print");
      const result = await printOrder(formattedOrder as any, storeName, activeConfig, {}, isManual, semValores);
      if (result.success) {
        showToast("✅ Comanda enviada para a impressora térmica!", "#10B981");
        printedLocally = true;
      }
    } catch (err) {
      console.warn("[Print] Erro na impressão local:", err);
    }

    if (printedLocally) {
      setTimeout(() => {
        if (orderKey) printingInProgressRef.current.delete(orderKey);
      }, 10000);
      return;
    }

    // 3. Se o assistente local não respondeu com sucesso ou deu erro, envia para a Fila de Impressão na nuvem
    try {
      const queueRes = await fetch("/api/store/print-queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          franchiseeId: user.ownerId || user.id,
          order: formattedOrder,
          storeName,
          paperWidth: receiptPaperSize || "80mm",
        }),
      });

      if (queueRes.ok) {
        showToast("✅ Enviado para a fila de impressão da impressora!", "#10B981");
      } else {
        showToast("⚠️ Falha ao enfileirar impressão na nuvem.", "#EF4444");
      }
    } catch (err) {
      console.warn("[Print] Erro ao enviar para fila em nuvem:", err);
      showToast("⚠️ Erro de conexão ao enviar para fila de impressão.", "#EF4444");
    } finally {
      setTimeout(() => {
        if (orderKey) printingInProgressRef.current.delete(orderKey);
      }, 10000);
    }
  };

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  // FAST POLLING — 3s via lightweight API (pauses during drag)
  const isDraggingRef = useRef(false);
  const lastPollHash = useRef("");
  const knownOrderIdsRef = useRef<Set<string>>(new Set(initialOrders.map((o: any) => o.id)));
  const autoPrintedIdsRef = useRef<Set<string>>(new Set());
  const previousStatusRef = useRef<Map<string, string>>(new Map(initialOrders.map((o: any) => [o.id, o.status])));

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

  useEffect(() => {
    // Marca como já impressos apenas pedidos ANTIGOS (criados há mais de 10 minutos)
    // Pedidos recentes (criados nos últimos 10 min) não são marcados como impressos na carga inicial para garantir o auto-print!
    const tenMinutesAgo = Date.now() - 10 * 60 * 1000;

    knownOrderIdsRef.current = new Set(initialOrders.map((o: any) => o.id));
    previousStatusRef.current = new Map(initialOrders.map((o: any) => [o.id, o.status]));

    initialOrders.forEach((o: any) => {
      const orderTime = o.createdAt ? new Date(o.createdAt).getTime() : 0;
      if (orderTime > 0 && orderTime < tenMinutesAgo) {
                  // CRIANDO_IA fica FORA da impressão automática.
                  //
                  // É o rascunho que o robô monta enquanto conversa: ele muda a
                  // cada mensagem ("tira a cebola", "põe mais uma coca") e pode
                  // nem virar pedido, se o cliente desistir. Imprimir aqui punha
                  // a cozinha a produzir comida não confirmada e a jogar fora
                  // comanda a cada alteração. A impressão sai quando o pedido
                  // chega de verdade, com status NOVO.
                  if (o.status !== "CANCELADO" && o.status !== "ENCERRADO" && o.status !== "CRIANDO_IA") {
          markAutoPrinted(o);
        }
      }
    });
  }, [initialOrders]);

  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        if (!isDraggingRef.current) {
          // O período vai no formato ISO: quem sabe o fuso do lojista é este
          // navegador, não o container (que roda em UTC).
          const { from, to } = periodoRef.current;
          const janela = `&from=${encodeURIComponent(new Date(from).toISOString())}&to=${encodeURIComponent(new Date(to).toISOString())}`;
          const res = await fetch(`/api/customer-order/poll?t=${Date.now()}${janela}`, {
            cache: "no-store",
            headers: { "Cache-Control": "no-cache, no-store, must-revalidate", "Pragma": "no-cache" }
          });
          if (res.ok && active) {
            const text = await res.text();
            // Only update if data actually changed — prevents re-render closing dropdowns
            if (text !== lastPollHash.current) {
              lastPollHash.current = text;
              const newOrders = JSON.parse(text);
              if (!areOrdersEqual(ordersRef.current, newOrders)) {
                setOrders(newOrders);
              }

              // Detectar pedidos verdadeiramente NOVOS que chegaram via polling
              const currentKnown = knownOrderIdsRef.current;
              const freshOrders = newOrders.filter((o: any) => !currentKnown.has(o.id));

              if (freshOrders.length > 0) {
                freshOrders.forEach((o: any) => {
                  // AGUARDANDO_PAGAMENTO fica FORA da impressão automática pelo
                  // mesmo motivo do CRIANDO_IA: ainda não é pedido, é intenção.
                  // O feed passou a devolver o pendente do totem para o
                  // atendente poder liberá-lo, e sem esta guarda o painel
                  // imprimiria a comanda no instante em que o cliente toca em
                  // "Pagar no caixa" — cozinha produzindo comida que ninguém
                  // pagou ainda. Quem imprime é `confirmOrderPayment`, depois do
                  // dinheiro na mão. Não marcamos como impresso aqui de
                  // propósito: marcar aqui mataria a impressão da confirmação.
                  if (o.status !== "CANCELADO" && o.status !== "ENCERRADO" && o.status !== "AGUARDANDO_PAGAMENTO") {
                    if (printerConfig?.autoprint !== false && !isAutoPrinted(o)) {
                      markAutoPrinted(o);
                      console.log("[AutoPrint] 🖨️ Disparando impressão automática para pedido novo:", o.id);
                      handlePrint(o, "cozinha");
                    }
                  }
                });
              }

              // Atualizar IDs e status conhecidos
              knownOrderIdsRef.current = new Set(newOrders.map((o: any) => o.id));
              previousStatusRef.current = new Map(newOrders.map((o: any) => [o.id, o.status]));
            }
          }
        }
      } catch {}
      // 3s dava 20 rodadas por minuto e mantinha o banco acordado o mês
      // inteiro, sem que pedido nenhum chegue nessa cadência. Em 8s o pedido
      // novo ainda aparece antes de a cozinha reagir, e as integrações não
      // dependem desta aba: o cron de fundo puxa iFood/JotaJá/Brendi a cada 60s
      // mesmo com o painel fechado.
      if (active) pollTimerRef.current = setTimeout(poll, 8000);
    };
    // Deixa a rodada atual acessível de fora para quem trocar o período poder
    // pedir os pedidos novos na hora, em vez de esperar o próximo tick.
    pollAgoraRef.current = () => {
      if (!active) return;
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      poll();
    };
    const timeout = setTimeout(poll, 1000);
    return () => {
      active = false;
      clearTimeout(timeout);
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      pollAgoraRef.current = () => {};
    };
  }, [printerConfig]);

  useEffect(() => { setOrders(initialOrders); }, [initialOrders]);

  useEffect(() => {
    if (!cancelConfirmId) {
      setCancellationReasons([]);
      setSelectedCancelCode("");
      return;
    }

    setLoadingReasons(true);
    fetch(`/api/customer-order/cancellation-reasons?orderId=${cancelConfirmId}`)
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data) && data.length > 0) {
          setCancellationReasons(data);
          setSelectedCancelCode(data[0].cancelCodeId);
          setCancelReason(data[0].description);
        }
      })
      .catch(err => {
        console.error("Error fetching cancellation reasons:", err);
      })
      .finally(() => {
        setLoadingReasons(false);
      });
  }, [cancelConfirmId]);

  // Auto-accept logic (apenas para pedidos recentes do dia/turno atual criados há menos de 6 horas)
  const autoAcceptedIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!autoAccept) return;
    const sixHoursAgo = Date.now() - 6 * 60 * 60 * 1000;
    const novos = orders.filter(o => {
      if (o.status !== "NOVO") return false;
      if (autoAcceptedIdsRef.current.has(o.id)) return false; // Já aceito nesta sessão
      const orderTime = o.createdAt ? new Date(o.createdAt).getTime() : Date.now();
      return orderTime >= sixHoursAgo;
    });
    if (novos.length === 0) return;
    // Aceitar todos de uma vez, sem loop de refresh
    novos.forEach(o => {
      autoAcceptedIdsRef.current.add(o.id);
      // Atualizar estado local imediatamente
      setOrders(prev => prev.map(p => p.id === o.id ? { ...p, status: "ACEITO" } : p));
      // Disparar API sem router.refresh()
      fetch("/api/customer-order/status", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: o.id, status: "ACEITO" }),
      }).then(res => {
        if (res.ok && printerConfig?.autoprint !== false && !isAutoPrinted(o)) {
          markAutoPrinted(o);
          handlePrint(o, "cozinha");
        }
      }).catch(() => {});
    });
  }, [orders, autoAccept]);

  // ── O aceite automatico precisa existir FORA deste navegador ─────────────
  //
  // Este interruptor so vivia no localStorage, entao ele valia enquanto esta
  // aba estivesse aberta e so nela: fechou o painel, parou de aceitar. E o
  // servidor nunca ficava sabendo — a coluna `autoAcceptOrders` do User (a
  // mesma que o cardapio proprio ja usa em customer-order/route.ts) continuava
  // false para todo mundo, porque nenhuma tela a escrevia.
  //
  // Isso passou a importar de verdade com o 99Food: e esta coluna que decide se
  // a loja pode ir para OPENAPI (o modo em que o app do 99Food nao precisa ficar
  // online) — porque OPENAPI so e seguro onde o FireHub confirma o pedido
  // sozinho, e quem faz o webhook confirmar sozinho e justamente o aceite
  // automatico. Ver src/lib/food99-abertura.ts.
  const gravarAceiteAutomatico = (valor: boolean) =>
    fetch("/api/store-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ autoAcceptOrders: valor }),
    }).catch(() => {});

  // Quem ja tinha o aceite ligado neste navegador nao pode perder a escolha:
  // na primeira montagem o valor local sobe para o servidor uma vez. Sem isto,
  // a coluna ficaria false ate o lojista desligar e religar o botao.
  const aceiteMigradoRef = useRef(false);
  useEffect(() => {
    if (aceiteMigradoRef.current) return;
    aceiteMigradoRef.current = true;
    if (autoAccept) gravarAceiteAutomatico(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Toggle auto accept
  const toggleAutoAccept = () => {
    const next = !autoAccept;
    setAutoAccept(next);
    localStorage.setItem("autoAcceptOrders", next.toString());
    gravarAceiteAutomatico(next);
  };

  // Pre-initialize AudioContext on first user interaction (required by browser autoplay policy)
  const audioCtxRef = useRef<AudioContext | null>(null);
  useEffect(() => {
    const initAudio = () => {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
    };
    document.addEventListener("click", initAudio, { once: true });
    document.addEventListener("touchstart", initAudio, { once: true });
    document.addEventListener("keydown", initAudio, { once: true });
    return () => {
      document.removeEventListener("click", initAudio);
      document.removeEventListener("touchstart", initAudio);
      document.removeEventListener("keydown", initAudio);
    };
  }, []);

  const playOrderChime = useCallback(async () => {
    try {
      let ctx = audioCtxRef.current;
      if (!ctx) {
        ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        audioCtxRef.current = ctx;
      }
      // Resume if suspended (browser policy)
      if (ctx.state === "suspended") await ctx.resume();

      const playChime = (startTime: number) => {
        const osc1 = ctx!.createOscillator();
        const gain1 = ctx!.createGain();
        osc1.type = "sine";
        osc1.frequency.setValueAtTime(880, startTime);
        gain1.gain.setValueAtTime(0.4, startTime);
        gain1.gain.exponentialRampToValueAtTime(0.01, startTime + 0.3);
        osc1.connect(gain1).connect(ctx!.destination);
        osc1.start(startTime);
        osc1.stop(startTime + 0.3);

        const osc2 = ctx!.createOscillator();
        const gain2 = ctx!.createGain();
        osc2.type = "sine";
        osc2.frequency.setValueAtTime(1100, startTime + 0.15);
        gain2.gain.setValueAtTime(0.4, startTime + 0.15);
        gain2.gain.exponentialRampToValueAtTime(0.01, startTime + 0.5);
        osc2.connect(gain2).connect(ctx!.destination);
        osc2.start(startTime + 0.15);
        osc2.stop(startTime + 0.5);
      };
      const t = ctx.currentTime;
      playChime(t);
      playChime(t + 0.7);
      playChime(t + 1.4);
    } catch {}
  }, []);

  // Calcular pedidos agendados ANTES do useEffect do som
  const leadMs = scheduleLeadHours * 60 * 60 * 1000;
  const scheduledOrders = orders.filter(o => {
    if (!o.scheduledDatetime) return false;
    const deadline = new Date(o.scheduledDatetime);
    const diffMs = deadline.getTime() - new Date(o.createdAt).getTime();
    const isFutureScheduled = diffMs > 3 * 60 * 60 * 1000;
    const isNotStarted = o.status === "NOVO" || o.status === "ACEITO";
    const stillWaiting = deadline.getTime() - now.getTime() > leadMs;
    return isFutureScheduled && isNotStarted && stillWaiting;
  });
  const scheduledOrderIds = new Set(scheduledOrders.map(o => o.id));



  // Solicitar permissão de notificação na montagem
  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      // Pequeno delay para não parecer intrusivo
      const t = setTimeout(() => Notification.requestPermission(), 3000);
      return () => clearTimeout(t);
    }
  }, []);

  // Carrega motoboys cadastrados
  useEffect(() => {
    fetch("/api/motoboys")
      .then(r => r.ok ? r.json() : [])
      .then(data => {
        if (Array.isArray(data) && data.length > 0) {
          setMotoboys(data.filter((m: any) => m.active !== false));
        }
      })
      .catch(() => {});
  }, []);

  const assignMotoboy = async (orderId: string, motoboyId: string) => {
    setAssigningId(orderId);
    const targetOrder = orders.find((o) => o.id === orderId);
    const seqNum = targetOrder ? getDisplayOrderNumber(targetOrder) : undefined;

    try {
      await fetch("/api/customer-order/assign-motoboy", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId,
          motoboyId: motoboyId || null,
          firehubOrderNumber: seqNum,
        }),
      });
      setOrders(prev => prev.map(o =>
        o.id === orderId
          ? { ...o, motoboyId, motoboy: motoboys.find(m => m.id === motoboyId) || null }
          : o
      ));
    } finally { setAssigningId(null); }
  };

  const updateStatus = async (orderId: string, newStatus: string) => {
    setLoadingId(orderId);
    try {
      const res = await fetch("/api/customer-order/status", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, status: newStatus })
      });
      if (res.ok) {
        setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: newStatus } : o));
        router.refresh();

        // 🖨️ Impressão Automática ao Aceitar Pedido (se autoprint estiver ativado)
        if (newStatus === "ACEITO" && printerConfig?.autoprint !== false) {
          const targetOrder = orders.find(o => o.id === orderId);
          if (targetOrder) {
            markAutoPrinted(targetOrder);
            handlePrint(targetOrder, "cozinha");
          }
        }
      } else {
        const errData = await res.json().catch(() => ({}));
        const msg = errData?.error || `Erro ${res.status}`;
        console.warn(`[updateStatus] ${orderId} → ${newStatus}: ${msg}`);
        showToast(msg, "#EF4444");
      }
    } catch (err: any) {
      console.warn("[updateStatus] network error:", err?.message);
      showToast("Erro de conexão. Tente novamente.", "#EF4444");
    } finally { setLoadingId(null); }
  };

  /**
   * O atendente recebeu o dinheiro (ou o Pix, ou passou o cartão) no balcão.
   *
   * A rota /api/store/orders/confirmar-pagamento já existia e já fazia tudo
   * certo — carimba paymentPaidAt, gera a senha, manda para o KDS, imprime,
   * baixa estoque e conta faturamento pela mesma `confirmOrderPayment` do
   * webhook do gateway — mas não tinha um único chamador no projeto. Era o
   * fim de linha do "Pagar no caixa": pedido gravado, dinheiro na gaveta,
   * comanda nenhuma na cozinha.
   *
   * A forma de pagamento vai junto porque é ela que decide em que faixa a
   * venda entra no fechamento do caixa; a rota ainda anexa QUEM recebeu, que é
   * o que permite rastrear uma divergência no fim do dia.
   */
  const confirmarPagamento = async (orderId: string, formaDePagamento: string) => {
    setLoadingId(orderId);
    try {
      const res = await fetch("/api/store/orders/confirmar-pagamento", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, formaDePagamento }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        // O status novo depende do auto-aceite da loja (NOVO ou ACEITO), então
        // quem manda é o que a rota devolveu — não um palpite da tela.
        setOrders(prev => prev.map(o => o.id === orderId
          ? { ...o, status: data.status || "NOVO", paymentPaidAt: new Date().toISOString() }
          : o));
        setConfirmarPagamentoOrder(null);
        showToast(data.mensagem || "Pagamento confirmado! O pedido foi para a cozinha.", "#10B981");
        router.refresh();
      } else {
        showToast(data.error || `Erro ${res.status} ao confirmar o pagamento.`, "#EF4444");
      }
    } catch {
      showToast("Erro de conexão ao confirmar o pagamento.", "#EF4444");
    } finally {
      setLoadingId(null);
    }
  };

  // === MOTOBOY IFOOD FUNCTIONS ===
  const fetchIfoodDriverQuote = async (orderId: string) => {
    setIfoodDriverModalId(orderId);
    setIfoodDriverLoading(true);
    setIfoodDriverError("");
    setIfoodDriverQuote(null);
    try {
      const res = await fetch(`/api/ifood/request-driver?orderId=${orderId}`);
      const data = await res.json();
      if (!data.available) throw new Error(data.error || "Motoboy iFood não disponível");
      setIfoodDriverQuote(data);
    } catch (e: any) { setIfoodDriverError(e.message); }
    finally { setIfoodDriverLoading(false); }
  };

  const requestIfoodDriver = async () => {
    if (!ifoodDriverModalId || !ifoodDriverQuote) return;
    setIfoodDriverLoading(true);
    try {
      const res = await fetch("/api/ifood/request-driver", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: ifoodDriverModalId, quoteId: ifoodDriverQuote.quoteId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao solicitar motoboy");
      setOrders(prev => prev.map(o =>
        o.id === ifoodDriverModalId ? { ...o, ifoodDriverStatus: "REQUESTED", ifoodDriverRequestedAt: new Date().toISOString() } : o
      ));
      setIfoodDriverModalId(null);
    } catch (e: any) { setIfoodDriverError(e.message); }
    finally { setIfoodDriverLoading(false); }
  };

  const cancelIfoodDriver = async (orderId: string) => {
    if (!window.confirm("Cancelar solicitação de motoboy iFood?")) return;
    try {
      await fetch(`/api/ifood/request-driver?orderId=${orderId}`, { method: "DELETE" });
      setOrders(prev => prev.map(o =>
        o.id === orderId ? { ...o, ifoodDriverStatus: null, ifoodDriverName: null, ifoodDriverPhone: null } : o
      ));
    } catch {}
  };

  const confirmCancel = async () => {
    if (!cancelConfirmId) return;
    const finalReason = cancelReason.trim() || cancellationReasons.find(r => r.cancelCodeId === selectedCancelCode)?.description || "Cancelado pela loja";
    setLoadingId(cancelConfirmId);
    try {
      const res = await fetch("/api/customer-order/status", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: cancelConfirmId,
          status: "CANCELADO",
          cancelReason: finalReason,
          cancellationCode: selectedCancelCode
        })
      });
      if (res.ok) {
        setOrders(prev => prev.map(o => o.id === cancelConfirmId ? { ...o, status: "CANCELADO", cancelledBy: "LOJA" } : o));
        router.refresh();
      } else showToast("Erro ao cancelar.", "#EF4444");
    } catch { showToast("Erro.", "#EF4444"); } finally {
      setLoadingId(null);
      setCancelConfirmId(null);
      setCancelReason("");
      setSelectedCancelCode("");
    }
  };
  // --- DRAG HANDLERS (DOM-DRIVEN FOR INSTANT 1-CLICK DRAG) ---
  const activeDragElRef = useRef<HTMLElement | null>(null);

  const highlightCard = (el: HTMLElement) => {
    activeDragElRef.current = el;
    el.style.borderColor = "#3B82F6";
    el.style.borderWidth = "2.5px";
    el.style.boxShadow = "0 16px 32px -4px rgba(59, 130, 246, 0.4), 0 0 0 4px rgba(59, 130, 246, 0.15)";
    el.style.transform = "scale(1.02) translateY(-2px)";
    el.style.background = "#F0F9FF";
  };

  const resetCard = (el: HTMLElement | null) => {
    if (!el) return;
    el.style.borderColor = "";
    el.style.borderWidth = "";
    el.style.boxShadow = "";
    el.style.transform = "";
    el.style.background = "";
    activeDragElRef.current = null;
  };

  const handleDragStart = (e: React.DragEvent, orderId: string) => {
    isDraggingRef.current = true;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", orderId);
    highlightCard(e.currentTarget as HTMLElement);
  };

  const handleDragEnd = (e: React.DragEvent) => {
    isDraggingRef.current = false;
    resetCard(e.currentTarget as HTMLElement);
    setDragOverColumn(null);
  };

  const handleDragOver = (e: React.DragEvent, columnId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverColumn(columnId);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    // Only clear if leaving the column entirely
    const relatedTarget = e.relatedTarget as HTMLElement;
    const currentTarget = e.currentTarget as HTMLElement;
    if (!currentTarget.contains(relatedTarget)) {
      setDragOverColumn(null);
    }
  };

  const handleDrop = (e: React.DragEvent, columnId: string) => {
    e.preventDefault();
    setDragOverColumn(null);
    resetCard(activeDragElRef.current);

    // Never allow dropping into Novos Pedidos
    if (columnId === "col-novos") return;

    const orderId = e.dataTransfer.getData("text/plain");
    if (!orderId) return;

    const order = orders.find(o => o.id === orderId);
    if (!order) return;

    const targetStatus = COLUMN_STATUS_MAP[columnId];
    if (!targetStatus) return;

    // Set the correct status based on target column
    let newStatus = targetStatus;
    if (columnId === "col-preparo") newStatus = "PREPARANDO";
    if (columnId === "col-transporte") newStatus = "SAIU_ENTREGA";

    if (order.status === newStatus) return;

    updateStatus(orderId, newStatus);
  };

  // --- TOUCH DRAG SUPPORT ---
  const touchRef = useRef<{ orderId: string; startX: number; startY: number; el: HTMLElement } | null>(null);
  const ghostRef = useRef<HTMLElement | null>(null);

  const handleTouchStart = (e: React.TouchEvent, orderId: string) => {
    isDraggingRef.current = true;
    const touch = e.touches[0];
    const el = e.currentTarget as HTMLElement;
    highlightCard(el);
    touchRef.current = { orderId, startX: touch.clientX, startY: touch.clientY, el };
  };

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!touchRef.current) return;
    const touch = e.touches[0];
    const dx = Math.abs(touch.clientX - touchRef.current.startX);
    const dy = Math.abs(touch.clientY - touchRef.current.startY);

    // Only activate horizontal drag — low threshold for fast response
    if (dx > 8 && dx > dy) {
      e.preventDefault();

      // Create/update ghost element
      if (!ghostRef.current) {
        const ghost = document.createElement("div");
        ghost.style.cssText = `position:fixed;z-index:9999;pointer-events:none;padding:8px 16px;background:#fff;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,0.2);font-weight:700;font-size:0.85rem;border:2px solid #3B82F6;`;
        ghost.textContent = `#${touchRef.current.orderId.slice(-6).toUpperCase()}`;
        document.body.appendChild(ghost);
        ghostRef.current = ghost;
      }
      ghostRef.current.style.left = `${touch.clientX - 40}px`;
      ghostRef.current.style.top = `${touch.clientY - 20}px`;

      // Highlight column under finger
      const columns = document.querySelectorAll("[data-droppable]");
      columns.forEach(col => {
        const rect = col.getBoundingClientRect();
        if (touch.clientX >= rect.left && touch.clientX <= rect.right && touch.clientY >= rect.top && touch.clientY <= rect.bottom) {
          (col as HTMLElement).style.background = "#E0F2FE";
          setDragOverColumn(col.getAttribute("data-droppable"));
        } else {
          (col as HTMLElement).style.background = "";
        }
      });
    }
  }, []);

  const handleTouchEnd = useCallback((e: TouchEvent) => {
    if (!touchRef.current) return;

    resetCard(touchRef.current.el);

    // Remove ghost
    if (ghostRef.current) {
      ghostRef.current.remove();
      ghostRef.current = null;
    }

    // Find which column we're over
    const touch = e.changedTouches[0];
    const columns = document.querySelectorAll("[data-droppable]");
    let droppedColumn: string | null = null;

    columns.forEach(col => {
      (col as HTMLElement).style.background = "";
      const rect = col.getBoundingClientRect();
      if (touch.clientX >= rect.left && touch.clientX <= rect.right && touch.clientY >= rect.top && touch.clientY <= rect.bottom) {
        droppedColumn = col.getAttribute("data-droppable");
      }
    });

    if (droppedColumn && droppedColumn !== "col-novos" && touchRef.current) {
      const order = orders.find(o => o.id === touchRef.current!.orderId);
      if (order) {
        let newStatus: string | null = null;
        if (droppedColumn === "col-preparo") newStatus = "PREPARANDO";
        if (droppedColumn === "col-transporte") newStatus = "SAIU_ENTREGA";
        if (newStatus && order.status !== newStatus) {
          updateStatus(order.id, newStatus);
        }
      }
    }

    isDraggingRef.current = false;
    setDragOverColumn(null);
    touchRef.current = null;
  }, [orders]);

  useEffect(() => {
    document.addEventListener("touchmove", handleTouchMove, { passive: false });
    document.addEventListener("touchend", handleTouchEnd);
    return () => {
      document.removeEventListener("touchmove", handleTouchMove);
      document.removeEventListener("touchend", handleTouchEnd);
    };
  }, [handleTouchMove, handleTouchEnd]);

  const fromDate = new Date(dateFrom);
  const toDate = new Date(dateTo);

  const matchesChannelFilter = (o: any) => {
    const isIfood = o.source === "IFOOD" || Boolean(o.ifoodOrderId) || Boolean(o.ifoodReference);
    const is99Food = o.source === "99FOOD" || o.openDeliveryChannel === "99FOOD" || (o.source === "OPEN_DELIVERY" && String(o.openDeliveryChannel).includes("99"));
    const isBrendi = o.source === "BRENDI" || o.openDeliveryChannel === "BRENDI";
    // O JotaJá era o "resto" do Open Delivery (todo pedido com
    // openDeliveryOrderId que não fosse 99Food) — com a Brendi gravando o id
    // dela no MESMO campo, o pedido dela cairia aqui e o filtro Brendi do
    // usuário não teria efeito nenhum. Canal decide; presença de campo não.
    const isJotaja = !isBrendi && (o.source === "JOTAJA" || (o.source === "OPEN_DELIVERY" && !String(o.openDeliveryChannel).includes("99")) || Boolean(o.openDeliveryOrderId && !o.ifoodOrderId && o.openDeliveryChannel !== "99FOOD"));
    const isRetirada = o.deliveryType === "PICKUP" || o.deliveryType === "TAKEOUT" || o.deliveryType === "BALCAO" || o.source === "PDV" || Boolean(o.tableNumber);
    const isSite = !isIfood && !is99Food && !isBrendi && !isJotaja && !isRetirada;

    if (isIfood && selectedChannels.ifood) return true;
    if (is99Food && selectedChannels["99food"]) return true;
    if (isBrendi && selectedChannels.brendi) return true;
    if (isJotaja && selectedChannels.jotaja) return true;
    if (isRetirada && selectedChannels.retirada) return true;
    if (isSite && selectedChannels.site) return true;

    return false;
  };

  const filteredOrders = orders.filter(o => {
    if (o.status === "ENCERRADO") return false;
    if (!matchesChannelFilter(o)) return false;
    
    // Pedidos de integrações (iFood/Jotajá) que estão EM ANDAMENTO ignoram filtro de data,
    // garantindo que pedidos ativos fiquem sempre visíveis.
    // Pedidos ENTREGUE, CANCELADOS e ENCERRADOS respeitam o filtro de data.
    const activeStatuses = ["NOVO", "ACEITO", "PREPARANDO", "SAIU_ENTREGA", "PRONTO"];
    const isInProgress = activeStatuses.includes(o.status);
    const isIntegration = !!(o.ifoodOrderId || o.openDeliveryOrderId);
    
    if (isInProgress && isIntegration) {
      // Pedidos em andamento de integração: visíveis se recentes, mas oculta se criados há mais de 12h e antes do período
      const refDate = o.scheduledDatetime ? new Date(o.scheduledDatetime) : new Date(o.createdAt);
      const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000);
      if (refDate < twelveHoursAgo && refDate < fromDate) return false;
    } else {
      // Pedidos finalizados (ENTREGUE), cancelados e pedidos manuais: filtro de data
      const refDate = o.scheduledDatetime ? new Date(o.scheduledDatetime) : new Date(o.createdAt);
      if (refDate < fromDate || refDate > toDate) return false;
    }
    
    if (!searchTerm) return true;
    const s = searchTerm.toLowerCase().replace("#", "").trim();
    const displayNum = String(o.dailyOrderNumber || o.ifoodReference || o.openDeliveryReference || "").toLowerCase();

    return (
      (o.customerName || "").toLowerCase().includes(s) ||
      (o.customerPhone || "").includes(s) ||
      (o.customerAddress || "").toLowerCase().includes(s) ||
      (s.length >= 4 && o.id.toLowerCase().includes(s)) ||
      getDisplayOrderNumber(o).toLowerCase().includes(s) ||
      displayNum.includes(s) ||
      (o.openDeliveryReference || "").toLowerCase().includes(s) ||
      (o.ifoodReference || "").toLowerCase().includes(s) ||
      (o.notes || "").toLowerCase().includes(s) ||
      String(o.dailyOrderNumber || "").includes(s)
    );
  });



  // scheduledOrders e scheduledOrderIds já calculados acima (antes do useEffect do som)

  const sortByOrderNumberAsc = (a: any, b: any) => {
    const timeA = new Date(a.createdAt).getTime();
    const timeB = new Date(b.createdAt).getTime();
    if (timeA !== timeB) return timeA - timeB;
    const numA = parseInt(getDisplayOrderNumber(a).replace(/\D/g, "") || "0", 10);
    const numB = parseInt(getDisplayOrderNumber(b).replace(/\D/g, "") || "0", 10);
    return numA - numB;
  };

  // ── AGUARDANDO PAGAMENTO GANHOU COLUNA ────────────────────────────────────
  // Este status não casava com filtro de coluna NENHUM: o pedido do totem que
  // escolhe "Pagar no caixa" chegava ao navegador e não era desenhado em lugar
  // algum. O cliente ia ao balcão com a senha, pagava, e o atendente não tinha
  // onde clicar — a cozinha nunca ficava sabendo. FIFO como as outras colunas
  // ativas: quem está esperando no balcão há mais tempo é o próximo.
  const aguardandoPagamento = filteredOrders.filter(o => o.status === "AGUARDANDO_PAGAMENTO").sort(sortByOrderNumberAsc);
  const novos = filteredOrders.filter(o => (o.status === "NOVO" || o.status === "CRIANDO_IA") && !scheduledOrderIds.has(o.id)).sort(sortByOrderNumberAsc);
  const preparo = filteredOrders.filter(o => o.status === "ACEITO" || o.status === "PREPARANDO" || (o.deliveryType === "DELIVERY" && o.status === "PRONTO")).sort(sortByOrderNumberAsc);
  const transporte = filteredOrders.filter(o => o.status === "SAIU_ENTREGA").sort(sortByOrderNumberAsc);
  // ── COLUNAS DE ENCERRADOS VÃO DO MAIS RECENTE PARA O MAIS ANTIGO ──────────
  // As colunas ativas (Novos, Em Produção, Saiu para Entrega) são FIFO: o mais
  // antigo primeiro, porque é a ordem de atendimento. Já em Finalizado e
  // Cancelado o operador quer ver o que ACABOU de sair — e ali a ordem
  // crescente jogava o pedido recém-concluído para o fim da lista.
  //
  // Na prática isso fazia o lojista achar que o pedido tinha sumido: em
  // 22/08/2026 a coluna Finalizado da Hakim tinha 48 pedidos na ordem
  // 148, 149, 150, 151, 1, 2, 3 … 84, 92, 102 — os de ontem no topo (entram
  // pelo scheduledDatetime) e o #92, recém-entregue, na 47ª posição.
  const sortByOrderNumberDesc = (a: any, b: any) => sortByOrderNumberAsc(b, a);

  const finalizados = filteredOrders.filter(o => o.status === "ENTREGUE" || o.status === "ENCERRADO" || (o.deliveryType !== "DELIVERY" && o.status === "PRONTO")).sort(sortByOrderNumberDesc);
  const cancelados = filteredOrders.filter(o => o.status === "CANCELADO").sort(sortByOrderNumberDesc);

  // ── QUEM PODE APITAR ────────────────────────────────────────────────────
  //
  // A coluna "Novos" mostra tambem o pedido que a IA do WhatsApp ainda esta
  // MONTANDO (status CRIANDO_IA) — e isso e util de ver. Mas o som usava a
  // mesma lista: enquanto o cliente conversava com o robo, o painel apitava a
  // cada 4 segundos, as vezes por varios minutos, por um pedido que ainda nem
  // existia para aceitar. A equipe corria ate a tela para nao encontrar nada.
  //
  // O alerta agora escuta so quem esta PRONTO para ser aceito. Quando a IA
  // fecha o pedido, o status vira NOVO e o som toca — uma unica vez por
  // pedido, como deve ser.
  const aguardandoAceite = novos.filter(o => o.status !== "CRIANDO_IA");

  // Continuous alert sound — loops every 4s while there are NOVO orders visible in Kanban
  const alertIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasNotifiedRef = useRef(false);

  useEffect(() => {
    const novoCount = aguardandoAceite.length;

    if (novoCount > 0) {
      // Start looping sound if not already playing
      if (!alertIntervalRef.current) {
        playOrderChime();
        alertIntervalRef.current = setInterval(() => {
          playOrderChime();
        }, 4000);
      }

      // Send push notification only once per batch
      if (!hasNotifiedRef.current) {
        hasNotifiedRef.current = true;
        if ("Notification" in window && Notification.permission === "granted") {
          try {
            new Notification("🔔 Novo pedido chegou!", {
              body: `Você tem ${novoCount} pedido${novoCount > 1 ? "s" : ""} aguardando confirmação.`,
              icon: "/icon.jpg",
              tag: "new-order",
            });
          } catch {}
        }
      }
    } else {
      // All orders accepted or no new orders in current view — stop the sound immediately
      if (alertIntervalRef.current) {
        clearInterval(alertIntervalRef.current);
        alertIntervalRef.current = null;
      }
      hasNotifiedRef.current = false;
    }

    return () => {
      if (alertIntervalRef.current) {
        clearInterval(alertIntervalRef.current);
        alertIntervalRef.current = null;
      }
    };
  }, [aguardandoAceite.length, playOrderChime]);

  // Transmite em tempo real a quantidade de pedidos em produção para a extensão Chrome do FireHub
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.postMessage({
        type: "FIREHUB_EM_PRODUCAO_COUNT",
        count: preparo.length
      }, "*");
    }
  }, [preparo.length]);

  // Resumo de vendas
  const allInRange = orders.filter(o => { const d = o.scheduledDatetime ? new Date(o.scheduledDatetime) : new Date(o.createdAt); return d >= fromDate && d <= toDate; });
  const resumo = {
    pendentes: allInRange.filter(o => o.status === "AGUARDANDO_PAGAMENTO"),
    novos: allInRange.filter(o => o.status === "NOVO"),
    preparo: allInRange.filter(o => o.status === "ACEITO" || o.status === "PREPARANDO"),
    transporte: allInRange.filter(o => o.status === "SAIU_ENTREGA"),
    entregues: allInRange.filter(o => o.status === "ENTREGUE" || o.status === "ENCERRADO"),
    cancelados: allInRange.filter(o => o.status === "CANCELADO"),
    // Pendente de pagamento fica FORA do total. Enquanto o feed escondia esse
    // status a linha "PAGAMENTOS PENDENTES" marcava zero para sempre e o total
    // não sentia nada; agora que o pendente chega de verdade, somá-lo aqui
    // inflaria o resumo de vendas com dinheiro que ninguém entregou — o mesmo
    // erro que o DRE já tinha corrigido. Ele tem a linha dele logo acima.
    total: allInRange.filter(o => o.status !== "CANCELADO" && o.status !== "AGUARDANDO_PAGAMENTO"),
  };

  const getChannelDiscount = (o: any): number => {
    if (typeof o.discountIfood === "number" && o.discountIfood > 0) return o.discountIfood;
    const totDisc = Number(o.discountTotal || 0);
    const merchDisc = Number(o.discountMerchant || 0);
    if (totDisc > merchDisc) return totDisc - merchDisc;
    if (o.notes) {
      const match = o.notes.match(/(?:iFood|Plataforma):\s*R\$\s*(\d+[.,]\d{2})/i);
      if (match && match[1]) return parseFloat(match[1].replace(",", "."));
    }
    return 0;
  };

  const sumVal = (arr: any[]) => arr.reduce((s, o) => s + (Number(o.totalAmount) || 0) + getChannelDiscount(o), 0);
  const fmtR = (v: number) => `R$ ${v.toFixed(2).replace('.', ',')}`;



  return (
    <div style={{ fontFamily: "'Inter', sans-serif" }}>
      {/* MODAL CANCELAR PEDIDO */}
      {cancelConfirmId && (
        <div onClick={() => { setCancelConfirmId(null); setCancelReason(""); setSelectedCancelCode(""); }} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: "16px", padding: "24px", width: "100%", maxWidth: "400px", boxShadow: "0 25px 60px rgba(0,0,0,0.3)" }}>
            <div style={{ textAlign: "center", marginBottom: "16px" }}>
              <div style={{ fontSize: "2rem", marginBottom: "8px" }}>⚠️</div>
              <div style={{ fontWeight: 700, fontSize: "1.1rem", color: "#1F2937" }}>Tem certeza que deseja cancelar esse pedido?</div>
            </div>
            <div style={{ marginBottom: "16px" }}>
              <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 600, color: "#374151", marginBottom: "6px" }}>Selecione o motivo do cancelamento:</label>
              {loadingReasons ? (
                <div style={{ fontSize: "0.82rem", color: "#6B7280", padding: "6px 0" }}>Carregando motivos do iFood...</div>
              ) : cancellationReasons.length > 0 ? (
                <select
                  value={selectedCancelCode}
                  onChange={e => {
                    const code = e.target.value;
                    setSelectedCancelCode(code);
                    const desc = cancellationReasons.find(r => r.cancelCodeId === code)?.description || "";
                    setCancelReason(desc);
                  }}
                  style={{ width: "100%", padding: "10px 12px", borderRadius: "8px", border: "1px solid #D1D5DB", fontSize: "0.85rem", fontFamily: "inherit", outline: "none", boxSizing: "border-box", background: "#fff", color: "#1F2937", marginBottom: "12px" }}
                >
                  {cancellationReasons.map(r => (
                    <option key={r.cancelCodeId} value={r.cancelCodeId}>
                      [{r.cancelCodeId}] {r.description}
                    </option>
                  ))}
                </select>
              ) : (
                <div style={{ fontSize: "0.82rem", color: "#EF4444", padding: "6px 0" }}>Usando motivos padrão do sistema.</div>
              )}

              <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 600, color: "#374151", marginBottom: "6px" }}>Detalhes do motivo (opcional):</label>
              <textarea
                value={cancelReason}
                onChange={e => setCancelReason(e.target.value)}
                placeholder="Ex: Cliente desistiu, item indisponível..."
                autoFocus
                style={{ width: "100%", padding: "10px 12px", borderRadius: "8px", border: "1px solid #D1D5DB", fontSize: "0.85rem", fontFamily: "inherit", resize: "vertical", minHeight: "80px", outline: "none", boxSizing: "border-box" }}
              />
            </div>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button onClick={() => { setCancelConfirmId(null); setCancelReason(""); setSelectedCancelCode(""); }} style={{ flex: 1, padding: "0.6rem", borderRadius: "8px", border: "1px solid #D1D5DB", background: "#fff", color: "#374151", fontWeight: 600, cursor: "pointer", fontSize: "0.85rem", fontFamily: "inherit" }}>Não</button>
              <button onClick={confirmCancel} disabled={!!loadingId} style={{ flex: 1, padding: "0.6rem", borderRadius: "8px", border: "none", background: "#DC2626", color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: "0.85rem", fontFamily: "inherit" }}>{loadingId ? "Cancelando..." : "Sim, cancelar"}</button>
            </div>
          </div>
        </div>
      )}

      {/* PRINT SELECT MODAL */}
      {printSelectOrderId && (() => {
        const order = orders.find(o => o.id === printSelectOrderId);
        if (!order) return null;
        return (
          <div onClick={() => setPrintSelectOrderId(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 10002, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
            <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: "16px", padding: "24px", width: "100%", maxWidth: "380px", boxShadow: "0 25px 60px rgba(0,0,0,0.3)", textAlign: "center" }}>
              <div style={{ fontSize: "2rem", marginBottom: "8px" }}>🖨️</div>
              <div style={{ fontWeight: 800, fontSize: "1.15rem", color: "#1E293B", marginBottom: "16px" }}>Como deseja imprimir o pedido?</div>
              
              <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "20px" }}>
                <button
                  onClick={() => {
                    handlePrint(order, "cozinha", true, true);
                    setPrintSelectOrderId(null);
                  }}
                  style={{ padding: "12px", borderRadius: "10px", border: "1px solid #D1D5DB", background: "#F8FAFC", color: "#374151", fontWeight: 700, cursor: "pointer", fontSize: "0.9rem", transition: "background 0.2s" }}
                >
                  🍳 Cupom da Cozinha (Sem Valores)
                </button>
                <button
                  onClick={() => {
                    handlePrint(order, "completo", true);
                    setPrintSelectOrderId(null);
                  }}
                  style={{ padding: "12px", borderRadius: "10px", border: "none", background: "#3B82F6", color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: "0.9rem", transition: "background 0.2s" }}
                >
                  📄 Cupom Completo (Com Valores)
                </button>
              </div>

              <button onClick={() => setPrintSelectOrderId(null)} style={{ padding: "8px 16px", borderRadius: "8px", border: "1px solid #E2E8F0", background: "#fff", color: "#64748B", fontWeight: 600, cursor: "pointer", fontSize: "0.85rem" }}>
                Cancelar
              </button>
            </div>
          </div>
        );
      })()}

      {/* MODAL CONFIRMAR PAGAMENTO NO BALCÃO */}
      {/* A forma de pagamento é perguntada em vez de assumida: é ela que decide
          em qual faixa do fechamento de caixa a venda entra (dinheiro, pix,
          débito, crédito). Mandar um genérico jogaria toda venda de balcão na
          faixa errada e a conferência com a gaveta e com o extrato da
          maquininha deixaria de fechar. De quebra, a escolha vira uma
          confirmação de dois toques — um clique torto não libera pedido não
          pago para a cozinha. */}
      {confirmarPagamentoOrder && (() => {
        const ord = confirmarPagamentoOrder;
        const formas = ["Dinheiro", "Pix", "Cartão de débito", "Cartão de crédito"];
        return (
          <div onClick={() => setConfirmarPagamentoOrder(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 10002, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
            <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: "16px", padding: "24px", width: "100%", maxWidth: "400px", boxShadow: "0 25px 60px rgba(0,0,0,0.3)", textAlign: "center" }}>
              <div style={{ fontSize: "2rem", marginBottom: "6px" }}>💵</div>
              <div style={{ fontWeight: 800, fontSize: "1.1rem", color: "#0F172A" }}>
                Confirmar pagamento do #{getDisplayOrderNumber(ord)}
              </div>
              <div style={{ fontSize: "0.85rem", color: "#475569", marginTop: "4px" }}>
                {ord.customerName} — <strong>R$ {Number(ord.totalAmount || 0).toFixed(2).replace(".", ",")}</strong>
              </div>
              <div style={{ fontSize: "0.78rem", color: "#64748B", margin: "12px 0 14px", lineHeight: 1.4 }}>
                Só confirme com o dinheiro na mão: ao confirmar, o pedido vai para a cozinha, imprime e dá baixa no estoque.
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "16px" }}>
                {formas.map(forma => (
                  <button
                    key={forma}
                    disabled={loadingId === ord.id}
                    onClick={() => confirmarPagamento(ord.id, forma)}
                    style={{ padding: "11px", borderRadius: "10px", border: "1.5px solid #CBD5E1", background: "#F8FAFC", color: "#0F172A", fontWeight: 700, cursor: loadingId === ord.id ? "wait" : "pointer", fontSize: "0.9rem", fontFamily: "inherit" }}
                  >
                    {loadingId === ord.id ? "Confirmando..." : `Recebi em ${forma}`}
                  </button>
                ))}
              </div>
              <button onClick={() => setConfirmarPagamentoOrder(null)} style={{ padding: "8px 16px", borderRadius: "8px", border: "1px solid #E2E8F0", background: "#fff", color: "#64748B", fontWeight: 600, cursor: "pointer", fontSize: "0.85rem", fontFamily: "inherit" }}>
                Ainda não recebi
              </button>
            </div>
          </div>
        );
      })()}

      {/* DELIVERY INFO & ROUTE MAP MODAL */}
      {deliveryInfoModalOrder && (() => {
        const order = deliveryInfoModalOrder;
        const storeOriginAddress = user?.storeAddress || user?.address || (user?.city ? `São Francisco, ${user.city}` : "Sua Loja");
        const rawCustomerAddress = cleanAddress(order.customerAddress) || "Endereço do Cliente";

        const originFull = cleanAddressForMap(storeOriginAddress, user?.city);
        const destFull = cleanAddressForMap(rawCustomerAddress, user?.city || "Rio das Ostras");

        // Google Maps Directions Iframe URL (saddr = start/origem, daddr = destination/destino) -> gera a linha azul da rota e tempo estimado
        const mapEmbedUrl = `https://maps.google.com/maps?saddr=${encodeURIComponent(originFull)}&daddr=${encodeURIComponent(destFull)}&output=embed`;
        const googleMapsDirUrl = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(originFull)}&destination=${encodeURIComponent(destFull)}`;
        const wazeNavUrl = `https://waze.com/ul?q=${encodeURIComponent(destFull)}&navigate=yes`;

        return (
          <div
            onClick={() => setDeliveryInfoModalOrder(null)}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.65)",
              backdropFilter: "blur(4px)",
              zIndex: 10005,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "1rem",
            }}
          >
            <div
              onClick={e => e.stopPropagation()}
              style={{
                background: "#fff",
                borderRadius: "16px",
                width: "100%",
                maxWidth: "540px",
                maxHeight: "92vh",
                overflowY: "auto",
                boxShadow: "0 25px 60px rgba(0,0,0,0.35)",
                border: "1px solid #E2E8F0",
              }}
            >
              {/* Header */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid #F1F5F9" }}>
                <div style={{ fontWeight: 800, fontSize: "1.1rem", color: "#0F172A", display: "flex", alignItems: "center", gap: "8px" }}>
                  Informações da Entrega
                </div>
                <button
                  onClick={() => setDeliveryInfoModalOrder(null)}
                  style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: "1.2rem", color: "#64748B", padding: "4px" }}
                >
                  ✕
                </button>
              </div>

              <div style={{ padding: "20px" }}>
                {/* Entregador */}
                <div style={{ marginBottom: "16px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
                    <label style={{ fontSize: "0.82rem", fontWeight: 700, color: "#475569" }}>
                      Entregador
                    </label>
                  </div>
                  {(() => {
                    const pInfo = getPartnerDeliveryInfo(order);
                    return pInfo.isPartner ? (
                      <div
                        style={{
                          padding: "10px 12px",
                          borderRadius: "8px",
                          border: "2px solid #EF4444",
                          background: "#FEF2F2",
                          color: "#DC2626",
                          fontWeight: 800,
                          fontSize: "0.88rem",
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                        }}
                      >
                        🛵 Motoboy {pInfo.partnerName} (Entrega Parceira Bloqueada)
                      </div>
                    ) : (
                    <select
                      value={order.motoboyId || ""}
                      onChange={e => {
                        assignMotoboy(order.id, e.target.value);
                        setDeliveryInfoModalOrder((prev: any) => prev ? { ...prev, motoboyId: e.target.value } : null);
                      }}
                      style={{
                        width: "100%",
                        padding: "10px 12px",
                        borderRadius: "8px",
                        border: "1.5px solid #CBD5E1",
                        fontSize: "0.9rem",
                        fontWeight: 600,
                        color: "#0F172A",
                        background: "#F8FAFC",
                        outline: "none",
                      }}
                    >
                      <option value="">Nenhum motoboy da loja atribuído</option>
                      {motoboys?.map((m: any) => (
                        <option key={m.id} value={m.id}>
                          {m.name} {m.phone ? `(${m.phone})` : ""}
                        </option>
                      ))}
                    </select>
                  );
                })()}
                </div>

                {/* Rota de Entrega */}
                <div style={{ marginBottom: "14px" }}>
                  <div style={{ fontWeight: 800, fontSize: "0.95rem", color: "#2563EB", marginBottom: "6px" }}>
                    Rota de entrega
                  </div>
                  <div style={{ fontSize: "0.84rem", color: "#334155", lineHeight: "1.5", background: "#F8FAFC", padding: "10px 12px", borderRadius: "8px", border: "1px solid #E2E8F0" }}>
                    <div><span style={{ color: "#2563EB", fontWeight: 700 }}>↗ De:</span> {originFull}</div>
                    <div style={{ marginTop: "4px" }}><span style={{ color: "#059669", fontWeight: 700 }}>📍 Para:</span> {rawCustomerAddress}</div>
                    {destFull !== rawCustomerAddress && (
                      <div style={{ marginTop: "4px", fontSize: "0.78rem", color: "#64748B" }}>
                        <span style={{ fontWeight: 700 }}>🗺️ Busca do Mapa:</span> {destFull}
                      </div>
                    )}
                  </div>
                </div>

                {/* Google Maps / Embed Rota com linha azul */}
                <div style={{ marginBottom: "14px", borderRadius: "12px", overflow: "hidden", border: "1px solid #CBD5E1", height: "280px", background: "#E2E8F0" }}>
                  <iframe
                    title="Mapa de Rota de Entrega"
                    width="100%"
                    height="100%"
                    frameBorder="0"
                    style={{ border: 0 }}
                    src={mapEmbedUrl}
                    allowFullScreen
                  />
                </div>

                {/* Botões de GPS Direto (Google Maps / Waze) */}
                <div style={{ display: "flex", gap: "10px", marginBottom: "16px" }}>
                  <a
                    href={googleMapsDirUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ flex: 1, textDecoration: "none", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", padding: "9px 12px", borderRadius: "8px", background: "#2563EB", color: "#fff", fontWeight: 700, fontSize: "0.82rem" }}
                  >
                    🗺️ Abrir no Google Maps
                  </a>
                  <a
                    href={wazeNavUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ flex: 1, textDecoration: "none", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", padding: "9px 12px", borderRadius: "8px", background: "#0284C7", color: "#fff", fontWeight: 700, fontSize: "0.82rem" }}
                  >
                    🧭 Abrir no Waze
                  </a>
                </div>

                {/* Botões de Ação */}
                <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", borderTop: "1px solid #F1F5F9", paddingTop: "12px" }}>
                  <button
                    onClick={() => setDeliveryInfoModalOrder(null)}
                    style={{ padding: "8px 18px", borderRadius: "8px", border: "1px solid #CBD5E1", background: "#64748B", color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: "0.85rem" }}
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={() => setDeliveryInfoModalOrder(null)}
                    style={{ padding: "8px 18px", borderRadius: "8px", border: "none", background: "#2563EB", color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: "0.85rem" }}
                  >
                    Confirmar
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* DIGITAL RECEIPT PREVIEW MODAL */}
      {viewReceiptOrderId && (() => {
        const order = orders.find(o => o.id === viewReceiptOrderId);
        if (!order) return null;

        const rawPhone = order.customerPhone || "";
        const phoneDigits = rawPhone.replace(/\D/g, "");
        let phone = rawPhone;
        if (phoneDigits.length >= 10 && phoneDigits.length <= 13) {
          phone = phoneDigits.length === 13 && phoneDigits.startsWith("55")
            ? `+55 (${phoneDigits.slice(2, 4)}) ${phoneDigits.slice(4, 9)}-${phoneDigits.slice(9)}`
            : phoneDigits.length === 11
            ? `(${phoneDigits.slice(0, 2)}) ${phoneDigits.slice(2, 7)}-${phoneDigits.slice(7)}`
            : rawPhone;
        }
        const createdDate = new Date(order.createdAt);
        const dateStr = createdDate.toLocaleDateString("pt-BR", { year: "2-digit", month: "2-digit", day: "2-digit" });
        const timeStr = createdDate.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
        const isDelivery = order.deliveryType === "DELIVERY";
        const seqNum = getDisplayOrderNumber(order);
        const subtotal = order.items?.reduce((sum: number, it: any) => sum + getItemEffectivePrice(it, order.items, order.totalAmount, order.deliveryFee || 0, order.discountTotal || 0) * it.quantity, 0) || order.totalAmount;

        return (
          <div onClick={() => setViewReceiptOrderId(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 10003, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
            <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: "16px", padding: "24px", width: "100%", maxWidth: receiptPaperSize === "58mm" ? "380px" : "450px", maxHeight: "90vh", overflowY: "auto", boxShadow: "0 25px 60px rgba(0,0,0,0.3)" }}>
              
              {/* Toggle de Formato POS 80 / POS 58 */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px", background: "#F9FAFB", padding: "8px 12px", borderRadius: "10px", border: "1px solid #E5E7EB" }}>
                <span style={{ fontSize: "0.8rem", fontWeight: 700, color: "#374151" }}>🖨️ Bobina:</span>
                <div style={{ display: "flex", gap: "6px" }}>
                  <button
                    type="button"
                    onClick={() => setReceiptPaperSize("80mm")}
                    style={{
                      padding: "4px 10px", borderRadius: "6px", fontSize: "0.75rem", fontWeight: 700,
                      border: `1.5px solid ${receiptPaperSize === "80mm" ? "#C62828" : "#E5E7EB"}`,
                      background: receiptPaperSize === "80mm" ? "#C6282810" : "#FFF",
                      color: receiptPaperSize === "80mm" ? "#C62828" : "#6B7280", cursor: "pointer", fontFamily: "inherit"
                    }}
                  >
                    📄 POS 80 (80mm)
                  </button>
                  <button
                    type="button"
                    onClick={() => setReceiptPaperSize("58mm")}
                    style={{
                      padding: "4px 10px", borderRadius: "6px", fontSize: "0.75rem", fontWeight: 700,
                      border: `1.5px solid ${receiptPaperSize === "58mm" ? "#C62828" : "#E5E7EB"}`,
                      background: receiptPaperSize === "58mm" ? "#C6282810" : "#FFF",
                      color: receiptPaperSize === "58mm" ? "#C62828" : "#6B7280", cursor: "pointer", fontFamily: "inherit"
                    }}
                  >
                    🧾 POS 58 (58mm)
                  </button>
                </div>
              </div>

              <div style={{
                fontFamily: "'Courier New', monospace",
                fontSize: receiptPaperSize === "58mm" ? "11px" : "13px",
                color: "#000",
                lineHeight: "1.4",
                border: "2px solid #000",
                padding: receiptPaperSize === "58mm" ? "12px" : "20px",
                borderRadius: "8px",
                background: "#FFF",
                maxWidth: receiptPaperSize === "58mm" ? "280px" : "100%",
                margin: "0 auto"
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", borderBottom: "1px dashed #000", paddingBottom: "10px", marginBottom: "10px" }}>
                  <span style={{ fontSize: "22px", fontWeight: "bold" }}>{seqNum}   {isDelivery ? "DELIVERY" : "RETIRADA"}</span>
                  <span style={{ fontSize: "16px", fontWeight: "bold" }}>{`#${order.ifoodReference || order.openDeliveryReference || (order.id ? order.id.slice(-6).toUpperCase() : "")}`}</span>
                </div>

                <div style={{ fontSize: "13px", fontWeight: 900, color: "#000", marginBottom: "10px", background: "#F1F5F9", padding: "6px 8px", borderRadius: "4px", border: "1px solid #CBD5E1", textAlign: "center" }}>
                  📅 DATA E HORA DO PEDIDO: {dateStr} às {timeStr}
                </div>

                <div style={{ marginBottom: "12px" }}>
                  <div>Estabelecimento: <strong style={{ textTransform: "uppercase" }}>{storeName}</strong></div>
                  <div>N° do Pedido: {order.ifoodReference || order.openDeliveryReference || (order.id ? order.id.slice(-6).toUpperCase() : "")}</div>
                </div>

                {(() => {
                  const pInfo = getPartnerDeliveryInfo(order);
                  if (!pInfo.isPartner || !pInfo.pickupCode) return null;
                  return (
                    <div style={{ border: "2px solid #7C3AED", background: "#F3E8FF", padding: "8px 10px", textAlign: "center", fontWeight: "bold", margin: "10px 0", borderRadius: "6px" }}>
                      <div style={{ fontSize: "11px", color: "#6B21A8", textTransform: "uppercase" }}>🔑 CÓDIGO DE COLETA P/ ENTREGADOR {pInfo.partnerName.toUpperCase()}</div>
                      <div style={{ fontSize: "20px", fontWeight: 900, color: "#581C87" }}>#{pInfo.pickupCode}</div>
                    </div>
                  );
                })()}

                <div style={{ textAlign: "center", margin: "14px 0 8px 0", position: "relative" }}>
                  <span style={{ background: "#FFF", padding: "0 10px", fontWeight: "bold", position: "relative", zIndex: 2 }}>CLIENTE</span>
                  <div style={{ position: "absolute", top: "50%", left: 0, right: 0, borderTop: "1px solid #000", zIndex: 1 }}></div>
                </div>

                <div style={{ marginBottom: "14px" }}>
                  <div>Nome: {order.customerName}</div>
                  <div>Telefone: {phone}</div>
                  <div>Qtd Pedidos: 1</div>
                </div>

                {isDelivery && order.customerAddress && (
                  <>
                    <div style={{ textAlign: "center", margin: "14px 0 8px 0", position: "relative" }}>
                      <span style={{ background: "#FFF", padding: "0 10px", fontWeight: "bold", position: "relative", zIndex: 2 }}>ENTREGA</span>
                      <div style={{ position: "absolute", top: "50%", left: 0, right: 0, borderTop: "1px solid #000", zIndex: 1 }}></div>
                    </div>
                    <div style={{ marginBottom: "14px" }}>
                      <div>Endereço: {cleanAddress(order.customerAddress)}</div>
                      {order.notes && <div>Obs: {order.notes}</div>}
                    </div>
                  </>
                )}

                {Boolean((order.items || []).some((item: any) => isBeverageItem(item))) && (
                  <div style={{ border: "2px solid #000", padding: "6px", textAlign: "center", fontWeight: "bold", margin: "10px 0", fontSize: "13px" }}>
                    🥤 *** ATENÇÃO: POSSUI BEBIDA ***
                  </div>
                )}

                <div style={{ textAlign: "center", margin: "14px 0 8px 0", position: "relative" }}>
                  <span style={{ background: "#FFF", padding: "0 10px", fontWeight: "bold", position: "relative", zIndex: 2 }}>RESUMO DO PEDIDO</span>
                  <div style={{ position: "absolute", top: "50%", left: 0, right: 0, borderTop: "1px solid #000", zIndex: 1 }}></div>
                </div>

                <div style={{ marginBottom: "14px" }}>
                  {order.items?.map((item: any) => {
                    const comboSels = parseComboSelections(item.comboSelections, item.quantity);
                    const nameParts = nomeDoItem(item).split(" | ");
                    const mainName = nameParts[0].trim();
                    const extras = nameParts.slice(1);
                    const itemPrice = getItemEffectivePrice(item, order.items, order.totalAmount, order.deliveryFee || 0, order.discountTotal || 0);
                    const isStandaloneBeverage = comboSels.length === 0 && isBeverageItem(item);

                    return (
                      <div key={item.id} style={{
                        border: "1.5px solid #000",
                        padding: "8px 10px",
                        borderRadius: "4px",
                        marginBottom: "8px"
                      }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontWeight: "bold", marginBottom: "4px" }}>
                          <span>Qtd: {item.quantity}x</span>
                          <span>Valor: R$ {(itemPrice * item.quantity).toFixed(2).replace('.', ',')}</span>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontWeight: "bold" }}>
                          <span>{mainName}</span>
                          {isStandaloneBeverage && (
                            <span style={{
                              background: "#000",
                              color: "#fff",
                              fontSize: "14px",
                              fontWeight: 900,
                              fontFamily: "monospace, sans-serif",
                              padding: "2px 8px",
                              borderRadius: "3px",
                              letterSpacing: "1px",
                              whiteSpace: "nowrap"
                            }}>
                              [BEBIDA]
                            </span>
                          )}
                        </div>
                        
                        {comboSels.length > 0 && (
                          <div style={{ paddingLeft: "10px", fontSize: "11px" }}>
                            {comboSels.map((sel: any, i: number) => {
                              const totalQty = sel.quantity || 1;
                              const isSubBeverage = isBeverageName(sel.name);
                              return (
                                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "3px 0" }}>
                                  <span style={{ fontSize: isSubBeverage ? "12px" : "11px", fontWeight: isSubBeverage ? "bold" : "normal" }}>
                                    - {totalQty > 1 ? `${totalQty}x ` : ""}{sel.name}
                                  </span>
                                  {isSubBeverage && (
                                    <span style={{
                                      background: "#000",
                                      color: "#fff",
                                      fontSize: "14px",
                                      fontWeight: 900,
                                      fontFamily: "monospace, sans-serif",
                                      padding: "2px 8px",
                                      borderRadius: "3px",
                                      letterSpacing: "1px",
                                      whiteSpace: "nowrap"
                                    }}>
                                      [BEBIDA]
                                    </span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                        {comboSels.length === 0 && extras.length > 0 && (
                          <div style={{ paddingLeft: "10px", fontSize: "11px" }}>
                            {extras.map((ext: string, i: number) => {
                              const isExtraBeverage = isBeverageName(ext);
                              return (
                                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "3px 0" }}>
                                  <span style={{ fontSize: isExtraBeverage ? "12px" : "11px", fontWeight: isExtraBeverage ? "bold" : "normal" }}>
                                    - {ext.trim()}
                                  </span>
                                  {isExtraBeverage && (
                                    <span style={{
                                      background: "#000",
                                      color: "#fff",
                                      fontSize: "14px",
                                      fontWeight: 900,
                                      fontFamily: "monospace, sans-serif",
                                      padding: "2px 8px",
                                      borderRadius: "3px",
                                      letterSpacing: "1px",
                                      whiteSpace: "nowrap"
                                    }}>
                                      [BEBIDA]
                                    </span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div style={{ paddingTop: "8px", marginBottom: "10px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>Subtotal:</span>
                    <span>R$ {subtotal.toFixed(2).replace('.', ',')}</span>
                  </div>
                  {order.discountTotal && order.discountTotal > 0 && (
                    <div style={{ display: "flex", justifyContent: "space-between", color: "#EF4444" }}>
                      {/* Mostra o cupom que gerou o desconto (ex.: "Cupom HAKIM10 (-10%)").
                          Antes dizia sempre "Cupom - Loja", sem dizer qual nem por quê. */}
                      <span>{(order as any).discountDetails?.[0]?.description || "Desconto (Cupom)"}:</span>
                      <span>-R$ {Number(order.discountTotal).toFixed(2).replace('.', ',')}</span>
                    </div>
                  )}
                  {isDelivery && (
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>Taxa de Entrega:</span>
                      <span>R$ {Number(order.deliveryFee || 0).toFixed(2).replace('.', ',')}</span>
                    </div>
                  )}
                  
                  {/* Total Box */}
                  <div style={{ border: "1.5px solid #000", padding: "6px 10px", borderRadius: "4px", margin: "8px 0", display: "flex", justifyContent: "space-between", fontWeight: "bold", fontSize: "15px" }}>
                    <span>Total:</span>
                    <span>R$ {order.totalAmount.toFixed(2).replace('.', ',')}</span>
                  </div>
                </div>

                {(() => {
                  const payMethodRaw = order.paymentMethod || "";
                  const payMethodClean = payMethodRaw.toLowerCase();

                  // Explicit offline check: if it contains "cobrar", "entrega", "maquin", "dinheiro", "troco", or "pendente" -> MUST BE OFFLINE (Cobrar na Entrega)
                  const isExplicitOffline =
                    /cobrar|entrega|maquin|dinheiro|troco|pendente|presencial|balc/i.test(payMethodClean) ||
                    (order as any).isPrepaid === false ||
                    (order as any).prepaid === false;

                  // Explicit online check: ONLY online if NOT explicit offline AND (contains "pago online", "online", "prepaid", "app" OR isPrepaid === true)
                  const isOnline = !isExplicitOffline && (
                    /pago online|online|prepaid|ifood pago|jotajá pago|jotaja pago|app/i.test(payMethodClean) ||
                    (order as any).isPrepaid === true
                  );

                  const onlineSource = order.source === "IFOOD" ? "iFood" : order.source === "JOTAJA" ? "JotaJá" : order.source === "BRENDI" ? "Brendi" : "Online";

                  let baseMethod = translatePayment(payMethodRaw).replace(/\s*\([^)]*\)/gi, "").trim();
                  if (!baseMethod) baseMethod = "Cartão";

                  if (isOnline) {
                    return (
                      <div style={{ fontWeight: "bold", marginTop: "10px", fontSize: "12px" }}>
                        Forma de Pagamento: {baseMethod} (Online) - Pago via {onlineSource} (NÃO COBRAR)
                      </div>
                    );
                  } else {
                    return (
                      <div style={{ marginTop: "10px" }}>
                        <div style={{ fontWeight: "bold", fontSize: "13px", color: "#000" }}>
                          Forma de Pagamento: {baseMethod} (Cobrar na Entrega)
                        </div>
                        {order.changeAmount != null && Number(order.changeAmount) > 0 && (() => {
                          const changeVal = Number(order.changeAmount);
                          const changeToGive = changeVal > order.totalAmount ? (changeVal - order.totalAmount) : 0;
                          return (
                            <div style={{ marginTop: "6px", padding: "6px 8px", background: "#FFF3E0", border: "1.5px solid #000", borderRadius: "4px" }}>
                              <div style={{ fontSize: "13px", fontWeight: 900, color: "#000" }}>
                                💵 Troco para: R$ {changeVal.toFixed(2).replace('.', ',')}
                              </div>
                              {changeToGive > 0 && (
                                <div style={{ color: "#C62828", fontSize: "13px", fontWeight: 900, marginTop: "3px" }}>
                                  👉 SEPARAR R$ {changeToGive.toFixed(2).replace('.', ',')} DE TROCO
                                </div>
                              )}
                            </div>
                          );
                        })()}
                        <div style={{
                          marginTop: "10px",
                          padding: "8px 10px",
                          background: "#000",
                          color: "#FFF",
                          borderRadius: "4px",
                          fontWeight: 900,
                          fontSize: "14px",
                          textAlign: "center",
                          border: "2px solid #000",
                          letterSpacing: "0.5px"
                        }}>
                          🚨 COBRAR DO CLIENTE NA ENTREGA: R$ {order.totalAmount.toFixed(2).replace('.', ',')}
                        </div>
                      </div>
                    );
                  }
                })()}
              </div>

              <div style={{ marginTop: "16px", display: "flex", justifyContent: "center" }}>
                <button
                  onClick={() => setViewReceiptOrderId(null)}
                  style={{
                    padding: "8px 24px",
                    borderRadius: "8px",
                    border: "none",
                    background: "#1E293B",
                    color: "#FFF",
                    fontWeight: 700,
                    cursor: "pointer",
                    fontSize: "0.85rem"
                  }}
                >
                  Fechar
                </button>
              </div>

            </div>
          </div>
        );
      })()}
      {/* MODAL MOTOBOY IFOOD — Cotação + Confirmação */}
      {ifoodDriverModalId && (() => {
        const driverOrder = orders.find(o => o.id === ifoodDriverModalId);
        return (
          <div onClick={() => { setIfoodDriverModalId(null); setIfoodDriverQuote(null); setIfoodDriverError(""); }} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 10001, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
            <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: "16px", padding: "24px", width: "100%", maxWidth: "400px", boxShadow: "0 25px 60px rgba(0,0,0,0.3)" }}>
              <div style={{ textAlign: "center", marginBottom: "16px" }}>
                <div style={{ fontSize: "2.5rem", marginBottom: "8px" }}>🛵</div>
                <div style={{ fontWeight: 800, fontSize: "1.15rem", color: "#1D4ED8" }}>Solicitar Motoboy iFood</div>
              </div>

              {/* Order info */}
              {driverOrder && (
                <div style={{ background: "#F8FAFC", borderRadius: "8px", padding: "10px 14px", marginBottom: "12px", fontSize: "0.82rem" }}>
                  <div><strong>Pedido:</strong> #{driverOrder.ifoodReference || driverOrder.openDeliveryReference || driverOrder.id.slice(-6).toUpperCase()}</div>
                  {driverOrder.customerAddress && <div style={{ color: "#6B7280", marginTop: "2px" }}>{cleanAddress(driverOrder.customerAddress)}</div>}
                </div>
              )}

              {/* Loading */}
              {ifoodDriverLoading && !ifoodDriverQuote && (
                <div style={{ textAlign: "center", padding: "20px", color: "#6B7280" }}>
                  <div style={{ fontSize: "1.5rem", marginBottom: "8px" }}>⏳</div>
                  Consultando disponibilidade...
                </div>
              )}

              {/* Error */}
              {ifoodDriverError && (
                <div style={{ background: "#FEF2F2", borderRadius: "8px", padding: "12px", marginBottom: "12px", border: "1px solid #FECACA" }}>
                  <div style={{ fontSize: "0.85rem", fontWeight: 600, color: "#DC2626" }}>❌ {ifoodDriverError}</div>
                </div>
              )}

              {/* Quote */}
              {ifoodDriverQuote && (
                <div style={{ background: "#EFF6FF", borderRadius: "12px", padding: "16px", marginBottom: "16px", border: "2px solid #BFDBFE" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                    <div>
                      <div style={{ fontSize: "0.72rem", fontWeight: 600, color: "#6B7280", textTransform: "uppercase", letterSpacing: "0.04em" }}>Custo</div>
                      <div style={{ fontSize: "1.3rem", fontWeight: 800, color: "#1D4ED8" }}>R$ {Number(ifoodDriverQuote.price).toFixed(2).replace('.', ',')}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: "0.72rem", fontWeight: 600, color: "#6B7280", textTransform: "uppercase", letterSpacing: "0.04em" }}>Tempo estimado</div>
                      <div style={{ fontSize: "1.3rem", fontWeight: 800, color: "#059669" }}>~{ifoodDriverQuote.estimatedMinutes ?? "?"}min</div>
                    </div>
                  </div>
                  <div style={{ fontSize: "0.75rem", color: "#6B7280", borderTop: "1px solid #BFDBFE", paddingTop: "6px" }}>
                    ⚠️ O valor será cobrado pela plataforma iFood.
                  </div>
                </div>
              )}

              {/* Buttons */}
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button onClick={() => { setIfoodDriverModalId(null); setIfoodDriverQuote(null); setIfoodDriverError(""); }} style={{ flex: 1, padding: "0.65rem", borderRadius: "8px", border: "1px solid #D1D5DB", background: "#fff", color: "#374151", fontWeight: 600, cursor: "pointer", fontSize: "0.85rem", fontFamily: "inherit" }}>Cancelar</button>
                {ifoodDriverQuote && (
                  <button onClick={requestIfoodDriver} disabled={ifoodDriverLoading} style={{ flex: 1, padding: "0.65rem", borderRadius: "8px", border: "none", background: "linear-gradient(135deg, #3B82F6, #1D4ED8)", color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: "0.85rem", fontFamily: "inherit" }}>
                    {ifoodDriverLoading ? "Solicitando..." : "✅ Confirmar e Chamar"}
                  </button>
                )}
                {ifoodDriverError && !ifoodDriverQuote && (
                  <button onClick={() => fetchIfoodDriverQuote(ifoodDriverModalId)} style={{ flex: 1, padding: "0.65rem", borderRadius: "8px", border: "none", background: "#3B82F6", color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: "0.85rem", fontFamily: "inherit" }}>
                    🔄 Tentar novamente
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}
      {/* MODAL NEGOCIAÇÃO DE CANCELAMENTO OU PREVISÃO DE ENTREGA (iFood) */}
      {(() => {
        const disputeOrder = orders.find((o: any) => o.cancelDispute?.pending === true);
        if (!disputeOrder) return null;
        const dispute = (disputeOrder as any).cancelDispute;
        const orderNum = getDisplayOrderNumber(disputeOrder);
        const expiresAt = dispute.expiresAt ? new Date(dispute.expiresAt) : null;
        const timeLeft = expiresAt ? Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000)) : null;
        const timeLeftMin = timeLeft != null ? Math.floor(timeLeft / 60) : 0;
        const timeLeftSec = timeLeft != null ? String(timeLeft % 60).padStart(2, "0") : "00";

        const isDueDateChange = dispute.type === "DUE_DATE_CHANGE" || dispute.reason?.toLowerCase().includes("previsão") || dispute.reason?.toLowerCase().includes("atrasado");

        if (isDueDateChange) {
          return (
            <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 10002, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
              <div style={{ background: "#fff", borderRadius: "16px", padding: "24px", width: "100%", maxWidth: "460px", boxShadow: "0 25px 60px rgba(0,0,0,0.35)", position: "relative" }}>
                
                {/* Header */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
                  <h3 style={{ fontWeight: 800, fontSize: "1.05rem", color: "#0F172A", margin: 0 }}>
                    Informe uma nova previsão de entrega pro pedido #{orderNum}
                  </h3>
                </div>

                {/* Countdown banner */}
                <div style={{ background: "#FEF2F2", border: "1px solid #FCA5A5", borderRadius: "10px", padding: "10px 14px", marginBottom: "16px" }}>
                  <div style={{ fontWeight: 800, fontSize: "0.85rem", color: "#991B1B" }}>
                    Você tem {timeLeftMin} minutos e {timeLeftSec} segundos para responder
                  </div>
                  <div style={{ fontSize: "0.78rem", color: "#7F1D1D", marginTop: 2 }}>
                    Caso não responda, {disputeOrder.customerName || "o cliente"} pode recorrer ao iFood
                  </div>
                </div>

                {/* Customer Query Card Box */}
                <div style={{ background: "#F8FAFC", borderRadius: "12px", border: "1px solid #E2E8F0", padding: "14px 16px", marginBottom: "18px" }}>
                  <div style={{ fontWeight: 800, fontSize: "0.92rem", color: "#0F172A", marginBottom: 4 }}>
                    Meu pedido está atrasado
                  </div>
                  <p style={{ margin: "0 0 12px", fontSize: "0.82rem", color: "#475569", lineHeight: 1.4 }}>
                    {dispute.reason || "O pedido está atrasado. Quero uma nova previsão de entrega."}
                  </p>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 34, height: 34, borderRadius: "50%", background: "#EA1D2C", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: "0.82rem", flexShrink: 0 }}>
                      {disputeOrder.customerName ? disputeOrder.customerName.slice(0, 2).toUpperCase() : "IF"}
                    </div>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: "0.85rem", color: "#0F172A" }}>{disputeOrder.customerName}</div>
                      <div style={{ fontSize: "0.75rem", color: "#64748B" }}>0 pedidos na loja</div>
                    </div>
                  </div>
                </div>

                {/* Dropdown 1: Quanto tempo a mais */}
                <div style={{ marginBottom: "16px" }}>
                  <label style={{ display: "block", fontWeight: 700, fontSize: "0.82rem", color: "#0F172A", marginBottom: 6 }}>
                    Quanto tempo a mais você precisa para entregar o pedido?
                  </label>
                  <select
                    value={dueDateExtraMinutes}
                    onChange={(e) => setDueDateExtraMinutes(Number(e.target.value))}
                    style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1.5px solid #CBD5E1", fontSize: "0.88rem", fontWeight: 600, background: "#fff", color: "#0F172A" }}
                  >
                    <option value={10}>10 minutos</option>
                    <option value={15}>15 minutos</option>
                    <option value={20}>20 minutos</option>
                    <option value={30}>30 minutos</option>
                    <option value={45}>45 minutos</option>
                  </select>
                  <div style={{ fontSize: "0.74rem", color: "#64748B", marginTop: 4 }}>
                    O cliente pode ou não aceitar sua proposta de tempo.
                  </div>
                </div>

                {/* Dropdown 2: Motivo do atraso */}
                <div style={{ marginBottom: "20px" }}>
                  <label style={{ display: "block", fontWeight: 700, fontSize: "0.82rem", color: "#0F172A", marginBottom: 6 }}>
                    Selecione qual é o motivo do atraso
                  </label>
                  <select
                    value={dueDateReason}
                    onChange={(e) => setDueDateReason(e.target.value)}
                    style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1.5px solid #CBD5E1", fontSize: "0.88rem", fontWeight: 600, background: "#fff", color: "#0F172A" }}
                  >
                    <option value="OUT_FOR_DELIVERY">Pedido saiu para entrega</option>
                    <option value="HIGH_DEMAND">Alta demanda de pedidos</option>
                    <option value="PREPARATION_DELAY">Problema no preparo</option>
                    <option value="WEATHER">Alagamento / Chuva</option>
                  </select>
                </div>

                {/* Buttons */}
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <button
                    disabled={!!loadingId}
                    onClick={async () => {
                      setLoadingId(disputeOrder.id);
                      try {
                        const r = await fetch("/api/customer-order/dispute", {
                          method: "PUT",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            orderId: disputeOrder.id,
                            action: "update_delivery_time",
                            additionalMinutes: dueDateExtraMinutes,
                            reason: dueDateReason,
                          }),
                        });
                        if (r.ok) {
                          setOrders((prev) => prev.map((o) => (o.id === disputeOrder.id ? { ...o, cancelDispute: { ...dispute, pending: false } } : o)));
                          showToast("✅ Previsão de entrega enviada ao iFood com sucesso!", "#16A34A");
                          router.refresh();
                        }
                      } catch {} finally {
                        setLoadingId(null);
                      }
                    }}
                    style={{ width: "100%", padding: "12px", borderRadius: 10, border: "none", background: "#EA1D2C", color: "#fff", fontWeight: 800, cursor: "pointer", fontSize: "0.92rem", fontFamily: "inherit" }}
                  >
                    {loadingId === disputeOrder.id ? "Enviando..." : "Atualizar previsão de entrega"}
                  </button>

                  <button
                    disabled={!!loadingId}
                    onClick={async () => {
                      if (!confirm("Tem certeza que o pedido não será entregue?")) return;
                      setLoadingId(disputeOrder.id);
                      try {
                        const r = await fetch("/api/customer-order/dispute", {
                          method: "PUT",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ orderId: disputeOrder.id, action: "deny_delivery" }),
                        });
                        if (r.ok) {
                          setOrders((prev) => prev.map((o) => (o.id === disputeOrder.id ? { ...o, cancelDispute: { ...dispute, pending: false } } : o)));
                          showToast("Resposta enviada ao iFood.", "#374151");
                          router.refresh();
                        }
                      } catch {} finally {
                        setLoadingId(null);
                      }
                    }}
                    style={{ width: "100%", padding: "12px", borderRadius: 10, border: "2px solid #EA1D2C", background: "#fff", color: "#EA1D2C", fontWeight: 800, cursor: "pointer", fontSize: "0.92rem", fontFamily: "inherit" }}
                  >
                    Pedido não será mais entregue
                  </button>
                </div>

              </div>
            </div>
          );
        }

        const timeLeftStr = timeLeft != null ? `${Math.floor(timeLeft / 60)}:${String(timeLeft % 60).padStart(2, "0")}` : null;

        const isResend = dispute.type === "RESEND_ITEMS" || /reenvio|reenviar|repor|substituir|troca/i.test(dispute.reason || "");
        const isRefund = dispute.type === "REFUND_ITEMS" || /reembolso|reembolsar/i.test(dispute.reason || "");
        const isDueDate = dispute.type === "DUE_DATE_CHANGE" || /previsão|atraso|tempo/i.test(dispute.reason || "");

        const modalEmoji = isResend ? "📦" : isRefund ? "💰" : isDueDate ? "⏱️" : "⚠️";
        const modalTitle = isResend
          ? `Pedido #${orderNum}: Solicitação de Reenvio de Item`
          : isRefund
          ? `Pedido #${orderNum}: Solicitação de Reembolso`
          : isDueDate
          ? `Pedido #${orderNum}: Nova Previsão de Entrega`
          : `Pedido #${orderNum} em negociação`;

        const modalSubtitle = isResend
          ? `O cliente prefere o reenvio de itens para resolver o problema no iFood.`
          : isRefund
          ? `O cliente solicitou o reembolso de um item pelo iFood.`
          : isDueDate
          ? `O cliente pediu atualização do tempo de entrega pelo iFood.`
          : `O cliente solicitou o cancelamento ${(disputeOrder as any).source === "JOTAJA" ? "pelo JotaJá" : (disputeOrder as any).source === "BRENDI" ? "pela Brendi" : "pelo iFood"}`;

        const boxBg = isResend ? "#EFF6FF" : isRefund ? "#ECFDF5" : "#FEF3C7";
        const boxBorder = isResend ? "#93C5FD" : isRefund ? "#A7F3D0" : "#FDE68A";
        const boxTitleColor = isResend ? "#1D4ED8" : isRefund ? "#047857" : "#92400E";
        const boxTextColor = isResend ? "#1E40AF" : isRefund ? "#065F46" : "#78350F";

        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 10002, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
            <div style={{ background: "#fff", borderRadius: "16px", padding: "24px", width: "100%", maxWidth: "450px", boxShadow: "0 25px 60px rgba(0,0,0,0.35)", border: `3px solid ${isResend ? "#2563EB" : isRefund ? "#10B981" : "#F59E0B"}` }}>
              <div style={{ textAlign: "center", marginBottom: "16px" }}>
                <div style={{ fontSize: "2.5rem", marginBottom: "8px" }}>{modalEmoji}</div>
                <div style={{ fontWeight: 800, fontSize: "1.15rem", color: isResend ? "#1E40AF" : "#92400E" }}>{modalTitle}</div>
                <div style={{ fontSize: "0.82rem", color: "#4B5563", marginTop: "4px", fontWeight: 600 }}>{modalSubtitle}</div>
                {timeLeftStr && (
                  <div style={{ marginTop: "8px", padding: "4px 12px", display: "inline-block", background: timeLeft! < 60 ? "#FEE2E2" : "#FEF3C7", borderRadius: "20px", fontSize: "0.78rem", fontWeight: 700, color: timeLeft! < 60 ? "#DC2626" : "#92400E" }}>
                    ⏱ Tempo para responder no iFood: {timeLeftStr}
                  </div>
                )}
              </div>
              <div style={{ background: boxBg, borderRadius: "10px", padding: "14px", marginBottom: "16px", border: `1px solid ${boxBorder}` }}>
                <div style={{ fontSize: "0.75rem", fontWeight: 800, color: boxTitleColor, marginBottom: "4px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  {isResend ? "📦 SOLICITAÇÃO DO CLIENTE / MOTIVO:" : "MOTIVO DO CLIENTE:"}
                </div>
                <div style={{ fontSize: "0.95rem", color: boxTextColor, fontWeight: 700 }}>"{dispute.reason || "Cliente prefere o reenvio de itens pra resolver o problema."}"</div>
                {dispute.requestedAt && (
                  <div style={{ fontSize: "0.72rem", color: boxTitleColor, marginTop: "6px" }}>
                    Solicitado às {new Date(dispute.requestedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                  </div>
                )}
              </div>
              <div style={{ background: "#F9FAFB", borderRadius: "8px", padding: "10px", marginBottom: "16px", fontSize: "0.8rem", color: "#4B5563" }}>
                <strong>Cliente:</strong> {disputeOrder.customerName} — {disputeOrder.customerPhone}<br/>
                <strong>Valor:</strong> R$ {disputeOrder.totalAmount?.toFixed(2)}<br/>
                {(disputeOrder.ifoodReference || disputeOrder.openDeliveryReference) && <><strong>{disputeOrder.openDeliveryReference ? ((disputeOrder as any).source === "BRENDI" ? "Brendi" : "Jotajá") : "iFood"}:</strong> #{disputeOrder.ifoodReference || disputeOrder.openDeliveryReference}</>}
              </div>
              {/* Campo de motivo para resposta */}
              <div style={{ marginBottom: "16px" }}>
                <label style={{ fontSize: "0.75rem", fontWeight: 700, color: "#374151", display: "block", marginBottom: "6px" }}>Sua resposta ao cliente (opcional/obrigatório para recusar):</label>
                <textarea
                  id="dispute-deny-reason"
                  placeholder={isResend ? "Ex: Reenviaremos o item em até 25 minutos..." : "Ex: O pedido já foi preparado e entregue corretamente..."}
                  rows={3}
                  style={{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid #D1D5DB", fontSize: "0.85rem", fontFamily: "inherit", resize: "vertical", boxSizing: "border-box" }}
                />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                <button
                  disabled={!!loadingId}
                  onClick={async () => {
                    const reasonEl = document.getElementById("dispute-deny-reason") as HTMLTextAreaElement;
                    const reason = reasonEl?.value?.trim() || (isResend ? "Item será reenviado" : "Pedido mantido conforme solicitado");
                    setLoadingId(disputeOrder.id);
                    try {
                      let r: Response;
                      // Canal decide a rota: BRENDI antes do JotaJá porque os
                      // dois compartilham o openDeliveryOrderId — e a rota da
                      // Brendi fala `acao` (nasceu em português), não `action`.
                      if ((disputeOrder as any).source === "BRENDI" && (disputeOrder as any).openDeliveryOrderId) {
                        r = await fetch("/api/customer-order/brendi-action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId: (disputeOrder as any).openDeliveryOrderId, acao: "deny_cancellation", reason }) });
                      } else if ((disputeOrder as any).source === "JOTAJA" && (disputeOrder as any).openDeliveryOrderId) {
                        r = await fetch("/api/customer-order/jotaja-action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId: (disputeOrder as any).openDeliveryOrderId, action: "deny_cancellation", reason }) });
                      } else {
                        r = await fetch("/api/customer-order/dispute", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId: disputeOrder.id, action: "deny", denyReason: reason }) });
                      }
                      if (r.ok) { setOrders(prev => prev.map(o => o.id === disputeOrder.id ? { ...o, cancelDispute: { ...dispute, pending: false } } : o)); router.refresh(); }
                    } catch {} finally { setLoadingId(null); }
                  }}
                  style={{ width: "100%", padding: "0.75rem", borderRadius: "8px", border: "none", background: "#059669", color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: "0.92rem", fontFamily: "inherit" }}
                >
                  {loadingId === disputeOrder.id ? "..." : (isResend ? "📦 Reenviar item — manter pedido" : "✋ Recusar cancelamento — manter pedido")}
                </button>
                <button
                  disabled={!!loadingId}
                  onClick={async () => {
                    if (!confirm(isResend ? "Deseja recusar a proposta de reenvio e cancelar o pedido?" : "Tem certeza que deseja ACEITAR o cancelamento? O pedido será cancelado.")) return;
                    setLoadingId(disputeOrder.id);
                    try {
                      let r: Response;
                      // Mesma separação por canal do botão de recusa acima.
                      if ((disputeOrder as any).source === "BRENDI" && (disputeOrder as any).openDeliveryOrderId) {
                        r = await fetch("/api/customer-order/brendi-action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId: (disputeOrder as any).openDeliveryOrderId, acao: "accept_cancellation" }) });
                      } else if ((disputeOrder as any).source === "JOTAJA" && (disputeOrder as any).openDeliveryOrderId) {
                        r = await fetch("/api/customer-order/jotaja-action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId: (disputeOrder as any).openDeliveryOrderId, action: "accept_cancellation" }) });
                      } else {
                        r = await fetch("/api/customer-order/dispute", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId: disputeOrder.id, action: "accept" }) });
                      }
                      if (r.ok) { setOrders(prev => prev.map(o => o.id === disputeOrder.id ? { ...o, status: "CANCELADO", cancelledBy: "LOJA", cancelDispute: { ...dispute, pending: false } } : o)); router.refresh(); }
                    } catch {} finally { setLoadingId(null); }
                  }}
                  style={{ width: "100%", padding: "0.75rem", borderRadius: "8px", border: "none", background: "#DC2626", color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: "0.92rem", fontFamily: "inherit" }}
                >
                  {loadingId === disputeOrder.id ? "..." : (isResend ? "❌ Recusar reenvio — cancelar pedido" : "✅ Aceitar cancelamento")}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
      {/* MODAL RESUMO DE VENDAS */}
      {showResumo && (
        <div onClick={() => setShowResumo(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: "16px", padding: "28px", minWidth: "340px", maxWidth: "95vw", boxShadow: "0 25px 60px rgba(0,0,0,0.25)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
              <h3 style={{ fontWeight: 800, fontSize: "1.1rem" }}>Resumo das vendas</h3>
              <button onClick={() => setShowResumo(false)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "1.2rem" }}>x</button>
            </div>
            {[
              { label: `PAGAMENTOS PENDENTES (${resumo.pendentes.length})`, val: sumVal(resumo.pendentes), bold: false, red: false },
              { label: `NOVOS PEDIDOS (${resumo.novos.length})`, val: sumVal(resumo.novos), bold: false, red: false },
              { label: `EM PREPARO (${resumo.preparo.length})`, val: sumVal(resumo.preparo), bold: false, red: false },
              { label: `EM TRANSPORTE (${resumo.transporte.length})`, val: sumVal(resumo.transporte), bold: false, red: false },
              { label: `ENTREGUES (${resumo.entregues.length})`, val: sumVal(resumo.entregues), bold: false, red: false },
              { label: `TOTAL ATE O MOMENTO (${resumo.total.length})`, val: sumVal(resumo.total), bold: true, red: false },
              { label: `CANCELADOS (${resumo.cancelados.length})`, val: sumVal(resumo.cancelados), bold: true, red: true },
            ].map((row, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #F1F5F9" }}>
                <span style={{ fontWeight: row.bold ? 700 : 400, color: row.red ? "#EF4444" : "#1a1a2e" }}>{row.label}</span>
                <span style={{ fontWeight: row.bold ? 700 : 400, color: row.red ? "#EF4444" : "#1a1a2e" }}>{fmtR(row.val)}</span>
              </div>
            ))}
            <div style={{ marginTop: "16px", padding: "10px", background: "#F8FAFC", borderRadius: "8px", fontSize: "0.78rem", color: "#64748B" }}>
              <div>• O periodo e de {new Date(dateFrom).toLocaleString("pt-BR")} ate {new Date(dateTo).toLocaleString("pt-BR")}.</div>
            </div>
            <button onClick={() => setShowResumo(false)} style={{ marginTop: "16px", width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid #E2E8F0", background: "#F8FAFC", fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Fechar</button>
          </div>
        </div>
      )}

      {/* ===== MODAL ALTA DEMANDA ===== */}
      {showAltaDemandaModal && (
        <div onClick={() => setShowAltaDemandaModal(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: "20px", padding: "32px", width: "420px", maxWidth: "95vw", boxShadow: "0 30px 80px rgba(0,0,0,0.3)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "20px" }}>
              <div style={{ width: 44, height: 44, borderRadius: "12px", background: "linear-gradient(135deg,#EF4444,#F97316)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Zap size={22} color="#fff" />
              </div>
              <div>
                <h3 style={{ fontWeight: 800, fontSize: "1.15rem", margin: 0 }}>⚡ Modo Alta Demanda</h3>
                <p style={{ fontSize: "0.78rem", color: "#64748B", margin: 0 }}>Ative quando a loja estiver sobrecarregada</p>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div style={{ background: "#FFF7ED", border: "1px solid #FED7AA", borderRadius: "12px", padding: "14px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
                  <Timer size={16} color="#EA580C" />
                  <span style={{ fontWeight: 700, fontSize: "0.9rem", color: "#EA580C" }}>+Tempo de Preparo (minutos extras)</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                  {[5,10,15,20,30].map(m => (
                    <button key={m} onClick={() => setAdExtraMinutes(m)}
                      style={{ padding: "6px 12px", borderRadius: "8px", border: `2px solid ${adExtraMinutes === m ? "#EA580C" : "#E2E8F0"}`,
                        background: adExtraMinutes === m ? "#FFF7ED" : "#fff", fontWeight: 700, cursor: "pointer", fontSize: "0.82rem", color: adExtraMinutes === m ? "#EA580C" : "#64748B", fontFamily: "inherit" }}>
                      +{m}min
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ background: "#FFF1F2", border: "1px solid #FECDD3", borderRadius: "12px", padding: "14px" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "10px" }}>
                  <span style={{ fontWeight: 700, fontSize: "0.9rem", color: "#E11D48" }}>💰 Taxa extra de entrega</span>
                  <span style={{ fontSize: "0.72rem", color: "#E11D48", background: "#FFE4E6", padding: "3px 8px", borderRadius: "6px", display: "inline-flex", alignItems: "center", gap: "4px", width: "fit-content" }}>
                    ⚠️ O cliente paga R${adExtraFee.toFixed(2)} a mais na taxa de entrega durante o período ativo
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                  {[0,1,2,3,5,8].map(v => (
                    <button key={v} onClick={() => setAdExtraFee(v)}
                      style={{ padding: "6px 12px", borderRadius: "8px", border: `2px solid ${adExtraFee === v ? "#E11D48" : "#E2E8F0"}`,
                        background: adExtraFee === v ? "#FFF1F2" : "#fff", fontWeight: 700, cursor: "pointer", fontSize: "0.82rem", color: adExtraFee === v ? "#E11D48" : "#64748B", fontFamily: "inherit" }}>
                      {v === 0 ? "Sem taxa" : `+R$${v}`}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: "12px", padding: "14px" }}>
                <span style={{ fontWeight: 700, fontSize: "0.9rem", color: "#16A34A" }}>⏱️ Duração da Ativação</span>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "10px" }}>
                  {[30,60,90,120].map(d => (
                    <button key={d} onClick={() => setAdDuration(d)}
                      style={{ padding: "6px 12px", borderRadius: "8px", border: `2px solid ${adDuration === d ? "#16A34A" : "#E2E8F0"}`,
                        background: adDuration === d ? "#F0FDF4" : "#fff", fontWeight: 700, cursor: "pointer", fontSize: "0.82rem", color: adDuration === d ? "#16A34A" : "#64748B" }}>
                      {d}min
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ background: "#F8FAFC", borderRadius: "10px", padding: "12px", fontSize: "0.82rem", color: "#475569" }}>
                <strong>Resumo:</strong> Clientes verão +{adExtraMinutes}min no tempo estimado e +R${adExtraFee.toFixed(2)} na taxa de entrega por {adDuration} minutos.
              </div>

              <button onClick={activateAltaDemanda}
                style={{ padding: "14px", borderRadius: "12px", border: "none", background: "linear-gradient(135deg,#EF4444,#F97316)", color: "#fff", fontWeight: 800, fontSize: "1rem", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", fontFamily: "inherit" }}>
                <Zap size={18} /> Ativar Alta Demanda
              </button>

              {/* Botão desativar — aparece quando Alta Demanda já está ativa */}
              {altaDemanda.active && (
                <button onClick={() => { deactivateAltaDemanda(); setShowAltaDemandaModal(false); }}
                  style={{ padding: "12px", borderRadius: "12px", border: "2px solid #E2E8F0", background: "#fff", color: "#64748B", fontWeight: 700, fontSize: "0.9rem", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", fontFamily: "inherit" }}>
                  <ZapOff size={16} /> Desativar Alta Demanda
                </button>
              )}

              {altaDemanda.logs?.length > 0 && (
                <button onClick={() => { setShowAltaDemandaModal(false); setShowAltaDemandaLog(true); }}
                  style={{ padding: "8px", borderRadius: "8px", border: "1px solid #E2E8F0", background: "#fff", color: "#64748B", fontWeight: 600, fontSize: "0.8rem", cursor: "pointer", fontFamily: "inherit" }}>
                  📋 Ver histórico de ativações ({altaDemanda.logs.length})
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===== MODAL LOG ALTA DEMANDA ===== */}
      {showAltaDemandaLog && (
        <div onClick={() => setShowAltaDemandaLog(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: "16px", padding: "28px", width: "460px", maxWidth: "95vw", boxShadow: "0 25px 60px rgba(0,0,0,0.25)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <h3 style={{ fontWeight: 800, fontSize: "1.05rem", margin: 0 }}>📋 Histórico Alta Demanda</h3>
              <button onClick={() => setShowAltaDemandaLog(false)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "1.2rem" }}>×</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "400px", overflowY: "auto" }}>
              {[...(altaDemanda.logs || [])].reverse().map((log: any, i: number) => (
                <div key={i} style={{ padding: "12px", borderRadius: "10px", background: "#F8FAFC", border: "1px solid #E2E8F0", fontSize: "0.82rem" }}>
                  <div style={{ fontWeight: 700, marginBottom: "4px" }}>🕐 {new Date(log.activatedAt).toLocaleString("pt-BR")}</div>
                  <div style={{ color: "#64748B" }}>+{log.extraMinutes}min de preparo · +R${log.extraFee?.toFixed(2)} taxa de entrega · Duração: {log.duration}min</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ===== MODAL AGENDAMENTOS ===== */}
      {showAgendamentos && (
        <div onClick={() => setShowAgendamentos(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: "20px", padding: "32px", width: "520px", maxWidth: "95vw", maxHeight: "85vh", boxShadow: "0 30px 80px rgba(0,0,0,0.3)", display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "20px" }}>
              <div style={{ width: 44, height: 44, borderRadius: "12px", background: "linear-gradient(135deg,#8B5CF6,#6366F1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <CalendarClock size={22} color="#fff" />
              </div>
              <div style={{ flex: 1 }}>
                <h3 style={{ fontWeight: 800, fontSize: "1.15rem", margin: 0 }}>📅 Pedidos Agendados</h3>
                <p style={{ fontSize: "0.78rem", color: "#64748B", margin: 0 }}>{scheduledOrders.length} pedido{scheduledOrders.length !== 1 ? "s" : ""} agendado{scheduledOrders.length !== 1 ? "s" : ""} para os próximos dias</p>
              </div>
              <button onClick={() => setShowAgendamentos(false)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "1.4rem", color: "#94A3B8", lineHeight: 1 }}>×</button>
            </div>

            {/* Bloco de Ativar / Desativar Agendamentos */}
            <div style={{ marginBottom: "16px", padding: "14px 16px", background: allowScheduledOrders ? "#F0FDF4" : "#FEF2F2", borderRadius: "14px", border: `1.5px solid ${allowScheduledOrders ? "#BBF7D0" : "#FECACA"}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: "0.9rem", color: allowScheduledOrders ? "#166534" : "#991B1B", display: "flex", alignItems: "center", gap: "6px" }}>
                  {allowScheduledOrders ? "🟢 Aceitar Agendamentos no Site" : "🔴 Agendamentos Desativados"}
                </div>
                <div style={{ fontSize: "0.76rem", color: allowScheduledOrders ? "#15803D" : "#B91C1C", marginTop: "2px" }}>
                  {allowScheduledOrders ? "Clientes podem escolher data/horário para agendar no seu site próprio." : "Seu site próprio aceitará apenas pedidos para entrega imediata."}
                </div>
              </div>
              <button
                type="button"
                onClick={() => toggleAllowScheduledOrders(!allowScheduledOrders)}
                style={{
                  position: "relative",
                  width: "52px",
                  height: "28px",
                  borderRadius: "20px",
                  background: allowScheduledOrders ? "#22C55E" : "#CBD5E1",
                  border: "none",
                  cursor: "pointer",
                  transition: "all 0.25s ease",
                  flexShrink: 0,
                  boxShadow: "inset 0 2px 4px rgba(0,0,0,0.1)",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    top: "3px",
                    left: allowScheduledOrders ? "27px" : "3px",
                    width: "22px",
                    height: "22px",
                    borderRadius: "50%",
                    background: "#fff",
                    boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
                    transition: "all 0.25s ease",
                  }}
                />
              </button>
            </div>

            {/* Configuração de antecedência */}
            <div style={{ marginBottom: "16px", padding: "14px", background: "#F5F3FF", borderRadius: "12px", border: "1px solid #DDD6FE" }}>
              <label style={{ fontSize: "0.82rem", fontWeight: 700, color: "#6D28D9", display: "block", marginBottom: "8px" }}>
                ⏰ Quantas horas antes do horário agendado você quer que o pedido vá para Novos Pedidos?
              </label>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                  {[0.5, 1, 1.5, 2, 3].map(h => (
                    <button key={h} onClick={() => { setScheduleLeadHours(h); localStorage.setItem("scheduleLeadHours", String(h)); }}
                      style={{ padding: "6px 14px", borderRadius: "8px", border: `2px solid ${scheduleLeadHours === h ? "#7C3AED" : "#E2E8F0"}`, background: scheduleLeadHours === h ? "#EDE9FE" : "#fff", fontWeight: 700, cursor: "pointer", fontSize: "0.82rem", color: scheduleLeadHours === h ? "#7C3AED" : "#64748B", fontFamily: "inherit" }}>
                      {h === 0.5 ? "30min" : `${h}h`}
                    </button>
                  ))}
                </div>
              </div>
              <p style={{ fontSize: "0.72rem", color: "#8B5CF6", margin: "8px 0 0" }}>
                ✅ Configurado: pedidos entram em Novos Pedidos <strong>{scheduleLeadHours === 0.5 ? "30 minutos" : `${scheduleLeadHours} hora${scheduleLeadHours > 1 ? "s" : ""}`}</strong> antes do horário agendado.
              </p>
            </div>

            <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "10px" }}>
              {scheduledOrders.length === 0 ? (
                <div style={{ textAlign: "center", padding: "3rem 1rem", color: "#94A3B8" }}>
                  <CalendarClock size={48} style={{ opacity: 0.2, marginBottom: "12px" }} />
                  <p style={{ fontSize: "0.95rem", fontWeight: 600 }}>Nenhum pedido agendado</p>
                  <p style={{ fontSize: "0.8rem" }}>Pedidos agendados para os próximos dias aparecerão aqui</p>
                </div>
              ) : (
                scheduledOrders
                  .sort((a, b) => new Date(a.scheduledDatetime).getTime() - new Date(b.scheduledDatetime).getTime())
                  .map(order => {
                    const deadline = new Date(order.scheduledDatetime);
                    const dateStr = deadline.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" });
                    const timeStr = deadline.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
                    const isToday = deadline.toDateString() === now.toDateString();
                    const isTomorrow = deadline.toDateString() === new Date(now.getTime() + 86400000).toDateString();
                    const dayLabel = isToday ? "Hoje" : isTomorrow ? "Amanhã" : dateStr;

                    return (
                      <div key={order.id} style={{ padding: "16px", borderRadius: "14px", background: "linear-gradient(135deg,#F5F3FF,#EDE9FE)", border: "1.5px solid #C4B5FD" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "10px" }}>
                          <div>
                            <span style={{ fontWeight: 800, fontSize: "0.95rem", color: "#1E1B4B" }}>#{order.id.slice(-6).toUpperCase()}</span>
                            <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "4px" }}>
                              <span style={{ fontSize: "0.82rem", color: "#64748B", display: "flex", alignItems: "center", gap: "4px" }}>
                                <User size={12} /> {order.customerName}
                              </span>
                            </div>
                          </div>
                          <span style={{ fontWeight: 800, fontSize: "1rem", color: "#7C3AED" }}>R$ {order.totalAmount.toFixed(2)}</span>
                        </div>

                        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px", padding: "8px 12px", background: "#fff", borderRadius: "10px", border: "1px solid #DDD6FE" }}>
                          <span style={{ fontSize: "1.3rem" }}>📅</span>
                          <div>
                            <div style={{ fontWeight: 700, fontSize: "0.85rem", color: "#6D28D9" }}>{dayLabel}</div>
                            <div style={{ fontWeight: 600, fontSize: "0.8rem", color: "#7C3AED" }}>🕐 {timeStr}</div>
                          </div>
                          <span style={{ marginLeft: "auto", padding: "3px 10px", borderRadius: "20px", background: isToday ? "#FEF3C7" : "#E0E7FF", fontSize: "0.72rem", fontWeight: 700, color: isToday ? "#B45309" : "#4338CA" }}>
                            {isToday ? "📢 Hoje" : isTomorrow ? "📆 Amanhã" : "📆 Futuro"}
                          </span>
                        </div>

                        {order.items && order.items.length > 0 && (
                          <div style={{ fontSize: "0.78rem", color: "#64748B", marginBottom: "10px", padding: "6px 10px", background: "rgba(255,255,255,0.6)", borderRadius: "8px" }}>
                            {order.items.slice(0, 3).map((item: any, i: number) => (
                              <div key={i}>{item.quantity}x {nomeDoItem(item)}</div>
                            ))}
                            {order.items.length > 3 && <div style={{ color: "#A78BFA" }}>+{order.items.length - 3} itens...</div>}
                          </div>
                        )}

                        <div style={{ display: "flex", gap: "6px" }}>
                          {order.deliveryType === "DELIVERY" ? (
                            <span style={{ padding: "3px 10px", borderRadius: "20px", background: "#F1F5F9", fontSize: "0.75rem", fontWeight: 600, color: "#475569" }}>
                              🛵 Entrega
                            </span>
                          ) : (
                            <span style={{ padding: "4px 12px", borderRadius: "20px", background: "#FFEDD5", border: "1.5px solid #FDBA74", fontSize: "0.78rem", fontWeight: 900, color: "#C2410C", display: "inline-flex", alignItems: "center", gap: "4px" }}>
                              🛍️ RETIRADA NO ESTABELECIMENTO
                            </span>
                          )}
                          {order.paymentMethod && (() => {
                            const method = translatePayment(order.paymentMethod);
                            const isCobrar = /cobrar|entrega|dinheiro|cash|maquin|presencial/i.test(method) || !/pago online|online|app|pix \(pago/i.test(order.paymentMethod || "");
                            const isPaidOnline = Boolean(order.paymentPaidAt || order.gatewayProvider || (/pago online|online|app|digital_wallet/i.test(order.paymentMethod || "") && !isCobrar));
                            return (
                              <>
                                <span style={{ padding: "3px 10px", borderRadius: "20px", background: "#F1F5F9", fontSize: "0.75rem", fontWeight: 600, color: "#475569" }}>
                                  💳 Pagamento: {method}
                                </span>
                                <span style={{ padding: "3px 10px", borderRadius: "20px", fontSize: "0.75rem", fontWeight: 700, background: isPaidOnline ? "#F0FDF4" : "#FFF7ED", border: `1px solid ${isPaidOnline ? "#BBF7D0" : "#FED7AA"}`, color: isPaidOnline ? "#15803D" : "#C2410C" }}>
                                  {isPaidOnline ? "✅ Pago Online" : "💰 Pagar na Entrega (Cobrar)"}
                                </span>
                              </>
                            );
                          })()}
                        </div>

                        <button
                          onClick={async () => {
                            if (!confirm(`Antecipar pedido #${order.id.slice(-6).toUpperCase()} para agora?\n\nEle será movido para Novos Pedidos imediatamente.`)) return;
                            try {
                              const res = await fetch("/api/customer-order/status", {
                                method: "PUT",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ orderId: order.id, status: "NOVO", scheduledDatetime: null })
                              });
                              if (res.ok) {
                                setOrders(prev => prev.map(o =>
                                  o.id === order.id ? { ...o, status: "NOVO", scheduledDatetime: null } : o
                                ));
                                setShowAgendamentos(false);
                              } else {
                                showToast("Erro ao antecipar pedido.", "#EF4444");
                              }
                            } catch {
                              showToast("Erro de conexão.", "#EF4444");
                            }
                          }}
                          style={{
                            width: "100%", marginTop: "12px", padding: "10px", borderRadius: "10px", border: "none",
                            background: "linear-gradient(135deg,#7C3AED,#6366F1)", color: "#fff",
                            fontWeight: 700, fontSize: "0.85rem", cursor: "pointer",
                            display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
                            fontFamily: "inherit", transition: "all 0.2s"
                          }}
                          onMouseEnter={e => { (e.target as HTMLElement).style.transform = "scale(1.02)"; (e.target as HTMLElement).style.boxShadow = "0 4px 16px rgba(124,58,237,0.35)"; }}
                          onMouseLeave={e => { (e.target as HTMLElement).style.transform = "scale(1)"; (e.target as HTMLElement).style.boxShadow = "none"; }}
                        >
                          ⚡ Antecipar agendamento
                        </button>
                      </div>
                    );
                  })
              )}
            </div>

            <button onClick={() => setShowAgendamentos(false)} style={{ marginTop: "20px", width: "100%", padding: "12px", borderRadius: "10px", border: "1px solid #E2E8F0", background: "#F8FAFC", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", fontSize: "0.85rem" }}>Fechar</button>
          </div>
        </div>
      )}

      {/* ===== BANNER ALTA DEMANDA ATIVO ===== */}
      {altaDemanda.active && (
        <div style={{ background: "linear-gradient(135deg,#EF4444,#F97316)", padding: "10px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", color: "#fff" }}>
            <Zap size={18} />
            <span style={{ fontWeight: 800, fontSize: "0.92rem" }}>⚡ ALTA DEMANDA ATIVA</span>
            <span style={{ fontSize: "0.82rem", opacity: 0.9 }}>+{altaDemanda.extraMinutes}min preparo · +R${Number(altaDemanda.extraFee).toFixed(2)} taxa de entrega</span>
            {altaDemanda.expiresAt && (
              <span style={{ fontSize: "0.78rem", opacity: 0.85 }}>
                · Expira às {new Date(altaDemanda.expiresAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
          </div>
          <button onClick={deactivateAltaDemanda}
            style={{ padding: "6px 14px", borderRadius: "8px", border: "2px solid rgba(255,255,255,0.5)", background: "rgba(255,255,255,0.15)", color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: "0.8rem", display: "flex", alignItems: "center", gap: "6px", fontFamily: "inherit" }}>
            <ZapOff size={14} /> Desativar
          </button>
        </div>
      )}

      {/* FILTER BAR */}

      <div style={{ background: "#fff", borderBottom: "1px solid #E2E8F0", padding: "0.6rem 1.5rem" }}>
        <div style={{ maxWidth: "1400px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "0.5rem" }}>

          {/* Row 1: Search + Date range + Weather/Clock */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.75rem", flexWrap: "wrap" }}>
            {/* Search */}
            <div style={{ position: "relative", flex: 1, minWidth: "180px", maxWidth: "320px" }}>
              <Search size={16} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: "#94A3B8" }} />
              <input
                type="text" placeholder="Nome, número, telefone, endereço..."
                value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                style={{ width: "100%", padding: "0.45rem 0.5rem 0.45rem 36px", borderRadius: "10px", border: "1.5px solid #E2E8F0", fontSize: "0.82rem", outline: "none" }}
              />
            </div>

            {/* Date range */}
            <div style={{ display: "flex", alignItems: "center", gap: "6px", background: "#F8FAFC", padding: "4px 10px", borderRadius: "10px", border: "1px solid #E2E8F0" }}>
              <span style={{ fontSize: "0.75rem", color: "#64748B", fontWeight: 600 }}>De</span>
              <input type="datetime-local" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ padding: "3px 6px", borderRadius: "6px", border: "1px solid #E2E8F0", fontSize: "0.75rem", outline: "none", background: "#fff" }} />
              <span style={{ fontSize: "0.75rem", color: "#64748B", fontWeight: 600 }}>Até</span>
              <input type="datetime-local" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ padding: "3px 6px", borderRadius: "6px", border: "1px solid #E2E8F0", fontSize: "0.75rem", outline: "none", background: "#fff" }} />
            </div>

            {/* Filtro de pedidos por canais / integrações */}
            {naBarra("filtroCanais") && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "2px" }}>
              <span style={{ fontSize: "0.60rem", fontWeight: 800, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.04em", paddingLeft: "2px" }}>
                Filtro de pedidos
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: "4px", background: "#F8FAFC", padding: "2px 5px", borderRadius: "9px", border: "1px solid #E2E8F0" }}>
                {/* iFood */}
                <button
                  type="button"
                  onClick={() => toggleChannel("ifood")}
                  title={selectedChannels.ifood ? "iFood: Ativo (Clique para filtrar)" : "iFood: Oculto (Clique para exibir)"}
                  style={{
                    height: "26px",
                    padding: "2px 6px",
                    borderRadius: "6px",
                    border: selectedChannels.ifood ? "1.5px solid #EF4444" : "1.5px solid #CBD5E1",
                    background: selectedChannels.ifood ? "#FFFFFF" : "#F1F5F9",
                    filter: selectedChannels.ifood ? "none" : "grayscale(100%) opacity(0.35)",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    boxShadow: selectedChannels.ifood ? "0 1px 3px rgba(239,68,68,0.15)" : "none",
                    transition: "all 0.15s ease",
                  }}
                >
                  <img src="/images/logos/ifood.png" alt="iFood" style={{ height: "15px", maxWidth: "100%", objectFit: "contain", display: "block" }} />
                </button>

                {/* 99Food */}
                <button
                  type="button"
                  onClick={() => toggleChannel("99food")}
                  title={selectedChannels["99food"] ? "99Food: Ativo (Clique para filtrar)" : "99Food: Oculto (Clique para exibir)"}
                  style={{
                    height: "26px",
                    padding: "2px 5px",
                    borderRadius: "6px",
                    border: selectedChannels["99food"] ? "1.5px solid #F59E0B" : "1.5px solid #CBD5E1",
                    background: selectedChannels["99food"] ? "#FFFFFF" : "#F1F5F9",
                    filter: selectedChannels["99food"] ? "none" : "grayscale(100%) opacity(0.35)",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    boxShadow: selectedChannels["99food"] ? "0 1px 3px rgba(245,158,11,0.15)" : "none",
                    transition: "all 0.15s ease",
                  }}
                >
                  <img src="/images/logos/99.svg" alt="99Food" style={{ height: "17px", maxWidth: "100%", objectFit: "contain", display: "block" }} />
                </button>

                {/* Jotajá */}
                <button
                  type="button"
                  onClick={() => toggleChannel("jotaja")}
                  title={selectedChannels.jotaja ? "Jotajá: Ativo (Clique para filtrar)" : "Jotajá: Oculto (Clique para exibir)"}
                  style={{
                    height: "26px",
                    padding: "2px 5px",
                    borderRadius: "6px",
                    border: selectedChannels.jotaja ? "1.5px solid #DC2626" : "1.5px solid #CBD5E1",
                    background: selectedChannels.jotaja ? "#FFFFFF" : "#F1F5F9",
                    filter: selectedChannels.jotaja ? "none" : "grayscale(100%) opacity(0.35)",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    boxShadow: selectedChannels.jotaja ? "0 1px 3px rgba(220,38,38,0.15)" : "none",
                    transition: "all 0.15s ease",
                  }}
                >
                  <img src="/images/logos/jotaja.png" alt="Jotajá" style={{ height: "17px", maxWidth: "100%", objectFit: "contain", display: "block" }} />
                </button>

                {/* Brendi — botão textual roxo (mesma cor do badge) porque ainda
                    não existe logo dela em /images/logos; um <img> com src
                    quebrado viraria um botão invisível que o lojista clicaria
                    sem ver o estado. */}
                <button
                  type="button"
                  onClick={() => toggleChannel("brendi")}
                  title={selectedChannels.brendi ? "Brendi: Ativo (Clique para filtrar)" : "Brendi: Oculto (Clique para exibir)"}
                  style={{
                    height: "26px",
                    padding: "2px 7px",
                    borderRadius: "6px",
                    border: selectedChannels.brendi ? "1.5px solid #8B5CF6" : "1.5px solid #CBD5E1",
                    background: selectedChannels.brendi ? "#F5F3FF" : "#F1F5F9",
                    color: selectedChannels.brendi ? "#5B21B6" : "#64748B",
                    filter: selectedChannels.brendi ? "none" : "grayscale(100%) opacity(0.35)",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "3px",
                    fontSize: "0.72rem",
                    fontWeight: 800,
                    boxShadow: selectedChannels.brendi ? "0 1px 3px rgba(139,92,246,0.15)" : "none",
                    transition: "all 0.15s ease",
                  }}
                >
                  <span style={{ fontSize: "0.82rem" }}>💬</span>
                  <span>Brendi</span>
                </button>

                {/* Retirada / Balcão */}
                <button
                  type="button"
                  onClick={() => toggleChannel("retirada")}
                  title={selectedChannels.retirada ? "Retirada: Ativo (Clique para filtrar)" : "Retirada: Oculto (Clique para exibir)"}
                  style={{
                    height: "26px",
                    padding: "2px 7px",
                    borderRadius: "6px",
                    border: selectedChannels.retirada ? "1.5px solid #10B981" : "1.5px solid #CBD5E1",
                    background: selectedChannels.retirada ? "#ECFDF5" : "#F1F5F9",
                    color: selectedChannels.retirada ? "#065F46" : "#64748B",
                    filter: selectedChannels.retirada ? "none" : "grayscale(100%) opacity(0.35)",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "3px",
                    fontSize: "0.72rem",
                    fontWeight: 800,
                    boxShadow: selectedChannels.retirada ? "0 1px 3px rgba(16,185,129,0.15)" : "none",
                    transition: "all 0.15s ease",
                  }}
                >
                  <span style={{ fontSize: "0.82rem" }}>🛍️</span>
                  <span>Retirada</span>
                </button>

                {/* Loja / Site */}
                <button
                  type="button"
                  onClick={() => toggleChannel("site")}
                  title={selectedChannels.site ? "Cardápio/WhatsApp: Ativo (Clique para filtrar)" : "Cardápio/WhatsApp: Oculto (Clique para exibir)"}
                  style={{
                    height: "26px",
                    padding: "2px 7px",
                    borderRadius: "6px",
                    border: selectedChannels.site ? "1.5px solid #3B82F6" : "1.5px solid #CBD5E1",
                    background: selectedChannels.site ? "#EFF6FF" : "#F1F5F9",
                    color: selectedChannels.site ? "#1E40AF" : "#64748B",
                    filter: selectedChannels.site ? "none" : "grayscale(100%) opacity(0.35)",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "3px",
                    fontSize: "0.72rem",
                    fontWeight: 800,
                    boxShadow: selectedChannels.site ? "0 1px 3px rgba(59,130,246,0.15)" : "none",
                    transition: "all 0.15s ease",
                  }}
                >
                  <span style={{ fontSize: "0.82rem" }}>🌐</span>
                  <span>Site</span>
                </button>
              </div>
            </div>
            )}

            {/* Relógio — a régua de clima que morava aqui saiu inteira (não
                ajudava a despachar pedido e mostrava a cidade errada), e o
                relógio virou opcional junto com o resto da barra: quem tem o
                horário na tela do computador não precisa dele aqui. */}
            {naBarra("relogio") && (
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginLeft: "auto" }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: "0.4rem" }}>
                  <span style={{ fontSize: "1.05rem", fontWeight: 700, color: "#0F172A" }}>
                    {now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </span>
                  <span style={{ fontSize: "0.72rem", color: "#94A3B8" }}>
                    {now.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
                  </span>
                </div>
              </div>
            </div>
            )}
          </div>

          {/* ── O QUE APARECE NESTA BARRA ─────────────────────────────────────
              Config POR LOJA, tudo ligado por padrão. Quem só faz delivery
              esconde "Mesas" e "Pedidos Balcão"; quem não usa roteirização
              esconde o mapa. Nada exige configurar para começar a usar. */}
          {showBarraConfig && (
            <div
              onClick={() => setShowBarraConfig(false)}
              style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.6)", zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 460, padding: "1.25rem 1.5rem", boxShadow: "0 25px 50px -12px rgba(0,0,0,0.4)", maxHeight: "85vh", overflowY: "auto" }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                  <h3 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 900, color: "#0F172A", display: "flex", alignItems: "center", gap: 8 }}>
                    <Settings size={18} /> O que aparece nesta barra
                  </h3>
                  <button onClick={() => setShowBarraConfig(false)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "1.4rem", color: "#94A3B8", lineHeight: 1 }}>×</button>
                </div>
                <p style={{ fontSize: "0.8rem", color: "#64748B", margin: "0 0 14px" }}>
                  Desmarque o que sua loja não usa. Vale só para esta loja, e você pode religar quando quiser.
                </p>

                {[
                  { chave: "filtroCanais", rotulo: "Filtro de pedidos por canal", ajuda: "iFood, 99Food, Brendi, Retirada, Site" },
                  { chave: "relogio", rotulo: "Relógio", ajuda: "Hora e data no canto da barra" },
                  { chave: "botaoResumo", rotulo: "Resumo das vendas", ajuda: "" },
                  { chave: "botaoAltaDemanda", rotulo: "Alta Demanda", ajuda: "Aumenta o tempo de entrega no movimento" },
                  { chave: "botaoAgendamentos", rotulo: "Agendamentos", ajuda: "" },
                  { chave: "botaoBalcao", rotulo: "Pedidos Balcão", ajuda: "Venda presencial" },
                  { chave: "botaoMesas", rotulo: "Mesas", ajuda: "Atendimento no salão" },
                  { chave: "botaoAlertas", rotulo: "Alertas de Produção", ajuda: "Amarelo/vermelho por tempo" },
                  { chave: "botaoRoteirizacao", rotulo: "Roteirização", ajuda: "Mapa de entregas" },
                  { chave: "botaoMotoboys", rotulo: "App Motoboys", ajuda: "Link de acesso dos entregadores" },
                ].map((item) => (
                  <label
                    key={item.chave}
                    style={{
                      display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", borderRadius: 10,
                      border: "1px solid #E2E8F0", marginBottom: 6, cursor: "pointer", userSelect: "none",
                      background: naBarra(item.chave) ? "#F8FAFC" : "#fff",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={naBarra(item.chave)}
                      onChange={(e) => salvarBarraConfig({ ...barraConfig, [item.chave]: e.target.checked })}
                      style={{ width: 16, height: 16, accentColor: "#2563EB", cursor: "pointer", flexShrink: 0 }}
                    />
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: "block", fontWeight: 800, fontSize: "0.85rem", color: "#0F172A" }}>{item.rotulo}</span>
                      {item.ajuda && <span style={{ display: "block", fontSize: "0.72rem", color: "#94A3B8" }}>{item.ajuda}</span>}
                    </span>
                  </label>
                ))}

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 14 }}>
                  <button
                    onClick={() => salvarBarraConfig({})}
                    style={{ padding: "8px 14px", borderRadius: 10, border: "1px solid #CBD5E1", background: "#fff", color: "#475569", fontWeight: 700, fontSize: "0.8rem", cursor: "pointer", fontFamily: "inherit" }}
                    title="Volta ao padrão: tudo aparecendo"
                  >
                    Mostrar tudo
                  </button>
                  <span style={{ fontSize: "0.75rem", color: salvandoBarra ? "#2563EB" : "#94A3B8" }}>
                    {salvandoBarra ? "Salvando..." : "Salvo automaticamente"}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Row 2: Action buttons */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", flexWrap: "wrap" }}>
            {naBarra("botaoResumo") && (
            <button onClick={() => setShowResumo(true)} style={{ padding: "5px 12px", background: "#1E293B", color: "#fff", border: "none", borderRadius: "8px", fontWeight: 700, fontSize: "0.78rem", cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: "5px" }}>💰 Resumo das vendas</button>
            )}
            {naBarra("botaoAltaDemanda") && (
            <button
              onClick={() => setShowAltaDemandaModal(true)}
              style={{
                padding: "5px 12px", border: "none", borderRadius: "8px", fontWeight: 700, fontSize: "0.78rem",
                cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: "5px",
                background: altaDemanda.active ? "linear-gradient(135deg,#EF4444,#F97316)" : "#FFF7ED",
                color: altaDemanda.active ? "#fff" : "#EA580C",
                outline: altaDemanda.active ? "none" : "1.5px solid #FED7AA",
                animation: altaDemanda.active ? "pulse 1.5s infinite" : "none"
              }}
            >
              <Zap size={14} /> {altaDemanda.active ? "⚡ Alta Demanda ON" : "Alta Demanda"}
            </button>
            )}
            {naBarra("botaoAgendamentos") && (
            <button
              onClick={() => setShowAgendamentos(true)}
              style={{
                padding: "5px 12px", border: "none", borderRadius: "8px", fontWeight: 700, fontSize: "0.78rem",
                cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: "5px",
                background: scheduledOrders.length > 0 ? "linear-gradient(135deg,#8B5CF6,#6366F1)" : "#F5F3FF",
                color: scheduledOrders.length > 0 ? "#fff" : "#7C3AED",
                outline: scheduledOrders.length > 0 ? "none" : "1.5px solid #DDD6FE",
                position: "relative"
              }}
            >
              <CalendarClock size={14} /> Agendamentos
              <span style={{
                background: scheduledOrders.length > 0 ? "#fff" : "#7C3AED",
                color: scheduledOrders.length > 0 ? "#7C3AED" : "#fff",
                borderRadius: "50%", minWidth: "18px", height: "18px",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "0.68rem", fontWeight: 800, marginLeft: "2px"
              }}>
                {scheduledOrders.length}
              </span>
            </button>
            )}

            {naBarra("botaoBalcao") && (
            <a
              href="/store/venda-presencial"
              style={{
                padding: "5px 12px", border: "none", borderRadius: "8px", fontWeight: 700, fontSize: "0.78rem",
                cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: "5px",
                background: "#F0FDF4", color: "#16A34A", outline: "1.5px solid #BBF7D0",
                textDecoration: "none"
              }}
            >
              🛒 Pedidos Balcão
            </a>
            )}

            {naBarra("botaoMesas") && (
            <a
              href="/store/mesas"
              style={{
                padding: "5px 12px", border: "none", borderRadius: "8px", fontWeight: 700, fontSize: "0.78rem",
                cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: "5px",
                background: "#F5F3FF", color: "#7C3AED", outline: "1.5px solid #DDD6FE",
                textDecoration: "none"
              }}
            >
              🍽️ Mesas
            </a>
            )}

            {/* Configurações de Alerta de Produção */}
            {naBarra("botaoAlertas") && (
            <button
              onClick={() => setShowAlertModal(true)}
              style={{
                padding: "5px 12px", border: "1.5px solid #F59E0B", borderRadius: "8px",
                fontWeight: 700, fontSize: "0.78rem", cursor: "pointer", fontFamily: "inherit",
                display: "flex", alignItems: "center", gap: "5px",
                background: (timeAlertConfig.yellowEnabled || timeAlertConfig.redEnabled) ? "#FFFBEB" : "#F8FAFC",
                color: (timeAlertConfig.yellowEnabled || timeAlertConfig.redEnabled) ? "#D97706" : "#64748B",
              }}
              title="Configurar Alertas Visuais de Tempo Limite (Amarelo / Vermelho)"
            >
              <Bell size={14} /> ⏱️ Alertas de Produção
            </button>
            )}

            {/* Módulo de Roteirização */}
            {naBarra("botaoRoteirizacao") && (
            <button
              onClick={() => setShowRoteirizacaoModal(true)}
              style={{
                padding: "5px 12px", border: "1.5px solid #2563EB", borderRadius: "8px",
                fontWeight: 800, fontSize: "0.78rem", cursor: "pointer", fontFamily: "inherit",
                display: "flex", alignItems: "center", gap: "5px",
                background: "#EFF6FF", color: "#1D4ED8",
                boxShadow: "0 2px 6px rgba(37,99,235,0.15)"
              }}
              title="Abrir Módulo de Roteirização e Mapa de Entregas"
            >
              <MapPin size={14} /> 🗺️ Roteirização
            </button>
            )}

            {/* App Motoboys Link Button */}
            {naBarra("botaoMotoboys") && (
            <button
              onClick={() => setShowMotoboyLinkModal(true)}
              style={{
                padding: "5px 12px", border: "1.5px solid #059669", borderRadius: "8px",
                fontWeight: 800, fontSize: "0.78rem", cursor: "pointer", fontFamily: "inherit",
                display: "flex", alignItems: "center", gap: "5px",
                background: "#ECFDF5", color: "#047857",
                boxShadow: "0 2px 6px rgba(5,150,105,0.15)"
              }}
              title="App Motoboys - Copiar Link de Acesso para seus Entregadores"
            >
              🛵 App Motoboys
            </button>
            )}

            {/* A engrenagem NUNCA é escondida: é por ela que o lojista traz de
                volta o que escondeu. Um botão de configuração que some com a
                própria configuração é uma armadilha sem saída. */}
            <button
              onClick={() => setShowBarraConfig(true)}
              style={{
                padding: "5px 10px", border: "1.5px solid #CBD5E1", borderRadius: "8px",
                fontWeight: 700, fontSize: "0.78rem", cursor: "pointer", fontFamily: "inherit",
                display: "flex", alignItems: "center", gap: "5px",
                background: "#F8FAFC", color: "#475569",
              }}
              title="Escolher o que aparece nesta barra"
            >
              <Settings size={14} />
            </button>
          </div>

        </div>
      </div>

      {/* 3 COLUMNS */}
      <div style={{ maxWidth: "100%", margin: "0 auto", padding: "0.75rem 1.25rem" }}>

        {/* ─── BARRA DE AÇÕES EM MASSA ─── */}
        {selectedOrderIds.size > 0 && (
          <div style={{
            position: "sticky", top: "10px", zIndex: 100, marginBottom: "1rem",
            background: "#1E293B", color: "#fff", padding: "0.85rem 1.25rem",
            borderRadius: "14px", boxShadow: "0 10px 30px rgba(0,0,0,0.3)",
            display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "1rem"
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
              <span style={{ background: "#3B82F6", padding: "4px 12px", borderRadius: "20px", fontSize: "0.85rem", fontWeight: 700 }}>
                ✓ {selectedOrderIds.size} selecionado{selectedOrderIds.size > 1 ? "s" : ""}
              </span>
              <span style={{ fontSize: "0.9rem", fontWeight: 600 }}>Ações em Massa:</span>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
              <select
                value={bulkTargetStatus}
                onChange={(e) => setBulkTargetStatus(e.target.value)}
                style={{
                  background: "#334155", color: "#fff", border: "1px solid #475569",
                  padding: "8px 14px", borderRadius: "8px", fontSize: "0.85rem", fontWeight: 600, cursor: "pointer"
                }}
              >
                <option value="">Mudar para...</option>
                <option value="ACEITO">✅ Aceito</option>
                <option value="PREPARANDO">👨‍🍳 Em Preparo</option>
                <option value="SAIU_ENTREGA">🛵 Saiu para Entrega</option>
                <option value="ENTREGUE">📦 Entregue / Concluído</option>
                <option value="CANCELADO">❌ Cancelar</option>
              </select>

              <button
                onClick={handleBulkStatusUpdate}
                disabled={!bulkTargetStatus || bulkUpdating}
                style={{
                  background: bulkTargetStatus ? "#3B82F6" : "#64748B",
                  color: "#fff", border: "none", padding: "8px 18px",
                  borderRadius: "8px", fontWeight: 700, fontSize: "0.85rem",
                  cursor: bulkTargetStatus ? "pointer" : "not-allowed",
                  display: "flex", alignItems: "center", gap: "0.4rem"
                }}
              >
                {bulkUpdating ? "Atualizando..." : "Mudar todos selecionados →"}
              </button>

              <button
                onClick={() => setSelectedOrderIds(new Set())}
                style={{ background: "transparent", color: "#94A3B8", border: "none", fontSize: "0.85rem", cursor: "pointer", textDecoration: "underline" }}
              >
                Desmarcar todos
              </button>
            </div>
          </div>
        )}

        {/* ── RESPONSIVE STATUS SELECTOR (Visível para alternar ou focar colunas sem cortar) ── */}


        <div className="dashboard-kanban-container" style={{ display: "flex", gap: "0.65rem", overflowX: "auto", paddingBottom: "0.5rem", maxWidth: "100%", WebkitOverflowScrolling: "touch" }}>
          {/* Só aparece quando existe alguém esperando no balcão. Loja sem totem
              nunca produz este status, e uma sexta coluna vazia permanente só
              espremeria as outras cinco. Vem PRIMEIRO porque é o cliente que
              está de pé na frente do atendente, esperando. Sem entrada em
              COLUMN_STATUS_MAP de propósito: arrastar um card para cá não pode
              "despagar" um pedido. */}
          {aguardandoPagamento.length > 0 && (
            <DashboardColumn
              columnId="col-aguardando-pagamento"
              title="Aguardando Pagamento" emoji="💰" color="#0891B2" count={aguardandoPagamento.length} columnOrders={aguardandoPagamento}
              isTabActive={activeColumnTab === "all" || activeColumnTab === "col-aguardando-pagamento"}
              dragOverColumn={dragOverColumn} selectedOrderIds={selectedOrderIds} onToggleSelectColumn={toggleSelectColumn}
            >
              {aguardandoPagamento.map(o => (
                <DashboardOrderCard
                  key={o.id}
                  order={o}
                  expanded={expandedId === o.id}
                  isLoading={loadingId === o.id}
                  isDragging={draggedOrderId === o.id}
                  now={now}
                  seqNum={getDisplayOrderNumber(o)}
                  timeAlertConfig={timeAlertConfig}
                  selectedOrderIds={selectedOrderIds}
                  motoboys={motoboys}
                  assigningId={assigningId}
                  onToggleSelectOrder={toggleSelectOrder}
                  onToggleExpand={(id: string) => setExpandedId(prev => prev === id ? null : id)}
                  onUpdateStatus={updateStatus}
                  onConfirmarPagamento={(ord: any) => setConfirmarPagamentoOrder(ord)}
                  onAssignMotoboy={assignMotoboy}
                  onOpenCancelModal={(id: string) => { setCancelConfirmId(id); setCancelReason(""); }}
                  onOpenPrintModal={(id: string) => setPrintSelectOrderId(id)}
                  onOpenReceiptModal={(id: string) => setViewReceiptOrderId(id)}
                  onOpenDeliveryModal={(ord: any) => setDeliveryInfoModalOrder(ord)}
                  onDragStart={handleDragStart}
                  onDragEnd={handleDragEnd}
                  setOrders={setOrders}
                />
              ))}
            </DashboardColumn>
          )}
          <DashboardColumn
            columnId="col-novos"
            title="Novos Pedidos" emoji="🔔" color="#3B82F6" count={novos.length} columnOrders={novos}
            isTabActive={activeColumnTab === "all" || activeColumnTab === "col-novos"}
            dragOverColumn={dragOverColumn} selectedOrderIds={selectedOrderIds} onToggleSelectColumn={toggleSelectColumn}
            onDragOver={(e: any) => handleDragOver(e, "col-novos")} onDragLeave={handleDragLeave} onDrop={(e: any) => handleDrop(e, "col-novos")}
            headerBelow={
              /* Faixa larga logo abaixo do cabeçalho: um pill de 40px escrito
                 "Auto" não dizia o que ligava. Aqui cabe o nome inteiro da
                 ação mais o estado atual, e continua fora da área rolável. */
              <button
                onClick={toggleAutoAccept}
                aria-pressed={autoAccept}
                title={autoAccept
                  ? "Aceitar automático LIGADO: todo pedido novo entra já aceito. Clique para desligar."
                  : "Aceitar automático DESLIGADO: você aceita cada pedido na mão. Clique para ligar."}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.4rem",
                  width: "100%", padding: "6px 0.85rem", border: "none", textAlign: "left",
                  borderBottom: "1px solid #E2E8F0", cursor: "pointer",
                  background: autoAccept ? "#DCFCE7" : "#F8FAFC",
                  color: autoAccept ? "#15803D" : "#64748B",
                  transition: "all 0.2s"
                }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: "5px", minWidth: 0, fontSize: "0.72rem", fontWeight: 700 }}>
                  {autoAccept ? <ToggleRight size={16} style={{ flexShrink: 0 }} /> : <ToggleLeft size={16} style={{ flexShrink: 0 }} />}
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Aceitar automático</span>
                </span>
                <span style={{ fontSize: "0.62rem", fontWeight: 800, letterSpacing: "0.03em", flexShrink: 0 }}>
                  {autoAccept ? "LIGADO" : "DESLIGADO"}
                </span>
              </button>
            }
          >
            {novos.map(o => (
              <DashboardOrderCard
                key={o.id}
                order={o}
                expanded={expandedId === o.id}
                isLoading={loadingId === o.id}
                isDragging={draggedOrderId === o.id}
                now={now}
                seqNum={getDisplayOrderNumber(o)}
                timeAlertConfig={timeAlertConfig}
                selectedOrderIds={selectedOrderIds}
                motoboys={motoboys}
                assigningId={assigningId}
                onToggleSelectOrder={toggleSelectOrder}
                onToggleExpand={(id: string) => setExpandedId(prev => prev === id ? null : id)}
                onUpdateStatus={updateStatus}
                onAssignMotoboy={assignMotoboy}
                onOpenCancelModal={(id: string) => { setCancelConfirmId(id); setCancelReason(""); }}
                onOpenPrintModal={(id: string) => setPrintSelectOrderId(id)}
                onOpenReceiptModal={(id: string) => setViewReceiptOrderId(id)}
                onOpenDeliveryModal={(ord: any) => setDeliveryInfoModalOrder(ord)}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                setOrders={setOrders}
              />
            ))}
          </DashboardColumn>
          <DashboardColumn columnId="col-preparo" title="Em Produção" emoji="👨‍🍳" color="#F59E0B" count={preparo.length} columnOrders={preparo}
            isTabActive={activeColumnTab === "all" || activeColumnTab === "col-preparo"}
            dragOverColumn={dragOverColumn} selectedOrderIds={selectedOrderIds} onToggleSelectColumn={toggleSelectColumn}
            onDragOver={(e: any) => handleDragOver(e, "col-preparo")} onDragLeave={handleDragLeave} onDrop={(e: any) => handleDrop(e, "col-preparo")}>
            {preparo.map(o => (
              <DashboardOrderCard
                key={o.id}
                order={o}
                expanded={expandedId === o.id}
                isLoading={loadingId === o.id}
                isDragging={draggedOrderId === o.id}
                now={now}
                seqNum={getDisplayOrderNumber(o)}
                timeAlertConfig={timeAlertConfig}
                selectedOrderIds={selectedOrderIds}
                motoboys={motoboys}
                assigningId={assigningId}
                onToggleSelectOrder={toggleSelectOrder}
                onToggleExpand={(id: string) => setExpandedId(prev => prev === id ? null : id)}
                onUpdateStatus={updateStatus}
                onAssignMotoboy={assignMotoboy}
                onOpenCancelModal={(id: string) => { setCancelConfirmId(id); setCancelReason(""); }}
                onOpenPrintModal={(id: string) => setPrintSelectOrderId(id)}
                onOpenReceiptModal={(id: string) => setViewReceiptOrderId(id)}
                onOpenDeliveryModal={(ord: any) => setDeliveryInfoModalOrder(ord)}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                setOrders={setOrders}
              />
            ))}
          </DashboardColumn>
          <DashboardColumn columnId="col-transporte" title="Saiu para Entrega" emoji="🛵" color="#7C3AED" count={transporte.length} columnOrders={transporte}
            isTabActive={activeColumnTab === "all" || activeColumnTab === "col-transporte"}
            dragOverColumn={dragOverColumn} selectedOrderIds={selectedOrderIds} onToggleSelectColumn={toggleSelectColumn}
            onDragOver={(e: any) => handleDragOver(e, "col-transporte")} onDragLeave={handleDragLeave} onDrop={(e: any) => handleDrop(e, "col-transporte")}>
            {transporte.map(o => (
              <DashboardOrderCard
                key={o.id}
                order={o}
                expanded={expandedId === o.id}
                isLoading={loadingId === o.id}
                isDragging={draggedOrderId === o.id}
                now={now}
                seqNum={getDisplayOrderNumber(o)}
                timeAlertConfig={timeAlertConfig}
                selectedOrderIds={selectedOrderIds}
                motoboys={motoboys}
                assigningId={assigningId}
                onToggleSelectOrder={toggleSelectOrder}
                onToggleExpand={(id: string) => setExpandedId(prev => prev === id ? null : id)}
                onUpdateStatus={updateStatus}
                onAssignMotoboy={assignMotoboy}
                onOpenCancelModal={(id: string) => { setCancelConfirmId(id); setCancelReason(""); }}
                onOpenPrintModal={(id: string) => setPrintSelectOrderId(id)}
                onOpenReceiptModal={(id: string) => setViewReceiptOrderId(id)}
                onOpenDeliveryModal={(ord: any) => setDeliveryInfoModalOrder(ord)}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                setOrders={setOrders}
              />
            ))}
          </DashboardColumn>
          <DashboardColumn columnId="col-finalizado" title="Finalizado" emoji="✅" color="#10B981" count={finalizados.length} columnOrders={finalizados}
            isTabActive={activeColumnTab === "all" || activeColumnTab === "col-finalizado"}
            dragOverColumn={dragOverColumn} selectedOrderIds={selectedOrderIds} onToggleSelectColumn={toggleSelectColumn}
            onDragOver={(e: any) => handleDragOver(e, "col-finalizado")} onDragLeave={handleDragLeave} onDrop={(e: any) => handleDrop(e, "col-finalizado")}>
            {finalizados.map(o => (
              <DashboardOrderCard
                key={o.id}
                order={o}
                expanded={expandedId === o.id}
                isLoading={loadingId === o.id}
                isDragging={draggedOrderId === o.id}
                now={now}
                seqNum={getDisplayOrderNumber(o)}
                timeAlertConfig={timeAlertConfig}
                selectedOrderIds={selectedOrderIds}
                motoboys={motoboys}
                assigningId={assigningId}
                onToggleSelectOrder={toggleSelectOrder}
                onToggleExpand={(id: string) => setExpandedId(prev => prev === id ? null : id)}
                onUpdateStatus={updateStatus}
                onAssignMotoboy={assignMotoboy}
                onOpenCancelModal={(id: string) => { setCancelConfirmId(id); setCancelReason(""); }}
                onOpenPrintModal={(id: string) => setPrintSelectOrderId(id)}
                onOpenReceiptModal={(id: string) => setViewReceiptOrderId(id)}
                onOpenDeliveryModal={(ord: any) => setDeliveryInfoModalOrder(ord)}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                setOrders={setOrders}
              />
            ))}
          </DashboardColumn>
          <DashboardColumn columnId="col-cancelados" title="Cancelado" emoji="🚫" color="#EF4444" count={cancelados.length} columnOrders={cancelados}
            isTabActive={activeColumnTab === "all" || activeColumnTab === "col-cancelados"}
            dragOverColumn={dragOverColumn} selectedOrderIds={selectedOrderIds} onToggleSelectColumn={toggleSelectColumn}
            onDragOver={(e: any) => handleDragOver(e, "col-cancelados")} onDragLeave={handleDragLeave} onDrop={(e: any) => handleDrop(e, "col-cancelados")}>
            {cancelados.map(o => (
              <DashboardOrderCard
                key={o.id}
                order={o}
                expanded={expandedId === o.id}
                isLoading={loadingId === o.id}
                isDragging={draggedOrderId === o.id}
                now={now}
                seqNum={getDisplayOrderNumber(o)}
                timeAlertConfig={timeAlertConfig}
                selectedOrderIds={selectedOrderIds}
                motoboys={motoboys}
                assigningId={assigningId}
                onToggleSelectOrder={toggleSelectOrder}
                onToggleExpand={(id: string) => setExpandedId(prev => prev === id ? null : id)}
                onUpdateStatus={updateStatus}
                onAssignMotoboy={assignMotoboy}
                onOpenCancelModal={(id: string) => { setCancelConfirmId(id); setCancelReason(""); }}
                onOpenPrintModal={(id: string) => setPrintSelectOrderId(id)}
                onOpenReceiptModal={(id: string) => setViewReceiptOrderId(id)}
                onOpenDeliveryModal={(ord: any) => setDeliveryInfoModalOrder(ord)}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                setOrders={setOrders}
              />
            ))}
          </DashboardColumn>
        </div>
      </div>

      {/* ===== MODAL CONFIGURAÇÃO DE ALERTAS DE TEMPO ===== */}
      {showAlertModal && (
        <div onClick={() => setShowAlertModal(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: "20px", padding: "28px", width: "100%", maxWidth: "480px", boxShadow: "0 25px 60px rgba(0,0,0,0.3)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <div style={{ width: 42, height: 42, borderRadius: "12px", background: "linear-gradient(135deg, #F59E0B, #D97706)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.3rem" }}>
                  ⏱️
                </div>
                <div>
                  <h3 style={{ fontWeight: 800, fontSize: "1.1rem", margin: 0, color: "#0F172A" }}>Alertas de Produção</h3>
                  <p style={{ fontSize: "0.78rem", color: "#64748B", margin: 0 }}>Destaque visual de prazos na aba 'Em Produção'</p>
                </div>
              </div>
              <button onClick={() => setShowAlertModal(false)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "1.4rem", color: "#94A3B8" }}>×</button>
            </div>

            {/* Explicação */}
            <div style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: "12px", padding: "12px 14px", marginBottom: "20px", fontSize: "0.8rem", color: "#475569", lineHeight: 1.4 }}>
              💡 Configure com quantos minutos de antecedência a borda do pedido na aba <strong>Em Produção</strong> deve ficar amarela ou vermelha para alertar a equipe. Se desativado ou 0, o alerta não é exibido.
            </div>

            {/* 🟡 Alerta Amarelo */}
            <div style={{ background: "#FFFBEB", border: "1.5px solid #FCD34D", borderRadius: "14px", padding: "16px", marginBottom: "16px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={{ fontSize: "1.2rem" }}>🟡</span>
                  <span style={{ fontWeight: 800, fontSize: "0.95rem", color: "#92400E" }}>Alerta Amarelo (Aviso)</span>
                </div>
                <label style={{ display: "flex", alignItems: "center", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={timeAlertConfig.yellowEnabled}
                    onChange={e => setTimeAlertConfig(c => ({ ...c, yellowEnabled: e.target.checked }))}
                    style={{ width: 18, height: 18, cursor: "pointer", accentColor: "#F59E0B" }}
                  />
                </label>
              </div>
              {timeAlertConfig.yellowEnabled && (
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "10px" }}>
                  <span style={{ fontSize: "0.82rem", color: "#78350F", fontWeight: 600 }}>Ativar quando faltarem</span>
                  <input
                    type="number"
                    min={1}
                    max={120}
                    value={timeAlertConfig.yellowMinutes}
                    onChange={e => setTimeAlertConfig(c => ({ ...c, yellowMinutes: Math.max(0, Number(e.target.value)) }))}
                    style={{ width: 70, padding: "6px 10px", borderRadius: "8px", border: "1.5px solid #F59E0B", fontWeight: 800, fontSize: "0.95rem", textAlign: "center" }}
                  />
                  <span style={{ fontSize: "0.82rem", color: "#78350F", fontWeight: 600 }}>minutos para o cliente</span>
                </div>
              )}
            </div>

            {/* 🔴 Alerta Vermelho */}
            <div style={{ background: "#FEF2F2", border: "1.5px solid #FCA5A5", borderRadius: "14px", padding: "16px", marginBottom: "20px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={{ fontSize: "1.2rem" }}>🔴</span>
                  <span style={{ fontWeight: 800, fontSize: "0.95rem", color: "#991B1B" }}>Alerta Vermelho (Urgente)</span>
                </div>
                <label style={{ display: "flex", alignItems: "center", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={timeAlertConfig.redEnabled}
                    onChange={e => setTimeAlertConfig(c => ({ ...c, redEnabled: e.target.checked }))}
                    style={{ width: 18, height: 18, cursor: "pointer", accentColor: "#EF4444" }}
                  />
                </label>
              </div>
              {timeAlertConfig.redEnabled && (
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "10px" }}>
                  <span style={{ fontSize: "0.82rem", color: "#7F1D1D", fontWeight: 600 }}>Ativar quando faltarem</span>
                  <input
                    type="number"
                    min={1}
                    max={120}
                    value={timeAlertConfig.redMinutes}
                    onChange={e => setTimeAlertConfig(c => ({ ...c, redMinutes: Math.max(0, Number(e.target.value)) }))}
                    style={{ width: 70, padding: "6px 10px", borderRadius: "8px", border: "1.5px solid #EF4444", fontWeight: 800, fontSize: "0.95rem", textAlign: "center" }}
                  />
                  <span style={{ fontSize: "0.82rem", color: "#7F1D1D", fontWeight: 600 }}>minutos para o cliente</span>
                </div>
              )}
            </div>

            {/* Botões de Ação */}
            <div style={{ display: "flex", gap: "10px" }}>
              <button
                onClick={() => setShowAlertModal(false)}
                style={{ flex: 1, padding: "10px", borderRadius: "10px", border: "1px solid #CBD5E1", background: "#FFF", color: "#475569", fontWeight: 700, cursor: "pointer" }}
              >
                Cancelar
              </button>
              <button
                onClick={async () => {
                  try {
                    const res = await fetch("/api/store/time-alert-config", {
                      method: "PUT",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify(timeAlertConfig),
                    });
                    if (res.ok) {
                      showToast("✅ Configurações de alerta salvas com sucesso!", "#10B981");
                      setShowAlertModal(false);
                    }
                  } catch {
                    showToast("Erro ao salvar alertas.", "#EF4444");
                  }
                }}
                style={{ flex: 2, padding: "10px", borderRadius: "10px", border: "none", background: "linear-gradient(135deg, #F59E0B, #D97706)", color: "#FFF", fontWeight: 800, cursor: "pointer" }}
              >
                💾 Salvar Configurações
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Módulo de Roteirização */}
      <RoteirizacaoModal
        isOpen={showRoteirizacaoModal}
        onClose={() => setShowRoteirizacaoModal(false)}
        orders={orders}
        storeAddress={user.storeAddress}
        storeCity={user.city}
        storeSlug={user.slug}
        storeId={user.id}
        storeLatLng={user.storeLatLng}
        onRefreshOrders={() => router.refresh()}
        onUpdateOrderStatus={updateStatus}
      />

      {/* Modal App Motoboys - Link de Acesso Exclusivo */}
      {showMotoboyLinkModal && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
          background: "rgba(15, 23, 42, 0.75)", backdropFilter: "blur(6px)",
          zIndex: 99999, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem"
        }}>
          <div style={{
            background: "#FFFFFF", width: "100%", maxWidth: "520px", borderRadius: "16px",
            padding: "1.75rem", boxShadow: "0 25px 50px -12px rgba(0,0,0,0.4)", border: "1px solid #E2E8F0"
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <span style={{ fontSize: "1.8rem" }}>🛵</span>
                <div>
                  <h3 style={{ margin: 0, fontSize: "1.15rem", fontWeight: 800, color: "#0F172A" }}>
                    Portal de Acesso dos Motoboys
                  </h3>
                  <p style={{ margin: 0, fontSize: "0.8rem", color: "#64748B" }}>
                    Envie este link para seus entregadores cadastrarem/acessarem
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowMotoboyLinkModal(false)}
                style={{ background: "#F1F5F9", border: "none", borderRadius: "50%", width: 32, height: 32, cursor: "pointer", fontWeight: 800 }}
              >
                ✕
              </button>
            </div>

            <div style={{
              background: "#F8FAFC", border: "1.5px solid #CBD5E1", borderRadius: "10px",
              padding: "1rem", marginBottom: "1.25rem"
            }}>
              <label style={{ fontSize: "0.76rem", fontWeight: 800, color: "#475569", textTransform: "uppercase", display: "block", marginBottom: 6 }}>
                Link Direto da Loja ({user.slug || "sua-loja"}):
              </label>
              <div style={{
                background: "#FFFFFF", border: "1px solid #E2E8F0", padding: "10px 12px",
                borderRadius: "8px", fontSize: "0.88rem", fontWeight: 700, color: "#1D4ED8",
                wordBreak: "break-all"
              }}>
                {typeof window !== "undefined" ? `${window.location.origin}/loja/${user.slug || "sua-loja"}/motoboy` : `https://firehubfood.com.br/loja/${user.slug || "sua-loja"}/motoboy`}
              </div>
            </div>

            <div style={{ display: "flex" }}>
              <button
                onClick={() => {
                  const link = `${window.location.origin}/loja/${user.slug || "sua-loja"}/motoboy`;
                  navigator.clipboard.writeText(link);
                  setCopiedMotoboyLink(true);
                  setTimeout(() => setCopiedMotoboyLink(false), 3000);
                }}
                style={{
                  width: "100%", padding: "14px", background: copiedMotoboyLink ? "#10B981" : "#2563EB",
                  color: "#FFFFFF", border: "none", borderRadius: "10px", fontWeight: 900,
                  fontSize: "0.95rem", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  boxShadow: "0 4px 12px rgba(37,99,235,0.25)"
                }}
              >
                {copiedMotoboyLink ? "✅ Link Copiado para a Área de Transferência!" : "📋 Copiar Link para Motoboys"}
              </button>
            </div>

          </div>
        </div>
      )}

      {/* TOAST NOTIFICATION */}
      {toastMsg && (
        <div style={{
          position: "fixed", bottom: "24px", right: "24px", zIndex: 99999,
          background: toastMsg.color, color: "#fff", padding: "12px 24px",
          borderRadius: "8px", fontWeight: 700, boxShadow: "0 10px 25px rgba(0,0,0,0.15)",
          display: "flex", alignItems: "center", gap: "8px", transition: "all 0.3s ease",
          animation: "pulse 2s infinite"
        }}>
          {toastMsg.color === "#10B981" ? "✅" : "⚠️"} {toastMsg.text}
        </div>
      )}

      <style>{`
        .dashboard-kanban-container {
          display: flex;
          gap: 0.65rem;
          overflow-x: auto;
          padding-bottom: 0.5rem;
          max-width: 100%;
          scrollbar-width: thin;
          scrollbar-color: #CBD5E1 transparent;
          -webkit-overflow-scrolling: touch;
        }
        .dashboard-kanban-container::-webkit-scrollbar {
          height: 6px;
        }
        .dashboard-kanban-container::-webkit-scrollbar-thumb {
          background: #CBD5E1;
          border-radius: 4px;
        }

        .dashboard-kanban-column {
          flex: 1 1 0px !important;
          min-width: 220px !important;
          max-width: none !important;
          transition: all 0.15s ease;
          overflow: hidden;
          box-sizing: border-box;
        }

        /* Large screens (> 1440px) - all 5 columns comfortable */

        /* Standard notebooks (1280px to 1440px) - slightly narrower */
        @media (max-width: 1440px) {
          .dashboard-kanban-column {
            min-width: 200px !important;
          }
        }

        /* Smaller notebooks and laptops (1024px to 1279px) - compact */
        @media (max-width: 1279px) {
          .dashboard-kanban-column {
            min-width: 180px !important;
          }
        }

        /* Tablets and smaller notebooks (< 1024px) - horizontal scroll */
        @media (max-width: 1023px) {
          .dashboard-kanban-container {
            flex-wrap: nowrap;
          }
          .dashboard-kanban-column.is-hidden-tab {
            display: none !important;
          }
          .dashboard-kanban-column {
            flex: 0 0 280px !important;
            min-width: 280px !important;
            max-width: 320px !important;
          }
        }

        /* Mobile phones (< 640px) - single column with horizontal scroll */
        @media (max-width: 640px) {
          .dashboard-kanban-column {
            flex: 0 0 85vw !important;
            min-width: 85vw !important;
            max-width: 90vw !important;
            min-height: calc(100vh - 220px) !important;
          }
          .status-pill-btn {
            padding: 5px 9px !important;
            font-size: 0.72rem !important;
          }
        }

        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.75; }
        }
      `}</style>
    </div>
  );
}
