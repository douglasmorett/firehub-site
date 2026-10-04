"use client";

/**
 * Módulo de mesa para CELULAR.
 *
 * A tela completa (MesasApp.tsx) foi desenhada para tablet: painéis lado a
 * lado, comanda fixa, abas de categoria em linha. No celular tudo isso se
 * espreme e o garçom erra o toque. Esta é outra tela, e não um media query da
 * mesma, porque o celular pede outro FLUXO, uma coisa por vez:
 *
 *   mesas → mesa → cardápio → revisar → enviar
 *
 * Referência: o sistema que o Ragnar usava antes (categorias em blocos
 * grandes, toque no produto já lança, barra fixa com Voltar/Revisar). O que
 * esta faz a mais: total e quantidade sempre à vista na barra de baixo, troca
 * de categoria sem voltar à grade, busca em todo o cardápio, contador no
 * próprio produto e o carrinho guardado no aparelho (cair a aba não perde o
 * pedido que o garçom está anotando).
 *
 * As APIs são as mesmas da tela completa; o servidor confere tudo (garçom só
 * mexe no que o link dele permite). Fechar a conta com pagamento continua na
 * tela completa: ela tem divisão por pessoa, taxa, desconto e formas de
 * pagamento, que não cabem bem num celular.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, Check, ChevronRight, Minus, Plus, Printer, RefreshCw, Search,
  StickyNote, Trash2, User, LogOut, Monitor, X, Users, ArrowLeftRight,
} from "lucide-react";
import ComboModal from "@/components/customer/ComboModal";
import SelecionarItensParaImpressao from "@/components/mesas/SelecionarItensParaImpressao";
import { montarCardapioDaMesa, gruposDoProduto, type ItemDaMesa } from "@/lib/cardapio-da-mesa";
import { numerosDaFaixa, type AndarDaMesa, lerAndares } from "@/lib/andares-da-mesa";
import { caminhoParaAbrirOCaixa } from "@/lib/caixa-aberto";

// ─── Tipos (os mesmos que as rotas devolvem para a tela completa) ───────────
interface Mesa {
  id: string;
  number: number;
  label: string | null;
  isActive: boolean;
  openSession: {
    id: string;
    customerName: string | null;
    notes?: string | null;
    waiterName: string | null;
    waiterId?: string | null;
    openedAt: string;
    totalAmount: number;
    orderCount: number;
  } | null;
}

interface PedidoDaMesa {
  id: string;
  dailyOrderNumber: number | null;
  totalAmount: number;
  createdAt: string;
  status: string;
  items: {
    id: string;
    quantity: number;
    price: number;
    menuProduct: { name: string };
    tableGuestId?: string | null;
    comboSelections?: unknown;
    notes?: string | null;
  }[];
}

interface DetalheDaMesa {
  id: string;
  customerName: string | null;
  waiterName: string | null;
  openedAt: string;
  orders: PedidoDaMesa[];
}

interface Pessoa { id: string; name: string; total: number }

interface LinhaDoCarrinho {
  uid: string;
  item: ItemDaMesa;
  qty: number;
  unitPrice: number;
  comboSelections?: { name: string; quantity: number }[];
  guestId: string | null;
  notes?: string;
}

type Tela = "mesas" | "mesa" | "cardapio" | "revisar";
type Filtro = "todas" | "livres" | "ocupadas" | "minhas" | `andar:${string}`;

// ─── Ajudantes ──────────────────────────────────────────────────────────────
const fmt = (v: number) => `R$ ${(Number(v) || 0).toFixed(2).replace(".", ",")}`;

function tempoDesde(iso: string) {
  const m = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h}h${m % 60 ? String(m % 60).padStart(2, "0") : ""}`;
}

/** "2x Calabresa, 1x Coca" a partir do que o pedido gravou. */
function resumoDoCombo(sel: unknown): string {
  let lista: any = sel;
  if (typeof lista === "string") {
    try { lista = JSON.parse(lista); } catch { return ""; }
  }
  if (!Array.isArray(lista)) return "";
  return lista
    .map((s: any) => (s?.name ? `${Number(s.quantity) > 1 ? `${s.quantity}x ` : ""}${s.name}` : ""))
    .filter(Boolean)
    .join(", ");
}

const chaveDoCarrinho = (sessionId: string) => `mesa-celular-carrinho:${sessionId}`;

function lerCarrinhoGuardado(sessionId: string): LinhaDoCarrinho[] {
  try {
    const bruto = localStorage.getItem(chaveDoCarrinho(sessionId));
    const lista = bruto ? JSON.parse(bruto) : [];
    return Array.isArray(lista) ? lista : [];
  } catch {
    return [];
  }
}

function guardarCarrinho(sessionId: string, linhas: LinhaDoCarrinho[]) {
  try {
    if (linhas.length) localStorage.setItem(chaveDoCarrinho(sessionId), JSON.stringify(linhas));
    else localStorage.removeItem(chaveDoCarrinho(sessionId));
  } catch { /* aba anônima: segue só em memória */ }
}

const vibrar = () => {
  try { navigator.vibrate?.(12); } catch { /* sem vibração */ }
};

// ── Aviso que desce do topo e some sozinho (no lugar do alert()) ──────────
// Mesma interface do components/AvisoNoTopo.tsx de outra frente, que ainda não
// foi publicado: quando ele estiver no master, basta trocar este bloco pelo import.
type Aviso = { tipo: "ok" | "erro" | "atencao" | "info"; titulo: string; detalhe?: string };
const COR_DO_AVISO: Record<Aviso["tipo"], { cor: string; fundo: string }> = {
  ok: { cor: "#059669", fundo: "#ECFDF5" },
  erro: { cor: "#DC2626", fundo: "#FEF2F2" },
  atencao: { cor: "#D97706", fundo: "#FFFBEB" },
  info: { cor: "#2563EB", fundo: "#EFF6FF" },
};
function AvisoNoTopo({ aviso, onFechar }: { aviso: Aviso | null; onFechar: () => void }) {
  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(onFechar, aviso.tipo === "erro" ? 12000 : 6000);
    return () => clearTimeout(t);
  }, [aviso, onFechar]);
  if (!aviso) return null;
  const { cor, fundo } = COR_DO_AVISO[aviso.tipo];
  return (
    <div
      role={aviso.tipo === "erro" ? "alert" : "status"}
      onClick={onFechar}
      style={{
        position: "fixed", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 1000,
        width: "min(440px, calc(100vw - 24px))", background: fundo, borderLeft: `4px solid ${cor}`,
        borderRadius: 12, padding: "12px 14px", boxShadow: "0 10px 30px rgba(15,23,42,.18)", cursor: "pointer",
      }}
    >
      <div style={{ fontWeight: 800, fontSize: 14, color: "#0F172A" }}>{aviso.titulo}</div>
      {aviso.detalhe && <div style={{ fontSize: 13, color: "#475569", marginTop: 2 }}>{aviso.detalhe}</div>}
    </div>
  );
}

