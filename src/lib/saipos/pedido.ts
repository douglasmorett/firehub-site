/**
 * lib/saipos/pedido.ts — CustomerOrder → pedido da API de Pedidos do Saipos (POST /order).
 *
 * Sentido ÚNICO: FireHub → Saipos. O Saipos não manda pedido para fora (só
 * recebe de parceiro), então esta integração só empurra o pedido do FireHub
 * para o PDV dele. Quem liga é a equipe do FireHub, a pedido da loja
 * (api/admin/saipos): não aparece em Integrações.
 *
 * Função pura: não lê banco, rede nem relógio.
 *
 * ── Valores: as réguas que já existem ───────────────────────────────────────
 *
 * Itens, taxa, desconto e acréscimo saem de `contaDoPedido` (a mesma conta da
 * comanda e do painel); pagamento de `pagamentosOD` (a régua do caixa, a mesma
 * da logística do Open Delivery). O `price` do item do FireHub já é o unitário
 * COM as opções: vai em `unit_price`, e cada opção vai com `aditional_price`
 * 0 — o Saipos calcula (unit_price + adicionais) × quantidade, e fecha.
 *
 * ── Código PDV ──────────────────────────────────────────────────────────────
 *
 * Sem o código do ITEM o pedido não é enviado (volta `faltando`): sem código o
 * Saipos recusa. Opção sem código NÃO trava o pedido: vira observação do item
 * ("sem código no Saipos: ...") e entra no aviso — pedido perdido é pior que
 * uma opção escrita à mão.
 */
import { contaDoPedido } from "@/lib/conta-do-pedido";
import { lerEnderecoGravado } from "@/lib/cliente-reconhecido";
import { parseComboSelections } from "@/lib/parse-combo";
import { nomeDoItem } from "@/lib/nome-do-item";
import { canalDoPedido } from "@/lib/canal-do-pedido";
import { cidadeDaLoja, pagamentosOD, ufDaLoja, type LojaParaOD, type MetodoOD } from "@/lib/open-delivery-saida/pedido";
import { codigoDaOpcao, codigoDoItem, type IndiceDoCatalogo } from "./codigos";

const reais = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const digitos = (t: unknown) => String(t ?? "").replace(/\D/g, "");

// ── Quem vai ──────────────────────────────────────────────────────────────────

export type PedidoParaSaipos = {
  id: string;
  status: string;
  source?: string | null;
  deliveryType?: string | null;
  deliveryBy?: string | null;
  ifoodOrderId?: string | null;
  ifoodReference?: string | null;
  openDeliveryOrderId?: string | null;
  openDeliveryChannel?: string | null;
  openDeliveryReference?: string | null;
  food99AppShopId?: string | null;
  tableSessionId?: string | null;
  parentOrderId?: string | null;
};

const NAO_E_PEDIDO_AINDA = new Set(["CRIANDO_IA", "AGUARDANDO_PAGAMENTO"]);
const RETIRADAS = new Set(["PICKUP", "TAKEOUT", "RETIRADA", "BALCAO", "BALCÃO"]);

/** O modo do pedido no Saipos, ou null se este pedido não vai para lá. */
export function modoNoSaipos(p: PedidoParaSaipos): "DELIVERY" | "TAKEOUT" | null {
  if (p.ifoodOrderId || p.openDeliveryOrderId || p.food99AppShopId) return null;
  if (p.tableSessionId || p.parentOrderId) return null;
  if (NAO_E_PEDIDO_AINDA.has(String(p.status || "").toUpperCase())) return null;
  if (String(p.source || "").toUpperCase() === "EQUIPE") return null;
  const canal = canalDoPedido(p as any);
  if (canal.ehMarketplace || canal.chave === "MESA") return null;
  const tipo = String(p.deliveryType || "").toUpperCase();
  if (tipo === "DELIVERY") return "DELIVERY";
  if (RETIRADAS.has(tipo)) return "TAKEOUT";
  return null;
}

