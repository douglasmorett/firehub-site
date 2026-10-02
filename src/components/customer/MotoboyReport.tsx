"use client";
import { useState, useCallback } from "react";
import { Calendar, Download, Filter, Bike, TrendingUp, DollarSign, MapPin, Loader2, X } from "lucide-react";
import { contaDoPedido, emReais as emReaisConta } from "@/lib/conta-do-pedido";
import type { ChaveDeCanal } from "@/lib/canal-do-pedido";
import { resumoDasEntregas } from "@/lib/resumo-do-entregador";

type Motoboy = { id: string; name: string; paymentType: string; dailyRate?: number; perDeliveryRate?: number; perKmRate?: number; active: boolean };

const fmt = (v: number) => `R$ ${(v || 0).toFixed(2).replace(".", ",")}`;
/**
 * Os botões do filtro de integrações no cartão de cada motoboy. Os quatro
 * primeiros aparecem sempre (é o que o lojista procura: iFood, 99, site,
 * balcão); os outros só quando aquele motoboy tem entrega de lá — botão de
 * canal que a loja nem usa só enche o cartão.
 */
const CANAIS_DO_FILTRO: { chave: ChaveDeCanal; nome: string; logo?: string; emoji?: string; sempre?: boolean }[] = [
  { chave: "IFOOD", nome: "iFood", logo: "/images/logos/ifood.png", sempre: true },
  { chave: "99FOOD", nome: "99Food", logo: "/images/logos/99.svg", sempre: true },
  { chave: "SITE", nome: "Site próprio", emoji: "🌐", sempre: true },
  { chave: "PDV", nome: "Balcão", emoji: "🧾", sempre: true },
  { chave: "MESA", nome: "Mesa", emoji: "🍽️" },
  { chave: "WHATSAPP_IA", nome: "Robô WhatsApp", emoji: "🤖" },
  { chave: "TOTEM", nome: "Totem", emoji: "🖥️" },
  { chave: "BRENDI", nome: "Brendi", logo: "/images/logos/brendi.webp" },
  { chave: "WABIZ", nome: "Wabiz", emoji: "📱" },
  { chave: "JOTAJA", nome: "Jotajá", logo: "/images/logos/jotaja.png" },
  { chave: "DESCONHECIDO", nome: "Outro canal", emoji: "❔" },
];

// Sem "Personalizado": as caixas de data ficam SEMPRE na tela. O botão só
// preenchia as mesmas duas caixas, e escondê-las até alguém achar o botão fazia
// o lojista pensar que não dava para escolher a data.
const PERIODS = [
  { label: "Hoje", value: "today" },
  { label: "Ontem", value: "yesterday" },
  { label: "Esta semana", value: "week" },
  { label: "Este mês", value: "month" },
];

/**
 * Formata uma data que JÁ está no fuso da loja.
 *
 * O código antigo passava essas datas por getBrasilDateString() de novo — ou
 * seja, convertia duas vezes. No computador da loja (que também está em
 * Brasília) isso dava no mesmo e ninguém percebeu; num navegador em outro fuso
 * o início da semana saía um dia deslocado. Converter uma vez e formatar é o
 * que evita o erro.
 */
