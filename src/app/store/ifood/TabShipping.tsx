"use client";
/**
 * Aba Shipping — entregador do iFood para o pedido do canal próprio da loja
 * (salesChannel=POS). Os quatro cenários do checklist do iFood:
 *
 *   1. pedido Sob Demanda (DELIVERY / IMMEDIATE / POS) registrado e acompanhado;
 *   2. cotação → registro → validar dados de entrega e confirmar → alteração de
 *      endereço até 500 m aceita (1º pedido) ou recusada (2º pedido);
 *   3. cancelamento com a lista de motivos vinda do iFood, escolhida na hora;
 *   4. código de coleta: presente no pedido e conferido no validatePickupCode.
 *
 * O pedido de alteração de endereço é registrado por esta tela em nome do
 * cliente — é a "Opção B" da documentação (integração sem a página de rastreio
 * do iFood: o cliente pede pela loja e o sistema chama o endpoint).
 *
 * Lista à esquerda, ações no meio, chamadas ao iFood (com o status HTTP) à
 * direita — o mesmo desenho da aba Entrega.
 */
import React, { useEffect, useMemo, useState } from "react";
import {
  Loader, RefreshCw, Truck, MapPin, Check, X, Ban, KeyRound, Search, Send, ExternalLink, ShieldCheck,
} from "lucide-react";

const LARANJA = "#E8360C";
const VERDE = "#0F766E";
const TINTA = "#0F172A";
const CINZA = "#64748B";
const LINHA = "#E2E8F0";

const agora = () => new Date().toLocaleTimeString("pt-BR");
const corDoStatus = (s: number) => (s >= 200 && s < 300 ? VERDE : s >= 400 && s < 500 ? "#B45309" : "#C92E09");
const reais = (n: any) => `R$ ${Number(n ?? 0).toFixed(2).replace(".", ",")}`;
const hora = (s?: string) => (s ? new Date(s).toLocaleTimeString("pt-BR") : "");

const NOME_STATUS: Record<string, string> = {
  REGISTRADO: "Registrado", CONFIRMADO: "Confirmado", EM_ROTA: "Em rota",
  CONCLUIDO: "Concluído", CANCELADO: "Cancelado",
};
const NOME_EVENTO: Record<string, string> = {
  PLACED: "Pedido recebido pelo iFood",
  CONFIRMED: "Pedido confirmado",
  DISPATCHED: "Saiu para entrega",
  CONCLUDED: "Pedido concluído",
  CANCELLED: "Pedido cancelado",
  CANCELLATION_REQUESTED: "Cancelamento solicitado",
  CANCELLATION_REQUEST_FAILED: "Cancelamento recusado",
  DELIVERY_ADDRESS_CHANGE_REQUESTED: "Cliente pediu outro endereço",
  DELIVERY_ADDRESS_CHANGE_ACCEPTED: "Alteração de endereço aceita",
  DELIVERY_ADDRESS_CHANGE_DENIED: "Alteração de endereço recusada",
  DELIVERY_ADDRESS_CHANGE_USER_CONFIRMED: "Endereço confirmado pelo cliente",
  DELIVERY_PICKUP_CODE_REQUESTED: "Entregador pediu o código de coleta",
  DELIVERY_DROP_CODE_REQUESTED: "Pedido exige código de entrega",
  ASSIGN_DRIVER: "Entregador alocado",
  GOING_TO_ORIGIN: "Entregador indo para a loja",
  ARRIVED_AT_ORIGIN: "Entregador chegou na loja",
  DELIVERY_IN_TRANSIT: "Entregador a caminho do cliente",
  ARRIVED_AT_DESTINATION: "Entregador chegou no cliente",
  DELIVERY_CONCLUDED: "Entrega concluída",
  DELIVERY_CANCELLED: "Entrega cancelada",
};

// Endereço de entrega perto da loja de teste (Ramal Bujari, 122 — Bujari/AC).
const NOVO_PEDIDO = {
  cliente: { nome: "Maria Teste", ddd: "22", numero: "998851680" },
  endereco: {
    postalCode: "69923000", streetName: "Ramal Bujari", streetNumber: "150", complement: "Casa",
    reference: "", neighborhood: "Bujari", city: "Bujari", state: "AC", country: "BR",
    latitude: -9.824, longitude: -67.947,
  },
  itens: [{ nome: "Produto Teste", quantidade: 1, precoUnitario: 30 }],
  pagamento: { metodo: "CASH", trocoPara: 50, bandeira: "VISA" } as any,
  preparoMin: 0,
};

