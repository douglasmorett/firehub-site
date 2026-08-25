"use client";
/**
 * Aba Entrega — os quatro cenários da homologação do módulo Logistics.
 *
 * Os critérios pedem duas interfaces, nomeadas assim: "Dashboard de pedidos" e
 * "Interface de entregador". Estão as duas aqui — a lista à esquerda e a
 * viagem à direita.
 *
 * A sequência é o que eles realmente avaliam: só o próximo passo fica
 * habilitado, porque "a sequência correta é crítica" e o avaliador tenta
 * despachar sem ter chegado à origem só para ver o que o sistema faz.
 *
 * O código de entrega aparece apenas para pedidos elegíveis — os que receberam
 * o evento DELIVERY_DROP_CODE_REQUESTED. E código errado não é erro: o campo
 * continua lá, esperando a segunda tentativa.
 */
import React, { useEffect, useState } from "react";
import { Loader, RefreshCw, Bike, MapPin, Package, Home, KeyRound, Check, X } from "lucide-react";
import { posicaoAtual } from "@/lib/ifood-logistics";

const LARANJA = "#E8360C";
const VERDE = "#16A34A";
const TINTA = "#0F172A";
const CINZA = "#64748B";
const LINHA = "#E2E8F0";

const ETAPAS = [
  { chave: "assignDriver", rotulo: "Alocar entregador", estado: "ASSIGNED", icone: Bike },
  { chave: "goingToOrigin", rotulo: "Saiu para coleta", estado: "GOING_TO_ORIGIN", icone: MapPin },
  { chave: "arrivedAtOrigin", rotulo: "Chegou na loja", estado: "ARRIVED_AT_ORIGIN", icone: Home },
  { chave: "dispatch", rotulo: "Saiu para entrega", estado: "DISPATCHED", icone: Package },
  { chave: "arrivedAtDestination", rotulo: "Chegou no cliente", estado: "ARRIVED_AT_DESTINATION", icone: MapPin },
] as const;

const VEICULOS: { v: string; nome: string }[] = [
  { v: "MOTORCYCLE", nome: "Moto" },
  { v: "BICYCLE", nome: "Bicicleta" },
  { v: "CAR", nome: "Carro" },
  { v: "ONFOOT", nome: "A pé" },
  { v: "EBIKE", nome: "Bike elétrica" },
  { v: "PATINETE", nome: "Patinete" },
  { v: "MOTORBIKE", nome: "Motoneta" },
  { v: "SUPERBIKE", nome: "Bike alta potência" },
];

const agora = () => new Date().toLocaleTimeString("pt-BR");
const corDoStatus = (s: number) => (s >= 200 && s < 300 ? VERDE : s >= 400 && s < 500 ? "#D97706" : "#DC2626");

// A contagem de etapas vem do lib, e não de uma cópia local: quando eram duas
// implementações, a da tela continuou zerando a viagem em estados que o webhook
// grava (COLLECTED, CONCLUDED) mesmo depois de o servidor já estar correto.
const posicao = posicaoAtual;

