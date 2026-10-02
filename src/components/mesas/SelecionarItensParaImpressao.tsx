"use client";

/**
 * "Selecionar itens para impressão" — a mesa aberta manda para a cozinha só
 * os itens que o atendente marcar (imprimir ou reimprimir, tanto faz).
 *
 * Pedido do Douglas a partir da Delícia de Casa (02/10/2026). Usado pela tela
 * de Mesas do painel/tablet (MesasApp) e pela do celular (MesasCelular): as
 * duas mostram os mesmos pedidos da mesa, e o papel tem de sair igual.
 *
 * O atendente não escolhe impressora: cada item sai onde a comanda dele
 * sairia (roteamento normal por categoria). Quem monta o papel e põe na fila
 * é api/store/table-sessions/[id]/imprimir-itens.
 */
import { useEffect, useMemo, useState } from "react";
import { parseComboSelections } from "@/lib/parse-combo";

// ── Aviso que desce do topo (no lugar do alert()) ─────────────────────────
// Mesma interface do components/AvisoNoTopo.tsx de outra frente, que ainda não
// está no master (MesasCelular tem a mesma cópia): quando estiver, troque este
// bloco pelo import.
export type Aviso = { tipo: "ok" | "erro" | "atencao" | "info"; titulo: string; detalhe?: string };
const COR_DO_AVISO: Record<Aviso["tipo"], { cor: string; fundo: string }> = {
  ok: { cor: "#059669", fundo: "#ECFDF5" },
  erro: { cor: "#DC2626", fundo: "#FEF2F2" },
  atencao: { cor: "#D97706", fundo: "#FFFBEB" },
  info: { cor: "#2563EB", fundo: "#EFF6FF" },
};
export function AvisoNoTopo({ aviso, onFechar }: { aviso: Aviso | null; onFechar: () => void }) {
  const [parado, setParado] = useState(false);
  useEffect(() => {
    if (!aviso || parado) return;
    const t = setTimeout(onFechar, aviso.tipo === "erro" ? 12000 : 6000);
    return () => clearTimeout(t);
  }, [aviso, onFechar, parado]);
  if (!aviso) return null;
  const { cor, fundo } = COR_DO_AVISO[aviso.tipo];
  return (
    <div
      role={aviso.tipo === "erro" ? "alert" : "status"}
      onClick={onFechar}
      onMouseEnter={() => setParado(true)}
      onMouseLeave={() => setParado(false)}
      style={{
        position: "fixed", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 2000,
        width: "min(440px, calc(100vw - 24px))", background: fundo, borderLeft: `4px solid ${cor}`,
        borderRadius: 12, padding: "12px 14px", boxShadow: "0 10px 30px rgba(15,23,42,.18)", cursor: "pointer",
      }}
    >
      <div style={{ fontWeight: 800, fontSize: 14, color: "#0F172A" }}>{aviso.titulo}</div>
      {aviso.detalhe && <div style={{ fontSize: 13, color: "#475569", marginTop: 2 }}>{aviso.detalhe}</div>}
    </div>
  );
}

type ItemLancado = {
  id: string;
  quantity: number;
  menuProduct?: { name?: string | null } | null;
  comboSelections?: unknown;
  notes?: string | null;
  tableGuestId?: string | null;
};

type PedidoLancado = {
  id: string;
  dailyOrderNumber?: number | string | null;
  status?: string | null;
  createdAt: string;
  items: ItemLancado[];
};

const CANCELADOS = new Set(["CANCELADO", "CANCELED", "CANCELLED"]);

const hora = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
};

