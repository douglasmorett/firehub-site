"use client";
import { useEffect, useState } from "react";
import { PALETA } from "@/lib/paleta-brasa";
import { FORMAS_DE_PAGAMENTO_NA_ENTREGA } from "@/lib/pagamento-na-entrega";
import { consultaDoBalcao, entregaNoPedidoDoBalcao, lerCotacaoNoBalcao } from "@/lib/entrega-no-checkout";
import { numeroDigitado, pagaEmDinheiro, ehRetirada } from "@/lib/finalizar-rascunho";

/**
 * "Finalizar pedido manualmente" — a janela do cartão "IA criando…".
 *
 * O robô lançou quase tudo e passou a conversa para a equipe (o caso da
 * Divinos, 25/09/2026: não achou o endereço). Aqui a loja confere e completa
 * o que falta — endereço, taxa, pagamento — e manda para a cozinha. A regra e
 * o porquê estão em lib/finalizar-rascunho.ts; a rota é
 * /api/store/orders/[id]/finalizar-rascunho.
 *
 * A taxa é cotada como no balcão (/api/delivery-fee, a mesma regra do
 * cardápio) e fica editável: "não localizado" deixa o campo vazio para a loja
 * decidir, e a cotação assinada vai junto para o pedido gravar distância,
 * ponto e repasse do motoboy.
 */

type Item = { id: string; nome: string; quantidade: number; preco: number; obs: string };
type Rascunho = {
  id: string;
  customerName: string | null;
  customerPhone: string | null;
  customerAddress: string | null;
  deliveryType: string | null;
  paymentMethod: string | null;
  changeAmount: number | null;
  deliveryFee: number;
  totalAmount: number;
  subtotal: number;
  notes: string | null;
  itens: Item[];
};

const reais = (n: number) => `R$ ${(Math.round((Number(n) || 0) * 100) / 100).toFixed(2).replace(".", ",")}`;

const campo: React.CSSProperties = {
  width: "100%", padding: "8px 10px", borderRadius: 8, border: `1px solid ${PALETA.areiaBorda}`,
  fontSize: "0.9rem", fontFamily: "inherit", boxSizing: "border-box", background: "#fff",
};
const rotulo: React.CSSProperties = { display: "block", fontSize: "0.75rem", fontWeight: 700, color: PALETA.areiaTinta, marginBottom: 4 };