function formatarYMD(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function getRange(period: string, tz = "America/Sao_Paulo") {
  const now = new Date();
  // O "hoje" é o do EXPEDIENTE (vira às 5h, como o servidor lê a data): à 1h
  // da manhã, o turno que está acabando ainda é o de ontem.
  const spNow = new Date(new Date(now.toLocaleString("en-US", { timeZone: tz })).getTime() - 5 * 60 * 60 * 1000);
  const hoje = formatarYMD(spNow);

  if (period === "today") return { from: hoje, to: hoje };
  if (period === "yesterday") {
    const ontem = new Date(spNow);
    ontem.setDate(spNow.getDate() - 1);
    const d = formatarYMD(ontem);
    // Ontem é um dia FECHADO: começa e termina nele mesmo, não vai até hoje.
    return { from: d, to: d };
  }
  if (period === "week") {
    const start = new Date(spNow);
    start.setDate(spNow.getDate() - spNow.getDay());
    return { from: formatarYMD(start), to: hoje };
  }
  if (period === "month") {
    const start = new Date(spNow.getFullYear(), spNow.getMonth(), 1);
    return { from: formatarYMD(start), to: hoje };
  }
  return null;
}

export default function MotoboyReport({ motoboys, storeTimezone }: { motoboys: Motoboy[], storeTimezone?: string }) {
  const tzLoja = storeTimezone || "America/Sao_Paulo";
  // As caixas de data nascem preenchidas com o período selecionado. O lojista
  // vê exatamente qual intervalo vai ser consultado antes de gerar — e pode
  // mexer direto na data sem procurar botão nenhum.
  const inicial = getRange("month", tzLoja)!;
  const [period, setPeriod] = useState("month");
  const [customFrom, setCustomFrom] = useState(inicial.from);
  const [customTo, setCustomTo] = useState(inicial.to);
  // HORA do turno, opcional. Vazio = dia inteiro, como sempre foi. Existe para
  // o entregador que entrou às 18h do dia 1 e saiu às 2h do dia 2: por dia
  // inteiro o relatório traz os dois dias completos — o dobro do que ele fez,
  // e um acerto errado (pedido do dono, 19/09/2026).
  const [horaInicio, setHoraInicio] = useState("");
  const [horaFim, setHoraFim] = useState("");

  /** Clicou num atalho: marca o período E preenche as caixas com ele. */
  const escolherPeriodo = (valor: string) => {
    setPeriod(valor);
    const r = getRange(valor, tzLoja);
    if (r) { setCustomFrom(r.from); setCustomTo(r.to); }
  };
  const [selectedMotoboy, setSelectedMotoboy] = useState("all");
  const [calcMode, setCalcMode] = useState<"all" | "fee_only">("all");
  const [report, setReport] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [periodInfo, setPeriodInfo] = useState<any>(null);
  const [selectedOrderModal, setSelectedOrderModal] = useState<any | null>(null);
  // Integrações DESLIGADAS no cartão de cada motoboy (id → canais). Começa
  // tudo ligado, como o filtro do painel de pedidos.
  const [canaisOcultos, setCanaisOcultos] = useState<Record<string, ChaveDeCanal[]>>({});
  const alternarCanal = (motoboyId: string, canal: ChaveDeCanal) =>
    setCanaisOcultos((atual) => {
      const ocultos = atual[motoboyId] || [];
      return { ...atual, [motoboyId]: ocultos.includes(canal) ? ocultos.filter((c) => c !== canal) : [...ocultos, canal] };
    });

  const load = useCallback(async () => {
    setLoading(true);
    // As caixas de data são a fonte da verdade: os atalhos preenchem elas, então
    // consultar sempre as caixas garante que o que foi buscado é o que está
    // escrito na tela — sem chance de o botão dizer uma coisa e a busca outra.
    const range = {
      from: customFrom + (horaInicio ? `T${horaInicio}` : ""),
      to: customTo + (horaFim ? `T${horaFim}` : ""),
    };
    if (!customFrom || !customTo) { setLoading(false); return; }

    const params = new URLSearchParams({ from: range.from, to: range.to, calcMode });
    if (selectedMotoboy !== "all") params.set("motoboyId", selectedMotoboy);

    const res = await fetch(`/api/motoboy-report?${params}`);
    if (res.ok) {
      const data = await res.json();
      setReport(data.report);
      setPeriodInfo(data.period);
      setLoaded(true);
    }
    setLoading(false);
  }, [period, customFrom, customTo, horaInicio, horaFim, selectedMotoboy, calcMode]);

  /**
   * Cada cartão com o filtro de integrações aplicado. Sem filtro vale a soma do
   * servidor; com filtro a tela refaz a MESMA soma (lib/resumo-do-entregador)
   * só com as entregas visíveis. A diária sai: ela é por dia trabalhado e não
   * se divide entre iFood e 99 — o total filtrado é só o ganho daquelas
   * entregas. Os totais do topo somam o que os cartões mostram.
   */
  const cards = report.map((r) => {
    const ocultos = canaisOcultos[r.motoboy.id] || [];
    const visiveis: any[] = ocultos.length ? r.orders.filter((o: any) => !ocultos.includes(o.canal)) : r.orders;
    const filtrado = visiveis.length !== r.orders.length;
    const st = filtrado
      ? (() => {
          const resumo = resumoDasEntregas(visiveis.map((o: any) => ({ ...o, ganho: o.ganhoDoMotoboy ?? 0 })), tzLoja);
          return { ...r.stats, ...resumo, dailyTotal: 0, totalWithDaily: resumo.feeTotal, totalFeeOnly: resumo.feeTotal };
        })()
      : r.stats;
    const semDistancia = filtrado
      ? visiveis.filter((o: any) => o.origemDoGanho === "SEM_DISTANCIA").length
      : r.motoboy.entregasSemDistancia ?? 0;
    const cancelados = filtrado
      ? (() => { const lista = visiveis.filter((o: any) => o.cancelado); return { qtd: lista.length, lista }; })()
      : r.cancelados;
    const porCanal = new Map<string, number>();
    for (const o of r.orders) porCanal.set(o.canal, (porCanal.get(o.canal) || 0) + 1);
    const botoes = CANAIS_DO_FILTRO.filter((c) => c.sempre || porCanal.has(c.chave));
    return { r, st, visiveis, filtrado, ocultos, semDistancia, cancelados, porCanal, botoes };
  });

  const getMotoboyPay = (st: any) => calcMode === "fee_only" ? st.totalFeeOnly : st.totalWithDaily;
  const totalPay = cards.reduce((s, c) => s + getMotoboyPay(c.st), 0);
  const totalDeliveries = cards.reduce((s, c) => s + c.st.totalDeliveries, 0);
  const totalCashCollected = cards.reduce((s, c) => s + (c.st.cashCollectedSum || 0), 0);
  const totalCardPos = cards.reduce((s, c) => s + (c.st.cardPosTotal || 0), 0);

  const PAYMENT_TYPE_LABEL: Record<string, string> = {
    PER_DELIVERY: "Por entrega",
    DAILY_RATE: "Diária Fixa",
    BOTH: "Diária + Entrega",
    DAILY_PLUS_FEE: "Diária + Taxa do Pedido",
    PER_KM: "Por KM",
    // Faltava aqui: o entregador pago por faixa aparecia com o rótulo cru
    // "FAIXA_KM" no cabeçalho do acerto dele. O nome é o mesmo do cadastro
    // (MotoboyManager) e do modelo (lib/modelos-de-pagamento) — o acerto que o
    // entregador recebe na mão tem que se chamar igual em toda tela.
    FAIXA_KM: "Diária + valor para cada km percorrido",
  };

  return (
    <div style={{ maxWidth: 800 }}>
      {/* Filtros */}
      <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 16, padding: 20, marginBottom: 20 }}>
        <h3 style={{ fontWeight: 800, marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
          <Filter size={18} color="#C92E09" /> Filtros do Relatório
        </h3>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
          {/* Período */}
          <div>
            <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#64748B", display: "block", marginBottom: 6, textTransform: "uppercase" }}>Período</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {PERIODS.map(p => (
                <button key={p.value} onClick={() => escolherPeriodo(p.value)}
                  style={{ padding: "6px 14px", borderRadius: 20, border: `1.5px solid ${period === p.value ? "#C92E09" : "#E2E8F0"}`, background: period === p.value ? "#C92E09" : "#fff", color: period === p.value ? "#fff" : "#475569", fontWeight: 600, fontSize: "0.78rem", cursor: "pointer", fontFamily: "inherit" }}>
                  {p.label}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
              <input type="date" value={customFrom} onChange={e => { setCustomFrom(e.target.value); setPeriod("custom"); }}
                style={{ flex: "1 1 130px", minWidth: 0, padding: "7px 10px", borderRadius: 8, border: `1.5px solid ${period === "custom" ? "#C92E09" : "#E2E8F0"}`, fontSize: "0.82rem", fontFamily: "inherit" }} />
              <input type="time" value={horaInicio} onChange={e => { setHoraInicio(e.target.value); setPeriod("custom"); }} title="Hora de início (opcional)"
                style={{ width: 96, padding: "7px 8px", borderRadius: 8, border: `1.5px solid ${horaInicio ? "#C92E09" : "#E2E8F0"}`, fontSize: "0.82rem", fontFamily: "inherit" }} />
              <span style={{ color: "#94A3B8", fontSize: "0.82rem" }}>até</span>
              <input type="date" value={customTo} onChange={e => { setCustomTo(e.target.value); setPeriod("custom"); }}
                style={{ flex: "1 1 130px", minWidth: 0, padding: "7px 10px", borderRadius: 8, border: `1.5px solid ${period === "custom" ? "#C92E09" : "#E2E8F0"}`, fontSize: "0.82rem", fontFamily: "inherit" }} />
              <input type="time" value={horaFim} onChange={e => { setHoraFim(e.target.value); setPeriod("custom"); }} title="Hora de fim (opcional)"
                style={{ width: 96, padding: "7px 8px", borderRadius: 8, border: `1.5px solid ${horaFim ? "#C92E09" : "#E2E8F0"}`, fontSize: "0.82rem", fontFamily: "inherit" }} />
              {(horaInicio || horaFim) && (
                <button type="button" onClick={() => { setHoraInicio(""); setHoraFim(""); }} title="Voltar para o dia inteiro"
                  style={{ padding: "7px 10px", borderRadius: 8, border: "1.5px solid #E2E8F0", background: "#fff", color: "#64748B", fontSize: "0.76rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                  dia inteiro
                </button>
              )}
            </div>
            <div style={{ marginTop: 6, fontSize: "0.73rem", color: "#94A3B8", lineHeight: 1.45 }}>
              A hora é opcional — em branco, vale o expediente inteiro: das <strong>5h</strong> do dia
              até as <strong>5h</strong> do dia seguinte, então o turno que vira a noite já entra completo.
            </div>
            {customFrom && customTo && customFrom > customTo && (
              <div style={{ marginTop: 6, fontSize: "0.75rem", color: "#B71C1C", fontWeight: 600 }}>
                A data inicial está depois da final — inverta para o relatório vir com dados.
              </div>
            )}
          </div>

          {/* Motoboy */}
          <div>
            <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#64748B", display: "block", marginBottom: 6, textTransform: "uppercase" }}>Motoboy</label>
            <select value={selectedMotoboy} onChange={e => setSelectedMotoboy(e.target.value)}
              style={{ width: "100%", padding: "8px 10px", borderRadius: 10, border: "1.5px solid #E2E8F0", fontSize: "0.88rem", outline: "none", background: "#fff" }}>
              <option value="all">Todos os motoboys</option>
              {motoboys.map(mb => <option key={mb.id} value={mb.id}>{mb.name}</option>)}
            </select>
          </div>
        </div>

        {/* Componentes do Pagamento a apurar */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#64748B", display: "block", marginBottom: 6, textTransform: "uppercase" }}>Composição de Cálculo</label>
          <div style={{ display: "flex", gap: 8, maxWidth: 400 }}>
            <button onClick={() => setCalcMode("all")}
              style={{ flex: 1, padding: "8px 14px", borderRadius: 10, border: `1.5px solid ${calcMode === "all" ? "#C92E09" : "#E2E8F0"}`, background: calcMode === "all" ? "#FEF2F2" : "#fff", color: calcMode === "all" ? "#C92E09" : "#475569", fontWeight: 700, fontSize: "0.82rem", cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
              💵 Diária + Taxa
            </button>
            <button onClick={() => setCalcMode("fee_only")}
              style={{ flex: 1, padding: "8px 14px", borderRadius: 10, border: `1.5px solid ${calcMode === "fee_only" ? "#C92E09" : "#E2E8F0"}`, background: calcMode === "fee_only" ? "#FEF2F2" : "#fff", color: calcMode === "fee_only" ? "#C92E09" : "#475569", fontWeight: 700, fontSize: "0.82rem", cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
              🛵 Só Taxa
            </button>
          </div>
        </div>

        <button onClick={load} disabled={loading}
          style={{ padding: "10px 24px", background: "#C92E09", color: "#fff", border: "none", borderRadius: 10, fontWeight: 700, fontSize: "0.9rem", cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 8 }}>
          {loading ? <Loader2 size={16} className="animate-spin" /> : <TrendingUp size={16} />}
          {loading ? "Carregando..." : "Gerar Relatório"}
        </button>
      </div>

      {/* Resultados */}
      {loaded && !loading && (
        <>
          {/* Totais */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 20 }}>
            {[
              { label: "Total Entregas", value: totalDeliveries.toString(), icon: Bike, color: "#1C1917" },
              { label: "Dinheiro a Entregar", value: fmt(totalCashCollected), icon: DollarSign, color: "#0F766E" },
              { label: "Maquininhas Cartão", value: fmt(totalCardPos), icon: DollarSign, color: "#334155" },
              { label: "Taxas/Diárias (Motoboy)", value: fmt(totalPay), icon: DollarSign, color: "#C92E09" },
            ].map(card => (
              <div key={card.label} style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 14, padding: 14 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                  <div style={{ width: 28, height: 28, borderRadius: 8, background: card.color + "15", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <card.icon size={15} color={card.color} />
                  </div>
                  <span style={{ fontSize: "0.72rem", color: "#64748B", fontWeight: 600 }}>{card.label}</span>
                </div>
                <div style={{ fontWeight: 900, fontSize: "1.15rem", color: card.color }}>{card.value}</div>
              </div>
            ))}
          </div>

          {/* Cards por motoboy */}
          {report.length === 0 ? (
            <div style={{ textAlign: "center", padding: "2rem", color: "#94A3B8", background: "#fff", borderRadius: 16, border: "1px solid #E2E8F0" }}>
              <Bike size={40} style={{ margin: "0 auto 10px" }} color="#CBD5E1" />
              <p>Nenhuma entrega encontrada no período.</p>
            </div>
          ) : cards.map(({ r, st, visiveis, filtrado, ocultos, semDistancia, cancelados, porCanal, botoes }) => {
            const payAmount = getMotoboyPay(st);
            return (
              <div key={r.motoboy.id} style={{ background: "#fff", border: "1.5px solid #E2E8F0", borderRadius: 16, padding: 20, marginBottom: 14 }}>
                {/* Header motoboy */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 44, height: 44, background: "#FEF3E2", borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <Bike size={22} color="#C92E09" />
                    </div>
                    <div>
                      <div style={{ fontWeight: 800, fontSize: "1rem" }}>{r.motoboy.name}</div>
                      <div style={{ fontSize: "0.75rem", color: "#64748B" }}>{PAYMENT_TYPE_LABEL[r.motoboy.paymentType] || r.motoboy.paymentType}</div>
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: "0.7rem", color: "#94A3B8", textTransform: "uppercase", fontWeight: 700 }}>
                      Total a pagar ao motoboy {filtrado ? "(filtrado)" : calcMode === "fee_only" ? "(Só Taxa)" : ""}
                    </div>
                    <div style={{ fontWeight: 900, fontSize: "1.4rem", color: "#C92E09" }}>{fmt(payAmount)}</div>
                  </div>
                </div>

                {/* ── FILTRO DE INTEGRAÇÕES DO CARTÃO ─────────────────────────
                    Mesmo jeito do filtro do painel de pedidos: começa tudo
                    ligado e cada clique liga/desliga um canal. Os quadrados,
                    a lista de entregas e o total abaixo passam a contar só o
                    que está ligado (pedido do Douglas, 02/10/2026). */}
                <div style={{ marginBottom: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: "0.62rem", fontWeight: 800, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.04em", paddingLeft: 2 }}>
                      Filtro de integrações
                    </span>
                    {ocultos.length > 0 && (
                      <button type="button" onClick={() => setCanaisOcultos((atual) => ({ ...atual, [r.motoboy.id]: [] }))}
                        style={{ background: "none", border: "none", padding: 0, color: "#C92E09", fontWeight: 700, fontSize: "0.72rem", cursor: "pointer", fontFamily: "inherit" }}>
                        Mostrar todas
                      </button>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 5, background: "#F8FAFC", padding: "4px 6px", borderRadius: 10, border: "1px solid #E2E8F0" }}>
                    {botoes.map((c) => {
                      const ligado = !ocultos.includes(c.chave);
                      const qtd = porCanal.get(c.chave) || 0;
                      return (
                        <button
                          key={c.chave}
                          type="button"
                          onClick={() => alternarCanal(r.motoboy.id, c.chave)}
                          aria-pressed={ligado}
                          title={`${c.nome}: ${ligado ? "aparecendo (clique para esconder)" : "escondido (clique para mostrar)"} — ${qtd} entrega(s)`}
                          style={{
                            height: 28, flexShrink: 0, padding: "2px 8px", borderRadius: 7,
                            border: `1.5px solid ${ligado ? "#1C1917" : "#E7DDD3"}`,
                            background: ligado ? "#fff" : "#FAF6F2",
                            color: ligado ? "#1C1917" : "#A8A29E",
                            filter: ligado ? "none" : "grayscale(100%) opacity(0.45)",
                            cursor: "pointer", display: "flex", alignItems: "center", gap: 5,
                            fontSize: "0.74rem", fontWeight: 800, fontFamily: "inherit",
                            transition: "all 0.15s ease",
                          }}
                        >
                          {c.logo
                            ? <img src={c.logo} alt={c.nome} style={{ height: 16, maxWidth: 52, objectFit: "contain", display: "block" }} />
                            : <><span style={{ fontSize: "0.85rem" }}>{c.emoji}</span><span>{c.nome}</span></>}
                          <span style={{ background: ligado ? "#F1F5F9" : "transparent", color: "#475569", borderRadius: 10, padding: "0 6px", fontSize: "0.68rem", fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
                            {qtd}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  {filtrado && (
                    <div style={{ marginTop: 5, fontSize: "0.72rem", color: "#92400E", fontWeight: 600, paddingLeft: 2 }}>
                      {visiveis.length === 0
                        ? "Nenhuma integração ligada — clique num botão para ver as entregas dela."
                        : `Mostrando ${visiveis.length} de ${r.orders.length} entregas. A diária fica fora: ela não se divide por integração.`}
                    </div>
                  )}
                </div>

                {/* Stats */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, background: "#F8FAFC", borderRadius: 10, padding: 12, marginBottom: 14 }}>
                  {[
                    { label: "Entregas", value: st.totalDeliveries },
                    { label: "Dias trab.", value: st.uniqueDays },
                    { label: "KM total", value: st.totalDistance + " km" },
                    { label: "Taxa/KM", value: r.motoboy.perKmRate ? fmt(r.motoboy.perKmRate) + "/km" : "-" },
                  ].map(s => (
                    <div key={s.label} style={{ textAlign: "center" }}>
                      <div style={{ fontWeight: 800, fontSize: "1rem", color: "#1E293B" }}>{s.value}</div>
                      <div style={{ fontSize: "0.7rem", color: "#94A3B8", fontWeight: 600, textTransform: "uppercase" }}>{s.label}</div>
                    </div>
                  ))}
                </div>

                {/* Conferência Unificada do Motoboy */}
                <div style={{ background: "#F8FAFC", border: "1.5px solid #E2E8F0", borderRadius: 14, padding: 16, marginBottom: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
                    <span style={{ fontSize: "0.85rem", fontWeight: 900, color: "#0F172A", textTransform: "uppercase", display: "flex", alignItems: "center", gap: 6 }}>
                      📋 CONFERÊNCIA DO MOTOBOY ({st.totalDeliveries} entregas)
                    </span>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <span style={{ fontSize: "0.78rem", fontWeight: 800, color: "#0F766E", background: "#F0FDFA", padding: "4px 10px", borderRadius: 20 }}>
                        💵 Entregar Dinheiro: {fmt(st.cashCollectedSum || 0)}
                      </span>
                      <span style={{ fontSize: "0.78rem", fontWeight: 800, color: "#334155", background: "#FAF6F2", padding: "4px 10px", borderRadius: 20 }}>
                        💳 Total Maquininha: {fmt(st.cardPosTotal || 0)}
                      </span>
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10 }}>
                    {/* Quadrado Dinheiro */}
                    <div style={{ background: (st.cashCollectedSum || 0) > 0 ? "#F0FDFA" : "#fff", border: `1.5px solid ${(st.cashCollectedSum || 0) > 0 ? "#99F6E4" : "#CBD5E1"}`, borderRadius: 10, padding: "10px 12px" }}>
                      <div style={{ fontSize: "0.72rem", color: (st.cashCollectedSum || 0) > 0 ? "#0F766E" : "#64748B", fontWeight: 700 }}>💵 Dinheiro (em mãos)</div>
                      <div style={{ fontWeight: 900, fontSize: "1.05rem", color: (st.cashCollectedSum || 0) > 0 ? "#0F766E" : "#0F172A", marginTop: 2 }}>{fmt(st.cashCollectedSum || 0)}</div>
                      <div style={{ fontSize: "0.68rem", color: (st.cashCollectedSum || 0) > 0 ? "#0F766E" : "#94A3B8", marginTop: 2 }}>
                        {st.cashOrdersCount || 0} pedido(s)
                      </div>
                      {(st.changeGivenSum || 0) > 0 && (
                        <div style={{ fontSize: "0.65rem", color: "#0F766E", marginTop: 3, fontWeight: 600, borderTop: "1px dashed #99F6E4", paddingTop: 3 }}>
                          {fmt(st.cashOrdersValueSum || 0)} ped. + {fmt(st.changeGivenSum || 0)} troco
                        </div>
                      )}
                    </div>

                    {/* Quadrado Débito */}
                    <div style={{ background: "#fff", border: "1px solid #CBD5E1", borderRadius: 10, padding: "10px 12px" }}>
                      <div style={{ fontSize: "0.72rem", color: "#64748B", fontWeight: 700 }}>💳 Débito (Máquina)</div>
                      <div style={{ fontWeight: 900, fontSize: "1.05rem", color: "#0F172A", marginTop: 2 }}>{fmt(st.debitTotal || 0)}</div>
                      <div style={{ fontSize: "0.68rem", color: "#94A3B8", marginTop: 2 }}>{st.debitCount || 0} pedido(s)</div>
                    </div>

                    {/* Quadrado Crédito */}
                    <div style={{ background: "#fff", border: "1px solid #CBD5E1", borderRadius: 10, padding: "10px 12px" }}>
                      <div style={{ fontSize: "0.72rem", color: "#64748B", fontWeight: 700 }}>💳 Crédito (Máquina)</div>
                      <div style={{ fontWeight: 900, fontSize: "1.05rem", color: "#0F172A", marginTop: 2 }}>{fmt(st.creditTotal || 0)}</div>
                      <div style={{ fontSize: "0.68rem", color: "#94A3B8", marginTop: 2 }}>{st.creditCount || 0} pedido(s)</div>
                    </div>

                    {/* Quadrado Voucher */}
                    <div style={{ background: "#fff", border: "1px solid #CBD5E1", borderRadius: 10, padding: "10px 12px" }}>
                      <div style={{ fontSize: "0.72rem", color: "#64748B", fontWeight: 700 }}>🎟️ Voucher (Vale)</div>
                      <div style={{ fontWeight: 900, fontSize: "1.05rem", color: "#0F172A", marginTop: 2 }}>{fmt(st.voucherTotal || 0)}</div>
                      <div style={{ fontSize: "0.68rem", color: "#94A3B8", marginTop: 2 }}>{st.voucherCount || 0} pedido(s)</div>
                    </div>

                    {/* Quadrado Pago Online */}
                    {st.onlineTotal > 0 && (
                      <div style={{ background: "#F0FDFA", border: "1px solid #99F6E4", borderRadius: 10, padding: "10px 12px" }}>
                        <div style={{ fontSize: "0.72rem", color: "#0F766E", fontWeight: 700 }}>⚡ Pago Online</div>
                        <div style={{ fontWeight: 900, fontSize: "1.05rem", color: "#0F766E", marginTop: 2 }}>{fmt(st.onlineTotal)}</div>
                        <div style={{ fontSize: "0.68rem", color: "#0F766E", marginTop: 2 }}>{st.onlineCount} pedido(s) site/app</div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Breakdown pagamento */}
                <div style={{ borderTop: "1px solid #F1F5F9", paddingTop: 10 }}>
                  <p style={{ fontSize: "0.72rem", fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", marginBottom: 6 }}>Composição do Pagamento</p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {r.stats.dailyTotal > 0 && (() => {
                      // Com filtro de integração a diária sai da conta: ela é
                      // do dia trabalhado, não do iFood nem do 99. Fica
                      // riscada, com o valor cheio, para ninguém achar que sumiu.
                      const fora = calcMode === "fee_only" || filtrado;
                      return (
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem", opacity: fora ? 0.45 : 1 }}>
                          <span style={{ textDecoration: fora ? "line-through" : "none" }}>
                            Diária: {fmt(r.motoboy.dailyRate || 0)} × {r.stats.uniqueDays} dias {filtrado ? "(não se divide por integração)" : calcMode === "fee_only" ? "(Desconsiderada)" : ""}
                          </span>
                          <span style={{ fontWeight: 700, textDecoration: fora ? "line-through" : "none" }}>{fmt(r.stats.dailyTotal)}</span>
                        </div>
                      );
                    })()}
                    {/* ── A LINHA DAS TAXAS ─────────────────────────────────
                        Ela lia `perDeliveryTotal` e `perKmTotal`, que a API
                        nunca devolveu: o campo chama `feeTotal`. Resultado —
                        R$ 18,00 apareciam dentro do TOTAL sem nenhuma linha
                        explicando de onde vinham, e a composição não fechava
                        com o total logo abaixo dela. */}
                    {st.feeTotal > 0 && (
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem", gap: 10 }}>
                        {/* O rótulo tem de dizer o acerto DELE. Escrito fixo
                            como "Por entrega", ele anunciava R$ 2,00/entrega
                            num entregador pago por faixa de km — que é como o
                            Lucas descobriu, em 15/09/2026, que o fechamento
                            não seguia o que ele tinha cadastrado. */}
                        <span>
                          {r.motoboy.paymentType === "FAIXA_KM"
                            ? `Por faixa de distância (${st.totalDeliveries} entregas, ${st.totalDistance.toFixed(1)} km no total)`
                            : r.motoboy.paymentType === "PER_KM"
                            ? `Por km: ${fmt(r.motoboy.perKmRate || 0)} × ${st.totalDistance.toFixed(1)} km`
                            : r.motoboy.usandoTaxaDoCliente
                              ? `Taxa de entrega dos pedidos (${st.totalDeliveries})`
                              : `Por entrega: ${fmt(r.motoboy.perDeliveryRate || 0)} × ${st.totalDeliveries} entregas`}
                        </span>
                        <span style={{ fontWeight: 700 }}>{fmt(st.feeTotal)}</span>
                      </div>
                    )}

                    {/* Sem valor por entrega cadastrado, a conta cai na taxa
                        que o CLIENTE pagou ao marketplace — que no 99Food já
                        vem descontada pelo cupom deles. Precisa estar escrito,
                        senão o lojista confere com um número que não é dele. */}
                    {r.motoboy.usandoTaxaDoCliente && st.feeTotal > 0 && (
                      <div style={{ background: "#FFF7E6", border: "1px solid #FDE68A", borderRadius: 8, padding: "7px 10px", fontSize: "0.74rem", color: "#92400E", lineHeight: 1.45 }}>
                        ⚠️ Este entregador não tem <b>valor por entrega</b> cadastrado, então está sendo usada a
                        taxa que o cliente pagou. Em pedido de iFood e 99Food essa taxa é do marketplace, não sua —
                        cadastre o valor por entrega em Motoboys para o acerto ficar certo.
                      </div>
                    )}
                    {/* Entrega que a escada de km não conseguiu precificar
                        porque o pedido chegou sem distância. Ela entra como
                        R$ 0,00 — inventar a taxa do marketplace aqui foi o
                        erro original. O lojista precisa VER quantas são. */}
                    {semDistancia > 0 && (
                      <div style={{ background: "#FFF7E6", border: "1px solid #FDE68A", borderRadius: 8, padding: "7px 10px", fontSize: "0.74rem", color: "#92400E", lineHeight: 1.45 }}>
                        ⚠️ {semDistancia} {semDistancia === 1 ? "entrega está" : "entregas estão"} sem a distância medida,
                        então a faixa de km não pôde ser aplicada e {semDistancia === 1 ? "ela entrou" : "elas entraram"} como R$ 0,00.
                        O endereço é medido automaticamente em alguns minutos — se continuar assim, confira o endereço desses pedidos.
                      </div>
                    )}
                    {/* Cancelado com o motoboy CONTA na corrida e não no
                        dinheiro (lib/relatorio-do-entregador.ts). A linha diz
                        quais foram, para ninguém estranhar o número. */}
                    {(cancelados?.qtd ?? 0) > 0 && (
                      <div style={{ fontSize: "0.74rem", color: "#64748B", lineHeight: 1.45 }}>
                        {cancelados.qtd} pedido{cancelados.qtd > 1 ? "s" : ""} cancelado{cancelados.qtd > 1 ? "s" : ""} com este motoboy
                        ({cancelados.lista.map((c: any) => `#${c.dailyOrderNumber ?? c.ifoodReference ?? c.openDeliveryReference ?? "—"}`).join(", ")}) — a corrida conta, sem dinheiro a prestar contas.
                      </div>
                    )}
                    <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 900, fontSize: "0.95rem", borderTop: "2px solid #1E293B", paddingTop: 6, marginTop: 4 }}>
                      <span>TOTAL {filtrado ? "(SÓ TAXAS DAS INTEGRAÇÕES MARCADAS)" : calcMode === "fee_only" ? "(SÓ TAXAS)" : "(DIÁRIA + TAXAS)"}</span>
                      <span style={{ color: "#C92E09" }}>{fmt(payAmount)}</span>
                    </div>
                  </div>
                </div>

                {/* Entregas detalhadas */}
                {visiveis.length > 0 && (
                  <details style={{ marginTop: 12 }}>
                    <summary style={{ fontSize: "0.8rem", fontWeight: 700, color: "#64748B", cursor: "pointer" }}>
                      📦 Ver {visiveis.length} entrega(s) detalhada(s)
                    </summary>
                    <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                      {visiveis.map((o: any) => {
                        const isCash = (o.paymentMethod || "").toUpperCase() === "CASH" || (o.paymentMethod || "").toUpperCase().includes("DINHEIR");
                        const dateStr = o.createdAt || o.date;
                        const numDisplay = o.dailyOrderNumber ? `#${o.dailyOrderNumber}` : o.ifoodReference ? `#${o.ifoodReference}` : o.openDeliveryReference ? `#${o.openDeliveryReference}` : "";
                        return (
                          <div key={o.id} style={{ display: "grid", gridTemplateColumns: "85px 1fr auto auto auto auto", gap: 8, padding: "8px 10px", background: "#F8FAFC", borderRadius: 8, fontSize: "0.78rem", alignItems: "center" }}>
                            <span style={{ color: "#64748B" }}>{dateStr ? new Date(dateStr).toLocaleDateString("pt-BR") : "-"}</span>
                            <span style={{ fontWeight: 600 }}>
                              {numDisplay ? <strong style={{ color: "#0F172A", marginRight: 4 }}>{numDisplay}</strong> : null}
                              {o.customerName} {o.customerAddress ? `— ${o.customerAddress.substring(0, 20)}...` : ""}
                            </span>
                            <span>
                              {o.cancelado ? (
                                <span title="A corrida conta para o motoboy; o pedido não foi pago" style={{ background: "#FEE2E2", color: "#B91C1C", padding: "2px 6px", borderRadius: 4, fontWeight: 800, fontSize: "0.7rem" }}>
                                  ✕ CANCELADO — sem dinheiro
                                </span>
                              ) : isCash ? (
                                (o.changeGiven || 0) > 0 ? (
                                  <span style={{ background: "#F0FDFA", color: "#0F766E", border: "1px solid #99F6E4", padding: "2px 8px", borderRadius: 6, fontWeight: 800, fontSize: "0.72rem", display: "inline-flex", alignItems: "center", gap: 4 }}>
                                    💵 Entregar: {fmt(o.cashToDeliver || o.totalAmount)}
                                    <span style={{ fontWeight: 600, color: "#0F766E", fontSize: "0.68rem" }}>(Ped: {fmt(o.totalAmount)} + Troco: {fmt(o.changeGiven)})</span>
                                  </span>
                                ) : (
                                  <span style={{ background: "#FFF7E6", color: "#B45309", padding: "2px 6px", borderRadius: 4, fontWeight: 700, fontSize: "0.7rem" }}>
                                    💵 Dinheiro ({fmt(o.totalAmount)})
                                  </span>
                                )
                              ) : (
                                <span style={{ background: "#E2E8F0", color: "#475569", padding: "2px 6px", borderRadius: 4, fontWeight: 700, fontSize: "0.7rem" }}>
                                  💳 {o.paymentMethod}
                                </span>
                              )}
                            </span>
                            {o.deliveryDistance ? <span style={{ color: "#1C1917", fontWeight: 600 }}>{o.deliveryDistance} km</span> : <span />}
                            {/* O que o MOTOBOY ganha nesta entrega, pela mesma
                                conta que soma o total — não a taxa que o
                                cliente pagou ao marketplace. */}
                            <span
                              title={r.motoboy.usandoTaxaDoCliente ? "Taxa que o cliente pagou — sem valor por entrega cadastrado" : "O que este entregador recebe por esta entrega"}
                              style={{ fontWeight: 700, color: r.motoboy.usandoTaxaDoCliente ? "#B45309" : "#0F766E" }}
                            >
                              {r.motoboy.usandoTaxaDoCliente ? "Taxa do cliente: " : "Motoboy: "}
                              {fmt(o.ganhoDoMotoboy ?? o.deliveryFee ?? 0)}
                            </span>
                            <button
                              onClick={() => setSelectedOrderModal(o)}
                              style={{ padding: "4px 8px", background: "#FAF6F2", color: "#1C1917", border: "1px solid #E7DDD3", borderRadius: 6, fontWeight: 700, fontSize: "0.72rem", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}
                            >
                              👁️ Ver Pedido
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </details>
                )}
              </div>
            );
          })}
        </>
      )}

      {/* ── MODAL DETALHES DO PEDIDO ── */}
      {selectedOrderModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={() => setSelectedOrderModal(null)}>
          <div style={{ background: "#fff", borderRadius: 20, padding: "1.5rem", width: "100%", maxWidth: 500, boxShadow: "0 20px 60px rgba(0,0,0,0.3)", position: "relative" }} onClick={e => e.stopPropagation()}>
            <button onClick={() => setSelectedOrderModal(null)} style={{ position: "absolute", top: 14, right: 14, background: "#F1F5F9", border: "none", borderRadius: "50%", width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}><X size={16} color="#64748B" /></button>

            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
              <div style={{ background: "#FEF2F2", color: "#C92E09", width: 44, height: 44, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: "1.2rem" }}>
                📦
              </div>
              <div>
                <h3 style={{ margin: 0, fontWeight: 900, fontSize: "1.1rem", color: "#0F172A" }}>
                  Pedido {selectedOrderModal.dailyOrderNumber ? `#${selectedOrderModal.dailyOrderNumber}` : selectedOrderModal.ifoodReference ? `#${selectedOrderModal.ifoodReference}` : `#${selectedOrderModal.id.slice(-6).toUpperCase()}`}
                </h3>
                <span style={{ fontSize: "0.78rem", color: "#64748B" }}>
                  {(() => {
                    const d = selectedOrderModal.createdAt || selectedOrderModal.date;
                    if (!d) return "";
                    const dateObj = new Date(d);
                    return `${dateObj.toLocaleDateString("pt-BR")} às ${dateObj.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
                  })()}
                </span>
              </div>
            </div>

            {/* Informações do Cliente */}
            <div style={{ background: "#F8FAFC", borderRadius: 12, padding: "12px 14px", marginBottom: 12, border: "1px solid #E2E8F0" }}>
              <div style={{ fontSize: "0.72rem", fontWeight: 800, color: "#64748B", textTransform: "uppercase", marginBottom: 4 }}>👤 Cliente & Entrega</div>
              <div style={{ fontWeight: 800, fontSize: "0.95rem", color: "#0F172A" }}>{selectedOrderModal.customerName}</div>
              {selectedOrderModal.customerPhone && (
                <div style={{ fontSize: "0.82rem", color: "#1C1917", fontWeight: 600, marginTop: 2 }}>📞 {selectedOrderModal.customerPhone}</div>
              )}
              {selectedOrderModal.customerAddress && (
                <div style={{ fontSize: "0.82rem", color: "#475569", marginTop: 4, lineHeight: 1.4 }}>
                  📍 {selectedOrderModal.customerAddress}
                </div>
              )}
            </div>

            {/* Forma de pagamento */}
            <div style={{ background: "#F1F5F9", borderRadius: 10, padding: "10px 12px", marginBottom: 12 }}>
              <span style={{ fontSize: "0.7rem", color: "#64748B", fontWeight: 700 }}>FORMA DE PGTO</span>
              <div style={{ fontWeight: 800, fontSize: "0.88rem", color: "#0F172A", marginTop: 2 }}>{selectedOrderModal.paymentMethod}</div>
            </div>

            {/* Destaque de Troco / Prestação de Contas em Dinheiro */}
            {(selectedOrderModal.changeGiven || 0) > 0 && (
              <div style={{ background: "#F0FDFA", border: "1.5px solid #99F6E4", borderRadius: 12, padding: "12px 14px", marginBottom: 12 }}>
                <div style={{ fontSize: "0.74rem", fontWeight: 800, color: "#0F766E", textTransform: "uppercase", marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
                  💵 Prestação de Contas (Dinheiro com Troco)
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: "0.82rem", color: "#0F766E", marginBottom: 6 }}>
                  <div>Valor do Pedido: <strong>{fmt(selectedOrderModal.totalAmount)}</strong></div>
                  <div>Troco levado da loja: <strong>{fmt(selectedOrderModal.changeGiven)}</strong></div>
                </div>
                <div style={{ borderTop: "1px dashed #99F6E4", paddingTop: 6, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontWeight: 800, fontSize: "0.85rem", color: "#0F766E" }}>Dinheiro a Devolver na Loja:</span>
                  <span style={{ fontWeight: 900, fontSize: "1.15rem", color: "#0F766E" }}>{fmt(selectedOrderModal.cashToDeliver || selectedOrderModal.changeFor || selectedOrderModal.totalAmount)}</span>
                </div>
              </div>
            )}

            {/* Itens do Pedido */}
            {selectedOrderModal.items && Array.isArray(selectedOrderModal.items) && selectedOrderModal.items.length > 0 && (
              <div style={{ background: "#F8FAFC", borderRadius: 12, padding: "12px 14px", marginBottom: 12, border: "1px solid #E2E8F0" }}>
                <div style={{ fontSize: "0.72rem", fontWeight: 800, color: "#64748B", textTransform: "uppercase", marginBottom: 6 }}>🍔 Itens do Pedido</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {selectedOrderModal.items.map((it: any, idx: number) => (
                    <div key={idx} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.82rem", color: "#334155" }}>
                      <span>{it.quantity}x {it.name || it.productName}</span>
                      <strong>{fmt((it.price || it.unitPrice || 0) * (it.quantity || 1))}</strong>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── A CONTA DO PEDIDO ─────────────────────────────────────────
                Antes esta janela mostrava so "VALOR TOTAL" e a lista de itens —
                e no #266009 do Lucas o item era R$ 59,99 com total R$ 48,52,
                sem uma linha dizendo para onde foram os R$ 11,47. Quem confere
                a entrega com o motoboy precisa ver o desconto e a taxa.

                A conta vem de lib/conta-do-pedido.ts, a mesma regra do papel:
                o desconto exibido e o que faz a soma bater com o que o cliente
                pagou. */}
            {(() => {
              const conta = contaDoPedido(selectedOrderModal);
              const linha = (rotulo: string, valor: number, forte = false) => (
                <div key={rotulo} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: forte ? "0.95rem" : "0.84rem", fontWeight: forte ? 900 : 600, color: forte ? "#0F172A" : "#475569", padding: forte ? "6px 0 0" : "2px 0", borderTop: forte ? "2px solid #CBD5E1" : "none", marginTop: forte ? 4 : 0 }}>
                  <span>{rotulo}</span>
                  <span style={{ fontVariantNumeric: "tabular-nums", color: forte ? "#0F766E" : valor < 0 ? "#B71C1C" : "#0F172A" }}>{emReaisConta(valor)}</span>
                </div>
              );
              return (
                <div style={{ background: "#FFFDF8", border: "1.5px solid #E2E8F0", borderRadius: 12, padding: "12px 14px", marginBottom: 12 }}>
                  <div style={{ fontSize: "0.72rem", fontWeight: 800, color: "#64748B", textTransform: "uppercase", marginBottom: 8 }}>🧾 Conta do pedido</div>
                  {linha("Subtotal dos itens", conta.subtotal)}
                  {conta.ajustes.map((a) => linha(a.rotulo, a.valor))}
                  {linha("Taxa de entrega (cliente)", conta.taxaEntrega)}
                  {linha("Total do pedido", conta.total, true)}
                  {selectedOrderModal.ganhoDoMotoboy != null && (
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: "0.84rem", fontWeight: 800, color: "#9A3412", background: "#FFF4EF", border: "1px solid #FFD3C2", borderRadius: 8, padding: "7px 10px", marginTop: 10 }}>
                      <span>🛵 O entregador recebe por esta entrega</span>
                      <span style={{ fontVariantNumeric: "tabular-nums" }}>{fmt(selectedOrderModal.ganhoDoMotoboy)}</span>
                    </div>
                  )}
                  {conta.taxaEntrega > 0 && (selectedOrderModal.source === "99FOOD" || selectedOrderModal.source === "IFOOD") && (
                    <p style={{ fontSize: "0.72rem", color: "#94A3B8", margin: "8px 0 0", lineHeight: 1.45 }}>
                      A taxa de entrega acima e a que o CLIENTE pagou ao {selectedOrderModal.source === "99FOOD" ? "99Food" : "iFood"} —
                      ja descontada de cupom deles quando houve. Ela nao e o que voce paga ao entregador.
                    </p>
                  )}
                </div>
              );
            })()}

            {selectedOrderModal.notes && (
              <div style={{ background: "#FFF7E6", border: "1px solid #FDE68A", borderRadius: 10, padding: "8px 12px", marginBottom: 12, fontSize: "0.8rem", color: "#92400E" }}>
                📝 <strong>Obs:</strong> {selectedOrderModal.notes}
              </div>
            )}

            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <a
                href="/store/pedidos-clientes"
                style={{ flex: 1, padding: "10px", background: "#1C1917", color: "#fff", borderRadius: 10, fontWeight: 700, fontSize: "0.85rem", textDecoration: "none", textAlign: "center" }}
              >
                📋 Abrir no Gerenciador ↗
              </a>
              <button
                onClick={() => setSelectedOrderModal(null)}
                style={{ padding: "10px 18px", background: "#F1F5F9", color: "#475569", border: "none", borderRadius: 10, fontWeight: 700, fontSize: "0.85rem", cursor: "pointer", fontFamily: "inherit" }}
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
