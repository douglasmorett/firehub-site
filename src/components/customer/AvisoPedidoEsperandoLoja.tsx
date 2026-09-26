"use client";
import { useState } from "react";
import { PALETA } from "@/lib/paleta-brasa";

/**
 * "Pedido do WhatsApp esperando você" — o aviso que abre sozinho no painel de
 * pedidos quando o robô SEGUROU um pedido porque o mapa não confirmou o
 * endereço (lib/finalizar-rascunho.ts, marca "AGUARDANDO A LOJA").
 *
 * Regra do dono (25/09/2026): endereço não confirmado não entra sozinho na
 * produção. A loja vê os dados do cliente e decide:
 *   - Aceitar → abre "Finalizar pedido manualmente", onde confere a taxa;
 *   - Não aceitar → cancela o rascunho com o motivo (o cliente é avisado);
 *   - Depois → o aviso fecha; o cartão continua em Novos com o botão.
 */

const MOTIVOS_DE_RECUSA = [
  "Endereço fora da nossa área de entrega",
  "Não conseguimos confirmar o endereço",
  "Outro motivo",
];

const reais = (n: unknown) => `R$ ${(Math.round((Number(n) || 0) * 100) / 100).toFixed(2).replace(".", ",")}`;

export default function AvisoPedidoEsperandoLoja({
  pedido,
  motivo,
  quantosMais,
  onAceitar,
  onNaoAceitar,
  onDepois,
}: {
  pedido: any;
  /** Por que o robô segurou (a marca do rascunho). */
  motivo: string;
  /** Quantos outros pedidos estão esperando além deste. */
  quantosMais: number;
  onAceitar: () => void;
  /** Cancela o rascunho; devolve a mensagem de erro, ou null quando deu certo. */
  onNaoAceitar: (motivoDaRecusa: string) => Promise<string | null>;
  onDepois: () => void;
}) {
  const [recusando, setRecusando] = useState(false);
  const [motivoEscolhido, setMotivoEscolhido] = useState(MOTIVOS_DE_RECUSA[0]);
  const [outro, setOutro] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const itens: any[] = Array.isArray(pedido?.items) ? pedido.items : [];
  const motivoDaRecusa = motivoEscolhido === "Outro motivo" ? outro.trim() : motivoEscolhido;

  async function recusar() {
    if (!motivoDaRecusa || enviando) return;
    setEnviando(true);
    setErro(null);
    const falha = await onNaoAceitar(motivoDaRecusa);
    setEnviando(false);
    if (falha) setErro(falha);
  }

  const linha: React.CSSProperties = { display: "flex", gap: 8, fontSize: "0.9rem", lineHeight: 1.35 };
  const rotulo: React.CSSProperties = { minWidth: 78, color: PALETA.areiaTinta, fontWeight: 700, fontSize: "0.8rem" };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(28,25,23,0.55)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div role="alertdialog" aria-label="Pedido do WhatsApp esperando você" style={{ background: "#fff", borderRadius: 14, width: "100%", maxWidth: 480, maxHeight: "92vh", overflowY: "auto", boxShadow: "0 20px 50px rgba(0,0,0,0.3)", fontFamily: "inherit" }}>
        <div style={{ padding: "14px 18px", background: PALETA.atencaoClaro, borderBottom: `1px solid ${PALETA.atencaoBorda}`, borderRadius: "14px 14px 0 0" }}>
          <div style={{ fontWeight: 800, fontSize: "1.05rem", color: PALETA.carvao }}>📲 Pedido do WhatsApp esperando você</div>
          <div style={{ fontSize: "0.82rem", color: PALETA.atencao, marginTop: 2 }}>
            O robô <b>não pôs o pedido na produção</b>: {motivo}. Ele avisou o cliente que a loja vai confirmar.
          </div>
        </div>

        <div style={{ padding: "14px 18px", display: "grid", gap: 6 }}>
          <div style={linha}><span style={rotulo}>Cliente</span><span><b>{pedido?.customerName || "—"}</b></span></div>
          <div style={linha}><span style={rotulo}>Telefone</span><span>{pedido?.customerPhone || "—"}</span></div>
          <div style={linha}><span style={rotulo}>Endereço</span><span>{pedido?.customerAddress || "—"}</span></div>
          <div style={linha}><span style={rotulo}>Pagamento</span><span>{pedido?.paymentMethod || "—"}</span></div>
          <div style={{ ...linha, alignItems: "flex-start" }}>
            <span style={rotulo}>Itens</span>
            <span>
              {itens.length === 0
                ? "—"
                : itens.map((i, k) => (
                    <div key={i.id || k}>{i.quantity}x {i.productName || i.menuProduct?.name || "Item"}</div>
                  ))}
            </span>
          </div>
          <div style={linha}><span style={rotulo}>Total</span><span><b>{reais(pedido?.totalAmount)}</b> <span style={{ color: PALETA.areiaTinta, fontSize: "0.8rem" }}>(a taxa de entrega você confere ao aceitar)</span></span></div>

          {recusando && (
            <div style={{ marginTop: 8, padding: 10, borderRadius: 10, background: PALETA.graveClaro, border: `1px solid ${PALETA.graveBorda}`, display: "grid", gap: 6 }}>
              <div style={{ fontWeight: 700, fontSize: "0.85rem", color: PALETA.grave }}>Por que não aceitar? O cliente recebe o motivo no WhatsApp.</div>
              {MOTIVOS_DE_RECUSA.map((m) => (
                <label key={m} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: "0.88rem", cursor: "pointer" }}>
                  <input type="radio" name="motivo-da-recusa" checked={motivoEscolhido === m} onChange={() => setMotivoEscolhido(m)} />
                  {m}
                </label>
              ))}
              {motivoEscolhido === "Outro motivo" && (
                <input value={outro} onChange={(e) => setOutro(e.target.value)} placeholder="Escreva o motivo" style={{ padding: "7px 9px", borderRadius: 8, border: `1px solid ${PALETA.areiaBorda}`, fontFamily: "inherit" }} />
              )}
            </div>
          )}
          {erro && <div style={{ color: PALETA.grave, fontSize: "0.85rem" }}>{erro}</div>}
        </div>

        <div style={{ padding: "12px 18px", borderTop: `1px solid ${PALETA.areiaBorda}`, display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
          {quantosMais > 0 && <span style={{ marginRight: "auto", fontSize: "0.78rem", color: PALETA.areiaTinta }}>+{quantosMais} esperando</span>}
          {!recusando ? (
            <>
              <button onClick={onDepois} style={{ padding: "9px 12px", borderRadius: 8, border: `1px solid ${PALETA.areiaBorda}`, background: "#fff", cursor: "pointer", fontFamily: "inherit" }}>Depois</button>
              <button onClick={() => setRecusando(true)} style={{ padding: "9px 12px", borderRadius: 8, border: `1.5px solid ${PALETA.grave}`, background: "#fff", color: PALETA.grave, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Não aceitar</button>
              <button onClick={onAceitar} style={{ padding: "9px 14px", borderRadius: 8, border: "none", background: PALETA.ok, color: "#fff", fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>Aceitar e conferir a taxa</button>
            </>
          ) : (
            <>
              <button onClick={() => setRecusando(false)} disabled={enviando} style={{ padding: "9px 12px", borderRadius: 8, border: `1px solid ${PALETA.areiaBorda}`, background: "#fff", cursor: "pointer", fontFamily: "inherit" }}>Voltar</button>
              <button onClick={recusar} disabled={enviando || !motivoDaRecusa} style={{ padding: "9px 14px", borderRadius: 8, border: "none", background: PALETA.grave, color: "#fff", fontWeight: 800, cursor: enviando ? "wait" : "pointer", fontFamily: "inherit" }}>
                {enviando ? "Cancelando…" : "Confirmar: não aceitar"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
