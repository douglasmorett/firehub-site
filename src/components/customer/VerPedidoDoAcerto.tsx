"use client";
/**
 * "Ver pedido" no acerto do motoboy (Motoboys → Relatório), aberto NA PRÓPRIA
 * TELA, com o botão de imprimir os valores.
 *
 * ── Por que voltou a ser uma janela aqui ────────────────────────────────────
 * Em 09/10/2026 o "Ver pedido" passou a abrir a tela de Pedidos em outra aba,
 * para editar com a comanda de verdade. No acerto isso atrapalhava: a aba nova
 * carrega o quadro inteiro do dia, e o pedido só aparece depois que a lista
 * chega — no vídeo do Fellipe (Delícia de Casa, 10/10/2026) ele viu o quadro
 * sem o pedido e desistiu. Ele pediu "aparecer o pedido nessa tela mesmo e a
 * opção de imprimir os valores". Editar continua a um clique: o botão "Editar
 * na tela de Pedidos" abre a aba de antes.
 *
 * ── Imprimir ────────────────────────────────────────────────────────────────
 * Pelo navegador, só o recibo deste pedido (iframe escondido). NÃO passa pela
 * fila do Assistente: a fila manda cada item para a impressora da categoria,
 * e uma "reimpressão" no acerto faria a cozinha montar o pedido de novo.
 */
import { useEffect } from "react";
import { X } from "lucide-react";
import { contaDoPedido, emReais } from "@/lib/conta-do-pedido";
import { safeParseCombo } from "@/lib/parse-combo";
import { nomeDoItem } from "@/lib/nome-do-item";
import { lerHistorico, quandoFoi, ROTULO_DA_EDICAO } from "@/lib/historico-do-pedido";
import { CAIXAS_DO_ACERTO, partesDaEntrega } from "@/lib/resumo-do-entregador";

type Props = {
  pedido: any;
  /** Nome do entregador do cartão onde a entrega está. */
  entregador: string;
  tz: string;
  /** A tela de Pedidos com este pedido aberto, para editar. */
  linkDeEdicao: string;
  aoFechar: () => void;
};

const rotuloDaCaixa = new Map(CAIXAS_DO_ACERTO.map((c) => [c.chave, c.curto]));

const escapar = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

/** O número que a loja procura: o do dia, ou o da plataforma. */
export function numeroDoPedido(o: any): string {
  if (o.dailyOrderNumber) return `#${o.dailyOrderNumber}`;
  if (o.ifoodReference) return `#${o.ifoodReference}`;
  if (o.openDeliveryReference) return `#${o.openDeliveryReference}`;
  return `#${String(o.id || "").slice(-6).toUpperCase()}`;
}

/** Itens com as escolhas de cada um ("+ 2x Bacon"), no formato da tela e do papel. */
function itensDoPedido(o: any) {
  const lista = Array.isArray(o.items) ? o.items : [];
  return lista.map((it: any) => {
    const qtd = Number(it.quantity ?? it.qty ?? 1) || 1;
    const opcoes = safeParseCombo(it.comboSelections)
      .map((s: any) => {
        const nome = String(s?.name || s?.nome || "").trim();
        if (!nome) return null;
        const q = Number(s?.quantity ?? s?.qty ?? 1) || 1;
        return q > 1 ? `${q}x ${nome}` : nome;
      })
      .filter(Boolean) as string[];
    return { qtd, nome: nomeDoItem(it), valor: Number(it.price || 0) * qtd, opcoes, obs: String(it.notes || "").trim() };
  });
}

function quandoFoiFeito(o: any, tz: string): string {
  const d = new Date(o.createdAt || o.date);
  if (isNaN(d.getTime())) return "";
  return `${d.toLocaleDateString("pt-BR", { timeZone: tz })} às ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: tz })}`;
}

