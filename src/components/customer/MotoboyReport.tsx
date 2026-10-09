"use client";
import { useState, useCallback, useRef } from "react";
import { Calendar, Download, Filter, Bike, TrendingUp, DollarSign, MapPin, Loader2, X } from "lucide-react";
import type { ChaveDeCanal } from "@/lib/canal-do-pedido";
import { resumoDasEntregas } from "@/lib/resumo-do-entregador";
import type { OperadorDaEdicao } from "@/lib/edicao-de-pedido";
import { podeTrocarPagamento } from "@/lib/pagamento-na-entrega";
import { toLocalISODate } from "@/lib/timezone";
import TrocaDePagamentoPainel from "./TrocaDePagamentoPainel";

type Motoboy = { id: string; name: string; paymentType: string; dailyRate?: number; perDeliveryRate?: number; perKmRate?: number; active: boolean };

const fmt = (v: number) => `R$ ${(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

export default function MotoboyReport({ motoboys, storeTimezone, operador }: { motoboys: Motoboy[], storeTimezone?: string, operador: OperadorDaEdicao }) {
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
  // Motoboys com a lista de entregas aberta. Era um <details> pequeno no pé do
  // cartão que ninguém achava sozinho (Douglas, 09/10/2026) — virou um botão
  // largo, e cada cartão abre o seu.
  const [entregasAbertas, setEntregasAbertas] = useState<Record<string, boolean>>({});
  // Integrações DESLIGADAS no cartão de cada motoboy (id → canais). Começa
  // tudo ligado, como o filtro do painel de pedidos.
  const [canaisOcultos, setCanaisOcultos] = useState<Record<string, ChaveDeCanal[]>>({});
  const alternarCanal = (motoboyId: string, canal: ChaveDeCanal) =>
    setCanaisOcultos((atual) => {
      const ocultos = atual[motoboyId] || [];
      return { ...atual, [motoboyId]: ocultos.includes(canal) ? ocultos.filter((c) => c !== canal) : [...ocultos, canal] };
    });

  // A entrega com a troca de pagamento aberta embaixo dela, e a que acabou de
  // ser salva (fica verde um instante, para o olho achar o que mudou).
  const [trocandoPagamento, setTrocandoPagamento] = useState<string | null>(null);
  const [acabouDeTrocar, setAcabouDeTrocar] = useState<string | null>(null);
  // A busca que está NA TELA. Depois de trocar um pagamento, é ela que se
  // repete — não a dos filtros, que a pessoa pode ter mexido sem gerar.
  const buscaNaTela = useRef<string | null>(null);

  const buscar = async (params: string, silencioso: boolean) => {
    if (!silencioso) setLoading(true);
    try {
      const res = await fetch(`/api/motoboy-report?${params}`);
      if (res.ok) {
        const data = await res.json();
        setReport(data.report);
        setPeriodInfo(data.period);
        setLoaded(true);
        buscaNaTela.current = params;
      }
    } finally {
      if (!silencioso) setLoading(false);
    }
  };

  /**
   * Trocou a forma de pagamento: a conferência é somada no servidor, então o
   * relatório é relido — em silêncio. Com o "Carregando…" a lista de entregas
   * desmontava, e quem acerta 15 entregas com o motoboy teria de reabri-la a
   * cada troca.
   */
  const aposTrocarPagamento = async (pedidoId: string) => {
    setTrocandoPagamento(null);
    if (buscaNaTela.current) await buscar(buscaNaTela.current, true);
    setAcabouDeTrocar(pedidoId);
    setTimeout(() => setAcabouDeTrocar((atual) => (atual === pedidoId ? null : atual)), 2500);
  };

  /**
   * "Ver pedido" abre O PEDIDO, na tela de Pedidos (aba nova): a mesma comanda
   * com Editar, Trocar pagamento, Nota e o histórico do que foi mexido — não
   * uma cópia só de leitura (Douglas, 09/10/2026). A data vai junto porque o
   * quadro de Pedidos mostra um dia; pedido de outro dia não estaria nele.
   */
  const linkDoPedido = (o: any) => {
    const dia = toLocalISODate(new Date(o.createdAt || o.date), tzLoja);
    return `/store/pedidos-clientes?pedido=${encodeURIComponent(o.id)}&dia=${dia}`;
  };

  const load = useCallback(async () => {
    // As caixas de data são a fonte da verdade: os atalhos preenchem elas, então
    // consultar sempre as caixas garante que o que foi buscado é o que está
    // escrito na tela — sem chance de o botão dizer uma coisa e a busca outra.
    const range = {
      from: customFrom + (horaInicio ? `T${horaInicio}` : ""),
      to: customTo + (horaFim ? `T${horaFim}` : ""),
    };
    if (!customFrom || !customTo) return;

    const params = new URLSearchParams({ from: range.from, to: range.to, calcMode });
    if (selectedMotoboy !== "all") params.set("motoboyId", selectedMotoboy);

    setTrocandoPagamento(null);
    await buscar(params.toString(), false);
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
  const totalCanceladas = cards.reduce((s, c) => s + (c.st.canceladasCount || 0), 0);
  const totalValorDosPedidos = cards.reduce((s, c) => s + (c.st.valorDosPedidos || 0), 0);
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
              { label: "Total Entregas", value: totalDeliveries.toString(), icon: Bike, color: "#1C1917", nota: totalCanceladas > 0 ? `${totalDeliveries - totalCanceladas} entregues · ${totalCanceladas} cancelada${totalCanceladas > 1 ? "s" : ""}` : undefined },
              { label: "Valor dos Pedidos", value: fmt(totalValorDosPedidos), icon: TrendingUp, color: "#1D4ED8", nota: "entregues, todas as formas" },
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
                {card.nota && <div style={{ fontSize: "0.68rem", color: "#64748B", fontWeight: 600, marginTop: 2 }}>{card.nota}</div>}
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

                {/* ── ENTREGAS E VALOR DOS PEDIDOS ───────────────────────────
                    O acerto que a loja faz com o motoboy começa aqui: quantas
                    ele levou, quantas delas foram canceladas (a corrida conta,
                    o dinheiro não) e quanto valem os pedidos que ele entregou
                    — "Jobson 30 notas, R$ 1.040 do lado" (Delícia de Casa,
                    09/10/2026). */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8, marginBottom: 8 }}>
                  {[
                    { label: "Entregas", value: String(st.totalDeliveries), cor: "#1E293B", fundo: "#F8FAFC", borda: "#E2E8F0" },
                    { label: "Entregues", value: String(st.entreguesCount ?? st.totalDeliveries), cor: "#0F766E", fundo: "#F0FDFA", borda: "#99F6E4" },
                    { label: "Canceladas", value: String(st.canceladasCount || 0), cor: (st.canceladasCount || 0) > 0 ? "#B91C1C" : "#94A3B8", fundo: (st.canceladasCount || 0) > 0 ? "#FEF2F2" : "#F8FAFC", borda: (st.canceladasCount || 0) > 0 ? "#FECACA" : "#E2E8F0",
                      nota: (st.canceladasCount || 0) > 0 ? `${fmt(st.canceladasValor || 0)} — fora do valor` : undefined },
                    { label: "Valor dos pedidos", value: fmt(st.valorDosPedidos || 0), cor: "#1D4ED8", fundo: "#EFF6FF", borda: "#BFDBFE", nota: "entregues, todas as formas" },
                  ].map(s => (
                    <div key={s.label} style={{ textAlign: "center", background: s.fundo, border: `1.5px solid ${s.borda}`, borderRadius: 10, padding: "10px 8px" }}>
                      <div style={{ fontWeight: 900, fontSize: "1.15rem", color: s.cor, fontVariantNumeric: "tabular-nums" }}>{s.value}</div>
                      <div style={{ fontSize: "0.68rem", color: "#64748B", fontWeight: 700, textTransform: "uppercase" }}>{s.label}</div>
                      {s.nota && <div style={{ fontSize: "0.64rem", color: "#94A3B8", fontWeight: 600, marginTop: 2 }}>{s.nota}</div>}
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 16px", fontSize: "0.74rem", color: "#64748B", fontWeight: 600, padding: "0 4px", marginBottom: 14 }}>
                  <span>📅 {st.uniqueDays} dia{st.uniqueDays === 1 ? "" : "s"} trabalhado{st.uniqueDays === 1 ? "" : "s"}</span>
                  <span>📍 {Number(st.totalDistance || 0).toFixed(1).replace(".", ",")} km no total</span>
                  {r.motoboy.perKmRate ? <span>🛵 {fmt(r.motoboy.perKmRate)}/km</span> : null}
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

                {/* ── AS ENTREGAS DESTE MOTOBOY ─────────────────────────────
                    Era um "Ver N entrega(s) detalhada(s)" pequeno e cinza no
                    pé do cartão, e ninguém achava sem ser mostrado (Douglas,
                    09/10/2026). Agora é um botão da largura do cartão. */}
                {visiveis.length > 0 && (() => {
                  const aberto = !!entregasAbertas[r.motoboy.id];
                  return (
                  <div style={{ marginTop: 14 }}>
                    <button
                      type="button"
                      onClick={() => setEntregasAbertas((atual) => ({ ...atual, [r.motoboy.id]: !aberto }))}
                      aria-expanded={aberto}
                      style={{
                        width: "100%", padding: "12px 16px", borderRadius: 12, cursor: "pointer", fontFamily: "inherit",
                        border: `2px solid ${aberto ? "#1C1917" : "#C92E09"}`,
                        background: aberto ? "#fff" : "#FFF4EF", color: aberto ? "#1C1917" : "#C92E09",
                        fontWeight: 800, fontSize: "0.92rem", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                      }}
                    >
                      📦 {aberto ? "Esconder as entregas" : `Ver as ${visiveis.length} entrega${visiveis.length === 1 ? "" : "s"} de ${r.motoboy.name}`}
                      <span aria-hidden style={{ fontSize: "0.8rem" }}>{aberto ? "▲" : "▼"}</span>
                    </button>
                    {aberto && (
                    <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                      <div style={{ fontSize: "0.72rem", color: "#64748B", fontWeight: 600, padding: "0 2px 2px" }}>
                        ✏️ Clique na forma de pagamento para trocar. <b>Ver pedido</b> abre a comanda em outra aba, onde dá para editar — e tudo o que for mudado fica no histórico do pedido.
                      </div>
                      {visiveis.map((o: any) => {
                        const isCash = (o.paymentMethod || "").toUpperCase() === "CASH" || (o.paymentMethod || "").toUpperCase().includes("DINHEIR");
                        const dateStr = o.createdAt || o.date;
                        const numDisplay = o.dailyOrderNumber ? `#${o.dailyOrderNumber}` : o.ifoodReference ? `#${o.ifoodReference}` : o.openDeliveryReference ? `#${o.openDeliveryReference}` : "";
                        const trocando = trocandoPagamento === o.id;
                        const acabou = acabouDeTrocar === o.id;
                        // Pago no app não se troca: o cadeado diz isso antes
                        // do clique, e o motivo aparece ao passar o mouse.
                        const trocavel = podeTrocarPagamento(o);
                        return (
                          <div key={o.id}>
                          <div style={{ display: "grid", gridTemplateColumns: "85px 1fr auto auto auto auto", gap: 8, padding: "8px 10px", background: acabou ? "#F0FDFA" : "#F8FAFC", outline: acabou ? "1.5px solid #99F6E4" : trocando ? "1.5px solid #FDE68A" : "none", borderRadius: 8, fontSize: "0.78rem", alignItems: "center", transition: "background 0.3s" }}>
                            <span style={{ color: "#64748B" }}>{dateStr ? new Date(dateStr).toLocaleDateString("pt-BR") : "-"}</span>
                            <span style={{ fontWeight: 600 }}>
                              {numDisplay ? <strong style={{ color: "#0F172A", marginRight: 4 }}>{numDisplay}</strong> : null}
                              {o.customerName} {o.customerAddress ? `— ${o.customerAddress.substring(0, 20)}...` : ""}
                              {/* Mexido depois de lançado: o histórico está no Ver pedido. */}
                              {o.edicoes > 0 && (
                                <span title="Este pedido foi alterado depois de lançado — o histórico está em Ver pedido" style={{ marginLeft: 6, background: "#FEF3C7", color: "#92400E", border: "1px solid #FDE68A", padding: "1px 6px", borderRadius: 4, fontWeight: 800, fontSize: "0.66rem", whiteSpace: "nowrap" }}>
                                  ✏️ EDITADO
                                </span>
                              )}
                            </span>
                            <span>
                              {o.cancelado ? (
                                <span title="A corrida conta para o motoboy; o pedido não foi pago" style={{ background: "#FEE2E2", color: "#B91C1C", padding: "2px 6px", borderRadius: 4, fontWeight: 800, fontSize: "0.7rem" }}>
                                  ✕ CANCELADO — sem dinheiro
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setTrocandoPagamento(trocando ? null : o.id)}
                                  title={trocavel.pode ? "Trocar a forma de pagamento desta entrega" : trocavel.motivo}
                                  style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit", display: "inline-flex", alignItems: "center", gap: 4 }}
                                >
                                  {isCash ? (
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
                                  <span style={{ fontSize: "0.72rem", opacity: trocando ? 1 : 0.6 }} aria-hidden>{trocavel.pode ? "✏️" : "🔒"}</span>
                                </button>
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
                            <a
                              href={linkDoPedido(o)}
                              target="_blank"
                              rel="noopener"
                              title="Abre a comanda deste pedido na tela de Pedidos, em outra aba"
                              style={{ padding: "4px 8px", background: "#FAF6F2", color: "#1C1917", border: "1px solid #E7DDD3", borderRadius: 6, fontWeight: 700, fontSize: "0.72rem", textDecoration: "none", whiteSpace: "nowrap" }}
                            >
                              👁️ Ver Pedido ↗
                            </a>
                          </div>
                          {trocando && (
                            <div style={{ margin: "4px 0 6px 0" }}>
                              <TrocaDePagamentoPainel
                                pedido={o}
                                operador={operador}
                                abrirDireto
                                aoFechar={() => setTrocandoPagamento(null)}
                                aoSalvar={() => aposTrocarPagamento(o.id)}
                              />
                            </div>
                          )}
                          </div>
                        );
                      })}
                    </div>
                    )}
                  </div>
                  );
                })()}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