export default function FinalizarPedidoDoRobo({
  orderId,
  onClose,
  onFinalizado,
}: {
  orderId: string;
  onClose: () => void;
  /** Depois de gravar: quem abriu atualiza a lista. */
  onFinalizado: (pedido: any) => void;
}) {
  const [carregando, setCarregando] = useState(true);
  const [rascunho, setRascunho] = useState<Rascunho | null>(null);
  const [cidade, setCidade] = useState("");
  const [statusAoFinalizar, setStatusAoFinalizar] = useState<"ACEITO" | "NOVO">("NOVO");
  const [erroDeCarga, setErroDeCarga] = useState<string | null>(null);

  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [tipo, setTipo] = useState<"DELIVERY" | "RETIRADA">("DELIVERY");
  const [endereco, setEndereco] = useState("");
  const [taxa, setTaxa] = useState("");
  const [taxaNaMao, setTaxaNaMao] = useState(false);
  const [aviso, setAviso] = useState<{ tom: "ok" | "alerta" | "erro"; texto: string } | null>(null);
  const [cotacao, setCotacao] = useState<{ token: string; endereco: string } | null>(null);
  const [cotando, setCotando] = useState(false);
  const [pagamento, setPagamento] = useState("");
  const [troco, setTroco] = useState("");
  const [obs, setObs] = useState("");

  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<{ texto: string; campo?: string } | null>(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const res = await fetch(`/api/store/orders/${orderId}/finalizar-rascunho`, { cache: "no-store" });
        const d = await res.json().catch(() => null);
        if (!vivo) return;
        if (!res.ok || !d?.pedido) {
          setErroDeCarga(d?.error || "Não consegui abrir o rascunho.");
          return;
        }
        const p: Rascunho = d.pedido;
        setRascunho(p);
        setCidade(d.cidadeDaLoja || "");
        setStatusAoFinalizar(d.statusAoFinalizar === "ACEITO" ? "ACEITO" : "NOVO");
        setNome(p.customerName || "");
        setTelefone(p.customerPhone || "");
        setTipo(ehRetirada(p.deliveryType) ? "RETIRADA" : "DELIVERY");
        setEndereco(p.customerAddress || "");
        setPagamento(p.paymentMethod || "");
        setTroco(p.changeAmount ? String(p.changeAmount).replace(".", ",") : "");
      } catch {
        if (vivo) setErroDeCarga("Não consegui abrir o rascunho. Verifique a internet e tente de novo.");
      } finally {
        if (vivo) setCarregando(false);
      }
    })();
    return () => { vivo = false; };
  }, [orderId]);

  // Endereço novo = cotação nova, mesmo que a taxa tenha sido digitada: a
  // combinação era com AQUELE endereço (a mesma regra do balcão).
  useEffect(() => { setTaxaNaMao(false); }, [endereco]);

  useEffect(() => {
    if (carregando || !rascunho) return;
    if (tipo !== "DELIVERY") { setAviso(null); setCotando(false); return; }
    const consulta = endereco.trim();
    if (consulta.length < 6) { setAviso(null); if (!taxaNaMao) setTaxa(""); return; }
    if (taxaNaMao) return;

    let vivo = true;
    const controle = typeof AbortController === "function" ? new AbortController() : null;
    setCotando(true);
    setTaxa("");
    setCotacao(null);
    const agendado = setTimeout(async () => {
      try {
        const res = await fetch(`/api/delivery-fee?${consultaDoBalcao(consulta, cidade)}`, { signal: controle?.signal });
        const d = await res.json().catch(() => null);
        if (!vivo) return;
        const lida = lerCotacaoNoBalcao(res.ok ? d : null, d?.message);
        setTaxa(lida.taxa ?? "");
        setAviso({ tom: lida.tom, texto: lida.texto });
        setCotacao(lida.cotacao ? { token: lida.cotacao, endereco: consulta } : null);
      } catch {
        if (vivo) setAviso({ tom: "erro", texto: "Não consegui calcular a taxa. Digite o valor na mão." });
      } finally {
        if (vivo) setCotando(false);
      }
    }, 500);
    return () => { vivo = false; controle?.abort(); clearTimeout(agendado); setCotando(false); };
  }, [carregando, rascunho, tipo, endereco, taxaNaMao, cidade]);

  const taxaNumero = tipo === "DELIVERY" ? numeroDigitado(taxa) : 0;
  const total = rascunho ? Math.max(0, rascunho.subtotal) + (Number.isFinite(taxaNumero) ? taxaNumero : 0) : 0;
  const formas: string[] = [...FORMAS_DE_PAGAMENTO_NA_ENTREGA];
  if (rascunho?.paymentMethod && !formas.includes(rascunho.paymentMethod)) formas.unshift(rascunho.paymentMethod);

  async function finalizar() {
    if (!rascunho || salvando) return;
    setErro(null);
    setSalvando(true);
    try {
      const res = await fetch(`/api/store/orders/${rascunho.id}/finalizar-rascunho`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipo,
          customerName: nome,
          customerPhone: telefone,
          customerAddress: endereco,
          taxa: tipo === "DELIVERY" ? taxa : 0,
          paymentMethod: pagamento,
          troco,
          observacao: obs,
          ...(tipo === "DELIVERY" ? entregaNoPedidoDoBalcao(endereco, cotacao, taxaNaMao, cidade) : {}),
        }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.success) {
        setErro({ texto: d?.error || "Não consegui finalizar o pedido.", campo: d?.campo });
        return;
      }
      onFinalizado(d.order);
    } catch {
      setErro({ texto: "Não consegui falar com o servidor. Verifique a internet e tente de novo." });
    } finally {
      setSalvando(false);
    }
  }

  const corDoAviso = aviso?.tom === "ok" ? PALETA.ok : aviso?.tom === "alerta" ? PALETA.atencao : PALETA.grave;
  const destaque = (nomeDoCampo: string): React.CSSProperties =>
    erro?.campo === nomeDoCampo ? { borderColor: PALETA.grave, boxShadow: `0 0 0 2px ${PALETA.graveClaro}` } : {};

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(28,25,23,0.55)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Finalizar pedido manualmente"
        style={{ background: "#fff", borderRadius: 14, width: "100%", maxWidth: 520, maxHeight: "92vh", overflowY: "auto", boxShadow: "0 20px 50px rgba(0,0,0,0.3)", fontFamily: "inherit" }}
      >
        <div style={{ padding: "14px 18px", borderBottom: `1px solid ${PALETA.areiaBorda}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: "1.05rem", color: PALETA.carvao }}>✍️ Finalizar pedido manualmente</div>
            <div style={{ fontSize: "0.78rem", color: PALETA.areiaTinta }}>O robô montou este pedido e passou a conversa para a equipe. Confira, complete e mande para a cozinha.</div>
          </div>
          <button onClick={onClose} aria-label="Fechar" style={{ border: "none", background: "transparent", fontSize: "1.3rem", cursor: "pointer", color: PALETA.areiaTinta }}>×</button>
        </div>

        <div style={{ padding: "14px 18px", display: "grid", gap: 12 }}>
          {carregando && <div style={{ color: PALETA.areiaTinta }}>Abrindo o rascunho…</div>}
          {erroDeCarga && (
            <div style={{ color: PALETA.grave, background: PALETA.graveClaro, border: `1px solid ${PALETA.graveBorda}`, padding: 10, borderRadius: 8 }}>
              {erroDeCarga}
            </div>
          )}

          {rascunho && (
            <>
              <div style={{ background: PALETA.areia, border: `1px solid ${PALETA.areiaBorda}`, borderRadius: 10, padding: 10 }}>
                <div style={{ ...rotulo, marginBottom: 6 }}>Itens que o robô lançou</div>
                {rascunho.itens.map((i) => (
                  <div key={i.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: "0.88rem", padding: "2px 0" }}>
                    <span>
                      <b>{i.quantidade}x</b> {i.nome}
                      {i.obs ? <span style={{ color: PALETA.areiaTinta }}> — {i.obs}</span> : null}
                    </span>
                    <span style={{ whiteSpace: "nowrap" }}>{reais(i.preco * i.quantidade)}</span>
                  </div>
                ))}
                {rascunho.itens.length === 0 && <div style={{ color: PALETA.grave, fontSize: "0.85rem" }}>Nenhum item lançado — lance o pedido pelo balcão.</div>}
                <div style={{ fontSize: "0.75rem", color: PALETA.areiaTinta, marginTop: 6 }}>Para trocar item, finalize e use o lápis (editar pedido) no cartão.</div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  <label style={rotulo}>Cliente</label>
                  <input value={nome} onChange={(e) => setNome(e.target.value)} style={{ ...campo, ...destaque("customerName") }} />
                </div>
                <div>
                  <label style={rotulo}>Telefone</label>
                  <input value={telefone} onChange={(e) => setTelefone(e.target.value)} style={campo} />
                </div>
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                {(["DELIVERY", "RETIRADA"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTipo(t)}
                    style={{
                      flex: 1, padding: "8px 10px", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontFamily: "inherit",
                      border: `1.5px solid ${tipo === t ? PALETA.carvao : PALETA.areiaBorda}`,
                      background: tipo === t ? PALETA.carvao : "#fff", color: tipo === t ? "#fff" : PALETA.carvao,
                    }}
                  >
                    {t === "DELIVERY" ? "🛵 Entrega" : "🛍️ Retirada"}
                  </button>
                ))}
              </div>

              {tipo === "DELIVERY" && (
                <>
                  <div>
                    <label style={rotulo}>Endereço de entrega (rua, número, bairro — e a referência)</label>
                    <input value={endereco} onChange={(e) => setEndereco(e.target.value)} placeholder="Ex.: Travessa Pantanal, 130 - Jardim Esperança" style={{ ...campo, ...destaque("customerAddress") }} />
                  </div>
                  <div>
                    <label style={rotulo}>Taxa de entrega</label>
                    <input
                      value={taxa}
                      onChange={(e) => { setTaxa(e.target.value); setTaxaNaMao(true); }}
                      inputMode="decimal"
                      placeholder={cotando ? "calculando…" : "0,00"}
                      style={{ ...campo, maxWidth: 160, ...destaque("taxa") }}
                    />
                    {cotando && <div style={{ fontSize: "0.78rem", color: PALETA.areiaTinta, marginTop: 4 }}>Calculando pela área de entrega da loja…</div>}
                    {!cotando && aviso && <div style={{ fontSize: "0.78rem", color: corDoAviso, marginTop: 4 }}>{aviso.texto}</div>}
                  </div>
                </>
              )}

              <div style={{ display: "grid", gridTemplateColumns: pagaEmDinheiro(pagamento) ? "1fr 1fr" : "1fr", gap: 10 }}>
                <div>
                  <label style={rotulo}>Pagamento</label>
                  <select value={pagamento} onChange={(e) => setPagamento(e.target.value)} style={{ ...campo, ...destaque("paymentMethod") }}>
                    {!pagamento && <option value="">Escolha…</option>}
                    {formas.map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>
                {pagaEmDinheiro(pagamento) && (
                  <div>
                    <label style={rotulo}>Troco para</label>
                    <input value={troco} onChange={(e) => setTroco(e.target.value)} inputMode="decimal" placeholder="ex.: 100" style={campo} />
                  </div>
                )}
              </div>

              <div>
                <label style={rotulo}>Observação da loja (sai na comanda)</label>
                <textarea value={obs} onChange={(e) => setObs(e.target.value)} rows={2} style={{ ...campo, resize: "vertical" }} />
              </div>

              <div style={{ borderTop: `1px dashed ${PALETA.areiaBorda}`, paddingTop: 10, display: "grid", gap: 4, fontSize: "0.9rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span>Itens</span><span>{reais(rascunho.subtotal)}</span></div>
                {tipo === "DELIVERY" && (
                  <div style={{ display: "flex", justifyContent: "space-between" }}><span>Entrega</span><span>{Number.isFinite(taxaNumero) ? reais(taxaNumero) : "—"}</span></div>
                )}
                <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 800, fontSize: "1rem" }}><span>Total</span><span>{reais(total)}</span></div>
                <div style={{ fontSize: "0.75rem", color: PALETA.areiaTinta }}>
                  {statusAoFinalizar === "ACEITO"
                    ? "Vai direto para Em produção (o aceite automático do robô está ligado) e a comanda sai."
                    : "Vai para Novos pedidos, com número do dia, e a comanda sai como a de qualquer pedido."}
                  {" "}O cliente recebe o “Pedido recebido” no WhatsApp.
                </div>
              </div>

              {erro && (
                <div style={{ color: PALETA.grave, background: PALETA.graveClaro, border: `1px solid ${PALETA.graveBorda}`, padding: 10, borderRadius: 8, fontSize: "0.88rem" }}>
                  {erro.texto}
                </div>
              )}
            </>
          )}
        </div>

        <div style={{ padding: "12px 18px", borderTop: `1px solid ${PALETA.areiaBorda}`, display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "9px 14px", borderRadius: 8, border: `1px solid ${PALETA.areiaBorda}`, background: "#fff", cursor: "pointer", fontFamily: "inherit" }}>
            Fechar
          </button>
          {rascunho && (
            <button
              onClick={finalizar}
              disabled={salvando || cotando || rascunho.itens.length === 0}
              style={{
                padding: "9px 16px", borderRadius: 8, border: "none", fontWeight: 800, fontFamily: "inherit",
                background: salvando || cotando ? PALETA.areiaTinta : PALETA.marca, color: "#fff",
                cursor: salvando || cotando ? "wait" : "pointer",
              }}
            >
              {salvando ? "Finalizando…" : "Finalizar e mandar para a cozinha"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