/** O recibo do pedido em HTML de bobina (72 mm), para o iframe de impressão. */
function reciboParaImprimir(o: any, entregador: string, tz: string): string {
  const conta = contaDoPedido(o);
  const partes = partesDaEntrega(o);
  const linha = (esq: string, dir = "", forte = false) =>
    `<div class="l${forte ? " f" : ""}"><span>${escapar(esq)}</span><span>${escapar(dir)}</span></div>`;
  const itens = itensDoPedido(o)
    .map((i: any) =>
      linha(`${i.qtd}x ${i.nome}`, emReais(i.valor)) +
      i.opcoes.map((op: string) => `<div class="op">+ ${escapar(op)}</div>`).join("") +
      (i.obs ? `<div class="op">Obs: ${escapar(i.obs)}</div>` : ""),
    )
    .join("");
  const dinheiro = partes.find((p) => p.caixa === "DINHEIRO" && p.trocoPara);
  return `<!doctype html><html><head><meta charset="utf-8"><title>Pedido ${escapar(numeroDoPedido(o))}</title><style>
@page{margin:3mm}
body{font-family:Arial,Helvetica,sans-serif;font-size:11pt;color:#000;margin:0}
.r{width:72mm}
h1{font-size:14pt;margin:0 0 2px}
.m{font-size:9.5pt;margin:1px 0}
hr{border:0;border-top:1px dashed #000;margin:6px 0}
.l{display:flex;justify-content:space-between;gap:8px;margin:2px 0}
.l span:last-child{white-space:nowrap}
.f{font-weight:700;font-size:12.5pt}
.op{font-size:9.5pt;padding-left:10px}
</style></head><body><div class="r">
<h1>Pedido ${escapar(numeroDoPedido(o))}</h1>
<div class="m">${escapar(quandoFoiFeito(o, tz))}${o.ifoodReference && o.dailyOrderNumber ? ` · iFood #${escapar(o.ifoodReference)}` : ""}</div>
<hr>
<div class="m"><b>Cliente:</b> ${escapar(o.customerName || "")}</div>
${o.customerPhone ? `<div class="m"><b>Tel:</b> ${escapar(o.customerPhone)}</div>` : ""}
${o.customerAddress ? `<div class="m"><b>End.:</b> ${escapar(o.customerAddress)}</div>` : ""}
<hr>
${itens}
<hr>
${linha("Subtotal dos itens", emReais(conta.subtotal))}
${conta.ajustes.map((a) => linha(a.rotulo, emReais(a.valor))).join("")}
${linha("Taxa de entrega", emReais(conta.taxaEntrega))}
${linha("TOTAL", emReais(conta.total), true)}
<hr>
<div class="m"><b>Pagamento:</b> ${escapar(o.paymentMethod || "—")}</div>
<div class="m"><b>No acerto:</b> ${escapar(partes.map((p) => `${(rotuloDaCaixa.get(p.caixa) || p.caixa).replace(/^\S+\s/, "")}${partes.length > 1 ? ` ${emReais(p.valor)}` : ""}`).join(" + "))}</div>
${dinheiro ? `<div class="m"><b>Troco para:</b> ${escapar(emReais(dinheiro.trocoPara))} (troco ${escapar(emReais((dinheiro.trocoPara || 0) - dinheiro.valor))})</div>` : ""}
<div class="m"><b>Entregador:</b> ${escapar(entregador)}${o.ganhoDoMotoboy != null ? ` — recebe ${escapar(emReais(o.ganhoDoMotoboy))}` : ""}</div>
${o.cancelado ? `<div class="m"><b>PEDIDO CANCELADO</b></div>` : ""}
${o.notes ? `<hr><div class="m"><b>Obs.:</b> ${escapar(o.notes)}</div>` : ""}
</div></body></html>`;
}

/** Imprime pelo navegador só o recibo, num iframe que some depois. */
function imprimirRecibo(html: string) {
  const quadro = document.createElement("iframe");
  quadro.setAttribute("aria-hidden", "true");
  Object.assign(quadro.style, { position: "fixed", right: "0", bottom: "0", width: "0", height: "0", border: "0" });
  document.body.appendChild(quadro);
  const janela = quadro.contentWindow;
  if (!janela) { quadro.remove(); return; }
  janela.document.open();
  janela.document.write(html);
  janela.document.close();
  // O Chrome segura o print() até o diálogo fechar; o tempo é para os outros.
  setTimeout(() => {
    janela.focus();
    janela.print();
    setTimeout(() => quadro.remove(), 1000);
  }, 50);
}

export default function VerPedidoDoAcerto({ pedido: o, entregador, tz, linkDeEdicao, aoFechar }: Props) {
  const conta = contaDoPedido(o);
  const partes = partesDaEntrega(o);
  const itens = itensDoPedido(o);
  const historico = lerHistorico(o.editHistory);
  const dinheiro = partes.find((p) => p.caixa === "DINHEIRO" && p.trocoPara);

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => { if (e.key === "Escape") aoFechar(); };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [aoFechar]);

  const linhaDaConta = (rotulo: string, valor: number, forte = false) => (
    <div key={rotulo} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: forte ? "0.95rem" : "0.84rem", fontWeight: forte ? 900 : 600, color: forte ? "#0F172A" : "#475569", padding: forte ? "6px 0 0" : "2px 0", borderTop: forte ? "2px solid #CBD5E1" : "none", marginTop: forte ? 4 : 0 }}>
      <span>{rotulo}</span>
      <span style={{ fontVariantNumeric: "tabular-nums", color: forte ? "#0F766E" : valor < 0 ? "#B71C1C" : "#0F172A" }}>{emReais(valor)}</span>
    </div>
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Pedido ${numeroDoPedido(o)}`}
      onClick={aoFechar}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 1000, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "24px 16px", overflowY: "auto" }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 18, padding: "1.25rem", width: "100%", maxWidth: 480, boxShadow: "0 20px 60px rgba(0,0,0,0.3)", position: "relative" }}>
        <button type="button" onClick={aoFechar} aria-label="Fechar" style={{ position: "absolute", top: 12, right: 12, background: "#F1F5F9", border: "none", borderRadius: "50%", width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
          <X size={16} color="#64748B" />
        </button>

        <div style={{ marginBottom: 12, paddingRight: 36 }}>
          <h3 style={{ margin: 0, fontWeight: 900, fontSize: "1.1rem", color: "#0F172A" }}>
            Pedido {numeroDoPedido(o)}
            {o.cancelado && <span style={{ marginLeft: 8, background: "#FEE2E2", color: "#B91C1C", padding: "2px 8px", borderRadius: 6, fontSize: "0.72rem", fontWeight: 800, verticalAlign: "middle" }}>CANCELADO</span>}
          </h3>
          <div style={{ fontSize: "0.78rem", color: "#64748B", marginTop: 2 }}>
            {quandoFoiFeito(o, tz)}
            {o.ifoodReference && o.dailyOrderNumber ? ` · iFood #${o.ifoodReference}` : ""}
            {` · 🛵 ${entregador}`}
          </div>
        </div>

        <div style={{ background: "#F8FAFC", borderRadius: 12, padding: "10px 12px", marginBottom: 10, border: "1px solid #E2E8F0" }}>
          <div style={{ fontWeight: 800, fontSize: "0.92rem", color: "#0F172A" }}>{o.customerName}</div>
          {o.customerPhone && <div style={{ fontSize: "0.8rem", color: "#1C1917", fontWeight: 600, marginTop: 2 }}>📞 {o.customerPhone}</div>}
          {o.customerAddress && <div style={{ fontSize: "0.8rem", color: "#475569", marginTop: 3, lineHeight: 1.4 }}>📍 {o.customerAddress}</div>}
        </div>

        {itens.length > 0 && (
          <div style={{ background: "#F8FAFC", borderRadius: 12, padding: "10px 12px", marginBottom: 10, border: "1px solid #E2E8F0" }}>
            <div style={{ fontSize: "0.7rem", fontWeight: 800, color: "#64748B", textTransform: "uppercase", marginBottom: 6 }}>Itens</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {itens.map((i: any, k: number) => (
                <div key={k}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: "0.84rem", color: "#1E293B" }}>
                    <span><b>{i.qtd}x</b> {i.nome}</span>
                    <b style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{emReais(i.valor)}</b>
                  </div>
                  {i.opcoes.length > 0 && <div style={{ fontSize: "0.76rem", color: "#64748B", paddingLeft: 18 }}>+ {i.opcoes.join(", ")}</div>}
                  {i.obs && <div style={{ fontSize: "0.76rem", color: "#92400E", paddingLeft: 18 }}>Obs: {i.obs}</div>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* A conta, pela mesma regra do papel (lib/conta-do-pedido.ts): o
            desconto que aparece é o que faz a soma bater com o que o cliente
            pagou — quem confere a entrega com o motoboy precisa ver os dois. */}
        <div style={{ background: "#FFFDF8", border: "1.5px solid #E2E8F0", borderRadius: 12, padding: "10px 12px", marginBottom: 10 }}>
          {linhaDaConta("Subtotal dos itens", conta.subtotal)}
          {conta.ajustes.map((a) => linhaDaConta(a.rotulo, a.valor))}
          {linhaDaConta("Taxa de entrega (cliente)", conta.taxaEntrega)}
          {linhaDaConta("Total do pedido", conta.total, true)}
        </div>

        <div style={{ background: "#F1F5F9", borderRadius: 10, padding: "9px 12px", marginBottom: 10, fontSize: "0.82rem", color: "#0F172A" }}>
          <div><span style={{ color: "#64748B", fontWeight: 700 }}>Pagamento:</span> <b>{o.paymentMethod || "—"}</b></div>
          <div style={{ marginTop: 3 }}>
            <span style={{ color: "#64748B", fontWeight: 700 }}>No acerto entra em:</span>{" "}
            <b>{partes.map((p) => `${rotuloDaCaixa.get(p.caixa) || p.caixa}${partes.length > 1 ? ` ${emReais(p.valor)}` : ""}`).join(" + ")}</b>
          </div>
          {dinheiro && (
            <div style={{ marginTop: 3, color: "#0F766E", fontWeight: 700 }}>
              💵 Troco para {emReais(dinheiro.trocoPara)} — o motoboy levou {emReais((dinheiro.trocoPara || 0) - dinheiro.valor)} de troco
            </div>
          )}
          {o.ganhoDoMotoboy != null && (
            <div style={{ marginTop: 3, color: "#9A3412", fontWeight: 700 }}>🛵 {entregador} recebe por esta entrega: {emReais(o.ganhoDoMotoboy)}</div>
          )}
        </div>

        {o.notes && (
          <div style={{ background: "#FFF7E6", border: "1px solid #FDE68A", borderRadius: 10, padding: "8px 12px", marginBottom: 10, fontSize: "0.8rem", color: "#92400E" }}>
            📝 <b>Obs:</b> {o.notes}
          </div>
        )}

        {historico.length > 0 && (
          <div style={{ border: "1px solid #FDE68A", background: "#FFFBEB", borderRadius: 10, padding: "8px 12px", marginBottom: 10 }}>
            <div style={{ fontSize: "0.72rem", fontWeight: 800, color: "#92400E", textTransform: "uppercase", marginBottom: 4 }}>✏️ Alterado {historico.length} {historico.length === 1 ? "vez" : "vezes"}</div>
            {historico.map((h, k) => (
              <div key={k} style={{ fontSize: "0.76rem", color: "#78350F", lineHeight: 1.45 }}>
                <b>{quandoFoi(h.quando, tz)}</b> · {h.quem} · {ROTULO_DA_EDICAO[h.acao] || h.acao}: {h.descricao}
              </div>
            ))}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
          <button
            type="button"
            onClick={() => imprimirRecibo(reciboParaImprimir(o, entregador, tz))}
            title="Imprime este pedido com os valores, pela impressora que você escolher"
            style={{ flex: "1 1 140px", padding: "10px", background: "#1C1917", color: "#fff", border: "none", borderRadius: 10, fontWeight: 800, fontSize: "0.86rem", cursor: "pointer", fontFamily: "inherit" }}
          >
            🖨️ Imprimir com valores
          </button>
          <a
            href={linkDeEdicao}
            target="_blank"
            rel="noopener"
            title="Abre a tela de Pedidos em outra aba, com o pedido aberto para editar"
            style={{ flex: "1 1 140px", padding: "10px", background: "#FAF6F2", color: "#1C1917", border: "1px solid #E7DDD3", borderRadius: 10, fontWeight: 700, fontSize: "0.84rem", textDecoration: "none", textAlign: "center" }}
          >
            ✏️ Editar na tela de Pedidos ↗
          </a>
          <button
            type="button"
            onClick={aoFechar}
            style={{ padding: "10px 16px", background: "#F1F5F9", color: "#475569", border: "none", borderRadius: 10, fontWeight: 700, fontSize: "0.84rem", cursor: "pointer", fontFamily: "inherit" }}
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
