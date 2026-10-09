"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { escolhasDoItem } from "@/lib/comanda-do-robo";

/**
 * "🤖 Pedido novo do robô — confira antes de aceitar".
 *
 * Abre sozinho no painel de pedidos quando a loja liga "Conferir cada pedido
 * do robô" (chatbotConfig.conferirPedidoDoRobo) e o cliente fecha um pedido no
 * WhatsApp. Pedido da Pizzaria 17 (08/10/2026): o robô atende tudo, mas a
 * atendente quer olhar a conversa e o pedido antes de ele ir para a cozinha.
 *
 * Roxo de propósito: o vermelho é do cancelamento (AvisosDoDia), o âmbar do
 * pedido que o robô segurou por endereço (AvisoPedidoEsperandoLoja). Quem olha
 * a tela de longe sabe qual é pela cor e pelo toque.
 *
 *   - Aceitar → vira pedido como estava (número do dia, comanda, cozinha) e o
 *     cliente recebe a confirmação;
 *   - Editar → "Finalizar pedido manualmente", para corrigir endereço, taxa,
 *     pagamento, troco e observação antes de aceitar;
 *   - Não aceitar → cancela com o motivo, e o cliente é avisado;
 *   - Depois → fecha nesta sessão; o cartão continua em Novos.
 */

const ROXO = "#6D28D9";
const ROXO_CLARO = "#F5F3FF";
const ROXO_BORDA = "#DDD6FE";
const CINZA = "#64748B";
const VERMELHO = "#B91C1C";
const VERDE = "#15803D";

const MOTIVOS_DE_RECUSA = [
  "Endereço fora da nossa área de entrega",
  "Item em falta",
  "Loja fechada no momento",
  "Outro motivo",
];

const reais = (n: unknown) => `R$ ${(Math.round((Number(n) || 0) * 100) / 100).toFixed(2).replace(".", ",")}`;

/** "5521999990000" → link do WhatsApp; vazio quando não dá para montar. */
function linkDoWhatsapp(telefone: unknown): string {
  let d = String(telefone || "").replace(/\D/g, "");
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  return d.length >= 12 ? `https://wa.me/${d}` : "";
}

function telefoneLegivel(telefone: unknown): string {
  const d = String(telefone || "").replace(/\D/g, "");
  const local = d.length === 13 && d.startsWith("55") ? d.slice(2) : d;
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  return String(telefone || "—");
}

/** As observações do robô sem a marca de espera e sem o cabeçalho técnico. */
function observacaoDoRobo(notas: unknown): string {
  return String(notas || "")
    .replace(/^🙋 AGUARDANDO A LOJA: [^·\n]*(· )?/, "")
    .replace(/^🤖 Pedido (sendo montado pela IA no WhatsApp|finalizado via IA pelo WhatsApp)\s*(·\s*)?/, "")
    .trim();
}