// ── Pagamento ─────────────────────────────────────────────────────────────────

const CODIGO_DA_FORMA: Record<string, string> = {
  CASH: "DIN",
  CREDIT: "CRE",
  DEBIT: "DEB",
  MEAL_VOUCHER: "VALE",
  PIX: "PARTNER_PAYMENT",
  OTHER: "OTHER",
};

export type PagamentoSaipos = { code: string; amount: number; change_for: number; complement?: string; type: "ONLINE" | "OFFLINE" };

export function pagamentosNoSaipos(o: any): PagamentoSaipos[] {
  const { methods } = pagamentosOD(o);
  return methods.map((m: MetodoOD) => {
    const online = m.type === "PREPAID";
    // Pix é sempre PARTNER_PAYMENT com complemento "pix" (a loja liga a forma "Pix" no Saipos);
    // online quando o cliente já pagou pelo site, offline quando paga na porta.
    if (m.method === "PIX") return { code: "PARTNER_PAYMENT", amount: m.value, change_for: 0, complement: "pix", type: online ? "ONLINE" : "OFFLINE" };
    // Pago online sem forma identificada: "Pagamento Online" do parceiro.
    if (online && m.method === "OTHER") return { code: "PARTNER_PAYMENT", amount: m.value, change_for: 0, complement: "", type: "ONLINE" };
    const code = CODIGO_DA_FORMA[m.method] || "OTHER";
    return {
      code,
      amount: m.value,
      change_for: code === "DIN" && m.changeFor ? m.changeFor : 0,
      complement: "",
      // Cartão pago online no FireHub (PREPAID) vai marcado ONLINE.
      type: online ? "ONLINE" : "OFFLINE",
    };
  });
}

// ── O pedido ──────────────────────────────────────────────────────────────────

export type IntegracaoParaSaipos = { codStore: string };

export type ResultadoDoPedido =
  | { ok: true; payload: Record<string, unknown>; avisos: string[] }
  | { ok: false; faltando: string[] };