// ─── Estilo ─────────────────────────────────────────────────────────────────
const CSS = `
.mc { --fundo:#F1F5F9; --cartao:#fff; --texto:#0F172A; --suave:#64748B; --linha:#E2E8F0;
      --marca:#C92E09; --ok:#0F766E; --ocupada:#C2410C; --ocupada-fundo:#FFF7ED;
      min-height:100dvh; background:var(--fundo); color:var(--texto);
      font-family:'Inter','Segoe UI',system-ui,sans-serif; -webkit-tap-highlight-color:transparent; }
.mc * { box-sizing:border-box; }
.mc button { font-family:inherit; }
.mc input, .mc textarea, .mc select { font-size:16px; font-family:inherit; }
.mc-topo { position:sticky; top:0; z-index:20; background:#0F172A; color:#fff;
           padding:calc(env(safe-area-inset-top) + 10px) 12px 10px; }
.mc-topo-linha { display:flex; align-items:center; gap:8px; min-height:40px; }
.mc-icone { width:40px; height:40px; border-radius:10px; border:none; background:rgba(255,255,255,.1);
            color:#fff; display:flex; align-items:center; justify-content:center; cursor:pointer; flex-shrink:0; }
.mc-titulo { flex:1; min-width:0; }
.mc-titulo strong { display:block; font-size:17px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.mc-titulo span { display:block; font-size:12px; color:#CBD5E1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.mc-corpo { padding:12px 12px calc(env(safe-area-inset-bottom) + 96px); }
.mc-chips { display:flex; gap:8px; overflow-x:auto; padding:2px 0 10px; scrollbar-width:none; }
.mc-chips::-webkit-scrollbar { display:none; }
.mc-chip { flex-shrink:0; border:1.5px solid var(--linha); background:var(--cartao); color:var(--texto);
           border-radius:999px; padding:8px 14px; font-size:14px; font-weight:600; cursor:pointer; white-space:nowrap; }
.mc-chip[aria-pressed="true"] { background:#0F172A; color:#fff; border-color:#0F172A; }
.mc-grade-mesas { display:grid; grid-template-columns:repeat(auto-fill, minmax(96px, 1fr)); gap:10px; }
.mc-mesa { aspect-ratio:1; border-radius:14px; border:2px solid var(--linha); background:var(--cartao);
           display:flex; flex-direction:column; align-items:center; justify-content:center; gap:2px;
           cursor:pointer; padding:6px; color:var(--texto); transition:transform .1s; }
.mc-mesa:active { transform:scale(.96); }
.mc-mesa b { font-size:28px; line-height:1; font-weight:800; }
.mc-mesa small { font-size:11px; color:var(--suave); max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.mc-mesa.ocupada { background:var(--ocupada); border-color:var(--ocupada); color:#fff; }
.mc-mesa.ocupada small { color:#FFEDD5; }
.mc-mesa small.mc-mesa-cliente { font-size:12px; font-weight:800; color:inherit; }
.mc-mesa.minha { box-shadow:0 0 0 3px #FDBA74; }
.mc-mesa[aria-pressed="true"] { background:var(--ok); border-color:var(--ok); color:#fff; }
.mc-mesa[aria-pressed="true"] small { color:#CCFBF1; }
.mc-grade { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
.mc-cat { min-height:76px; border-radius:14px; border:none; background:#0F172A; color:#fff; padding:12px;
          text-align:left; font-weight:800; font-size:15px; cursor:pointer; display:flex; flex-direction:column;
          justify-content:space-between; gap:6px; }
.mc-cat span { font-size:12px; font-weight:500; color:#94A3B8; }
.mc-cat:active, .mc-prod:active { transform:scale(.97); }
.mc-prod { position:relative; min-height:92px; border-radius:14px; border:1.5px solid var(--linha); background:var(--cartao);
           padding:10px; text-align:left; cursor:pointer; display:flex; flex-direction:column; justify-content:space-between;
           gap:8px; color:var(--texto); transition:transform .1s; }
.mc-prod.no-pedido { border-color:var(--ok); background:#F0FDFA; }
.mc-prod-nome { font-size:14px; font-weight:700; line-height:1.25; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; }
.mc-prod-preco { font-size:14px; font-weight:800; color:var(--ok); }
.mc-prod-qtd { position:absolute; top:-8px; right:-6px; min-width:26px; height:26px; border-radius:13px; background:var(--ok);
               color:#fff; font-size:13px; font-weight:800; display:flex; align-items:center; justify-content:center; padding:0 7px; }
.mc-prod-tag { font-size:11px; font-weight:700; color:#7C3AED; }
.mc-barra { position:fixed; left:0; right:0; bottom:0; z-index:30; background:var(--cartao); border-top:1px solid var(--linha);
            padding:10px 12px calc(env(safe-area-inset-bottom) + 10px); display:flex; gap:10px; }
.mc-btn { min-height:52px; border-radius:12px; border:none; font-weight:800; font-size:15px; cursor:pointer;
          display:flex; align-items:center; justify-content:center; gap:8px; padding:0 14px; }
.mc-btn:disabled { opacity:.45; cursor:not-allowed; }
.mc-btn.primario { background:var(--ok); color:#fff; flex:1; }
.mc-btn.marca { background:var(--marca); color:#fff; flex:1; }
.mc-btn.secundario { background:#F1F5F9; color:#0F172A; }
.mc-btn.perigo { background:#FEF2F2; color:#B91C1C; }
.mc-cartao { background:var(--cartao); border:1px solid var(--linha); border-radius:14px; padding:12px; margin-bottom:10px; }
.mc-busca { display:flex; align-items:center; gap:8px; background:#fff; border-radius:12px; padding:0 12px; margin-top:10px; }
.mc-busca input { flex:1; border:none; outline:none; padding:12px 0; background:transparent; color:#0F172A; min-width:0; }
.mc-ultimo { position:fixed; left:12px; right:12px; bottom:calc(env(safe-area-inset-bottom) + 84px); z-index:29;
             background:#0F172A; color:#fff; border-radius:14px; padding:10px 10px 10px 14px; display:flex; align-items:center; gap:8px;
             box-shadow:0 8px 24px rgba(15,23,42,.3); animation:mc-sobe .18s ease-out; }
.mc-ultimo-nome { flex:1; min-width:0; font-size:14px; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.mc-ultimo button { width:40px; height:40px; border-radius:10px; border:none; background:rgba(255,255,255,.12); color:#fff;
                    display:flex; align-items:center; justify-content:center; cursor:pointer; flex-shrink:0; }
.mc-passo { display:flex; align-items:center; border:1.5px solid var(--linha); border-radius:12px; overflow:hidden; flex-shrink:0; }
.mc-passo button { width:44px; height:44px; border:none; background:#fff; display:flex; align-items:center; justify-content:center; cursor:pointer; color:#0F172A; }
.mc-passo span { min-width:32px; text-align:center; font-weight:800; font-size:16px; }
.mc-veu { position:fixed; inset:0; z-index:50; background:rgba(15,23,42,.5); display:flex; align-items:flex-end; animation:mc-aparece .15s; }
.mc-folha { width:100%; max-height:88dvh; overflow-y:auto; background:#fff; border-radius:20px 20px 0 0;
            padding:8px 16px calc(env(safe-area-inset-bottom) + 16px); animation:mc-sobe .2s ease-out; }
.mc-folha-alca { width:40px; height:5px; border-radius:3px; background:#CBD5E1; margin:0 auto 12px; }
.mc-folha h3 { margin:0 0 4px; font-size:19px; }
.mc-campo { width:100%; padding:13px 14px; border-radius:12px; border:1.5px solid var(--linha); background:#fff; color:#0F172A; outline:none; }
.mc-campo:focus { border-color:#0F172A; }
.mc-rotulo { display:block; font-size:13px; font-weight:700; color:var(--suave); margin:12px 0 6px; }
.mc-vazio { text-align:center; color:var(--suave); padding:40px 16px; font-size:15px; }
@keyframes mc-sobe { from { transform:translateY(16px); opacity:0 } to { transform:none; opacity:1 } }
@keyframes mc-aparece { from { opacity:0 } to { opacity:1 } }
@media (prefers-reduced-motion: reduce) { .mc *, .mc-veu, .mc-folha, .mc-ultimo { animation:none !important; transition:none !important; } }
`;

function Folha({ aberta, onFechar, children }: { aberta: boolean; onFechar: () => void; children: React.ReactNode }) {
  if (!aberta) return null;
  return (
    <div className="mc-veu" onClick={onFechar}>
      <div className="mc-folha" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="mc-folha-alca" />
        {children}
      </div>
    </div>
  );
}