function distancia(a: any, b: any) {
  const R = 6_371_000, rad = (g: number) => (g * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude), dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

export default function TabShipping() {
  const [pedidos, setPedidos] = useState<any[]>([]);
  const [sel, setSel] = useState<any>(null);
  const [detalhe, setDetalhe] = useState<any>(null);
  const [carregando, setCarregando] = useState(false);
  const [ocupado, setOcupado] = useState<string>("");
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [chamadas, setChamadas] = useState<any[]>([]);

  const [novo, setNovo] = useState<any>(NOVO_PEDIDO);
  const [cotacao, setCotacao] = useState<any>(null);
  const [mostrarNovo, setMostrarNovo] = useState(true);

  const [troca, setTroca] = useState<any>(null);
  const [motivos, setMotivos] = useState<any[] | null>(null);
  const [motivoSel, setMotivoSel] = useState("");
  const [motivoTexto, setMotivoTexto] = useState("");
  const [codigoColeta, setCodigoColeta] = useState("");
  const [resColeta, setResColeta] = useState<null | { ok: boolean; texto: string }>(null);
  const [extra, setExtra] = useState<{ rastreio?: any; confianca?: any }>({});

  const registrar = (c: any) => setChamadas((a) => [{ ...c, hora: agora() }, ...a].slice(0, 50));

  async function chamar(metodo: "GET" | "POST", params: Record<string, any>) {
    setErro("");
    const url = metodo === "GET"
      ? `/api/ifood/shipping?${new URLSearchParams({ ...params, distribuido: "1" }).toString()}`
      : "/api/ifood/shipping?distribuido=1";
    const r = await fetch(url, {
      method: metodo,
      ...(metodo === "POST" ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(params) } : {}),
    });
    const d = await r.json().catch(() => ({}));
    if (d?.endpoint || d?.ifood) {
      registrar({ metodo: d?.endpoint?.split(" ")[0] ?? metodo, endpoint: d?.endpoint?.split(" ").slice(1).join(" ") ?? "", status: d?.ifood?.status ?? r.status, origem: d?.ifood?.origem });
    }
    if (!r.ok) {
      const det = d?.detalhe ? ` — ${typeof d.detalhe === "string" ? d.detalhe : JSON.stringify(d.detalhe)}` : "";
      throw new Error((d?.error || "Falha na chamada ao iFood.") + det);
    }
    return d;
  }

  async function carregarPedidos(manterSel = true) {
    setCarregando(true);
    try {
      const d = await chamar("GET", { acao: "pedidos" });
      const lista = d.pedidos ?? [];
      setPedidos(lista);
      if (manterSel && sel) {
        const atual = lista.find((p: any) => p.ifoodOrderId === sel.ifoodOrderId);
        if (atual) setSel(atual);
      }
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => { carregarPedidos(false); }, []);
  // Eventos chegam pelo polling (a cada ~30 s): a lista se atualiza sozinha.
  useEffect(() => {
    const t = setInterval(() => carregarPedidos(true), 15000);
    return () => clearInterval(t);
  });

  async function executar(nome: string, fn: () => Promise<any>) {
    setOcupado(nome);
    setAviso("");
    try { return await fn(); } catch (e: any) { setErro(e.message); } finally { setOcupado(""); }
  }

  // ── novo pedido ──
  const totalItens = useMemo(
    () => novo.itens.reduce((s: number, i: any) => s + Number(i.quantidade || 0) * Number(i.precoUnitario || 0), 0),
    [novo],
  );

  const consultar = () => executar("cotacao", async () => {
    setCotacao(null);
    const d = await chamar("GET", { acao: "cotacao", latitude: novo.endereco.latitude, longitude: novo.endereco.longitude });
    setCotacao(d.data);
  });

  const registrarPedido = () => executar("registrar", async () => {
    const taxa = Number(cotacao?.quote?.netValue ?? 0);
    const pg = novo.pagamento.metodo === "CASH"
      ? { metodo: "CASH", trocoPara: Number(novo.pagamento.trocoPara) || null }
      : { metodo: novo.pagamento.metodo, bandeira: novo.pagamento.bandeira };
    const d = await chamar("POST", {
      acao: "registrar",
      pedido: { ...novo, pagamento: pg, quoteId: cotacao?.id, taxaEntrega: taxa },
    });
    setAviso(`Pedido registrado no iFood (${reais(d.total)}). O entregador será alocado pelo iFood.`);
    setCotacao(null);
    setMostrarNovo(false);
    await carregarPedidos(false);
    const criado = { ifoodOrderId: d.data.id, trackingUrl: d.data.trackingUrl, clienteNome: novo.cliente.nome, total: d.total, eventos: [], status: "REGISTRADO", enderecoOriginal: novo.endereco };
    abrirPedido(criado);
  });

  // ── pedido escolhido ──
  async function abrirPedido(p: any) {
    setSel(p);
    setDetalhe(null);
    setTroca(null);
    setMotivos(null);
    setMotivoSel("");
    setCodigoColeta("");
    setResColeta(null);
    setExtra({});
    setAviso("");
    try {
      const d = await chamar("GET", { acao: "detalhe", orderId: p.ifoodOrderId });
      setDetalhe(d.data);
    } catch (e: any) {
      setErro(e.message);
    }
  }

  const acaoSimples = (acao: string, msg: string) => executar(acao, async () => {
    await chamar("POST", { acao, orderId: sel.ifoodOrderId });
    setAviso(msg);
    setTimeout(() => carregarPedidos(true), 4000);
  });

  const pedirTroca = () => executar("pedirTroca", async () => {
    await chamar("POST", { acao: "pedirTroca", orderId: sel.ifoodOrderId, endereco: troca, original: sel.enderecoOriginal });
    setAviso("Alteração de endereço registrada. A loja tem 15 minutos para aceitar ou recusar.");
    setTimeout(() => carregarPedidos(true), 4000);
  });

  const carregarMotivos = () => executar("motivos", async () => {
    const d = await chamar("GET", { acao: "motivos", orderId: sel.ifoodOrderId });
    setMotivos(Array.isArray(d.data) ? d.data : []);
    setMotivoSel("");
  });

  const cancelar = () => executar("cancelar", async () => {
    const m = motivos?.find((x) => x.cancelCodeId === motivoSel);
    await chamar("POST", { acao: "cancelar", orderId: sel.ifoodOrderId, codigo: motivoSel, motivo: motivoTexto || m?.description });
    setAviso("Cancelamento enviado ao iFood. A confirmação chega pelos eventos.");
    setMotivos(null);
    setTimeout(() => carregarPedidos(true), 5000);
  });

  const validarColeta = () => executar("coleta", async () => {
    setResColeta(null);
    const d = await chamar("POST", { acao: "validarColeta", orderId: sel.ifoodOrderId, codigo: codigoColeta });
    if (d.aguardandoEntregador) setResColeta({ ok: false, texto: d.mensagem });
    else {
      const ok = d?.data?.success !== false;
      setResColeta({ ok, texto: ok ? "Código de coleta conferido. Pedido retirado pelo entregador." : "Código não confere. Peça ao entregador e digite de novo." });
    }
  });

  const verExtra = (acao: "rastreio" | "confianca") => executar(acao, async () => {
    const d = await chamar("GET", { acao, orderId: sel.ifoodOrderId });
    setExtra((x) => ({ ...x, [acao]: d.data }));
  });

  // ── estilos ──
  const cartao: React.CSSProperties = { background: "#fff", border: `1.5px solid ${LINHA}`, borderRadius: 14, padding: "1.1rem 1.25rem" };
  const rotulo: React.CSSProperties = { display: "block", fontSize: "0.7rem", fontWeight: 700, color: CINZA, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 };
  const campo: React.CSSProperties = { width: "100%", padding: "8px 10px", border: `1.5px solid ${LINHA}`, borderRadius: 9, fontSize: "0.85rem", fontFamily: "inherit", color: TINTA, boxSizing: "border-box" };
  const titulo: React.CSSProperties = { margin: "0 0 0.7rem", fontSize: "0.9rem", fontWeight: 800, color: TINTA, display: "flex", alignItems: "center", gap: 7 };
  const botao = (cor: string, desab = false): React.CSSProperties => ({
    display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 14px", background: desab ? "#CBD5E1" : cor,
    color: "#fff", border: "none", borderRadius: 9, fontWeight: 800, fontSize: "0.83rem", cursor: desab ? "not-allowed" : "pointer", fontFamily: "inherit",
  });

  const setEnd = (k: string, v: any) => setNovo({ ...novo, endereco: { ...novo.endereco, [k]: v } });
  const eventos: any[] = (sel?.eventos ?? []).slice().sort((a: any, b: any) => String(a.em).localeCompare(String(b.em)));
  const cancelado = sel?.status === "CANCELADO";
  const pendente = sel?.trocaPendente;
  const ultimaTroca = [...eventos].reverse().find((e) => /^DELIVERY_ADDRESS_CHANGE_(ACCEPTED|DENIED)$/.test(e.codigo));
  const distTroca = troca && sel?.enderecoOriginal ? distancia(sel.enderecoOriginal, troca) : null;
  const pickupCode = detalhe?.delivery?.pickupCode ?? detalhe?.pickupCode ?? null;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "260px minmax(0,1fr) 270px", gap: "1.1rem", alignItems: "start" }}>
      {/* ── pedidos ── */}
      <div style={{ ...cartao, position: "sticky", top: 12 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.8rem" }}>
          <h4 style={{ margin: 0, fontSize: "0.9rem", fontWeight: 800, color: TINTA }}>Pedidos com entregador iFood</h4>
          <button onClick={() => carregarPedidos(true)} disabled={carregando}
            style={{ display: "inline-flex", padding: 6, background: "#F1F5F9", border: "none", borderRadius: 7, cursor: "pointer", color: CINZA }}>
            {carregando ? <Loader size={13} className="spin" /> : <RefreshCw size={13} />}
          </button>
        </div>
        <button onClick={() => { setMostrarNovo(true); setSel(null); }}
          style={{ ...botao(LARANJA), width: "100%", justifyContent: "center", marginBottom: 10 }}>
          <Truck size={14} /> Novo pedido do canal próprio
        </button>
        {pedidos.length === 0 ? (
          <p style={{ margin: 0, fontSize: "0.78rem", color: CINZA, lineHeight: 1.45 }}>Nenhum pedido com entregador iFood nos últimos 3 dias.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 520, overflowY: "auto" }}>
            {pedidos.map((p) => {
              const ativo = sel?.ifoodOrderId === p.ifoodOrderId;
              return (
                <button key={p.ifoodOrderId} onClick={() => { setMostrarNovo(false); abrirPedido(p); }}
                  style={{ textAlign: "left", padding: "9px 10px", borderRadius: 9, cursor: "pointer", border: `1.5px solid ${ativo ? LARANJA : LINHA}`, background: ativo ? "#FFF7F5" : "#fff", fontFamily: "inherit" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 6 }}>
                    <strong style={{ fontSize: "0.83rem", color: TINTA }}>#{p.displayId || p.ifoodOrderId.slice(0, 6)}</strong>
                    <span style={{ fontSize: "0.64rem", fontWeight: 800, color: p.status === "CANCELADO" ? "#B71C1C" : VERDE }}>{NOME_STATUS[p.status] ?? p.status}</span>
                  </div>
                  <div style={{ fontSize: "0.72rem", color: CINZA, marginTop: 2 }}>{p.clienteNome} · {reais(p.total)}</div>
                  {p.trocaPendente && <div style={{ fontSize: "0.66rem", color: LARANJA, fontWeight: 700, marginTop: 3 }}>Alteração de endereço pendente</div>}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── centro ── */}
      <div>
        {erro && <div style={{ background: "#FEF2F2", border: "1.5px solid #FECACA", color: "#B71C1C", borderRadius: 10, padding: "10px 13px", marginBottom: "1rem", fontSize: "0.84rem", wordBreak: "break-word" }}>{erro}</div>}
        {aviso && <div style={{ background: "#F0FDFA", border: "1.5px solid #99F6E4", color: VERDE, borderRadius: 10, padding: "10px 13px", marginBottom: "1rem", fontSize: "0.84rem" }}>{aviso}</div>}

        {mostrarNovo && !sel && (
          <div style={{ ...cartao, marginBottom: "1rem" }}>
            <h4 style={titulo}><Truck size={15} /> Novo pedido do canal próprio com entregador iFood</h4>
            <p style={{ margin: "0 0 0.9rem", fontSize: "0.76rem", color: CINZA, lineHeight: 1.45 }}>
              Pedido Sob Demanda: <code>orderType=DELIVERY</code>, <code>orderTiming=IMMEDIATE</code>, <code>salesChannel=POS</code>.
              Primeiro consulte a disponibilidade e o valor do entregador; depois registre.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "2fr 0.6fr 1.4fr", gap: "0.55rem", marginBottom: "0.6rem" }}>
              <div><label style={rotulo}>Cliente</label><input style={campo} value={novo.cliente.nome} onChange={(e) => setNovo({ ...novo, cliente: { ...novo.cliente, nome: e.target.value } })} /></div>
              <div><label style={rotulo}>DDD</label><input style={campo} value={novo.cliente.ddd} inputMode="numeric" onChange={(e) => setNovo({ ...novo, cliente: { ...novo.cliente, ddd: e.target.value } })} /></div>
              <div><label style={rotulo}>Celular</label><input style={campo} value={novo.cliente.numero} inputMode="numeric" onChange={(e) => setNovo({ ...novo, cliente: { ...novo.cliente, numero: e.target.value } })} /></div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "2fr 0.7fr 1fr 1fr", gap: "0.55rem", marginBottom: "0.6rem" }}>
              <div><label style={rotulo}>Rua</label><input style={campo} value={novo.endereco.streetName} onChange={(e) => setEnd("streetName", e.target.value)} /></div>
              <div><label style={rotulo}>Número</label><input style={campo} value={novo.endereco.streetNumber} onChange={(e) => setEnd("streetNumber", e.target.value)} /></div>
              <div><label style={rotulo}>Complemento</label><input style={campo} value={novo.endereco.complement} onChange={(e) => setEnd("complement", e.target.value)} /></div>
              <div><label style={rotulo}>Bairro</label><input style={campo} value={novo.endereco.neighborhood} onChange={(e) => setEnd("neighborhood", e.target.value)} /></div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1.2fr 0.5fr 1fr 1fr 1fr", gap: "0.55rem", marginBottom: "0.6rem" }}>
              <div><label style={rotulo}>Cidade</label><input style={campo} value={novo.endereco.city} onChange={(e) => setEnd("city", e.target.value)} /></div>
              <div><label style={rotulo}>UF</label><input style={campo} value={novo.endereco.state} maxLength={2} onChange={(e) => setEnd("state", e.target.value.toUpperCase())} /></div>
              <div><label style={rotulo}>CEP</label><input style={campo} value={novo.endereco.postalCode} inputMode="numeric" onChange={(e) => setEnd("postalCode", e.target.value)} /></div>
              <div><label style={rotulo}>Latitude</label><input style={campo} value={novo.endereco.latitude} onChange={(e) => setEnd("latitude", e.target.value)} /></div>
              <div><label style={rotulo}>Longitude</label><input style={campo} value={novo.endereco.longitude} onChange={(e) => setEnd("longitude", e.target.value)} /></div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "2fr 0.6fr 1fr 1fr 1fr", gap: "0.55rem", marginBottom: "0.9rem" }}>
              <div><label style={rotulo}>Item</label><input style={campo} value={novo.itens[0].nome} onChange={(e) => setNovo({ ...novo, itens: [{ ...novo.itens[0], nome: e.target.value }] })} /></div>
              <div><label style={rotulo}>Qtd</label><input style={campo} value={novo.itens[0].quantidade} inputMode="numeric" onChange={(e) => setNovo({ ...novo, itens: [{ ...novo.itens[0], quantidade: e.target.value }] })} /></div>
              <div><label style={rotulo}>Preço (R$)</label><input style={campo} value={novo.itens[0].precoUnitario} onChange={(e) => setNovo({ ...novo, itens: [{ ...novo.itens[0], precoUnitario: e.target.value.replace(",", ".") }] })} /></div>
              <div><label style={rotulo}>Pagamento</label>
                <select style={campo} value={novo.pagamento.metodo} onChange={(e) => setNovo({ ...novo, pagamento: { ...novo.pagamento, metodo: e.target.value } })}>
                  <option value="CASH">Dinheiro</option><option value="CREDIT">Crédito</option><option value="DEBIT">Débito</option>
                </select></div>
              {novo.pagamento.metodo === "CASH"
                ? <div><label style={rotulo}>Troco para</label><input style={campo} value={novo.pagamento.trocoPara ?? ""} onChange={(e) => setNovo({ ...novo, pagamento: { ...novo.pagamento, trocoPara: e.target.value } })} /></div>
                : <div><label style={rotulo}>Bandeira</label>
                    <select style={campo} value={novo.pagamento.bandeira} onChange={(e) => setNovo({ ...novo, pagamento: { ...novo.pagamento, bandeira: e.target.value } })}>
                      {["VISA", "MASTERCARD", "ELO", "AMEX", "HIPERCARD"].map((b) => <option key={b}>{b}</option>)}
                    </select></div>}
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <button onClick={consultar} disabled={!!ocupado} style={botao("#475569", !!ocupado)}>
                {ocupado === "cotacao" ? <Loader size={14} className="spin" /> : <Search size={14} />} Consultar entregador iFood
              </button>
              <button onClick={registrarPedido} disabled={!!ocupado || !cotacao} style={botao(LARANJA, !!ocupado || !cotacao)}>
                {ocupado === "registrar" ? <Loader size={14} className="spin" /> : <Send size={14} />} Registrar pedido e chamar entregador
              </button>
            </div>

            {cotacao && (
              <div style={{ marginTop: "0.9rem", background: "#F8FAFC", borderRadius: 10, padding: "0.8rem 0.9rem", fontSize: "0.82rem", color: TINTA, display: "grid", gap: 4 }}>
                <div><strong>Entregador disponível.</strong> Cotação <code>{cotacao.id}</code></div>
                <div>Valor da entrega: <strong>{reais(cotacao.quote?.netValue)}</strong>{cotacao.quote?.raise ? ` (acréscimo ${reais(cotacao.quote.raise)})` : ""} · distância {cotacao.distance} m · {Math.round((cotacao.deliveryTime?.min ?? 0) / 60)}–{Math.round((cotacao.deliveryTime?.max ?? 0) / 60)} min</div>
                <div>Válida até {new Date(cotacao.expirationAt).toLocaleString("pt-BR")} · formas aceitas: {(cotacao.paymentMethods ?? []).map((m: any) => `${m.method}${m.brand ? " " + m.brand : ""}`).join(", ")}</div>
                <div>Total do pedido: <strong>{reais(totalItens + Number(cotacao.quote?.netValue ?? 0))}</strong> (itens {reais(totalItens)} + entrega)</div>
              </div>
            )}
          </div>
        )}

        {sel && (
          <>
            <div style={{ ...cartao, marginBottom: "1rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
                <div>
                  <h3 style={{ margin: "0 0 0.15rem", fontSize: "1rem", fontWeight: 800, color: TINTA }}>Pedido #{detalhe?.displayId || sel.displayId || "…"}</h3>
                  <p style={{ margin: 0, fontSize: "0.72rem", color: CINZA, fontFamily: "monospace" }}>{sel.ifoodOrderId}</p>
                </div>
                <div style={{ textAlign: "right" }}>
                  <span style={{ fontSize: "0.75rem", fontWeight: 800, color: cancelado ? "#B71C1C" : VERDE }}>{NOME_STATUS[sel.status] ?? sel.status}</span>
                  {sel.statusNoSistema && <div style={{ fontSize: "0.68rem", color: CINZA }}>no FireHub: {sel.statusNoSistema}</div>}
                </div>
              </div>
              {detalhe ? (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.3rem 1rem", fontSize: "0.8rem", color: TINTA, marginTop: "0.8rem" }}>
                  <div><strong>orderType:</strong> {detalhe.orderType}</div>
                  <div><strong>orderTiming:</strong> {detalhe.orderTiming}</div>
                  <div><strong>salesChannel:</strong> {detalhe.salesChannel}</div>
                  <div><strong>Entrega por:</strong> {detalhe.delivery?.deliveredBy}</div>
                  <div><strong>Cliente:</strong> {detalhe.customer?.name} · {detalhe.customer?.phone?.number}</div>
                  <div><strong>Total:</strong> {reais(detalhe.total?.orderAmount)} (entrega {reais(detalhe.total?.deliveryFee)})</div>
                  <div style={{ gridColumn: "1 / -1" }}><strong>Itens:</strong> {(detalhe.items ?? []).map((i: any) => `${i.quantity}× ${i.name}`).join(", ")}</div>
                  <div style={{ gridColumn: "1 / -1" }}><strong>Endereço enviado:</strong> {sel.enderecoOriginal ? `${sel.enderecoOriginal.streetName}, ${sel.enderecoOriginal.streetNumber} — ${sel.enderecoOriginal.neighborhood}, ${sel.enderecoOriginal.city}/${sel.enderecoOriginal.state}` : "—"}</div>
                </div>
              ) : <p style={{ margin: "0.8rem 0 0", fontSize: "0.8rem", color: CINZA }}>Carregando os dados do pedido…</p>}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: "0.9rem" }}>
                {sel.trackingUrl && <a href={sel.trackingUrl} target="_blank" rel="noreferrer" style={{ ...botao("#334155"), textDecoration: "none" }}><ExternalLink size={13} /> Rastreio do cliente</a>}
                <button onClick={() => verExtra("rastreio")} disabled={!!ocupado} style={botao("#64748B", !!ocupado)}><MapPin size={13} /> Posição do entregador</button>
                <button onClick={() => verExtra("confianca")} disabled={!!ocupado} style={botao("#64748B", !!ocupado)}><ShieldCheck size={13} /> Confiança da entrega</button>
              </div>
              {extra.rastreio && <pre style={{ margin: "0.6rem 0 0", fontSize: "0.7rem", background: "#F8FAFC", padding: 8, borderRadius: 8, whiteSpace: "pre-wrap" }}>{JSON.stringify(extra.rastreio, null, 1)}</pre>}
              {extra.confianca && <div style={{ marginTop: "0.6rem", fontSize: "0.8rem" }}>Confiança: <strong>{extra.confianca.score}</strong> · {Object.entries(extra.confianca.rules ?? {}).filter(([, v]) => v).map(([k]) => k).join(", ")}</div>}
            </div>

            {/* confirmação */}
            <div style={{ ...cartao, marginBottom: "1rem", opacity: cancelado ? 0.55 : 1 }}>
              <h4 style={titulo}><Check size={15} /> Confirmação do pedido</h4>
              <p style={{ margin: "0 0 0.8rem", fontSize: "0.76rem", color: CINZA, lineHeight: 1.45 }}>
                Valide os dados de entrega com o cliente e confirme o pedido no sistema.
              </p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button onClick={() => acaoSimples("confirmarEndereco", "Endereço confirmado pelo cliente.")} disabled={!!ocupado || cancelado} style={botao("#475569", !!ocupado || cancelado)}>
                  {ocupado === "confirmarEndereco" ? <Loader size={14} className="spin" /> : <MapPin size={14} />} Cliente confirmou o endereço
                </button>
                <button onClick={() => acaoSimples("confirmar", "Pedido confirmado.")} disabled={!!ocupado || cancelado} style={botao(VERDE, !!ocupado || cancelado)}>
                  {ocupado === "confirmar" ? <Loader size={14} className="spin" /> : <Check size={14} />} Confirmar pedido
                </button>
              </div>
            </div>

            {/* endereço */}
            <div style={{ ...cartao, marginBottom: "1rem", opacity: cancelado ? 0.55 : 1 }}>
              <h4 style={titulo}><MapPin size={15} /> Alteração de endereço</h4>
              {pendente ? (
                <>
                  <div style={{ background: "#FFF7E6", border: "1.5px solid #FDE68A", borderRadius: 10, padding: "10px 12px", fontSize: "0.82rem", color: "#92400E", marginBottom: "0.8rem", lineHeight: 1.45 }}>
                    <strong>O cliente pediu entrega em outro endereço</strong> ({hora(pendente.em)}):{" "}
                    {pendente.metadata?.address ? `${pendente.metadata.address.streetName}, ${pendente.metadata.address.streetNumber ?? "s/n"} — ${pendente.metadata.address.neighborhood}, ${pendente.metadata.address.city}` : "novo endereço"}
                    {pendente.metadata?.address?.coordinates && sel.enderecoOriginal && ` · ${distancia(sel.enderecoOriginal, pendente.metadata.address.coordinates)} m do original`}
                    . Responda em até 15 minutos.
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => acaoSimples("aceitarTroca", "Alteração de endereço aceita.")} disabled={!!ocupado} style={botao(VERDE, !!ocupado)}>
                      {ocupado === "aceitarTroca" ? <Loader size={14} className="spin" /> : <Check size={14} />} Aceitar alteração
                    </button>
                    <button onClick={() => acaoSimples("recusarTroca", "Alteração de endereço recusada.")} disabled={!!ocupado} style={botao("#B71C1C", !!ocupado)}>
                      {ocupado === "recusarTroca" ? <Loader size={14} className="spin" /> : <X size={14} />} Recusar alteração
                    </button>
                  </div>
                </>
              ) : (
                <>
                  {ultimaTroca && (
                    <div style={{ fontSize: "0.82rem", fontWeight: 700, color: ultimaTroca.codigo.endsWith("ACCEPTED") ? VERDE : "#B71C1C", marginBottom: "0.7rem" }}>
                      {NOME_EVENTO[ultimaTroca.codigo]} às {hora(ultimaTroca.em)}.
                    </div>
                  )}
                  <p style={{ margin: "0 0 0.7rem", fontSize: "0.76rem", color: CINZA, lineHeight: 1.45 }}>
                    O cliente ligou pedindo outro endereço? Registre aqui o pedido dele (até {500} m do endereço original).
                  </p>
                  {!troca ? (
                    <button onClick={() => setTroca({ ...(sel.enderecoOriginal ?? NOVO_PEDIDO.endereco), streetNumber: "300", complement: "Casa 2", reference: "Perto da praça", latitude: -9.8255, longitude: -67.9465 })}
                      disabled={cancelado} style={botao("#475569", cancelado)}>
                      <MapPin size={14} /> Cliente pediu outro endereço
                    </button>
                  ) : (
                    <>
                      <div style={{ display: "grid", gridTemplateColumns: "2fr 0.7fr 1fr 1fr 1fr", gap: "0.5rem", marginBottom: "0.6rem" }}>
                        <div><label style={rotulo}>Rua</label><input style={campo} value={troca.streetName} onChange={(e) => setTroca({ ...troca, streetName: e.target.value })} /></div>
                        <div><label style={rotulo}>Número</label><input style={campo} value={troca.streetNumber} onChange={(e) => setTroca({ ...troca, streetNumber: e.target.value })} /></div>
                        <div><label style={rotulo}>Bairro</label><input style={campo} value={troca.neighborhood} onChange={(e) => setTroca({ ...troca, neighborhood: e.target.value })} /></div>
                        <div><label style={rotulo}>Latitude</label><input style={campo} value={troca.latitude} onChange={(e) => setTroca({ ...troca, latitude: e.target.value })} /></div>
                        <div><label style={rotulo}>Longitude</label><input style={campo} value={troca.longitude} onChange={(e) => setTroca({ ...troca, longitude: e.target.value })} /></div>
                      </div>
                      {distTroca != null && (
                        <div style={{ fontSize: "0.78rem", fontWeight: 700, marginBottom: "0.6rem", color: distTroca > 500 ? "#B71C1C" : VERDE }}>
                          {distTroca} m do endereço original {distTroca > 500 ? "— acima do limite de 500 m" : "— dentro do limite de 500 m"}
                        </div>
                      )}
                      <div style={{ display: "flex", gap: 8 }}>
                        <button onClick={pedirTroca} disabled={!!ocupado} style={botao(LARANJA, !!ocupado)}>
                          {ocupado === "pedirTroca" ? <Loader size={14} className="spin" /> : <Send size={14} />} Registrar alteração pedida pelo cliente
                        </button>
                        <button onClick={() => setTroca(null)} style={botao("#94A3B8")}>Cancelar</button>
                      </div>
                    </>
                  )}
                </>
              )}
            </div>

            {/* cancelamento */}
            <div style={{ ...cartao, marginBottom: "1rem", opacity: cancelado ? 0.55 : 1 }}>
              <h4 style={titulo}><Ban size={15} /> Cancelamento</h4>
              {cancelado ? (
                <div style={{ fontSize: "0.84rem", fontWeight: 800, color: "#B71C1C" }}>Pedido cancelado.</div>
              ) : motivos === null ? (
                <button onClick={carregarMotivos} disabled={!!ocupado} style={botao("#475569", !!ocupado)}>
                  {ocupado === "motivos" ? <Loader size={14} className="spin" /> : <Ban size={14} />} Cancelar pedido…
                </button>
              ) : motivos.length === 0 ? (
                <p style={{ margin: 0, fontSize: "0.8rem", color: CINZA }}>O iFood não oferece mais motivos: o pedido não pode ser cancelado.</p>
              ) : (
                <>
                  <p style={{ margin: "0 0 0.6rem", fontSize: "0.76rem", color: CINZA }}>Motivos aceitos pelo iFood para este pedido:</p>
                  <div style={{ display: "grid", gap: 5, marginBottom: "0.7rem" }}>
                    {motivos.map((m) => (
                      <label key={m.cancelCodeId} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: "0.82rem", color: TINTA, cursor: "pointer" }}>
                        <input type="radio" name="motivo" checked={motivoSel === m.cancelCodeId} onChange={() => setMotivoSel(m.cancelCodeId)} />
                        {m.description} <span style={{ color: CINZA, fontFamily: "monospace", fontSize: "0.7rem" }}>({m.cancelCodeId})</span>
                      </label>
                    ))}
                  </div>
                  <input style={{ ...campo, marginBottom: "0.7rem" }} placeholder="Observação (opcional)" value={motivoTexto} onChange={(e) => setMotivoTexto(e.target.value)} />
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={cancelar} disabled={!!ocupado || !motivoSel} style={botao("#B71C1C", !!ocupado || !motivoSel)}>
                      {ocupado === "cancelar" ? <Loader size={14} className="spin" /> : <Ban size={14} />} Confirmar cancelamento
                    </button>
                    <button onClick={() => setMotivos(null)} style={botao("#94A3B8")}>Voltar</button>
                  </div>
                </>
              )}
            </div>

            {/* coleta */}
            <div style={{ ...cartao, marginBottom: "1rem", opacity: cancelado ? 0.55 : 1 }}>
              <h4 style={titulo}><KeyRound size={15} /> Código de coleta</h4>
              <p style={{ margin: "0 0 0.7rem", fontSize: "0.8rem", color: TINTA }}>
                {pickupCode
                  ? <>Este pedido tem código de coleta (<code>pickupCode</code> presente). Peça o código ao entregador e confira antes de entregar o pedido.</>
                  : "Sem código de coleta neste pedido."}
              </p>
              {eventos.some((e) => e.codigo === "DELIVERY_PICKUP_CODE_REQUESTED") && (
                <div style={{ fontSize: "0.8rem", fontWeight: 700, color: LARANJA, marginBottom: "0.6rem" }}>O entregador chegou e pediu para validar o código.</div>
              )}
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <input value={codigoColeta} onChange={(e) => setCodigoColeta(e.target.value)} placeholder="0000" inputMode="numeric" maxLength={8}
                  disabled={cancelado}
                  style={{ ...campo, width: 120, fontFamily: "monospace", fontSize: "1.1rem", letterSpacing: "3px", textAlign: "center" }} />
                <button onClick={validarColeta} disabled={!!ocupado || !codigoColeta || cancelado} style={botao("#475569", !!ocupado || !codigoColeta || cancelado)}>
                  {ocupado === "coleta" ? <Loader size={14} className="spin" /> : <KeyRound size={14} />} Validar código de coleta
                </button>
              </div>
              {resColeta && (
                <div style={{ marginTop: "0.7rem", display: "inline-flex", alignItems: "center", gap: 7, padding: "8px 12px", borderRadius: 9, fontSize: "0.82rem", fontWeight: 700, background: resColeta.ok ? "#F0FDFA" : "#FFF7E6", color: resColeta.ok ? VERDE : "#92400E" }}>
                  {resColeta.ok ? <Check size={14} /> : <X size={14} />} {resColeta.texto}
                </div>
              )}
            </div>

            {/* eventos */}
            <div style={cartao}>
              <h4 style={titulo}>Eventos do pedido (polling)</h4>
              {eventos.length === 0 ? (
                <p style={{ margin: 0, fontSize: "0.78rem", color: CINZA }}>Nenhum evento recebido ainda — o polling roda a cada 30 s.</p>
              ) : (
                <div style={{ display: "grid", gap: 5 }}>
                  {eventos.map((e, i) => (
                    <div key={i} style={{ display: "flex", gap: 10, fontSize: "0.78rem", color: TINTA }}>
                      <span style={{ color: CINZA, fontFamily: "monospace", minWidth: 62 }}>{hora(e.em)}</span>
                      <span style={{ fontWeight: 700 }}>{NOME_EVENTO[e.codigo] ?? e.codigo}</span>
                      <span style={{ color: CINZA, fontFamily: "monospace", fontSize: "0.68rem" }}>{e.codigo}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* ── chamadas ── */}
      <div style={{ ...cartao, position: "sticky", top: 12 }}>
        <h4 style={{ margin: "0 0 0.3rem", fontSize: "0.88rem", fontWeight: 800, color: TINTA }}>Chamadas ao iFood</h4>
        <p style={{ margin: "0 0 0.8rem", fontSize: "0.72rem", color: CINZA, lineHeight: 1.4 }}>Cada ação da tela com o status devolvido pela API.</p>
        {chamadas.length === 0 ? (
          <p style={{ margin: 0, fontSize: "0.78rem", color: CINZA }}>Nenhuma chamada ainda.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 560, overflowY: "auto" }}>
            {chamadas.map((c, i) => (
              <div key={i} style={{ border: `1px solid ${LINHA}`, borderRadius: 8, padding: "7px 9px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 6 }}>
                  <span style={{ fontFamily: "monospace", fontSize: "0.68rem", fontWeight: 700, color: CINZA }}>{c.metodo}</span>
                  <span style={{ fontFamily: "monospace", fontSize: "0.76rem", fontWeight: 800, color: corDoStatus(c.status) }}>{c.status}</span>
                </div>
                <div style={{ fontFamily: "monospace", fontSize: "0.68rem", color: TINTA, wordBreak: "break-all", marginTop: 2 }}>{c.endpoint}</div>
                <div style={{ fontSize: "0.65rem", color: CINZA, marginTop: 2 }}>{c.hora}{c.origem ? ` · app ${c.origem}` : ""}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