const dataBr = (d: Date) =>
  d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export function pedidoNoFormatoSaipos(
  o: any,
  loja: LojaParaOD,
  integ: IntegracaoParaSaipos,
  indice: IndiceDoCatalogo,
): ResultadoDoPedido {
  const modo = modoNoSaipos(o);
  if (!modo) return { ok: false, faltando: ["pedido que não vai para o Saipos"] };

  const itensValidos = (o.items || []).filter((i: any) => Number(i.quantity) > 0);
  const conta = contaDoPedido({ ...o, items: itensValidos });
  const faltando: string[] = [];
  const avisos: string[] = [];

  const items = itensValidos.map((i: any) => {
    const nome = nomeDoItem(i);
    const codigo = codigoDoItem(indice, [nome, i.menuProduct?.name]);
    if (!codigo) faltando.push(nome);
    const notas: string[] = [];
    if (i.notes) notas.push(String(i.notes));
    const choice_items: any[] = [];
    for (const op of parseComboSelections(i.comboSelections, 1)) {
      const cod = codigoDaOpcao(indice, codigo, op.name);
      if (cod) {
        choice_items.push({
          integration_code: cod,
          desc_item_choice: String(op.name),
          aditional_price: 0,
          quantity: Number(op.quantity) || 1,
          notes: "",
        });
      } else {
        const q = Number(op.quantity) > 1 ? `${op.quantity}x ` : "";
        notas.push(`${q}${op.name} (sem código no Saipos)`);
        avisos.push(`opção sem código: ${op.name} (${nome})`);
      }
    }
    return {
      integration_code: codigo || "",
      desc_item: nome,
      quantity: Number(i.quantity) || 1,
      unit_price: reais(Number(i.price) || 0),
      notes: notas.join(" · "),
      ...(choice_items.length > 0 ? { choice_items } : {}),
    };
  });
  if (faltando.length > 0) return { ok: false, faltando: [...new Set(faltando)] };
  if (items.length === 0) return { ok: false, faltando: ["pedido sem itens"] };

  // Ajustes da conta: negativo = desconto; positivo = acréscimo (taxa de serviço etc.).
  const desconto = reais(conta.ajustes.filter((a) => a.valor < 0).reduce((s, a) => s - a.valor, 0));
  const acrescimos = conta.ajustes.filter((a) => a.valor > 0);
  const acrescimo = reais(acrescimos.reduce((s, a) => s + a.valor, 0));

  const telefone = digitos(o.customerPhone);
  const agendado = Boolean(o.agendado && o.scheduledDatetime);
  const notasDoPedido = [
    agendado ? `AGENDADO PARA ${dataBr(new Date(o.scheduledDatetime))}` : "",
    o.notes ? String(o.notes) : "",
  ].filter(Boolean).join(" · ");

  const payload: Record<string, unknown> = {
    order_id: String(o.id),
    display_id: String(o.dailyOrderNumber ?? String(o.id).slice(-4).toUpperCase()),
    cod_store: integ.codStore,
    created_at: new Date(o.createdAt).toISOString(),
    notes: notasDoPedido,
    total_discount: desconto,
    total_increase: acrescimo,
    ...(acrescimo > 0
      ? { otherFees: acrescimos.map((a) => ({ description: a.rotulo, type: "SERVICE_FEE", liability: "RESTAURANT", value: reais(a.valor) })) }
      : {}),
    total_amount: reais(Number(o.totalAmount) || 0),
    customer: {
      id: telefone || "-1",
      name: String(o.customerName || "Cliente"),
      phone: telefone || "00000000000",
    },
    order_method:
      modo === "DELIVERY"
        ? {
            mode: "DELIVERY",
            delivery_by: "RESTAURANT",
            delivery_fee: reais(conta.taxaEntrega),
            scheduled: agendado,
            ...(agendado ? { delivery_date_time: new Date(o.scheduledDatetime).toISOString() } : {}),
          }
        : { mode: "TAKEOUT", scheduled: agendado, ...(agendado ? { delivery_date_time: new Date(o.scheduledDatetime).toISOString() } : {}) },
    items,
    payment_types: pagamentosNoSaipos(o),
  };

  if (modo === "DELIVERY") {
    const texto = String(o.customerAddress || "").trim();
    const lido = lerEnderecoGravado(texto, o.customerLatLng);
    const ponto = o.customerLatLng && typeof o.customerLatLng === "object" ? (o.customerLatLng as { lat?: unknown; lng?: unknown }) : null;
    const lat = Number(ponto?.lat);
    const lng = Number(ponto?.lng);
    const uf = ufDaLoja(loja).replace(/^BR-/, "");
    payload.delivery_address = {
      country: "BR",
      state: uf,
      city: cidadeDaLoja(loja),
      district: lido?.bairro || cidadeDaLoja(loja) || "Centro",
      street_name: lido?.rua || texto || "Endereço não informado",
      street_number: lido?.numero || "S/N",
      postal_code: digitos(lido?.cep) || "00000000",
      reference: texto,
      ...(lido?.complemento ? { complement: lido.complemento } : {}),
      ...(Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0) ? { coordinates: { latitude: lat, longitude: lng } } : {}),
    };
    if (!uf) avisos.push("sem UF da loja: o Saipos recusa endereço sem estado válido");
  }

  // A conta do Saipos (itens − desconto + entrega + acréscimo) tem de fechar com o total do FireHub.
  const subtotal = reais(items.reduce((s: number, i: any) => s + i.unit_price * i.quantity, 0));
  const doSaipos = reais(subtotal - desconto + acrescimo + (modo === "DELIVERY" ? reais(conta.taxaEntrega) : 0));
  const nosso = reais(Number(o.totalAmount) || 0);
  if (Math.abs(doSaipos - nosso) > 0.01) avisos.push(`total não fecha: Saipos calcularia ${doSaipos.toFixed(2)} e o FireHub tem ${nosso.toFixed(2)}`);

  return { ok: true, payload, avisos };
}