// ─── Tela ───────────────────────────────────────────────────────────────────
export default function MesasCelular({
  modo = "loja",
  garcom = null,
  slug = "",
}: {
  modo?: "loja" | "garcom";
  garcom?: { id: string; name: string } | null;
  slug?: string;
}) {
  const ehGarcom = modo === "garcom" && !!garcom;
  const enderecoCompleto = ehGarcom ? `/garcom/${encodeURIComponent(slug)}/mesas` : "/store/mesas";

  const [aviso, setAviso] = useState<Aviso | null>(null);
  const avisar = (tipo: Aviso["tipo"], titulo: string, detalhe?: string) => setAviso({ tipo, titulo, detalhe });
  const fecharAviso = useCallback(() => setAviso(null), []);

  /** Mesmo contrato da tela completa: em modo garçom declara quem fala e trata o 401. */
  const chamar = useCallback(async (input: string, init?: RequestInit): Promise<Response> => {
    if (!ehGarcom) return fetch(input, init);
    const cabecalhos = new Headers(init?.headers || {});
    cabecalhos.set("x-operador", "garcom");
    const res = await fetch(input, { ...init, headers: cabecalhos });
    if (res.status === 401) {
      let motivo = "sessao";
      let sessaoVale = false;
      try {
        const me = await fetch("/api/garcom/me", { cache: "no-store" });
        const d = await me.json().catch(() => ({}));
        if (me.ok) sessaoVale = true;
        else if (typeof d?.codigo === "string") motivo = d.codigo;
      } catch { /* fica o genérico */ }
      if (sessaoVale) {
        setAviso({ tipo: "erro", titulo: "Esta ação não está liberada para o seu acesso de garçom" });
        return res;
      }
      window.location.assign(`/garcom/${encodeURIComponent(slug)}?tela=celular&motivo=${encodeURIComponent(motivo)}`);
    }
    return res;
  }, [ehGarcom, slug]);

  // ── Dados ────────────────────────────────────────────────────────────────
  const [mesas, setMesas] = useState<Mesa[]>([]);
  const [andares, setAndares] = useState<AndarDaMesa[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [caixaAberto, setCaixaAberto] = useState<boolean | null>(null);
  const [cardapio, setCardapio] = useState<ItemDaMesa[]>([]);
  const [categorias, setCategorias] = useState<string[]>([]);
  const [garcons, setGarcons] = useState<{ id: string; name: string }[]>([]);

  // ── Navegação ────────────────────────────────────────────────────────────
  const [tela, setTela] = useState<Tela>("mesas");
  const [mesaId, setMesaId] = useState<string | null>(null);
  const mesa = useMemo(() => mesas.find((m) => m.id === mesaId) || null, [mesas, mesaId]);
  const sessionId = mesa?.openSession?.id || null;
  const [detalhe, setDetalhe] = useState<DetalheDaMesa | null>(null);
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);

  // ── Grade de mesas ───────────────────────────────────────────────────────
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const [mostrarTotais, setMostrarTotais] = useState(true);
  const [, setTique] = useState(0);

  // ── Abrir mesa ───────────────────────────────────────────────────────────
  const [abrindo, setAbrindo] = useState<Mesa | null>(null);
  const [nomeCliente, setNomeCliente] = useState("");
  const [obsMesa, setObsMesa] = useState("");
  const [garcomEscolhido, setGarcomEscolhido] = useState(garcom?.id || "");
  const [ocupado, setOcupado] = useState(false);

  // ── Lançar ───────────────────────────────────────────────────────────────
  const [carrinho, setCarrinho] = useState<LinhaDoCarrinho[]>([]);
  const [categoria, setCategoria] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [pessoaAtiva, setPessoaAtiva] = useState<string | null>(null);
  const [escolhendoPessoa, setEscolhendoPessoa] = useState(false);
  const [novaPessoa, setNovaPessoa] = useState("");
  const [ultimaLinha, setUltimaLinha] = useState<string | null>(null);
  const [comboAberto, setComboAberto] = useState<ItemDaMesa | null>(null);
  const [obsDaLinha, setObsDaLinha] = useState<{ uid: string; texto: string } | null>(null);
  const [descartar, setDescartar] = useState(false);
  const relogioUltima = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Itens já lançados ────────────────────────────────────────────────────
  const [itemLancado, setItemLancado] = useState<{
    orderId: string; itemId: string; nome: string; atual: number; novo: number; ultimoDoPedido: boolean;
  } | null>(null);
  const [mexendo, setMexendo] = useState(false);
  const [imprimindo, setImprimindo] = useState(false);
  /** "Selecionar itens para impressão" aberto (components/mesas/SelecionarItensParaImpressao). */
  const [selecionandoImpressao, setSelecionandoImpressao] = useState(false);

  // ── Mudar de mesa ────────────────────────────────────────────────────────
  const [mudandoMesa, setMudandoMesa] = useState(false);
  const [destinoMesa, setDestinoMesa] = useState<Mesa | null>(null);
  /** Quando a conta trocou de mesa por ESTE aparelho (ver o efeito abaixo). */
  const trocouDeMesaEm = useRef(0);

  // ── Carregamento ─────────────────────────────────────────────────────────
  const carregarMesas = useCallback(async () => {
    try {
      const res = await chamar("/api/store/tables");
      if (res.ok) {
        const data = await res.json();
        setMesas((data.tables || []).filter((m: Mesa) => m.isActive !== false));
        if (Array.isArray(data.andares)) setAndares(lerAndares({ andares: data.andares }));
      }
    } catch { /* o próximo ciclo tenta de novo */ } finally {
      setCarregando(false);
    }
  }, [chamar]);

  const carregarCardapio = useCallback(async () => {
    try {
      const res = await chamar(ehGarcom ? "/api/garcom/cardapio" : "/api/admin/menu-products?canal=salao");
      if (!res.ok) return;
      const data = await res.json();
      if (!Array.isArray(data)) return;
      const { itens, categorias } = montarCardapioDaMesa(data);
      setCardapio(itens);
      setCategorias(categorias.filter((c) => c !== "Todos"));
    } catch { /* tenta de novo ao abrir o cardápio */ }
  }, [chamar, ehGarcom]);

  const carregarDetalhe = useCallback(async (sid: string) => {
    try {
      const res = await chamar(`/api/store/table-sessions?sessionId=${sid}`);
      if (res.ok) setDetalhe(await res.json());
    } catch { /* fica o que já havia */ }
  }, [chamar]);

  const carregarPessoas = useCallback(async (sid: string) => {
    try {
      const res = await chamar(`/api/store/table-sessions/${sid}/guests`);
      if (res.ok) setPessoas((await res.json()).guests || []);
    } catch { /* a mesa funciona sem pessoas */ }
  }, [chamar]);

  useEffect(() => {
    carregarMesas();
    carregarCardapio();
    const relogio = setInterval(() => { carregarMesas(); setTique((t) => t + 1); }, 10_000);
    const aoVoltar = () => { if (document.visibilityState === "visible") carregarMesas(); };
    document.addEventListener("visibilitychange", aoVoltar);
    return () => { clearInterval(relogio); document.removeEventListener("visibilitychange", aoVoltar); };
  }, [carregarMesas, carregarCardapio]);

  useEffect(() => {
    let vivo = true;
    const conferir = () => {
      chamar("/api/store/caixa-aberto")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (vivo && d) setCaixaAberto(d.aberto === true); })
        .catch(() => {});
    };
    conferir();
    const relogio = setInterval(conferir, 30_000);
    return () => { vivo = false; clearInterval(relogio); };
  }, [chamar]);

  useEffect(() => {
    if (ehGarcom) return;
    chamar("/api/store/waiters")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => { if (Array.isArray(d)) setGarcons(d.filter((w: any) => w.active)); })
      .catch(() => {});
  }, [ehGarcom, chamar]);

  // A mesa fechou em outro aparelho enquanto o garçom olhava para ela.
  // Logo depois de mudar de mesa por aqui, uma leitura da grade que saiu
  // antes da troca ainda mostra a mesa nova livre — não é mesa fechada.
  useEffect(() => {
    if (Date.now() - trocouDeMesaEm.current < 5000) return;
    if (tela !== "mesas" && mesaId && !carregando && !mesa?.openSession) {
      setTela("mesas");
      setMesaId(null);
      avisar("info", "Esta mesa foi fechada em outro aparelho");
    }
  }, [mesa, mesaId, tela, carregando]);

  // O carrinho mora no aparelho, por mesa: aba que recarrega não perde o pedido.
  useEffect(() => {
    if (sessionId) guardarCarrinho(sessionId, carrinho);
  }, [carrinho, sessionId]);

  // O botão "voltar" do Android volta UMA etapa, em vez de sair do módulo.
  // Fora da grade há sempre uma (e só uma) entrada de guarda no histórico: o
  // voltar do aparelho consome a guarda, a tela recua uma etapa e, se ainda
  // não chegou à grade, a guarda é reposta. Ao chegar à grade pelos botões da
  // tela, a guarda sai — senão o primeiro voltar do aparelho não faria nada.
  const telaRef = useRef(tela);
  telaRef.current = tela;
  const voltarRef = useRef<() => void>(() => {});
  const guarda = useRef(false);
  useEffect(() => {
    if (tela !== "mesas" && !guarda.current) {
      history.pushState({ mesaCelular: true }, "");
      guarda.current = true;
    } else if (tela === "mesas" && guarda.current) {
      guarda.current = false;
      history.back();
    }
  }, [tela]);
  useEffect(() => {
    const aoVoltar = (e: PopStateEvent) => {
      // Ainda na guarda = quem saiu do histórico foi algo ACIMA dela (o
      // ComboModal empilha a própria entrada e a consome com history.back()
      // ao fechar). Não é o garçom voltando de tela.
      if ((e.state as any)?.mesaCelular) return;
      if (!guarda.current) return;
      guarda.current = false;
      voltarRef.current();
      setTimeout(() => {
        if (telaRef.current !== "mesas" && !guarda.current) {
          history.pushState({ mesaCelular: true }, "");
          guarda.current = true;
        }
      }, 50);
    };
    window.addEventListener("popstate", aoVoltar);
    return () => window.removeEventListener("popstate", aoVoltar);
  }, []);

  // ── Ações ────────────────────────────────────────────────────────────────
  const entrarNaMesa = (m: Mesa) => {
    if (!m.openSession) {
      setAbrindo(m);
      setNomeCliente("");
      setObsMesa("");
      setGarcomEscolhido(garcom?.id || "");
      return;
    }
    setMesaId(m.id);
    setDetalhe(null);
    setPessoas([]);
    setPessoaAtiva(null);
    setCarrinho(lerCarrinhoGuardado(m.openSession.id));
    carregarDetalhe(m.openSession.id);
    carregarPessoas(m.openSession.id);
    setTela("mesa");
  };

  const abrirMesa = async () => {
    if (!abrindo || ocupado) return;
    setOcupado(true);
    try {
      const garcomId = ehGarcom ? garcom!.id : garcomEscolhido;
      const nomeDoGarcom = ehGarcom ? garcom!.name : garcons.find((g) => g.id === garcomId)?.name || "";
      const res = await chamar("/api/store/table-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tableId: abrindo.id,
          customerName: nomeCliente,
          notes: obsMesa,
          waiterId: garcomId,
          waiterName: nomeDoGarcom,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        avisar("erro", `Não abriu a mesa ${abrindo.number}`, data?.error);
        return;
      }
      const r = await chamar("/api/store/tables");
      const lista: Mesa[] = r.ok ? ((await r.json()).tables || []) : [];
      setMesas(lista.filter((m) => m.isActive !== false));
      const aberta = lista.find((m) => m.id === abrindo.id);
      setAbrindo(null);
      if (aberta?.openSession) {
        setMesaId(aberta.id);
        setDetalhe(null);
        setPessoas([]);
        setPessoaAtiva(null);
        setCarrinho(lerCarrinhoGuardado(aberta.openSession.id));
        carregarDetalhe(aberta.openSession.id);
        // Mesa nova não tem o que mostrar: vai direto anotar o pedido.
        setCategoria(null);
        setBusca("");
        setTela("cardapio");
      }
    } catch {
      avisar("erro", "Sem conexão. A mesa não foi aberta.");
    } finally {
      setOcupado(false);
    }
  };

  /** Mesma regra da tela completa: com escolha ou observação, a linha é própria. */
  const adicionar = (item: ItemDaMesa, comboSelections?: { name: string; quantity: number }[], extra = 0, notes = "") => {
    const obs = notes.trim();
    const dono = pessoaAtiva;
    const uidNovo = `${item.id}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}-${dono || "mesa"}`;
    const linhaPropria = !!(comboSelections && comboSelections.length) || !!obs;
    const mesmaLinha = (l: LinhaDoCarrinho) => l.item.id === item.id && !l.comboSelections && !l.notes && (l.guestId || null) === dono;
    // Cada toque é um render: o carrinho da tela já é o atual. É ele que diz
    // qual linha a faixa do "último lançado" deve mostrar.
    const uidFinal = linhaPropria ? uidNovo : carrinho.find(mesmaLinha)?.uid ?? uidNovo;
    setCarrinho((antes) => {
      if (linhaPropria) {
        return [...antes, { uid: uidNovo, item, qty: 1, unitPrice: item.price + extra, comboSelections: comboSelections?.length ? comboSelections : undefined, guestId: dono, notes: obs || undefined }];
      }
      const existente = antes.find(mesmaLinha);
      if (existente) return antes.map((l) => (l.uid === existente.uid ? { ...l, qty: l.qty + 1 } : l));
      return [...antes, { uid: uidFinal, item, qty: 1, unitPrice: item.price, guestId: dono }];
    });
    vibrar();
    setUltimaLinha(uidFinal);
    if (relogioUltima.current) clearTimeout(relogioUltima.current);
    relogioUltima.current = setTimeout(() => setUltimaLinha(null), 5000);
  };

  const tocarProduto = (item: ItemDaMesa) => {
    const grupos = gruposDoProduto(item);
    if (grupos.length > 0) setComboAberto({ ...item, comboGroups: grupos });
    else adicionar(item);
  };

  const mudarQtd = (uid: string, delta: number) => {
    setCarrinho((antes) =>
      antes.flatMap((l) => (l.uid !== uid ? [l] : l.qty + delta <= 0 ? [] : [{ ...l, qty: l.qty + delta }]))
    );
    vibrar();
  };

  const enviar = async () => {
    if (!sessionId || carrinho.length === 0 || ocupado) return;
    setOcupado(true);
    try {
      const res = await chamar(`/api/store/table-sessions/${sessionId}/add-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: carrinho.map((c) => ({
            menuProductId: c.item.id,
            quantity: c.qty,
            price: c.unitPrice ?? c.item.price,
            comboSelections: c.comboSelections ? JSON.stringify(c.comboSelections) : null,
            tableGuestId: c.guestId || null,
            notes: (c.notes || "").trim() || null,
          })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        avisar("erro", "O pedido não foi enviado", data?.error);
        return;
      }
      const qtd = carrinho.reduce((s, l) => s + l.qty, 0);
      setCarrinho([]);
      guardarCarrinho(sessionId, []);
      avisar("ok", `Pedido da mesa ${mesa?.number} enviado`, `${qtd} ${qtd === 1 ? "item" : "itens"} foram para a produção.`);
      setTela("mesa");
      carregarDetalhe(sessionId);
      carregarPessoas(sessionId);
      carregarMesas();
    } catch {
      avisar("erro", "Sem conexão. O pedido continua aqui, tente enviar de novo.");
    } finally {
      setOcupado(false);
    }
  };

  const confirmarItemLancado = async (remover: boolean) => {
    if (!sessionId || !itemLancado || mexendo) return;
    setMexendo(true);
    try {
      const corpo = remover
        ? { removerItemIds: [itemLancado.itemId] }
        : { itens: [{ itemId: itemLancado.itemId, quantity: itemLancado.novo }] };
      const res = await chamar(`/api/store/table-sessions/${sessionId}/orders/${itemLancado.orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        avisar("erro", "Não deu para alterar o item", data?.error);
      } else {
        avisar("ok", remover ? `${itemLancado.nome} removido` : `${itemLancado.nome}: ${itemLancado.atual}x → ${itemLancado.novo}x`);
        setItemLancado(null);
      }
      await carregarDetalhe(sessionId);
      carregarMesas();
    } catch {
      avisar("erro", "Sem conexão. Nada foi alterado.");
    } finally {
      setMexendo(false);
    }
  };

  const imprimirConta = async () => {
    if (!sessionId || imprimindo) return;
    setImprimindo(true);
    try {
      const res = await chamar(`/api/store/table-sessions/${sessionId}/imprimir-conta`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) avisar("erro", "A conta não foi impressa", data?.error);
      else avisar("ok", "Conta enviada para a impressora do caixa", `Taxa de serviço: ${data?.taxaPct ?? "?"}%`);
    } catch {
      avisar("erro", "Sem conexão. A conta não foi impressa.");
    } finally {
      setImprimindo(false);
    }
  };

  /**
   * Leva a conta inteira para outra mesa: o cliente sentou na 5 e subiu para
   * a 60. Pedidos, pessoas e pagamentos continuam na mesma conta; só a mesa
   * muda. Antes daqui o celular mandava para a tela completa, que as
   * atendentes do Ragnar já não usam (01/10/2026).
   */
  const mudarDeMesa = async () => {
    if (!sessionId || !mesa?.openSession || !destinoMesa || ocupado) return;
    const origem = mesa;
    const destino = destinoMesa;
    setOcupado(true);
    try {
      const res = await chamar(`/api/store/table-sessions/${sessionId}/transferir`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toTableId: destino.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        avisar("erro", `A conta não foi para a mesa ${destino.number}`, data?.error);
        carregarMesas();
        return;
      }
      // A grade muda aqui mesmo, junto com a mesa aberta na tela: esperar a
      // próxima leitura deixaria a mesa antiga sem conta e a tela voltaria
      // para a grade dizendo que ela foi fechada.
      trocouDeMesaEm.current = Date.now();
      setMesas((antes) => antes.map((m) =>
        m.id === origem.id ? { ...m, openSession: null }
          : m.id === destino.id ? { ...m, openSession: origem.openSession }
            : m
      ));
      setMesaId(destino.id);
      setMudandoMesa(false);
      setDestinoMesa(null);
      avisar("ok", `Conta movida da mesa ${data.de ?? origem.number} para a mesa ${data.para ?? destino.number}`);
      carregarMesas();
      carregarDetalhe(sessionId);
    } catch {
      avisar("erro", "Sem conexão. A conta continua na mesma mesa.");
    } finally {
      setOcupado(false);
    }
  };

  const adicionarPessoa = async () => {
    const nome = novaPessoa.trim();
    if (!sessionId || !nome) return;
    const res = await chamar(`/api/store/table-sessions/${sessionId}/guests`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: nome }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return avisar("erro", "Não deu para adicionar a pessoa", data?.error);
    setNovaPessoa("");
    await carregarPessoas(sessionId);
    if (data?.guest?.id) setPessoaAtiva(data.guest.id);
    setEscolhendoPessoa(false);
  };

  function voltar() {
    if (comboAberto) return setComboAberto(null);
    if (tela === "revisar") return setTela("cardapio");
    if (tela === "cardapio") {
      if (categoria || busca) { setCategoria(null); setBusca(""); return; }
      return setTela("mesa");
    }
    if (tela === "mesa") {
      if (carrinho.length > 0) return setDescartar(true);
      setTela("mesas");
      setMesaId(null);
    }
  }

  voltarRef.current = voltar;

  const sair = async () => {
    try { await fetch("/api/garcom/logout", { method: "POST" }); } catch { /* sai mesmo assim */ }
    window.location.assign(`/garcom/${encodeURIComponent(slug)}?tela=celular`);
  };

  // ── Derivados ────────────────────────────────────────────────────────────
  const minhasId = garcom?.id || null;
  const faixas = useMemo(() => andares.map((a) => ({ id: a.id, nome: a.nome, numeros: numerosDaFaixa(a.mesas) })), [andares]);
  const mesasFiltradas = useMemo(() => {
    const lista = [...mesas].sort((a, b) => a.number - b.number);
    if (filtro === "livres") return lista.filter((m) => !m.openSession);
    if (filtro === "ocupadas") return lista.filter((m) => m.openSession);
    if (filtro === "minhas") return lista.filter((m) => m.openSession?.waiterId && m.openSession.waiterId === minhasId);
    if (filtro.startsWith("andar:")) {
      const f = faixas.find((x) => x.id === filtro.slice(6));
      return f ? lista.filter((m) => f.numeros.has(m.number)) : lista;
    }
    return lista;
  }, [mesas, filtro, faixas, minhasId]);
  const ocupadas = mesas.filter((m) => m.openSession).length;

  /** Mesas livres para onde a conta pode ir, separadas por andar quando a loja tem. */
  const destinosPorAndar = useMemo(() => {
    const livres = mesas.filter((m) => !m.openSession && m.id !== mesaId).sort((a, b) => a.number - b.number);
    if (faixas.length === 0) return [{ nome: "", lista: livres }];
    const usadas = new Set<string>();
    const grupos = faixas.map((f) => {
      const lista = livres.filter((m) => f.numeros.has(m.number) && !usadas.has(m.id));
      lista.forEach((m) => usadas.add(m.id));
      return { nome: f.nome, lista };
    });
    const resto = livres.filter((m) => !usadas.has(m.id));
    if (resto.length) grupos.push({ nome: "Outras", lista: resto });
    return grupos.filter((g) => g.lista.length > 0);
  }, [mesas, mesaId, faixas]);

  const qtdNoCarrinho = carrinho.reduce((s, l) => s + l.qty, 0);
  const totalDoCarrinho = carrinho.reduce((s, l) => s + l.unitPrice * l.qty, 0);
  const qtdPorProduto = useMemo(() => {
    const m: Record<string, number> = {};
    for (const l of carrinho) m[l.item.id] = (m[l.item.id] || 0) + l.qty;
    return m;
  }, [carrinho]);

  const produtosVisiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (termo) return cardapio.filter((p) => p.name.toLowerCase().includes(termo) || (p.category || "").toLowerCase().includes(termo));
    if (!categoria) return [];
    if (categoria === "Combos" && !cardapio.some((p) => p.category === "Combos")) return cardapio.filter((p) => p.isCombo);
    return cardapio.filter((p) => (p.category || "Outros") === categoria);
  }, [cardapio, categoria, busca]);

  const contagemPorCategoria = useMemo(() => {
    const m: Record<string, number> = {};
    for (const p of cardapio) m[p.category || "Outros"] = (m[p.category || "Outros"] || 0) + 1;
    m["Combos"] = m["Combos"] ?? cardapio.filter((p) => p.isCombo).length;
    return m;
  }, [cardapio]);

  const linhaUltima = carrinho.find((l) => l.uid === ultimaLinha) || null;
  const nomeDaPessoa = (id: string | null) => (id ? pessoas.find((p) => p.id === id)?.name || "Pessoa" : "Mesa toda");

  const itensLancados = useMemo(
    () => (detalhe?.orders || []).filter((o) => o.status !== "CANCELADO" && o.status !== "CANCELED" && o.status !== "CANCELLED"),
    [detalhe]
  );

  // ── Desenho ──────────────────────────────────────────────────────────────
  const topo = (titulo: string, sub?: string, comVoltar = true, direita?: React.ReactNode, abaixo?: React.ReactNode) => (
    <header className="mc-topo">
      <div className="mc-topo-linha">
        {comVoltar && (
          <button className="mc-icone" onClick={voltar} aria-label="Voltar"><ArrowLeft size={20} /></button>
        )}
        <div className="mc-titulo">
          <strong>{titulo}</strong>
          {sub && <span>{sub}</span>}
        </div>
        {direita}
      </div>
      {abaixo}
    </header>
  );

  const modalDeCombo = comboAberto ? (
    <ComboModal
      product={comboAberto as any}
      onClose={() => setComboAberto(null)}
      onConfirm={(selections, extraSum, qty, notes) => {
        const lista: { name: string; quantity: number }[] = [];
        for (const porGrupo of Object.values(selections || {})) {
          for (const [nome, quantidade] of Object.entries((porGrupo || {}) as Record<string, number>)) {
            if (Number(quantidade) > 0) lista.push({ name: nome, quantity: Number(quantidade) });
          }
        }
        for (let i = 0; i < Math.max(1, qty || 1); i++) adicionar(comboAberto, lista, extraSum, notes || "");
        setComboAberto(null);
      }}
    />
  ) : null;

  if (carregando) {
    return (
      <div className="mc" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <style>{CSS}</style>
        <p style={{ color: "#64748B" }}>Carregando mesas...</p>
      </div>
    );
  }

  return (
    <div className="mc">
      <style>{CSS}</style>
      <AvisoNoTopo aviso={aviso} onFechar={fecharAviso} />
      {/* Só na tela da mesa: o voltar do Android troca a tela e a seleção some junto. */}
      {selecionandoImpressao && tela === "mesa" && sessionId && detalhe && (
        <SelecionarItensParaImpressao
          sessionId={sessionId}
          pedidos={detalhe.orders}
          chamar={chamar}
          nomeDaPessoa={(id) => nomeDaPessoa(id)}
          onFechar={() => setSelecionandoImpressao(false)}
          onAviso={setAviso}
        />
      )}

      {/* ═══ MESAS ═══ */}
      {tela === "mesas" && (
        <>
          {topo(
            "Mesas",
            `${ocupadas} ocupada${ocupadas === 1 ? "" : "s"} · ${mesas.length - ocupadas} livre${mesas.length - ocupadas === 1 ? "" : "s"}${garcom ? ` · ${garcom.name}` : ""}`,
            false,
            <>
              <button className="mc-icone" onClick={() => { carregarMesas(); avisar("info", "Mesas atualizadas"); }} aria-label="Atualizar"><RefreshCw size={18} /></button>
              <a className="mc-icone" href={enderecoCompleto} aria-label="Versão completa" title="Versão completa (tablet e computador)"><Monitor size={18} /></a>
              {ehGarcom && <button className="mc-icone" onClick={sair} aria-label="Sair"><LogOut size={18} /></button>}
            </>
          )}
          <main className="mc-corpo">
            {caixaAberto === false && (
              <div className="mc-cartao" style={{ background: "#FFFBEB", borderColor: "#FCD34D", color: "#92400E", fontSize: 14 }}>
                <strong>Caixa fechado.</strong> Abra o caixa para lançar pedidos.
                {!ehGarcom && <> <a href={caminhoParaAbrirOCaixa("/store/mesas/celular")} style={{ color: "#92400E", fontWeight: 800 }}>Abrir caixa</a></>}
              </div>
            )}
            <div className="mc-chips" role="toolbar" aria-label="Filtrar mesas">
              {([
                ["todas", `Todas ${mesas.length}`],
                ["livres", `Livres ${mesas.length - ocupadas}`],
                ["ocupadas", `Ocupadas ${ocupadas}`],
                ...(ehGarcom ? [["minhas", "Minhas"]] : []),
                ...faixas.map((f) => [`andar:${f.id}`, f.nome]),
              ] as [Filtro, string][]).map(([valor, rotulo]) => (
                <button key={valor} className="mc-chip" aria-pressed={filtro === valor} onClick={() => setFiltro(valor)}>
                  {rotulo}
                </button>
              ))}
              <button className="mc-chip" aria-pressed={mostrarTotais} onClick={() => setMostrarTotais((v) => !v)}>
                {mostrarTotais ? "Com total" : "Sem total"}
              </button>
            </div>

            {mesasFiltradas.length === 0 ? (
              <p className="mc-vazio">
                {mesas.length === 0 ? "Nenhuma mesa cadastrada. O cadastro é feito no painel, em Mesas." : "Nenhuma mesa neste filtro."}
              </p>
            ) : (
              <div className="mc-grade-mesas">
                {mesasFiltradas.map((m) => {
                  const s = m.openSession;
                  const minha = !!(s && minhasId && s.waiterId === minhasId);
                  return (
                    <button
                      key={m.id}
                      className={`mc-mesa${s ? " ocupada" : ""}${minha ? " minha" : ""}`}
                      onClick={() => entrarNaMesa(m)}
                      aria-label={`Mesa ${m.number}${s ? `, ocupada${s.customerName ? `, ${s.customerName}` : ""}${s.waiterName ? `, garçom ${s.waiterName}` : ""}, ${fmt(s.totalAmount)}` : ", livre"}`}
                    >
                      <b>{String(m.number).padStart(2, "0")}</b>
                      {s ? (
                        <>
                          {/* Cliente e garçom à vista, como no cartão da versão
                              completa (Ragnar, 03/10/2026): antes o nome só
                              aparecia no "Sem total" e o garçom nunca. */}
                          {s.customerName && <small className="mc-mesa-cliente">{s.customerName}</small>}
                          {s.waiterName && <small>👤 {s.waiterName}</small>}
                          {/* O quadrado tem ~100 px no celular: cabem 3 linhas
                              pequenas. Com cliente E garçom, o tempo fica de fora. */}
                          {mostrarTotais ? (
                            <>
                              <small style={{ fontWeight: 700, fontSize: 12 }}>{fmt(s.totalAmount)}</small>
                              {!(s.customerName && s.waiterName) && <small>{tempoDesde(s.openedAt)}</small>}
                            </>
                          ) : (
                            !s.customerName && !s.waiterName && <small>ocupada</small>
                          )}
                        </>
                      ) : (
                        <small>{m.label || "livre"}</small>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </main>
        </>
      )}

      {/* ═══ MESA ═══ */}
      {tela === "mesa" && mesa?.openSession && (
        <>
          {topo(
            `Mesa ${mesa.number}${mesa.openSession.customerName ? ` · ${mesa.openSession.customerName}` : ""}`,
            `${tempoDesde(mesa.openSession.openedAt)} aberta${mesa.openSession.waiterName ? ` · ${mesa.openSession.waiterName}` : ""}`
          )}
          <main className="mc-corpo">
            <div className="mc-cartao" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontSize: 13, color: "#64748B", fontWeight: 600 }}>Consumo até agora</div>
                <div style={{ fontSize: 28, fontWeight: 900 }}>{fmt(mesa.openSession.totalAmount)}</div>
              </div>
              <button className="mc-btn secundario" onClick={imprimirConta} disabled={imprimindo || mesa.openSession.totalAmount <= 0}>
                <Printer size={18} /> {imprimindo ? "..." : "Conta"}
              </button>
            </div>

            {mesa.openSession.notes && (
              <div className="mc-cartao" style={{ background: "#FFFBEB", borderColor: "#FDE68A", fontSize: 14 }}>
                📝 {mesa.openSession.notes}
              </div>
            )}

            {carrinho.length > 0 && (
              <button className="mc-cartao" onClick={() => setTela("revisar")}
                style={{ width: "100%", textAlign: "left", background: "#F0FDFA", borderColor: "#5EEAD4", cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ flex: 1, fontSize: 14 }}>
                  <strong>{qtdNoCarrinho} {qtdNoCarrinho === 1 ? "item ainda não enviado" : "itens ainda não enviados"}</strong>
                  <br /><span style={{ color: "#0F766E" }}>Toque para revisar e enviar</span>
                </span>
                <ChevronRight size={20} color="#0F766E" />
              </button>
            )}

            {!detalhe ? (
              <p className="mc-vazio">Carregando pedidos...</p>
            ) : itensLancados.length === 0 ? (
              <p className="mc-vazio">Nada lançado nesta mesa ainda.</p>
            ) : (
              <>
              {/* Imprimir (ou reimprimir) só os itens marcados: a mesma tela do tablet. */}
              <button className="mc-btn secundario" style={{ width: "100%", marginBottom: 8 }} onClick={() => setSelecionandoImpressao(true)}>
                <Printer size={18} /> Selecionar itens para impressão
              </button>
              <p style={{ margin: "4px 2px 8px", fontSize: 12, color: "#64748B" }}>Toque num item para mudar a quantidade ou remover.</p>
              {itensLancados.map((o) => (
                <div key={o.id} className="mc-cartao" style={{ padding: 0, overflow: "hidden" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 12px", background: "#F8FAFC", fontSize: 13, color: "#64748B", fontWeight: 600 }}>
                    <span>Pedido {o.dailyOrderNumber ? `#${o.dailyOrderNumber}` : ""} · {new Date(o.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
                    <span>{fmt(o.totalAmount)}</span>
                  </div>
                  {o.items.map((it) => {
                    const combo = resumoDoCombo(it.comboSelections);
                    return (
                      <button
                        key={it.id}
                        onClick={() => setItemLancado({
                          orderId: o.id, itemId: it.id, nome: it.menuProduct?.name || "Item",
                          atual: it.quantity, novo: it.quantity, ultimoDoPedido: o.items.length === 1,
                        })}
                        style={{ width: "100%", display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 12px", border: "none", borderTop: "1px solid #F1F5F9", background: "#fff", textAlign: "left", cursor: "pointer", color: "#0F172A" }}
                      >
                        <span style={{ fontWeight: 800, minWidth: 28 }}>{it.quantity}x</span>
                        <span style={{ flex: 1, minWidth: 0, fontSize: 15 }}>
                          {it.menuProduct?.name}
                          {it.tableGuestId && <span style={{ fontSize: 12, color: "#7C3AED", fontWeight: 700 }}> · {nomeDaPessoa(it.tableGuestId)}</span>}
                          {combo && <span style={{ display: "block", fontSize: 12, color: "#64748B" }}>{combo}</span>}
                          {it.notes && <span style={{ display: "block", fontSize: 12, color: "#B45309" }}>Obs.: {it.notes}</span>}
                        </span>
                        <span style={{ fontWeight: 700, fontSize: 14 }}>{fmt(it.price * it.quantity)}</span>
                      </button>
                    );
                  })}
                </div>
              ))}
              </>
            )}

            <button className="mc-btn secundario" style={{ width: "100%", marginTop: 4 }}
              onClick={() => { setDestinoMesa(null); setMudandoMesa(true); carregarMesas(); }}>
              <ArrowLeftRight size={18} /> Mudar de mesa
            </button>

            <a href={enderecoCompleto} style={{ display: "block", textAlign: "center", color: "#64748B", fontSize: 13, padding: "8px 0" }}>
              Fechar conta ou dividir: versão completa
            </a>
          </main>
          <div className="mc-barra">
            <button className="mc-btn secundario" onClick={voltar}><ArrowLeft size={18} /> Mesas</button>
            <button className="mc-btn marca" onClick={() => { setCategoria(null); setBusca(""); setTela("cardapio"); }}>
              <Plus size={20} /> Lançar itens
            </button>
          </div>
        </>
      )}

      {/* ═══ CARDÁPIO ═══ */}
      {tela === "cardapio" && mesa?.openSession && (
        <>
          {topo(
            `Mesa ${mesa.number} · ${busca.trim() ? "Busca" : categoria || "Cardápio"}`,
            `Lançando para: ${nomeDaPessoa(pessoaAtiva)}`,
            true,
            <button className="mc-icone" onClick={() => setEscolhendoPessoa(true)} aria-label="Para quem é o item"><Users size={18} /></button>,
            <div className="mc-busca">
              <Search size={18} color="#64748B" />
              <input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar em todo o cardápio"
                enterKeyHint="search"
                aria-label="Buscar produto"
              />
              {busca && <button onClick={() => setBusca("")} aria-label="Limpar busca" style={{ border: "none", background: "none", padding: 4, color: "#64748B" }}><X size={18} /></button>}
            </div>
          )}
          <main className="mc-corpo">
            {categoria && !busca.trim() && (
              <div className="mc-chips" role="toolbar" aria-label="Categorias">
                {categorias.map((c) => (
                  <button key={c} className="mc-chip" aria-pressed={c === categoria} onClick={() => setCategoria(c)}>{c}</button>
                ))}
              </div>
            )}

            {!categoria && !busca.trim() ? (
              cardapio.length === 0 ? (
                <p className="mc-vazio">Carregando o cardápio...</p>
              ) : (
                <div className="mc-grade">
                  {categorias.map((c) => (
                    <button key={c} className="mc-cat" onClick={() => setCategoria(c)}>
                      {c}
                      <span>{contagemPorCategoria[c] || 0} {contagemPorCategoria[c] === 1 ? "item" : "itens"}</span>
                    </button>
                  ))}
                </div>
              )
            ) : produtosVisiveis.length === 0 ? (
              <p className="mc-vazio">Nada encontrado{busca.trim() ? ` para "${busca.trim()}"` : ""}.</p>
            ) : (
              <div className="mc-grade">
                {produtosVisiveis.map((p) => {
                  const qtd = qtdPorProduto[p.id] || 0;
                  const temEscolha = gruposDoProduto(p).length > 0;
                  return (
                    <button key={p.id} className={`mc-prod${qtd ? " no-pedido" : ""}`} onClick={() => tocarProduto(p)}>
                      {qtd > 0 && <span className="mc-prod-qtd">{qtd}</span>}
                      <span className="mc-prod-nome">{p.name}</span>
                      <span style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 6 }}>
                        <span className="mc-prod-preco">{temEscolha && p.price <= 0 ? "Escolher" : fmt(p.price)}</span>
                        {temEscolha && <span className="mc-prod-tag">opções</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </main>

          {linhaUltima && (
            <div className="mc-ultimo" role="status">
              <Check size={18} color="#5EEAD4" />
              <span className="mc-ultimo-nome">{linhaUltima.qty}x {linhaUltima.item.name}</span>
              <button onClick={() => mudarQtd(linhaUltima.uid, -1)} aria-label="Tirar um"><Minus size={18} /></button>
              <button onClick={() => mudarQtd(linhaUltima.uid, 1)} aria-label="Mais um"><Plus size={18} /></button>
              <button onClick={() => setObsDaLinha({ uid: linhaUltima.uid, texto: linhaUltima.notes || "" })} aria-label="Observação"><StickyNote size={18} /></button>
            </div>
          )}

          <div className="mc-barra">
            <button className="mc-btn secundario" onClick={voltar}><ArrowLeft size={18} /></button>
            <button className="mc-btn primario" disabled={qtdNoCarrinho === 0} onClick={() => setTela("revisar")}>
              {qtdNoCarrinho === 0 ? "Toque nos produtos para lançar" : <>Revisar {qtdNoCarrinho} {qtdNoCarrinho === 1 ? "item" : "itens"} · {fmt(totalDoCarrinho)} <ChevronRight size={18} /></>}
            </button>
          </div>
        </>
      )}

      {/* ═══ REVISAR ═══ */}
      {tela === "revisar" && mesa?.openSession && (
        <>
          {topo(`Revisar · Mesa ${mesa.number}`, "Confira antes de mandar para a produção")}
          <main className="mc-corpo">
            {carrinho.length === 0 ? (
              <p className="mc-vazio">Nenhum item para enviar.</p>
            ) : (
              carrinho.map((l) => {
                const combo = resumoDoCombo(l.comboSelections);
                return (
                  <div key={l.uid} className="mc-cartao">
                    <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 800, fontSize: 15 }}>{l.item.name}</div>
                        {combo && <div style={{ fontSize: 12, color: "#64748B", marginTop: 2 }}>{combo}</div>}
                        {(pessoas.length > 0 || l.guestId) && (
                          <div style={{ fontSize: 12, color: "#7C3AED", fontWeight: 700, marginTop: 2 }}>
                            <User size={11} style={{ verticalAlign: -1 }} /> {nomeDaPessoa(l.guestId)}
                          </div>
                        )}
                      </div>
                      <div style={{ fontWeight: 800, fontSize: 15, whiteSpace: "nowrap" }}>{fmt(l.unitPrice * l.qty)}</div>
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
                      <div className="mc-passo">
                        <button onClick={() => mudarQtd(l.uid, -1)} aria-label="Tirar um">{l.qty === 1 ? <Trash2 size={17} color="#B91C1C" /> : <Minus size={18} />}</button>
                        <span>{l.qty}</span>
                        <button onClick={() => mudarQtd(l.uid, 1)} aria-label="Mais um"><Plus size={18} /></button>
                      </div>
                      <button
                        onClick={() => setObsDaLinha({ uid: l.uid, texto: l.notes || "" })}
                        style={{ flex: 1, minHeight: 44, borderRadius: 12, border: "1.5px dashed #CBD5E1", background: l.notes ? "#FFFBEB" : "#fff", color: l.notes ? "#92400E" : "#64748B", fontSize: 14, textAlign: "left", padding: "0 12px", cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                      >
                        {l.notes ? `Obs.: ${l.notes}` : "+ Observação"}
                      </button>
                    </div>
                  </div>
                );
              })
            )}
            <button className="mc-btn secundario" style={{ width: "100%" }} onClick={() => setTela("cardapio")}>
              <Plus size={18} /> Adicionar mais itens
            </button>
          </main>
          <div className="mc-barra">
            <button className="mc-btn primario" disabled={carrinho.length === 0 || ocupado} onClick={enviar}>
              <Check size={20} /> {ocupado ? "Enviando..." : `Enviar · ${fmt(totalDoCarrinho)}`}
            </button>
          </div>
        </>
      )}

      {modalDeCombo}

      {/* ── Abrir mesa ── */}
      <Folha aberta={!!abrindo} onFechar={() => setAbrindo(null)}>
        {abrindo && (
          <>
            <h3>Abrir mesa {abrindo.number}</h3>
            <p style={{ margin: 0, color: "#64748B", fontSize: 14 }}>Os dois campos são opcionais.</p>
            <label className="mc-rotulo" htmlFor="mc-cliente">Nome do cliente</label>
            <input id="mc-cliente" className="mc-campo" value={nomeCliente} onChange={(e) => setNomeCliente(e.target.value)} placeholder="Ex.: Juliana" autoComplete="off" />
            <label className="mc-rotulo" htmlFor="mc-obs">Observação da mesa</label>
            <input id="mc-obs" className="mc-campo" value={obsMesa} onChange={(e) => setObsMesa(e.target.value)} placeholder="Ex.: aniversário, sem glúten" autoComplete="off" />
            {!ehGarcom && garcons.length > 0 && (
              <>
                <label className="mc-rotulo" htmlFor="mc-garcom">Garçom</label>
                <select id="mc-garcom" className="mc-campo" value={garcomEscolhido} onChange={(e) => setGarcomEscolhido(e.target.value)}>
                  <option value="">Sem garçom</option>
                  {garcons.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </>
            )}
            <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
              <button className="mc-btn secundario" onClick={() => setAbrindo(null)}>Cancelar</button>
              <button className="mc-btn marca" onClick={abrirMesa} disabled={ocupado}>
                {ocupado ? "Abrindo..." : "Abrir e lançar itens"}
              </button>
            </div>
          </>
        )}
      </Folha>

      {/* ── Observação de uma linha do carrinho ── */}
      <Folha aberta={!!obsDaLinha} onFechar={() => setObsDaLinha(null)}>
        {obsDaLinha && (
          <>
            <h3>Observação</h3>
            <p style={{ margin: "0 0 10px", color: "#64748B", fontSize: 14 }}>
              {carrinho.find((l) => l.uid === obsDaLinha.uid)?.item.name}. Vale para todas as unidades desta linha.
            </p>
            <textarea
              className="mc-campo"
              rows={3}
              autoFocus
              maxLength={200}
              value={obsDaLinha.texto}
              onChange={(e) => setObsDaLinha({ ...obsDaLinha, texto: e.target.value })}
              placeholder="Ex.: sem cebola, ponto da carne bem passado"
            />
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
              {["Sem cebola", "Sem gelo", "Bem passado", "Sem molho", "Para viagem"].map((s) => (
                <button key={s} className="mc-chip" onClick={() => setObsDaLinha({ ...obsDaLinha, texto: obsDaLinha.texto ? `${obsDaLinha.texto}, ${s.toLowerCase()}` : s })}>{s}</button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <button className="mc-btn secundario" onClick={() => setObsDaLinha(null)}>Cancelar</button>
              <button
                className="mc-btn primario"
                onClick={() => {
                  const texto = obsDaLinha.texto.trim();
                  setCarrinho((antes) => antes.map((l) => (l.uid === obsDaLinha.uid ? { ...l, notes: texto || undefined } : l)));
                  setObsDaLinha(null);
                }}
              >
                Salvar
              </button>
            </div>
          </>
        )}
      </Folha>

      {/* ── Para quem é o item ── */}
      <Folha aberta={escolhendoPessoa} onFechar={() => setEscolhendoPessoa(false)}>
        <h3>Para quem é?</h3>
        <p style={{ margin: "0 0 12px", color: "#64748B", fontSize: 14 }}>Serve para dividir a conta por pessoa no fechamento.</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[{ id: null as string | null, name: "Mesa toda" }, ...pessoas].map((p) => (
            <button
              key={p.id || "mesa"}
              className="mc-btn secundario"
              style={{ justifyContent: "flex-start", background: pessoaAtiva === p.id ? "#0F172A" : "#F1F5F9", color: pessoaAtiva === p.id ? "#fff" : "#0F172A" }}
              onClick={() => { setPessoaAtiva(p.id); setEscolhendoPessoa(false); }}
            >
              {p.id ? <User size={18} /> : <Users size={18} />} {p.name}
            </button>
          ))}
        </div>
        <label className="mc-rotulo" htmlFor="mc-pessoa">Nova pessoa</label>
        <div style={{ display: "flex", gap: 8 }}>
          <input id="mc-pessoa" className="mc-campo" value={novaPessoa} onChange={(e) => setNovaPessoa(e.target.value)} placeholder="Nome" onKeyDown={(e) => { if (e.key === "Enter") adicionarPessoa(); }} />
          <button className="mc-btn marca" style={{ flex: "0 0 auto" }} onClick={adicionarPessoa} disabled={!novaPessoa.trim()}><Plus size={18} /></button>
        </div>
      </Folha>

      {/* ── Item já lançado ── */}
      <Folha aberta={!!itemLancado} onFechar={() => setItemLancado(null)}>
        {itemLancado && (
          <>
            <h3>{itemLancado.nome}</h3>
            <p style={{ margin: "0 0 14px", color: "#64748B", fontSize: 14 }}>Já foi para a produção. Mudar aqui altera a conta da mesa.</p>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <span style={{ fontWeight: 700 }}>Quantidade</span>
              <div className="mc-passo">
                <button onClick={() => setItemLancado({ ...itemLancado, novo: Math.max(1, itemLancado.novo - 1) })} aria-label="Menos"><Minus size={18} /></button>
                <span>{itemLancado.novo}</span>
                <button onClick={() => setItemLancado({ ...itemLancado, novo: itemLancado.novo + 1 })} aria-label="Mais"><Plus size={18} /></button>
              </div>
            </div>
            <button
              className="mc-btn primario"
              style={{ width: "100%", marginTop: 16 }}
              disabled={mexendo || itemLancado.novo === itemLancado.atual}
              onClick={() => confirmarItemLancado(false)}
            >
              {mexendo ? "Salvando..." : `Mudar para ${itemLancado.novo}x`}
            </button>
            <button className="mc-btn perigo" style={{ width: "100%", marginTop: 10 }} disabled={mexendo} onClick={() => confirmarItemLancado(true)}>
              <Trash2 size={18} /> {itemLancado.ultimoDoPedido ? "Remover (cancela o pedido inteiro)" : "Remover item"}
            </button>
          </>
        )}
      </Folha>

      {/* ── Mudar de mesa ── */}
      <Folha aberta={mudandoMesa && !!mesa?.openSession} onFechar={() => { if (!ocupado) { setMudandoMesa(false); setDestinoMesa(null); } }}>
        <h3>Mudar a mesa {mesa?.number} para…</h3>
        <p style={{ margin: "0 0 4px", color: "#64748B", fontSize: 14 }}>
          A conta vai inteira, com os pedidos e as pessoas. Só aparecem as mesas livres.
        </p>
        {destinosPorAndar.length === 0 ? (
          <p className="mc-vazio">Nenhuma mesa livre agora.</p>
        ) : (
          destinosPorAndar.map((g) => (
            <div key={g.nome || "todas"}>
              {g.nome && <span className="mc-rotulo">{g.nome}</span>}
              <div className="mc-grade-mesas" style={{ marginTop: g.nome ? 0 : 12 }}>
                {g.lista.map((m) => (
                  <button key={m.id} className="mc-mesa" aria-pressed={destinoMesa?.id === m.id}
                    onClick={() => setDestinoMesa(m)} aria-label={`Mesa ${m.number}`}>
                    <b>{String(m.number).padStart(2, "0")}</b>
                    <small>{m.label || "livre"}</small>
                  </button>
                ))}
              </div>
            </div>
          ))
        )}
        <button className="mc-btn primario" style={{ width: "100%", marginTop: 16 }} disabled={!destinoMesa || ocupado} onClick={mudarDeMesa}>
          {ocupado ? "Mudando..." : destinoMesa ? `Levar a conta para a mesa ${destinoMesa.number}` : "Escolha a mesa nova"}
        </button>
      </Folha>

      {/* ── Sair da mesa com itens não enviados ── */}
      <Folha aberta={descartar} onFechar={() => setDescartar(false)}>
        <h3>Itens ainda não enviados</h3>
        <p style={{ margin: "0 0 16px", color: "#64748B", fontSize: 14 }}>
          {qtdNoCarrinho} {qtdNoCarrinho === 1 ? "item ficou" : "itens ficaram"} sem enviar. Eles continuam guardados neste aparelho para esta mesa.
        </p>
        <button className="mc-btn primario" style={{ width: "100%" }} onClick={() => { setDescartar(false); setTela("revisar"); }}>
          Revisar e enviar
        </button>
        <button className="mc-btn secundario" style={{ width: "100%", marginTop: 10 }} onClick={() => { setDescartar(false); setTela("mesas"); setMesaId(null); }}>
          Guardar e voltar às mesas
        </button>
        <button className="mc-btn perigo" style={{ width: "100%", marginTop: 10 }} onClick={() => { if (sessionId) guardarCarrinho(sessionId, []); setCarrinho([]); setDescartar(false); setTela("mesas"); setMesaId(null); }}>
          <Trash2 size={18} /> Descartar os itens
        </button>
      </Folha>
    </div>
  );
}