export default function TabEntrega() {
  const [pedidos, setPedidos] = useState<any[]>([]);
  const [sel, setSel] = useState<any>(null);
  const [detalhe, setDetalhe] = useState<any>(null);
  const [carregando, setCarregando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [chamadas, setChamadas] = useState<any[]>([]);

  const [entregador, setEntregador] = useState({ nome: "", telefone: "", veiculo: "MOTORCYCLE" });
  const [codigo, setCodigo] = useState("");
  const [resultadoCodigo, setResultadoCodigo] = useState<null | { ok: boolean; texto: string }>(null);

  const registrar = (c: any) => setChamadas((a) => [{ ...c, hora: agora() }, ...a].slice(0, 40));

  async function chamar(metodo: string, url: string, corpo?: any) {
    setErro("");
    const sep = url.includes("?") ? "&" : "?";
    const r = await fetch(`${url}${sep}distribuido=1`, {
      method: metodo,
      ...(corpo ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) } : {}),
    });
    const d = await r.json().catch(() => ({}));
    registrar({
      metodo,
      endpoint: d?.endpoint ?? url.replace("/api/ifood", ""),
      status: d?.ifood?.status ?? r.status,
      origem: d?.ifood?.origem,
    });
    if (!r.ok) throw new Error(d?.error || "Falha na chamada ao iFood.");
    return d;
  }

  async function carregarPedidos() {
    setCarregando(true);
    try {
      const r = await fetch("/api/ifood/logistics/pedidos");
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || "Falha ao listar pedidos.");
      setPedidos(d.pedidos ?? []);
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => { carregarPedidos(); }, []);

  async function abrirPedido(p: any) {
    setSel(p);
    setDetalhe(null);
    setResultadoCodigo(null);
    setCodigo("");
    setAviso("");
    try {
      const d = await chamar("GET", `/api/ifood/logistics/pedido/${p.ifoodOrderId}`);
      setDetalhe(d.pedido);
      if (d.local) setSel({ ...p, ifoodDriverStatus: d.local.ifoodDriverStatus ?? p.ifoodDriverStatus });
    } catch (e: any) {
      setErro(e.message);
    }
  }

  async function executarEtapa(chave: string) {
    if (!sel) return;
    setOcupado(true);
    setAviso("");
    try {
      const d = await chamar("POST", "/api/ifood/logistics/etapa", {
        orderId: sel.ifoodOrderId,
        etapa: chave,
        ...(chave === "assignDriver" ? { entregador } : {}),
      });
      setSel((s: any) => ({ ...s, ifoodDriverStatus: d.estado }));
      setPedidos((lista) =>
        lista.map((p) => (p.id === sel.id ? { ...p, ifoodDriverStatus: d.estado } : p)),
      );
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setOcupado(false);
    }
  }

  async function enviarCodigo() {
    if (!sel) return;
    setOcupado(true);
    setResultadoCodigo(null);
    try {
      const d = await chamar("POST", "/api/ifood/logistics/codigo", {
        orderId: sel.ifoodOrderId,
        codigo,
      });
      if (d.elegivel === false) {
        setAviso(d.mensagem);
        return;
      }
      setResultadoCodigo({ ok: !!d.conferido, texto: d.mensagem });
      if (d.conferido) {
        setSel((s: any) => ({ ...s, ifoodDriverStatus: "DELIVERED" }));
      } else {
        setCodigo("");
      }
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setOcupado(false);
    }
  }

  // ── estilos ──
  const cartao: React.CSSProperties = {
    background: "#fff", border: `1.5px solid ${LINHA}`, borderRadius: 14, padding: "1.1rem 1.25rem",
  };
  const rotulo: React.CSSProperties = {
    display: "block", fontSize: "0.72rem", fontWeight: 700, color: CINZA,
    textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 5,
  };
  const campo: React.CSSProperties = {
    width: "100%", padding: "9px 11px", border: `1.5px solid ${LINHA}`,
    borderRadius: 9, fontSize: "0.88rem", fontFamily: "inherit", color: TINTA,
  };

  const pos = posicao(sel?.ifoodDriverStatus);
  const entregue = sel?.ifoodDriverStatus === "DELIVERED";

  return (
    <div style={{ display: "grid", gridTemplateColumns: "270px minmax(0,1fr) 280px", gap: "1.1rem", alignItems: "start" }}>
      {/* ── painel de pedidos ── */}
      <div style={{ ...cartao, position: "sticky", top: 12 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.8rem" }}>
          <h4 style={{ margin: 0, fontSize: "0.9rem", fontWeight: 800, color: TINTA }}>Pedidos iFood</h4>
          <button onClick={carregarPedidos} disabled={carregando}
            style={{ display: "inline-flex", padding: 6, background: "#F1F5F9", border: "none", borderRadius: 7, cursor: "pointer", color: CINZA }}>
            {carregando ? <Loader size={13} className="spin" /> : <RefreshCw size={13} />}
          </button>
        </div>

        {pedidos.length === 0 ? (
          <p style={{ margin: 0, fontSize: "0.78rem", color: CINZA, lineHeight: 1.45 }}>
            Nenhum pedido iFood nos últimos 3 dias. Faça um pedido pelo aplicativo de teste para começar.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 520, overflowY: "auto" }}>
            {pedidos.map((p) => {
              const ativo = sel?.id === p.id;
              return (
                <button key={p.id} onClick={() => abrirPedido(p)}
                  style={{
                    textAlign: "left", padding: "9px 10px", borderRadius: 9, cursor: "pointer",
                    border: `1.5px solid ${ativo ? LARANJA : LINHA}`,
                    background: ativo ? "#FFF7F5" : "#fff", fontFamily: "inherit",
                  }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 6 }}>
                    <strong style={{ fontSize: "0.83rem", color: TINTA }}>
                      #{p.ifoodReference || p.orderNumber}
                    </strong>
                    {p.exigeCodigo && (
                      <span title="Este pedido exige código de entrega"
                        style={{ fontSize: "0.62rem", fontWeight: 800, color: "#7C3AED", background: "#F3E8FF", padding: "1px 5px", borderRadius: 4 }}>
                        CÓDIGO
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: "0.72rem", color: CINZA, marginTop: 2 }}>
                    {p.customerName || "Cliente"} · R$ {Number(p.total).toFixed(2)}
                  </div>
                  {p.ifoodDriverStatus && (
                    <div style={{ fontSize: "0.66rem", color: LARANJA, fontWeight: 700, marginTop: 3 }}>
                      {ETAPAS.find((e) => e.estado === p.ifoodDriverStatus)?.rotulo ?? p.ifoodDriverStatus}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── interface do entregador ── */}
      <div>
        {erro && (
          <div style={{ background: "#FEF2F2", border: "1.5px solid #FECACA", color: "#991B1B",
            borderRadius: 10, padding: "10px 13px", marginBottom: "1rem", fontSize: "0.85rem" }}>{erro}</div>
        )}
        {aviso && (
          <div style={{ background: "#FFFBEB", border: "1.5px solid #FDE68A", color: "#92400E",
            borderRadius: 10, padding: "10px 13px", marginBottom: "1rem", fontSize: "0.85rem" }}>{aviso}</div>
        )}

        {!sel ? (
          <div style={{ ...cartao, textAlign: "center", color: CINZA, fontSize: "0.88rem", padding: "2.5rem 1rem" }}>
            Escolha um pedido à esquerda para começar a entrega.
          </div>
        ) : (
          <>
            <div style={{ ...cartao, marginBottom: "1rem" }}>
              <h3 style={{ margin: "0 0 0.2rem", fontSize: "1rem", fontWeight: 800, color: TINTA }}>
                Pedido #{sel.ifoodReference || sel.orderNumber}
              </h3>
              <p style={{ margin: "0 0 0.9rem", fontSize: "0.76rem", color: CINZA, fontFamily: "monospace" }}>
                {sel.ifoodOrderId}
              </p>

              {detalhe ? (
                <div style={{ display: "grid", gap: "0.35rem", fontSize: "0.82rem", color: TINTA }}>
                  <div><strong>Cliente:</strong> {detalhe?.customer?.name ?? "—"}</div>
                  <div><strong>Telefone:</strong> {detalhe?.customer?.phone?.number ?? "—"}</div>
                  <div><strong>Entrega:</strong>{" "}
                    {detalhe?.delivery?.deliveryAddress
                      ? `${detalhe.delivery.deliveryAddress.streetName}, ${detalhe.delivery.deliveryAddress.streetNumber} — ${detalhe.delivery.deliveryAddress.neighborhood}, ${detalhe.delivery.deliveryAddress.city}`
                      : "—"}
                  </div>
                  <div><strong>Itens:</strong> {detalhe?.items?.length ?? 0}</div>
                  <div><strong>Pagamento:</strong>{" "}
                    {detalhe?.payments?.methods?.[0]?.method ?? "—"}
                    {detalhe?.payments?.pending ? ` · pendente R$ ${Number(detalhe.payments.pending).toFixed(2)}` : ""}
                  </div>
                </div>
              ) : (
                <p style={{ margin: 0, fontSize: "0.82rem", color: CINZA }}>Carregando os dados do pedido…</p>
              )}
            </div>

            {/* sequência */}
            <div style={{ ...cartao, marginBottom: "1rem" }}>
              <h4 style={{ margin: "0 0 0.9rem", fontSize: "0.9rem", fontWeight: 800, color: TINTA }}>
                Viagem do entregador
              </h4>

              {pos < 0 && (
                /* Estado gravado por outro caminho (webhook, motoboy do iFood) com
                   vocabulário que esta tela não conhece. Dizer isso é melhor que
                   mostrar a viagem zerada e deixar clicar em algo que vai falhar. */
                <div style={{ background: "#FFFBEB", border: "1.5px solid #FDE68A", color: "#92400E",
                  borderRadius: 10, padding: "10px 13px", marginBottom: "0.9rem", fontSize: "0.84rem", lineHeight: 1.45 }}>
                  Este pedido está em <strong>{String(sel.ifoodDriverStatus)}</strong>, um estado
                  registrado fora desta tela. A viagem dele não pode ser conduzida por aqui.
                </div>
              )}

              {pos === 0 && (
                <div style={{ display: "grid", gap: "0.7rem", marginBottom: "1rem", padding: "0.85rem", background: "#F8FAFC", borderRadius: 10 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "2fr 1.4fr 1fr", gap: "0.6rem" }}>
                    <div>
                      <label style={rotulo}>Nome do entregador</label>
                      <input style={campo} value={entregador.nome} placeholder="João da Silva"
                        onChange={(e) => setEntregador({ ...entregador, nome: e.target.value })} />
                    </div>
                    <div>
                      <label style={rotulo}>Telefone</label>
                      <input style={campo} value={entregador.telefone} placeholder="11999999999" inputMode="numeric"
                        onChange={(e) => setEntregador({ ...entregador, telefone: e.target.value })} />
                    </div>
                    <div>
                      <label style={rotulo}>Veículo</label>
                      <select style={campo} value={entregador.veiculo}
                        onChange={(e) => setEntregador({ ...entregador, veiculo: e.target.value })}>
                        {VEICULOS.map((v) => <option key={v.v} value={v.v}>{v.nome}</option>)}
                      </select>
                    </div>
                  </div>
                </div>
              )}

              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                {ETAPAS.map((etapa, i) => {
                  const feita = pos > i;
                  const proxima = pos === i && !entregue;
                  const Icone = etapa.icone;
                  return (
                    <button key={etapa.chave}
                      onClick={() => executarEtapa(etapa.chave)}
                      disabled={!proxima || ocupado}
                      style={{
                        display: "flex", alignItems: "center", gap: 10, padding: "11px 13px",
                        borderRadius: 10, fontFamily: "inherit", textAlign: "left",
                        border: `1.5px solid ${feita ? "#BBF7D0" : proxima ? LARANJA : LINHA}`,
                        background: feita ? "#F0FDF4" : proxima ? "#fff" : "#F8FAFC",
                        cursor: proxima && !ocupado ? "pointer" : "default",
                        opacity: !feita && !proxima ? 0.55 : 1,
                      }}>
                      <span style={{
                        width: 26, height: 26, borderRadius: "50%", flexShrink: 0,
                        background: feita ? VERDE : proxima ? LARANJA : "#CBD5E1",
                        color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
                      }}>
                        {feita ? <Check size={13} /> : <Icone size={13} />}
                      </span>
                      <span style={{ flex: 1 }}>
                        <span style={{ display: "block", fontSize: "0.86rem", fontWeight: 700, color: TINTA }}>
                          {etapa.rotulo}
                        </span>
                        <span style={{ display: "block", fontFamily: "monospace", fontSize: "0.68rem", color: CINZA }}>
                          POST /logistics/v1.0/orders/{"{id}"}/{etapa.chave}
                        </span>
                      </span>
                      {proxima && ocupado && <Loader size={14} className="spin" />}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* código de entrega */}
            <div style={{ ...cartao, opacity: pos >= ETAPAS.length || entregue ? 1 : 0.55 }}>
              <h4 style={{ margin: "0 0 0.3rem", fontSize: "0.9rem", fontWeight: 800, color: TINTA }}>
                Código de entrega
              </h4>
              <p style={{ margin: "0 0 0.9rem", fontSize: "0.76rem", color: CINZA, lineHeight: 1.45 }}>
                {sel.exigeCodigo
                  ? "Este pedido pediu código. Peça os dígitos ao cliente e confirme."
                  : "Só pedidos que receberam o evento DELIVERY_DROP_CODE_REQUESTED exigem código."}
              </p>

              {entregue ? (
                <div style={{ display: "inline-flex", alignItems: "center", gap: 7, color: VERDE, fontWeight: 800, fontSize: "0.88rem" }}>
                  <Check size={16} /> Entrega confirmada
                </div>
              ) : (
                <>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <input
                      value={codigo} onChange={(e) => setCodigo(e.target.value)}
                      placeholder="0000" inputMode="numeric" maxLength={8}
                      disabled={pos < ETAPAS.length}
                      style={{ ...campo, width: 120, fontFamily: "monospace", fontSize: "1.1rem", letterSpacing: "3px", textAlign: "center" }}
                    />
                    <button onClick={enviarCodigo} disabled={ocupado || !codigo || pos < ETAPAS.length}
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 7, padding: "10px 16px",
                        background: ocupado || !codigo || pos < ETAPAS.length ? "#CBD5E1" : "#7C3AED",
                        color: "#fff", border: "none", borderRadius: 9, fontWeight: 800, fontSize: "0.86rem",
                        cursor: ocupado || !codigo || pos < ETAPAS.length ? "not-allowed" : "pointer", fontFamily: "inherit",
                      }}>
                      <KeyRound size={14} /> Confirmar entrega
                    </button>
                  </div>

                  {resultadoCodigo && (
                    <div style={{
                      marginTop: "0.8rem", display: "inline-flex", alignItems: "center", gap: 7,
                      padding: "8px 12px", borderRadius: 9, fontSize: "0.84rem", fontWeight: 700,
                      background: resultadoCodigo.ok ? "#F0FDF4" : "#FEF2F2",
                      color: resultadoCodigo.ok ? VERDE : "#991B1B",
                    }}>
                      {resultadoCodigo.ok ? <Check size={14} /> : <X size={14} />} {resultadoCodigo.texto}
                    </div>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </div>

      {/* ── chamadas ── */}
      <div style={{ ...cartao, position: "sticky", top: 12 }}>
        <h4 style={{ margin: "0 0 0.3rem", fontSize: "0.88rem", fontWeight: 800, color: TINTA }}>Chamadas ao iFood</h4>
        <p style={{ margin: "0 0 0.8rem", fontSize: "0.72rem", color: CINZA, lineHeight: 1.4 }}>
          Cada ação da tela com o status devolvido pela API.
        </p>
        {chamadas.length === 0 ? (
          <p style={{ margin: 0, fontSize: "0.78rem", color: CINZA }}>Nenhuma chamada ainda.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 480, overflowY: "auto" }}>
            {chamadas.map((c, i) => (
              <div key={i} style={{ border: `1px solid ${LINHA}`, borderRadius: 8, padding: "7px 9px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 6 }}>
                  <span style={{ fontFamily: "monospace", fontSize: "0.68rem", fontWeight: 700, color: CINZA }}>{c.metodo}</span>
                  <span style={{ fontFamily: "monospace", fontSize: "0.76rem", fontWeight: 800, color: corDoStatus(c.status) }}>{c.status}</span>
                </div>
                <div style={{ fontFamily: "monospace", fontSize: "0.68rem", color: TINTA, wordBreak: "break-all", marginTop: 2 }}>{c.endpoint}</div>
                <div style={{ fontSize: "0.65rem", color: CINZA, marginTop: 2 }}>
                  {c.hora}{c.origem ? ` · app ${c.origem}` : ""}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