export default function AvisoPedidoDoRoboParaConferir({
  pedido,
  quantosMais,
  onAceitar,
  onEditar,
  onNaoAceitar,
  onDepois,
  lojas = [],
  lojaAtualId = "",
}: {
  pedido: any;
  /** Quantos outros pedidos do robô estão esperando além deste. */
  quantosMais: number;
  /** Aceita como está, na loja escolhida; devolve a mensagem de erro, ou null quando deu certo. */
  onAceitar: (lojaDestinoId: string) => Promise<string | null>;
  onEditar: () => void;
  /** Cancela o rascunho; devolve a mensagem de erro, ou null quando deu certo. */
  onNaoAceitar: (motivoDaRecusa: string) => Promise<string | null>;
  onDepois: () => void;
  /**
   * As lojas do grupo em que o pedido pode ser preparado (Pizzaria 17 →
   * Aeroporto, 09/10/2026). Vazio ou uma só = sem escolha, fica na loja atual.
   */
  lojas?: { id: string; storeName?: string | null }[];
  lojaAtualId?: string;
}) {
  const [recusando, setRecusando] = useState(false);
  const [lojaEscolhida, setLojaEscolhida] = useState(lojaAtualId);
  const [motivoEscolhido, setMotivoEscolhido] = useState(MOTIVOS_DE_RECUSA[0]);
  const [outro, setOutro] = useState("");
  const [enviando, setEnviando] = useState<"aceitar" | "recusar" | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  // ── O TOQUE: três notas subindo, a cada 10 s, enquanto o aviso estiver aberto.
  // O navegador só deixa tocar depois de um clique na página; o painel de
  // pedidos já costuma ter sido clicado, e o aviso escrito vale de qualquer jeito.
  const ctxRef = useRef<AudioContext | null>(null);
  const tocar = useCallback(() => {
    try {
      const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!Ctx) return;
      if (!ctxRef.current) ctxRef.current = new Ctx();
      const ctx = ctxRef.current!;
      if (ctx.state !== "running") { ctx.resume().catch(() => {}); return; }
      const t = ctx.currentTime + 0.05;
      [523, 659, 784].forEach((f, i) => {
        const osc = ctx.createOscillator();
        const ganho = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(f, t + i * 0.18);
        ganho.gain.setValueAtTime(0.0001, t + i * 0.18);
        ganho.gain.exponentialRampToValueAtTime(0.35, t + i * 0.18 + 0.02);
        ganho.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.18 + 0.22);
        osc.connect(ganho).connect(ctx.destination);
        osc.start(t + i * 0.18);
        osc.stop(t + i * 0.18 + 0.25);
      });
    } catch {}
  }, []);
  useEffect(() => {
    tocar();
    const t = setInterval(tocar, 10_000);
    return () => {
      clearInterval(t);
      ctxRef.current?.close().catch(() => {});
      ctxRef.current = null;
    };
  }, [tocar]);

  const itens: any[] = Array.isArray(pedido?.items) ? pedido.items : [];
  const entrega = String(pedido?.deliveryType || "").toUpperCase() === "DELIVERY";
  const taxa = Number(pedido?.deliveryFee) || 0;
  const total = Number(pedido?.totalAmount) || 0;
  const troco = Number(pedido?.changeAmount) || 0;
  const obs = observacaoDoRobo(pedido?.notes);
  const whats = linkDoWhatsapp(pedido?.customerPhone);
  const motivoDaRecusa = motivoEscolhido === "Outro motivo" ? outro.trim() : motivoEscolhido;

  const escolheLoja = lojas.length > 1;

  async function aceitar() {
    if (enviando) return;
    setEnviando("aceitar");
    setErro(null);
    const falha = await onAceitar(escolheLoja ? lojaEscolhida || lojaAtualId : lojaAtualId);
    setEnviando(null);
    if (falha) setErro(falha);
  }

  async function recusar() {
    if (!motivoDaRecusa || enviando) return;
    setEnviando("recusar");
    setErro(null);
    const falha = await onNaoAceitar(motivoDaRecusa);
    setEnviando(null);
    if (falha) setErro(falha);
  }

  const linha: React.CSSProperties = { display: "flex", gap: 8, fontSize: "0.9rem", lineHeight: 1.35 };
  const rotulo: React.CSSProperties = { minWidth: 86, color: CINZA, fontWeight: 700, fontSize: "0.8rem" };
  const botao = (cor: string, cheio: boolean): React.CSSProperties => ({
    padding: "10px 14px", borderRadius: 9, fontWeight: 800, fontSize: "0.88rem", cursor: enviando ? "wait" : "pointer",
    fontFamily: "inherit", border: cheio ? "none" : `1.5px solid ${cor}`, background: cheio ? cor : "#fff", color: cheio ? "#fff" : cor,
  });

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(30,27,75,0.55)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div role="alertdialog" aria-label="Pedido novo do robô para conferir" style={{ background: "#fff", borderRadius: 14, width: "100%", maxWidth: 520, maxHeight: "92vh", overflowY: "auto", boxShadow: "0 20px 50px rgba(30,27,75,0.4)", fontFamily: "inherit", border: `2px solid ${ROXO}` }}>
        <div style={{ padding: "14px 18px", background: ROXO, color: "#fff", borderRadius: "12px 12px 0 0" }}>
          <div style={{ fontWeight: 900, fontSize: "1.1rem" }}>🤖 Pedido novo do robô — confira antes de aceitar</div>
          <div style={{ fontSize: "0.82rem", opacity: 0.92, marginTop: 3 }}>
            O cliente fechou no WhatsApp. O pedido <b>ainda não foi para a cozinha</b>: confira e aceite.
          </div>
        </div>

        <div style={{ padding: "14px 18px", display: "grid", gap: 7 }}>
          <div style={linha}><span style={rotulo}>Cliente</span><span><b>{pedido?.customerName || "—"}</b></span></div>
          <div style={{ ...linha, alignItems: "center" }}>
            <span style={rotulo}>WhatsApp</span>
            <span style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              {telefoneLegivel(pedido?.customerPhone)}
              {whats && (
                <a href={whats} target="_blank" rel="noreferrer" style={{ fontSize: "0.78rem", fontWeight: 800, color: VERDE, textDecoration: "none", border: `1px solid ${VERDE}`, borderRadius: 999, padding: "2px 10px" }}>
                  Abrir conversa ↗
                </a>
              )}
            </span>
          </div>
          <div style={linha}><span style={rotulo}>{entrega ? "Entrega" : "Retirada"}</span><span>{entrega ? pedido?.customerAddress || "—" : "Cliente busca na loja"}</span></div>
          <div style={linha}>
            <span style={rotulo}>Pagamento</span>
            <span>{pedido?.paymentMethod || "—"}{troco > total ? ` (troco para ${reais(troco)})` : ""}</span>
          </div>

          <div style={{ marginTop: 4, padding: "10px 12px", borderRadius: 10, background: ROXO_CLARO, border: `1px solid ${ROXO_BORDA}` }}>
            {itens.length === 0 ? (
              <div style={{ color: CINZA }}>O robô não lançou itens.</div>
            ) : (
              itens.map((i, k) => {
                const qtd = Math.max(1, Number(i.quantity) || 1);
                const escolhas = escolhasDoItem({ quantity: qtd, productName: i.productName || "", price: Number(i.price) || 0, comboSelections: i.comboSelections ?? null, notes: i.notes });
                return (
                  <div key={i.id || k} style={{ padding: "4px 0", borderBottom: k < itens.length - 1 ? `1px dashed ${ROXO_BORDA}` : "none" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontWeight: 700, fontSize: "0.92rem" }}>
                      <span>{qtd}x {i.productName || i.menuProduct?.name || "Item"}</span>
                      <span>{reais((Number(i.price) || 0) * qtd)}</span>
                    </div>
                    {escolhas && <div style={{ fontSize: "0.8rem", color: "#4C1D95", marginTop: 1 }}>↳ {escolhas}</div>}
                    {i.notes && <div style={{ fontSize: "0.8rem", color: CINZA }}>↳ Obs: {i.notes}</div>}
                  </div>
                );
              })
            )}
            {entrega && (
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem", color: CINZA, marginTop: 6 }}>
                <span>Taxa de entrega</span><span>{taxa > 0 ? reais(taxa) : "grátis"}</span>
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 900, fontSize: "1.02rem", marginTop: 4 }}>
              <span>Total</span><span>{reais(total)}</span>
            </div>
          </div>

          {obs && <div style={{ ...linha, alignItems: "flex-start" }}><span style={rotulo}>Anotações</span><span style={{ fontSize: "0.82rem", color: "#334155" }}>{obs}</span></div>}

          {escolheLoja && (
            // Igual à escolha de impressora: uma lista, um clique. O pedido
            // passa a ser da loja marcada (painel, comanda, cozinha e motoboys dela).
            <div style={{ marginTop: 4, padding: "10px 12px", borderRadius: 10, background: "#fff", border: `1.5px solid ${ROXO}`, display: "grid", gap: 6 }}>
              <div style={{ fontWeight: 800, fontSize: "0.85rem", color: ROXO }}>🏪 Em qual loja este pedido vai ser preparado?</div>
              {lojas.map((l) => (
                <label key={l.id} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: "0.92rem", cursor: "pointer", padding: "6px 8px", borderRadius: 8, background: lojaEscolhida === l.id ? ROXO_CLARO : "transparent", border: `1px solid ${lojaEscolhida === l.id ? ROXO_BORDA : "transparent"}` }}>
                  <input type="radio" name="loja-do-pedido-do-robo" checked={lojaEscolhida === l.id} onChange={() => setLojaEscolhida(l.id)} disabled={!!enviando} />
                  <span style={{ fontWeight: lojaEscolhida === l.id ? 800 : 500 }}>{l.storeName || "Loja"}</span>
                  {l.id === lojaAtualId && <span style={{ fontSize: "0.72rem", color: CINZA }}>(esta loja)</span>}
                </label>
              ))}
            </div>
          )}

          {recusando && (
            <div style={{ marginTop: 6, padding: 10, borderRadius: 10, background: "#FEF2F2", border: "1px solid #FECACA", display: "grid", gap: 6 }}>
              <div style={{ fontWeight: 700, fontSize: "0.85rem", color: VERMELHO }}>Por que não aceitar? O cliente recebe o motivo no WhatsApp.</div>
              {MOTIVOS_DE_RECUSA.map((m) => (
                <label key={m} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: "0.88rem", cursor: "pointer" }}>
                  <input type="radio" name="motivo-da-recusa-robo" checked={motivoEscolhido === m} onChange={() => setMotivoEscolhido(m)} />
                  {m}
                </label>
              ))}
              {motivoEscolhido === "Outro motivo" && (
                <input value={outro} onChange={(e) => setOutro(e.target.value)} placeholder="Escreva o motivo" style={{ padding: "7px 9px", borderRadius: 8, border: "1px solid #CBD5E1", fontFamily: "inherit" }} />
              )}
            </div>
          )}
          {erro && <div style={{ color: VERMELHO, fontSize: "0.85rem", fontWeight: 600 }}>{erro}</div>}
        </div>

        <div style={{ padding: "12px 18px", borderTop: `1px solid ${ROXO_BORDA}`, display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
          {quantosMais > 0 && <span style={{ marginRight: "auto", fontSize: "0.78rem", color: CINZA }}>+{quantosMais} esperando</span>}
          {!recusando ? (
            <>
              <button onClick={onDepois} disabled={!!enviando} style={{ padding: "10px 12px", borderRadius: 9, border: "1px solid #CBD5E1", background: "#fff", cursor: "pointer", fontFamily: "inherit", color: CINZA }}>Depois</button>
              <button onClick={() => setRecusando(true)} disabled={!!enviando} style={botao(VERMELHO, false)}>Não aceitar</button>
              <button onClick={onEditar} disabled={!!enviando} style={botao(ROXO, false)}>✏️ Editar</button>
              <button onClick={aceitar} disabled={!!enviando} style={botao(VERDE, true)}>
                {enviando === "aceitar" ? "Aceitando…" : "✓ Aceitar pedido"}
              </button>
            </>
          ) : (
            <>
              <button onClick={() => setRecusando(false)} disabled={!!enviando} style={{ padding: "10px 12px", borderRadius: 9, border: "1px solid #CBD5E1", background: "#fff", cursor: "pointer", fontFamily: "inherit" }}>Voltar</button>
              <button onClick={recusar} disabled={!!enviando || !motivoDaRecusa} style={botao(VERMELHO, true)}>
                {enviando === "recusar" ? "Cancelando…" : "Confirmar: não aceitar"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