export default function SelecionarItensParaImpressao({
  sessionId,
  pedidos,
  chamar,
  nomeDaPessoa,
  onFechar,
  onAviso,
}: {
  sessionId: string;
  pedidos: PedidoLancado[];
  /** O fetch da tela (o do garçom leva o cabeçalho dele). */
  chamar: (input: string, init?: RequestInit) => Promise<Response>;
  nomeDaPessoa?: (id: string) => string;
  onFechar: () => void;
  onAviso: (aviso: Aviso) => void;
}) {
  // Mais antigo primeiro, como a comanda chegou à cozinha; cancelado não entra.
  const lista = useMemo(
    () =>
      [...(pedidos || [])]
        .filter((p) => !CANCELADOS.has(String(p.status || "").toUpperCase()) && (p.items || []).length > 0)
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
    [pedidos]
  );
  const todosOsIds = useMemo(() => lista.flatMap((p) => p.items.map((i) => i.id)), [lista]);

  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [enviando, setEnviando] = useState(false);

  // A mesa atualiza sozinha (a tela consulta de tempos em tempos): item que
  // sumiu da mesa sai da seleção, para o botão não contar o que não existe.
  useEffect(() => {
    setMarcados((atual) => {
      const valem = new Set([...atual].filter((id) => todosOsIds.includes(id)));
      return valem.size === atual.size ? atual : valem;
    });
  }, [todosOsIds]);

  const alternar = (id: string) =>
    setMarcados((atual) => {
      const novo = new Set(atual);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });

  const alternarPedido = (p: PedidoLancado) =>
    setMarcados((atual) => {
      const novo = new Set(atual);
      const todos = p.items.every((i) => novo.has(i.id));
      for (const i of p.items) {
        if (todos) novo.delete(i.id);
        else novo.add(i.id);
      }
      return novo;
    });

  const tudoMarcado = todosOsIds.length > 0 && todosOsIds.every((id) => marcados.has(id));
  const n = marcados.size;

  const imprimir = async () => {
    if (n === 0 || enviando) return;
    setEnviando(true);
    try {
      const res = await chamar(`/api/store/table-sessions/${sessionId}/imprimir-itens`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itens: [...marcados] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        onAviso({ tipo: "erro", titulo: "Os itens não foram impressos", detalhe: data?.error || "Tente de novo." });
        return;
      }
      const rotulo = `${n} ${n === 1 ? "item enviado" : "itens enviados"} para a impressora`;
      if (data?.assistenteParado) {
        onAviso({
          tipo: "atencao",
          titulo: `${rotulo}, mas o Assistente de impressão não está respondendo`,
          detalhe: "O papel sai quando o computador do caixa voltar a imprimir. Confira se ele está ligado e com o Assistente aberto.",
        });
      } else {
        onAviso({ tipo: "ok", titulo: rotulo, detalhe: "Cada item sai na impressora de sempre dele, em alguns segundos." });
      }
      onFechar();
    } catch {
      onAviso({ tipo: "erro", titulo: "Sem conexão", detalhe: "Os itens não foram impressos. Tente de novo." });
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div
      onClick={onFechar}
      style={{
        position: "fixed", inset: 0, zIndex: 1500, background: "rgba(15,23,42,0.5)",
        display: "flex", alignItems: "flex-end", justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Selecionar itens para impressão"
        style={{
          width: "100%", maxWidth: 560, maxHeight: "88dvh", background: "#fff",
          borderRadius: "18px 18px 0 0", display: "flex", flexDirection: "column",
          boxShadow: "0 -10px 40px rgba(0,0,0,0.25)", fontFamily: "inherit",
        }}
      >
        <div style={{ padding: "16px 18px 10px", borderBottom: "1px solid #E2E8F0" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 17, fontWeight: 900, color: "#0F172A" }}>🖨️ Selecionar itens para impressão</div>
              <div style={{ fontSize: 13, color: "#64748B", marginTop: 2, lineHeight: 1.4 }}>
                Marque o que quer mandar para a cozinha. Pode ser item já impresso.
              </div>
            </div>
            <button type="button" onClick={onFechar} aria-label="Fechar" style={{
              border: "none", background: "#F1F5F9", borderRadius: 10, width: 40, height: 40,
              fontSize: 18, cursor: "pointer", color: "#475569", flexShrink: 0,
            }}>✕</button>
          </div>
          {todosOsIds.length > 0 && (
            <button type="button" onClick={() => setMarcados(tudoMarcado ? new Set() : new Set(todosOsIds))} style={{
              marginTop: 10, padding: "9px 14px", borderRadius: 10, border: "1.5px solid #CBD5E1",
              background: "#F8FAFC", color: "#334155", fontSize: 14, fontWeight: 800, cursor: "pointer", fontFamily: "inherit",
            }}>
              {tudoMarcado ? "Desmarcar todos" : "Marcar todos"}
            </button>
          )}
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "8px 12px" }}>
          {lista.length === 0 ? (
            <div style={{ textAlign: "center", padding: "30px 10px", color: "#94A3B8", fontSize: 14 }}>
              Nada lançado nesta mesa ainda.
            </div>
          ) : (
            lista.map((p) => {
              const todosDoPedido = p.items.every((i) => marcados.has(i.id));
              return (
                <div key={p.id} style={{ marginBottom: 10, border: "1px solid #E2E8F0", borderRadius: 12, overflow: "hidden" }}>
                  <button type="button" onClick={() => alternarPedido(p)} style={{
                    width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8,
                    padding: "9px 12px", background: "#F8FAFC", border: "none", borderBottom: "1px solid #E2E8F0",
                    fontSize: 13, fontWeight: 800, color: "#475569", cursor: "pointer", fontFamily: "inherit", textAlign: "left",
                  }}>
                    <span>Pedido {p.dailyOrderNumber ? `#${p.dailyOrderNumber}` : ""} · lançado às {hora(p.createdAt)}</span>
                    <span style={{ fontSize: 12, color: "#0F766E", whiteSpace: "nowrap" }}>
                      {todosDoPedido ? "desmarcar pedido" : "marcar pedido"}
                    </span>
                  </button>
                  {p.items.map((it) => {
                    const marcado = marcados.has(it.id);
                    const escolhas = parseComboSelections(it.comboSelections, 1);
                    return (
                      <label key={it.id} style={{
                        display: "flex", alignItems: "center", gap: 12, padding: "12px",
                        borderTop: "1px solid #F1F5F9", cursor: "pointer",
                        background: marcado ? "#F0FDFA" : "#fff",
                      }}>
                        <input
                          type="checkbox"
                          checked={marcado}
                          onChange={() => alternar(it.id)}
                          style={{ width: 26, height: 26, accentColor: "#0F766E", flexShrink: 0, cursor: "pointer" }}
                        />
                        <span style={{ fontSize: 16, fontWeight: 900, color: "#0F172A", minWidth: 34 }}>{it.quantity}x</span>
                        <span style={{ flex: 1, minWidth: 0, fontSize: 15, color: "#0F172A", fontWeight: 600 }}>
                          {it.menuProduct?.name || "Item"}
                          {it.tableGuestId && nomeDaPessoa && (
                            <span style={{ fontSize: 12, color: "#7C3AED", fontWeight: 700 }}> · {nomeDaPessoa(it.tableGuestId)}</span>
                          )}
                          {escolhas.length > 0 && (
                            <span style={{ display: "block", fontSize: 12, color: "#64748B", fontWeight: 600, marginTop: 1 }}>
                              {escolhas.map((e) => (e.quantity > 1 ? `${e.quantity}x ${e.name}` : e.name)).join(" · ")}
                            </span>
                          )}
                          {it.notes && (
                            <span style={{ display: "block", fontSize: 12, color: "#B45309", fontWeight: 700, marginTop: 1 }}>Obs.: {it.notes}</span>
                          )}
                        </span>
                      </label>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>

        <div style={{ padding: "12px 14px calc(env(safe-area-inset-bottom) + 12px)", borderTop: "1px solid #E2E8F0", display: "flex", gap: 8 }}>
          <button type="button" onClick={onFechar} style={{
            padding: "14px 16px", borderRadius: 12, border: "1.5px solid #CBD5E1", background: "#fff",
            color: "#475569", fontSize: 15, fontWeight: 800, cursor: "pointer", fontFamily: "inherit",
          }}>Cancelar</button>
          <button type="button" onClick={imprimir} disabled={n === 0 || enviando} style={{
            flex: 1, padding: "14px 16px", borderRadius: 12, border: "none",
            background: n === 0 ? "#CBD5E1" : "#0F766E", color: "#fff", fontSize: 16, fontWeight: 900,
            cursor: n === 0 ? "not-allowed" : enviando ? "wait" : "pointer", fontFamily: "inherit",
            opacity: enviando ? 0.7 : 1,
          }}>
            {enviando ? "Enviando..." : n === 0 ? "Marque os itens" : `🖨️ Imprimir ${n} ${n === 1 ? "item" : "itens"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
