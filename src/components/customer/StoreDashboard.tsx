"use client";
import { useState, useMemo, useEffect, useRef, useCallback, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { TrendingUp, DollarSign, ShoppingCart, Users, CreditCard, Banknote, Smartphone, ArrowUpRight, ArrowDownRight, Filter, Calendar, Store as StoreIcon, UtensilsCrossed, RefreshCw } from "lucide-react";
import OnboardingChecklist from "@/components/OnboardingChecklist";
import StoreDashboardMap from "@/components/customer/StoreDashboardMap";
import { nomeDoItem } from "@/lib/nome-do-item";
import { fmtDia, hojeNaLoja } from "@/lib/relatorios/base";
import { entraNaVenda } from "@/lib/relatorios/regua-da-venda";
import {
  MAIOR_PERIODO_EM_DIAS, clientesDoInicio, desdeDaAtualizacao, formaDoPedidoNaLista, formasDoInicio, horaNaLoja, juntarPedidos,
  naJanela, numeroDoPedidoNaLista, periodoDoFiltro, periodoDoInicio, precisaDesde, produtosDoInicio, tipoDoPedidoNaLista, variacao,
  vendasDoInicio, vendasPorHora,
  type ChaveDaFormaDoInicio, type FiltroDoInicio, type PedidoDaTelaInicio,
} from "@/lib/numeros-do-inicio";

/*
 * A TELA INÍCIO — os números do dia da loja, pela régua dos Relatórios.
 *
 * Toda conta mora em src/lib/numeros-do-inicio.ts (testada em
 * scripts/teste-inicio.ts): o dia de operação (vira às 5h, no fuso da LOJA),
 * o anterior cortado no mesmo horário, valor/vendas/ticket/tipos pelo
 * "Vendas por período", a forma de pagamento pelo "Formas de pagamento" e os
 * clientes pelo telefone de verdade. Esta tela só desenha — e se atualiza
 * sozinha enquanto o período chega até hoje (a cada 2 min, com a aba à vista).
 *
 * O cartão "LUCRO LÍQUIDO" saiu em 11/10/2026: ele era o faturamento. O custo
 * dos produtos estava cadastrado em quase nenhum item, a taxa da maquininha
 * era procurada pelo texto cru da forma de pagamento (0 de 2.075 pedidos da
 * Ragnar acharam), a comissão do app ficava de fora e a taxa de entrega
 * contava como lucro. Número que afirma lucro que não existe não fica na tela.
 */

type Order = PedidoDaTelaInicio;
type StoreOption = { id: string; name: string; slug: string };

const DIA_MS = 24 * 60 * 60 * 1000;
/** De quanto em quanto tempo o período que chega até hoje se relê sozinho. */
const ATUALIZA_A_CADA_MS = 2 * 60 * 1000;

const formatBRL = (val: number) => val.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtInt = (n: number) => n.toLocaleString("pt-BR");
const fmtPct1 = (n: number) => n.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const VISUAL_DA_FORMA: Record<ChaveDaFormaDoInicio, { icon: any; color: string }> = {
  DINHEIRO: { icon: Banknote, color: "#0D9488" },
  PIX: { icon: Smartphone, color: "#0F766E" },
  CREDITO: { icon: CreditCard, color: "#44403C" },
  DEBITO: { icon: CreditCard, color: "#2196F3" },
  VALE: { icon: DollarSign, color: "#E8590C" },
  ONLINE: { icon: Smartphone, color: "#EA1D2C" },
  MESA: { icon: UtensilsCrossed, color: "#B45309" },
  FIADO: { icon: DollarSign, color: "#7C3AED" },
  OUTROS: { icon: DollarSign, color: "#64748B" },
};

const STATUS_LABELS: Record<string, { label: string; emoji: string; color: string }> = {
  NOVO: { label: "Novos", emoji: "🔔", color: "#1C1917" },
  ACEITO: { label: "Aceitos", emoji: "✅", color: "#0F766E" },
  PREPARANDO: { label: "Preparando", emoji: "👨‍🍳", color: "#B45309" },
  PRONTO: { label: "Prontos", emoji: "🍽️", color: "#0E7490" },
  SAIU_ENTREGA: { label: "Em Entrega", emoji: "🛵", color: "#64748B" },
  ENTREGUE: { label: "Entregues", emoji: "📦", color: "#0F766E" },
  ENCERRADO: { label: "Encerrados", emoji: "📦", color: "#0F766E" },
  CANCELADO: { label: "Cancelados", emoji: "❌", color: "#C92E09" },
  AGUARDANDO_PAGAMENTO: { label: "Aguardando pagamento (não é venda)", emoji: "⏳", color: "#94A3B8" },
  CRIANDO_IA: { label: "Rascunho do robô (não é venda)", emoji: "🤖", color: "#94A3B8" },
};

const EMOJI_DO_TIPO: Record<string, string> = { DELIVERY: "🛵", RETIRADA: "🏪", BALCAO: "🧾", MESA: "🍽️", TOTEM: "🖥️" };

/** O nome do produto no ranking: o do pedido; o item de integração sem nome fica junto. */
function nomeDoProduto(item: any): string {
  const nome = nomeDoItem(item, "");
  if (!nome || nome === "Item de Integração" || nome === "Produto excluído" || nome === "—") return "Item (Integração)";
  return nome;
}

/** O que a tela tem carregado: os pedidos, desde quando e até que instante do servidor. */
type Lote = { id: string; pedidos: Order[]; desde: string; ate: string };

export default function StoreDashboard({ orders: ordersDaTela, carregadoDesde = "", carregadoEm = "", tz = "America/Sao_Paulo", completedOnboardingSteps = [], isAdmin = false, storeList = [], selectedStoreId = "todas", pontoDaLoja = null, cidadeDaLoja = "" }: {
  orders: Order[];
  /** Desde quando `orders` vem carregado (ISO). Período mais antigo é buscado
   *  em /api/store/inicio. Ver src/lib/pedidos-do-inicio.ts. */
  carregadoDesde?: string;
  /** O instante do servidor em que `orders` foi lido (ISO). */
  carregadoEm?: string;
  /** Fuso da loja: o dia de operação vira às 5h NELE, não no do computador. */
  tz?: string;
  completedOnboardingSteps?: string[]; isAdmin?: boolean; storeList?: StoreOption[]; selectedStoreId?: string;
  /** Onde fica a loja, para o mapa abrir no lugar certo e ter âncora para
   *  localizar os endereços das entregas. Ver lib/ponto-da-loja-servidor. */
  pontoDaLoja?: { lat: number; lng: number } | null;
  cidadeDaLoja?: string;
}) {
  const router = useRouter();
  const [dateFilter, setDateFilter] = useState<FiltroDoInicio>("hoje");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");

  // ── O QUE A TELA TEM CARREGADO ─────────────────────────────────────────
  // `base`: o que veio com a página (o mês e as duas últimas semanas), mais as
  // atualizações. `extra`: um período que começa antes disso (o "Mês"
  // comparado com os dias de antes do dia 1º, um "Período" antigo), buscado
  // uma vez por escolha. Uma página nova do servidor (outra loja no seletor
  // do ADMIN) recomeça as duas.
  const loteDaPagina = (): Lote => ({ id: `base:${carregadoEm}:${selectedStoreId}`, pedidos: ordersDaTela, desde: carregadoDesde || new Date(0).toISOString(), ate: carregadoEm || new Date(0).toISOString() });
  const [base, setBase] = useState<Lote>(loteDaPagina);
  const [extra, setExtra] = useState<Lote | null>(null);
  const [paginaVista, setPaginaVista] = useState(`${carregadoEm}:${selectedStoreId}`);
  if (paginaVista !== `${carregadoEm}:${selectedStoreId}`) {
    setPaginaVista(`${carregadoEm}:${selectedStoreId}`);
    setBase(loteDaPagina());
    setExtra(null);
  }

  // O relógio: decide o "hoje" (vira às 5h). Começa no instante do servidor
  // para a primeira pintura ser igual no servidor e no navegador.
  const [relogio, setRelogio] = useState(() => Date.parse(carregadoEm) || 0);
  useEffect(() => {
    setRelogio(Date.now());
    const t = setInterval(() => setRelogio(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const hoje = hojeNaLoja(tz, new Date(relogio));

  // ── O PERÍODO ──────────────────────────────────────────────────────────
  const dias = useMemo(() => periodoDoFiltro(dateFilter, hoje, { de: customStart, ate: customEnd }), [dateFilter, hoje, customStart, customEnd]);
  // Desde quando os dados precisam ir (o início do anterior não depende do corte).
  const periodoBruto = useMemo(() => periodoDoInicio(dias.de, dias.ate, hoje, tz, relogio), [dias, hoje, tz, relogio]);
  const desdeNecessario = precisaDesde(periodoBruto);
  const coberto = desdeNecessario.getTime() >= Date.parse(base.desde);
  const longoDemais = !coberto && periodoBruto.janela.fim.getTime() - desdeNecessario.getTime() > (MAIOR_PERIODO_EM_DIAS + 1) * DIA_MS;
  const chaveDoPeriodo = `${desdeNecessario.toISOString()}|${periodoBruto.janela.fim.toISOString()}|${selectedStoreId}`;
  const [erroDoPeriodo, setErroDoPeriodo] = useState("");

  useEffect(() => {
    if (coberto || longoDemais || extra?.id === chaveDoPeriodo) return;
    let vivo = true;
    setErroDoPeriodo("");
    const qs = new URLSearchParams({ de: desdeNecessario.toISOString(), ate: periodoBruto.janela.fim.toISOString() });
    if (isAdmin && selectedStoreId !== "todas") qs.set("loja", selectedStoreId);
    fetch(`/api/store/inicio?${qs}`, { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!vivo) return;
        if (!r.ok) { setErroDoPeriodo(j.error || "Não consegui carregar o período."); return; }
        setExtra({ id: chaveDoPeriodo, pedidos: j.pedidos || [], desde: desdeNecessario.toISOString(), ate: j.geradoEm || new Date().toISOString() });
      })
      .catch(() => { if (vivo) setErroDoPeriodo("Não consegui falar com o servidor. Tente de novo."); });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaveDoPeriodo, coberto, longoDemais]);

  const lote: Lote | null = coberto ? base : extra?.id === chaveDoPeriodo ? extra : null;
  const carregandoPeriodo = !coberto && !longoDemais && !erroDoPeriodo && !lote;
  // O erro é do período que foi buscado: voltou para "Hoje", some.
  const erroVisivel = !coberto && !longoDemais ? erroDoPeriodo : "";

  // O instante dos DADOS: o hoje e o anterior param no mesmo minuto.
  const agoraDosDados = lote ? Date.parse(lote.ate) : relogio;
  const periodo = useMemo(() => periodoDoInicio(dias.de, dias.ate, hoje, tz, agoraDosDados), [dias, hoje, tz, agoraDosDados]);
  const incluiHoje = periodo.ate >= hoje;

  // ── A ATUALIZAÇÃO ──────────────────────────────────────────────────────
  // A tela carregava uma vez e o "Hoje" ficava parado na hora em que abriu.
  // Agora, enquanto o período chega até hoje e a aba está à vista, ela relê o
  // dia de hoje a cada 2 min (e ao voltar para a aba, e na virada das 5h).
  const [atualizando, setAtualizando] = useState(false);
  const [erroDaAtualizacao, setErroDaAtualizacao] = useState("");
  const ultimaTentativa = useRef(0);
  const emVoo = useRef(false);
  const estado = useRef({ coberto, chaveDoPeriodo, base, extra, hoje, tz, isAdmin, selectedStoreId, incluiHoje });
  estado.current = { coberto, chaveDoPeriodo, base, extra, hoje, tz, isAdmin, selectedStoreId, incluiHoje };

  const atualizar = useCallback(async () => {
    const e = estado.current;
    if (emVoo.current) return;
    const alvo: Lote | null = e.coberto ? e.base : e.extra && e.extra.id === e.chaveDoPeriodo ? e.extra : null;
    if (!alvo) return;
    const ehBase = alvo === e.base;
    const de = desdeDaAtualizacao({ hoje: e.hoje, tz: e.tz, cobertoAte: Date.parse(alvo.ate), cobertoDesde: Date.parse(alvo.desde) });
    emVoo.current = true;
    ultimaTentativa.current = Date.now();
    setAtualizando(true);
    try {
      const qs = new URLSearchParams({ de: new Date(de).toISOString() });
      if (e.isAdmin && e.selectedStoreId !== "todas") qs.set("loja", e.selectedStoreId);
      const r = await fetch(`/api/store/inicio?${qs}`, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErroDaAtualizacao(r.status === 401 ? "A sessão expirou: entre de novo para atualizar os números." : j.error || "Não consegui atualizar agora."); return; }
      const novos: Order[] = j.pedidos || [];
      const ate: string = j.geradoEm || new Date().toISOString();
      const aplicar = (l: Lote | null): Lote | null => (l && l.id === alvo.id ? { ...l, pedidos: juntarPedidos(l.pedidos, novos, de), ate } : l);
      if (ehBase) setBase((b) => aplicar(b) as Lote);
      else setExtra((x) => aplicar(x));
      setErroDaAtualizacao("");
    } catch {
      setErroDaAtualizacao("Sem conexão: os números são da última atualização.");
    } finally {
      emVoo.current = false;
      setAtualizando(false);
    }
  }, []);

  useEffect(() => {
    ultimaTentativa.current = Date.now();
    const talvez = () => {
      const e = estado.current;
      if (!e.incluiHoje) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      // O ADMIN em "Todas as Lojas" relê a plataforma inteira: de 5 em 5 min.
      const intervalo = e.isAdmin && e.selectedStoreId === "todas" ? 5 * 60 * 1000 : ATUALIZA_A_CADA_MS;
      if (Date.now() - ultimaTentativa.current < intervalo) return;
      atualizar();
    };
    const t = setInterval(talvez, 20_000);
    document.addEventListener("visibilitychange", talvez);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", talvez); };
  }, [atualizar]);

  // Virou o dia (5h) com a tela aberta: relê já, sem esperar os 2 min.
  const hojeVisto = useRef(hoje);
  useEffect(() => {
    if (hojeVisto.current === hoje) return;
    hojeVisto.current = hoje;
    atualizar();
  }, [hoje, atualizar]);

  // ── OS NÚMEROS ─────────────────────────────────────────────────────────
  const todos = lote ? lote.pedidos : [];
  const doPeriodo = useMemo(() => todos.filter((p) => naJanela(p, periodo.janela)), [todos, periodo]);
  const doAnterior = useMemo(() => (periodo.anterior ? todos.filter((p) => naJanela(p, periodo.anterior!.janela)) : []), [todos, periodo]);

  const vendas = useMemo(() => vendasDoInicio(doPeriodo), [doPeriodo]);
  const vendasAntes = useMemo(() => (periodo.anterior && lote ? vendasDoInicio(doAnterior) : null), [doAnterior, periodo, lote]);
  const formas = useMemo(() => formasDoInicio(doPeriodo), [doPeriodo]);
  const clientes = useMemo(() => clientesDoInicio(doPeriodo), [doPeriodo]);
  const porHora = useMemo(() => vendasPorHora(doPeriodo, { de: periodo.de, ate: periodo.ate, tz, agora: agoraDosDados }), [doPeriodo, periodo, tz, agoraDosDados]);
  const produtos = useMemo(() => produtosDoInicio(doPeriodo, nomeDoProduto), [doPeriodo]);
  // O mapa: só o que é venda (o cancelado e o rascunho do robô não são entrega).
  const vendasDoMapa = useMemo(() => doPeriodo.filter((p) => entraNaVenda(p)), [doPeriodo]);
  const porStatus = useMemo(() => {
    const map = new Map<string, number>();
    for (const o of doPeriodo) map.set(o.status, (map.get(o.status) || 0) + 1);
    return [...map.entries()];
  }, [doPeriodo]);

  const tendenciaValor = vendasAntes ? variacao(vendas.valor, vendasAntes.valor) : null;
  const tendenciaVendas = vendasAntes ? variacao(vendas.vendas, vendasAntes.vendas) : null;
  const tendenciaTicket = vendasAntes ? variacao(vendas.ticket, vendasAntes.ticket) : null;

  const umDia = periodo.dias === 1;
  const maxHora = Math.max(...porHora.map((h) => h.media), 0.0001);
  const recentes = doPeriodo.slice(0, 10);
  const mostrarLoja = doPeriodo.some((o) => o.storeName);
  const atualizadoAs = lote ? horaNaLoja(lote.ate, tz) : "";

  const filterBtns: { key: FiltroDoInicio; label: string }[] = [
    { key: "hoje", label: "Hoje" }, { key: "ontem", label: "Ontem" },
    { key: "semana", label: "7 dias" }, { key: "mes", label: "Mês" },
    { key: "custom", label: "Período" }
  ];

  const Card = ({ title, value, subtitle, icon: Icon, color, trend }: { title: string; value: ReactNode; subtitle?: ReactNode; icon: any; color: string; trend?: number | null }) => (
    <div style={{ background: "#fff", borderRadius: "14px", padding: "1.25rem", border: "1px solid #E2E8F0", flex: "1 1 200px", minWidth: "180px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <p style={{ fontSize: "0.75rem", color: "#94A3B8", fontWeight: 600, margin: "0 0 4px" }}>{title}</p>
          <p style={{ fontSize: "1.5rem", fontWeight: 800, margin: 0, color: "#1E293B" }}>{value}</p>
          {subtitle && <p style={{ fontSize: "0.72rem", color: "#94A3B8", margin: "4px 0 0" }}>{subtitle}</p>}
        </div>
        <div style={{ width: "42px", height: "42px", borderRadius: "12px", background: `${color}15`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Icon size={20} color={color} />
        </div>
      </div>
      {trend !== undefined && trend !== null && (
        <div style={{ display: "flex", alignItems: "center", gap: "3px", marginTop: "8px", fontSize: "0.72rem", fontWeight: 700, color: Math.abs(trend) < 0.05 ? "#94A3B8" : trend > 0 ? "#0F766E" : "#C92E09" }}>
          {trend > 0 ? <ArrowUpRight size={13} /> : trend < 0 ? <ArrowDownRight size={13} /> : null}
          {Math.abs(trend) < 0.05 ? "= igual ao período anterior" : `${fmtPct1(Math.abs(trend))}% vs. período anterior`}
        </div>
      )}
    </div>
  );

  const rotuloDoFiltro = dateFilter === "hoje" ? "Hoje" : dateFilter === "ontem" ? "Ontem" : dateFilter === "semana" ? "Últimos 7 dias" : dateFilter === "mes" ? "Este Mês" : "Período Personalizado";
  const diasEmTexto = (de: string, ate: string) => (de === ate ? fmtDia(de) : `${fmtDia(de)} a ${fmtDia(ate)}`);

  return (
    <div style={{ maxWidth: "1400px", margin: "0 auto", padding: "1.25rem 1.5rem", fontFamily: "'Inter', sans-serif" }}>

      {/* SELETOR MULTILOJA — só para ADMIN */}
      {isAdmin && storeList.length > 1 && (
        <div style={{ background: "#fff", borderRadius: "14px", border: "1px solid #E2E8F0", padding: "1rem 1.25rem", marginBottom: "1.25rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.75rem" }}>
            <StoreIcon size={16} color="#C92E09" />
            <span style={{ fontWeight: 700, fontSize: "0.85rem", color: "#1E293B" }}>Selecionar Loja</span>
            <span style={{ fontSize: "0.75rem", color: "#94A3B8", marginLeft: "4px" }}>{storeList.length - 1} franquia(s) cadastrada(s)</span>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            {storeList.map(s => {
              const active = s.id === selectedStoreId;
              return (
                <button key={s.id} onClick={() => router.push(`/store${s.id === "todas" ? "" : `?loja=${s.id}`}`)}
                  style={{ padding: "0.45rem 1rem", borderRadius: "20px", fontSize: "0.82rem", fontWeight: active ? 700 : 500, cursor: "pointer", transition: "all 0.15s",
                    border: active ? "2px solid #C92E09" : "1.5px solid #E2E8F0",
                    background: active ? "#C92E09" : "#F8FAFC",
                    color: active ? "#fff" : "#64748B",
                    boxShadow: active ? "0 2px 8px #C6282830" : "none"
                  }}>
                  {s.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ONBOARDING — some se admin ou todas as etapas concluídas */}
      {!isAdmin && completedOnboardingSteps.length < 6 && (
        <OnboardingChecklist completedSteps={completedOnboardingSteps} />
      )}

      {/* FILTER BAR */}
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap", marginBottom: "0.6rem" }}>
        <Filter size={16} color="#94A3B8" />
        {filterBtns.map(f => (
          <button key={f.key} onClick={() => setDateFilter(f.key)} style={{
            padding: "0.4rem 0.9rem", borderRadius: "8px", fontSize: "0.82rem", fontWeight: dateFilter === f.key ? 700 : 500,
            border: dateFilter === f.key ? "2px solid #C92E09" : "1.5px solid #E2E8F0",
            background: dateFilter === f.key ? "#C6282810" : "#fff", color: dateFilter === f.key ? "#C92E09" : "#64748B", cursor: "pointer"
          }}>{f.label}</button>
        ))}
        {dateFilter === "custom" && (
          <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
            <Calendar size={14} color="#94A3B8" />
            <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} style={{ padding: "0.35rem 0.5rem", borderRadius: "6px", border: "1.5px solid #E2E8F0", fontSize: "0.8rem" }} />
            <span style={{ color: "#94A3B8", fontSize: "0.8rem" }}>até</span>
            <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} style={{ padding: "0.35rem 0.5rem", borderRadius: "6px", border: "1.5px solid #E2E8F0", fontSize: "0.8rem" }} />
          </div>
        )}
        {carregandoPeriodo && (
          <span role="status" style={{ fontSize: "0.8rem", color: "#64748B", fontWeight: 600 }}>Carregando o período…</span>
        )}
        {erroVisivel && (
          <span role="alert" style={{ fontSize: "0.8rem", color: "#C92E09", fontWeight: 600 }}>{erroVisivel}</span>
        )}
        {longoDemais && (
          <span role="alert" style={{ fontSize: "0.8rem", color: "#B45309", fontWeight: 600 }}>
            Aqui o período vai até 3 meses. Para mais, use <Link href="/store/relatorios" style={{ color: "inherit" }}>Relatórios</Link>.
          </span>
        )}
      </div>

      {/* DE ONDE VÊM OS NÚMEROS — o período, a comparação e a hora dos dados */}
      <p style={{ margin: "0 0 1.1rem", fontSize: "0.76rem", color: "#64748B", lineHeight: 1.5 }}>
        {diasEmTexto(periodo.de, periodo.ate)} — o dia de operação vira às 5h.
        {periodo.anterior
          ? <> Comparado com {diasEmTexto(periodo.anterior.de, periodo.anterior.ate)}{periodo.anterior.ateEsteHorario ? " até este mesmo horário" : ""} (o mesmo número de dias logo antes).</>
          : <> Sem comparação: o período é longo demais para comparar aqui.</>}
        {" "}As mesmas contas de <Link href="/store/relatorios/vendas" style={{ color: "#C92E09", fontWeight: 700 }}>Relatórios › Vendas por período</Link>.
        {lote && incluiHoje && (
          <span style={{ marginLeft: 6, whiteSpace: "nowrap" }}>
            · Atualizado às {atualizadoAs}{" "}
            <button type="button" onClick={() => atualizar()} disabled={atualizando}
              style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "1px 8px", borderRadius: 999, border: "1px solid #E2E8F0", background: "#fff", color: "#475569", fontSize: "0.72rem", fontWeight: 700, cursor: atualizando ? "default" : "pointer" }}>
              <RefreshCw size={11} /> {atualizando ? "Atualizando…" : "Atualizar"}
            </button>
          </span>
        )}
        {erroDaAtualizacao && <span role="alert" style={{ marginLeft: 6, color: "#B45309", fontWeight: 600 }}>{erroDaAtualizacao}</span>}
      </p>

      {/* OS CARTÕES — pela régua: faturamento = valor vendido (a Receita Bruta do DRE e o "Valor vendido"
          dos Relatórios), vendas (a mesa conta uma vez), ticket = valor ÷ vendas. "PEDIDOS" virou "VENDAS"
          porque o número é de vendas; o roteiro do vídeo (tutoriais/roteiros/inicio.mjs) procura estes títulos. */}
      <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "1.25rem" }}>
        <Card title="FATURAMENTO" value={formatBRL(vendas.valor)} icon={DollarSign} color="#0F766E" trend={tendenciaValor}
          subtitle="Valor vendido: total dos pedidos, sem cancelados" />
        <Card title="VENDAS" value={fmtInt(vendas.vendas)} icon={ShoppingCart} color="#1C1917" trend={tendenciaVendas}
          subtitle={<>
            {vendas.lancamentos !== vendas.vendas ? `${fmtInt(vendas.lancamentos)} lançamentos (a mesa conta uma vez)` : "A mesa conta uma vez"}
            <br />
            {vendas.cancelados.pedidos > 0 ? `${fmtInt(vendas.cancelados.pedidos)} cancelado(s), ${formatBRL(vendas.cancelados.valor)}, fora da conta` : "Sem cancelamentos"}
          </>} />
        <Card title="TICKET MÉDIO" value={formatBRL(vendas.ticket)} icon={TrendingUp} color="#64748B" trend={tendenciaTicket}
          subtitle="Valor vendido ÷ vendas" />
        <Card title="CLIENTES IDENTIFICADOS" value={fmtInt(clientes.clientes)} icon={Users} color="#B45309"
          subtitle={<>Pelo telefone: em {fmtInt(clientes.vendasComTelefone)} de {fmtInt(clientes.vendas)} vendas<br />O iFood esconde o número do cliente</>} />
      </div>
      {vendas.valoresImpossiveis > 0 && (
        <p role="note" style={{ margin: "-0.6rem 0 1.1rem", fontSize: "0.8rem", color: "#C92E09", fontWeight: 700 }}>
          {vendas.valoresImpossiveis} pedido{vendas.valoresImpossiveis === 1 ? "" : "s"} com valor impossível (R$ 1 milhão ou mais) ficou fora de todas as somas. Confira o cadastro.
        </p>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 400px), 1fr))", gap: "1rem", marginBottom: "1.25rem" }}>
        {/* FORMAS DE PAGAMENTO — a régua do relatório Formas de pagamento */}
        <div style={{ background: "#fff", borderRadius: "14px", padding: "1.25rem", border: "1px solid #E2E8F0" }}>
          <h3 style={{ fontSize: "0.9rem", fontWeight: 700, margin: "0 0 1rem", color: "#1E293B" }}>💳 Formas de Pagamento</h3>
          {formas.length === 0 ? (
            <p style={{ color: "#94A3B8", fontSize: "0.85rem" }}>Sem dados no período</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {formas.map((data) => {
                const { icon: Icon, color } = VISUAL_DA_FORMA[data.chave];
                return (
                  <div key={data.chave}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px", gap: 8 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <div style={{ width: "32px", height: "32px", borderRadius: "8px", background: `${color}15`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          <Icon size={16} color={color} />
                        </div>
                        <div>
                          <span style={{ fontWeight: 700, fontSize: "0.85rem", color: "#0F172A" }}>{data.rotulo}</span>
                          <span style={{ fontSize: "0.75rem", color: "#64748B", marginLeft: "6px" }}>
                            {fmtInt(data.contas)} {data.chave === "MESA" ? (data.contas === 1 ? "conta" : "contas") : (data.contas === 1 ? "pedido" : "pedidos")} ({fmtPct1(data.pct)}%)
                          </span>
                        </div>
                      </div>
                      <span style={{ fontWeight: 800, fontSize: "0.88rem", color: "#0F172A", whiteSpace: "nowrap" }}>{formatBRL(data.valor)}</span>
                    </div>
                    <div style={{ height: "7px", borderRadius: "4px", background: "#F1F5F9", overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${data.pct}%`, background: color, borderRadius: "4px", transition: "width 0.5s" }} />
                    </div>
                  </div>
                );
              })}
              <p style={{ margin: "0.25rem 0 0", fontSize: "0.72rem", color: "#94A3B8", lineHeight: 1.45 }}>
                {formas.some((f) => f.chave === "ONLINE") && <>Pago online: no app (iFood, 99Food…) ou no site — chega pelo repasse, não passa pelo caixa. </>}
                {formas.some((f) => f.chave === "MESA") && <>Mesa: a forma está no fechamento da conta — veja em <Link href="/store/relatorios/formas-de-pagamento" style={{ color: "inherit", fontWeight: 700 }}>Relatórios › Formas de pagamento</Link>. </>}
                Pagamento dividido entra em cada forma pela parte dele.
              </p>
            </div>
          )}
        </div>

        {/* STATUS DOS PEDIDOS E TIPO DE VENDA */}
        <div style={{ background: "#fff", borderRadius: "14px", padding: "1.25rem", border: "1px solid #E2E8F0" }}>
          <h3 style={{ fontSize: "0.9rem", fontWeight: 700, margin: "0 0 0.2rem", color: "#1E293B" }}>📊 Status dos Pedidos</h3>
          <p style={{ margin: "0 0 0.8rem", fontSize: "0.72rem", color: "#94A3B8" }}>Cada lançamento conta; a rodada da mesa fica "Aceito" até a conta fechar.</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.6rem" }}>
            {porStatus.map(([status, count]) => {
              const cfg = STATUS_LABELS[status] || { label: status, emoji: "📋", color: "#64748B" };
              return (
                <div key={status} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "0.6rem", borderRadius: "10px", background: `${cfg.color}08`, border: `1px solid ${cfg.color}20` }}>
                  <span style={{ fontSize: "1.2rem" }}>{cfg.emoji}</span>
                  <div>
                    <p style={{ fontWeight: 700, fontSize: "1.1rem", margin: 0, color: cfg.color }}>{fmtInt(count)}</p>
                    <p style={{ fontSize: "0.7rem", color: "#64748B", margin: 0 }}>{cfg.label}</p>
                  </div>
                </div>
              );
            })}
            {porStatus.length === 0 && <p style={{ color: "#94A3B8", fontSize: "0.85rem", margin: 0 }}>Sem pedidos no período</p>}
          </div>

          {/* Por tipo de venda — em VENDAS (a mesa conta uma vez), como nos Relatórios */}
          <h4 style={{ fontSize: "0.82rem", fontWeight: 700, margin: "1rem 0 0.2rem", color: "#1E293B" }}>Vendas por tipo</h4>
          <p style={{ margin: "0 0 0.6rem", fontSize: "0.72rem", color: "#94A3B8" }}>Entrega, retirada, balcão, mesa e totem — cada mesa é uma venda.</p>
          {vendas.porTipo.length === 0 ? (
            <p style={{ color: "#94A3B8", fontSize: "0.85rem", margin: 0 }}>Sem vendas no período</p>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: "0.6rem" }}>
              {vendas.porTipo.map((t) => (
                <div key={t.tipo} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "0.6rem", borderRadius: "10px", background: "#FFF4EF", border: "1px solid #FFEDD5" }}>
                  <span style={{ fontSize: "1.2rem" }}>{EMOJI_DO_TIPO[t.tipo] || "📋"}</span>
                  <div>
                    <p style={{ fontWeight: 700, fontSize: "1.1rem", margin: 0, color: "#E8590C" }}>{fmtInt(t.vendas)}</p>
                    <p style={{ fontSize: "0.7rem", color: "#64748B", margin: 0 }}>{t.rotulo} · {formatBRL(t.valor)}</p>
                    {t.lancamentos !== t.vendas && <p style={{ fontSize: "0.66rem", color: "#94A3B8", margin: 0 }}>{fmtInt(t.lancamentos)} lançamentos</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* MAPA DE CALOR & DISTRIBUIÇÃO GEOGRÁFICA DE PEDIDOS POR FILTRO */}
      <StoreDashboardMap
        orders={vendasDoMapa}
        dateFilterLabel={rotuloDoFiltro}
        pontoDaLoja={pontoDaLoja}
        cidadeDaLoja={cidadeDaLoja}
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 400px), 1fr))", gap: "1rem", marginBottom: "1.25rem" }}>
        {/* VENDAS POR HORA — do relógio da loja, a partir das 5h; média por dia no período de vários dias */}
        <div style={{ background: "#fff", borderRadius: "14px", padding: "1.25rem", border: "1px solid #E2E8F0" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "1rem", gap: 8, flexWrap: "wrap" }}>
            <div>
              <h3 style={{ fontSize: "0.9rem", fontWeight: 700, margin: 0, color: "#1E293B" }}>🕐 Vendas por Hora (Pico do Dia)</h3>
              <p style={{ margin: "2px 0 0", fontSize: "0.72rem", color: "#94A3B8" }}>
                {umDia ? "Vendas em cada hora do relógio da loja" : `Média por dia (${periodo.dias} dias); a hora que ainda não chegou hoje não entra na média`}
              </p>
            </div>
            <div style={{ display: "flex", gap: "0.75rem", fontSize: "0.72rem", fontWeight: 600 }}>
              <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                <span style={{ width: "8px", height: "8px", borderRadius: "2px", background: "#C92E09" }} />Almoço (11h-14h)
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                <span style={{ width: "8px", height: "8px", borderRadius: "2px", background: "#B45309" }} />Jantar (18h-22h)
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                <span style={{ width: "8px", height: "8px", borderRadius: "2px", background: "#1C1917" }} />Outros
              </span>
            </div>
          </div>

          {/* Gráfico de Barras com altura 100% garantida no container. As 24 barras
              não cabem num celular: rolam dentro do cartão, não a página. */}
          <div style={{ overflowX: "auto" }}>
          <div style={{ display: "flex", alignItems: "flex-end", gap: "4px", height: "150px", padding: "10px 0 5px", minWidth: "560px" }}>
            {porHora.map(({ hora: h, vendas: n, media }) => {
              const heightPct = media > 0 ? Math.max((media / maxHora) * 100, 10) : 4;
              const barColor = h >= 11 && h <= 14 ? "#C92E09" : h >= 18 && h <= 22 ? "#B45309" : "#1C1917";
              const rotulo = umDia ? fmtInt(n) : media.toLocaleString("pt-BR", { maximumFractionDigits: 1 });

              return (
                <div key={h} style={{ flex: 1, minWidth: 0, height: "100%", display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center" }}
                  title={umDia ? `${h}h: ${n} venda(s)` : `${h}h: ${rotulo} venda(s) por dia em média (${n} no período)`}>
                  {media > 0 && (
                    <span style={{ fontSize: "0.62rem", color: "#1E293B", fontWeight: 800, marginBottom: "3px" }}>
                      {rotulo}
                    </span>
                  )}
                  <div style={{
                    width: "100%",
                    height: `${heightPct}%`,
                    borderRadius: "4px 4px 0 0",
                    background: media > 0 ? `linear-gradient(to top, ${barColor}, ${barColor}DD)` : "#F1F5F9",
                    transition: "all 0.3s ease",
                    boxShadow: media > 0 ? `0 2px 6px ${barColor}40` : "none"
                  }} />
                  <span style={{ fontSize: "0.6rem", color: "#64748B", fontWeight: h % 3 === 0 || media > 0 ? 700 : 500, marginTop: "4px" }}>
                    {h}h
                  </span>
                </div>
              );
            })}
          </div>
          </div>
        </div>

        {/* TOP PRODUTOS */}
        <div style={{ background: "#fff", borderRadius: "14px", padding: "1.25rem", border: "1px solid #E2E8F0" }}>
          <h3 style={{ fontSize: "0.9rem", fontWeight: 700, margin: "0 0 1rem", color: "#1E293B" }}>🏆 Top Produtos</h3>
          {produtos.length === 0 ? (
            <p style={{ color: "#94A3B8", fontSize: "0.85rem" }}>Sem dados no período</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
              {produtos.map((p, i) => {
                const margem = p.total > 0 && p.cost > 0 ? ((p.total - p.cost) / p.total * 100) : null;
                const margemColor = margem === null ? "#94A3B8" : margem >= 40 ? "#0F766E" : margem >= 20 ? "#B45309" : "#C92E09";
                return (
                  <div key={p.name} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.4rem 0.5rem", borderRadius: "8px", background: i === 0 ? "#FFF4EF" : "transparent" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span style={{ width: "22px", height: "22px", borderRadius: "6px", background: i < 3 ? "#C92E09" : "#E2E8F0", color: i < 3 ? "#fff" : "#64748B", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.7rem", fontWeight: 700, flexShrink: 0 }}>{i + 1}</span>
                      <span style={{ fontSize: "0.82rem", fontWeight: 600, color: "#1E293B" }}>{p.name}</span>
                    </div>
                    <div style={{ textAlign: "right", display: "flex", alignItems: "center", gap: "8px" }}>
                      <span style={{ fontSize: "0.8rem", fontWeight: 700 }}>{fmtInt(p.qty)}x</span>
                      {margem !== null && (
                        <span title="Margem sobre o custo cadastrado no produto" style={{ fontSize: "0.68rem", fontWeight: 700, padding: "2px 6px", borderRadius: "8px", background: margemColor + "18", color: margemColor }}>
                          {margem.toFixed(0)}% mg
                        </span>
                      )}
                      <span style={{ fontSize: "0.75rem", color: "#64748B", fontWeight: 600 }}>{formatBRL(p.total)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ÚLTIMOS PEDIDOS */}
      <div style={{ background: "#fff", borderRadius: "14px", padding: "1.25rem", border: "1px solid #E2E8F0" }}>
        <h3 style={{ fontSize: "0.9rem", fontWeight: 700, margin: "0 0 1rem", color: "#1E293B" }}>📋 Últimos Pedidos</h3>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
            <thead>
              <tr style={{ borderBottom: "2px solid #F1F5F9" }}>
                {["Pedido", ...(mostrarLoja ? ["Loja"] : []), "Cliente", "Tipo", "Pagamento", "Status", "Valor", "Hora"].map(h => (
                  <th key={h} style={{ padding: "0.5rem", textAlign: "left", color: "#94A3B8", fontWeight: 600, fontSize: "0.75rem" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recentes.map(o => {
                const st = STATUS_LABELS[o.status] || { emoji: "📋", label: o.status, color: "#64748B" };
                return (
                  <tr key={o.id} style={{ borderBottom: "1px solid #F8FAFC" }}>
                    <td style={{ padding: "0.5rem", fontWeight: 700, whiteSpace: "nowrap" }}>{numeroDoPedidoNaLista(o)}</td>
                    {mostrarLoja && (
                      <td style={{ padding: "0.5rem" }}>
                        <span style={{ fontSize: "0.75rem", background: "#F1F5F9", padding: "2px 8px", borderRadius: "8px", fontWeight: 600, color: "#475569", whiteSpace: "nowrap" }}>
                          🏪 {o.storeName || "—"}
                        </span>
                      </td>
                    )}
                    <td style={{ padding: "0.5rem" }}>{o.customerName}</td>
                    <td style={{ padding: "0.5rem", whiteSpace: "nowrap" }}>{tipoDoPedidoNaLista(o)}</td>
                    <td style={{ padding: "0.5rem" }}><span style={{ fontWeight: 600, color: "#475569" }}>{formaDoPedidoNaLista(o)}</span></td>
                    <td style={{ padding: "0.5rem" }}><span style={{ padding: "2px 8px", borderRadius: "12px", background: `${st.color}15`, color: st.color, fontWeight: 600, fontSize: "0.75rem", whiteSpace: "nowrap" }}>{st.emoji} {st.label}</span></td>
                    <td style={{ padding: "0.5rem", fontWeight: 800, whiteSpace: "nowrap" }}>{formatBRL(o.totalAmount)}</td>
                    <td style={{ padding: "0.5rem", color: "#94A3B8" }}>{horaNaLoja(o.createdAt, tz)}</td>
                  </tr>
                );
              })}
              {recentes.length === 0 && (
                <tr><td colSpan={mostrarLoja ? 8 : 7} style={{ padding: "2rem", textAlign: "center", color: "#94A3B8" }}>{carregandoPeriodo ? "Carregando o período…" : "Nenhum pedido no período selecionado"}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
