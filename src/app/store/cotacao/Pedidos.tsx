"use client";

/**
 * Os pedidos de compra que a loja mandou: na fila, enviado, recebido. Ao marcar
 * "Recebi a mercadoria", os itens ligados a um insumo entram no estoque com o
 * custo (a mesma entrada da compra sem nota, lib/cmv/lancar-compra.ts); o que
 * não está ligado ou não tem o fator da caixa aparece dizendo o porquê.
 */

import { useCallback, useEffect, useState } from "react";
import { COR, COR_CLARA, S, VERDE, VERDE_CLARO, VERMELHO, numero, pedir, reais, type Aviso } from "./ui";

type Pedido = {
  id: string; fornecedor: string; status: string; total: number; texto: string; criadoEm: string; enviadoEm: string | null; recebidoEm: string | null;
  stockInvoiceId: string | null; itens: { produtoId: string; nome: string; unidade: string; quantidade: number; preco: number | null }[];
};

const STATUS: Record<string, { nome: string; cor: string; fundo: string }> = {
  FILA: { nome: "⏳ saindo", cor: COR, fundo: COR_CLARA },
  ENVIADO: { nome: "📨 enviado", cor: "#0369A1", fundo: "#E0F2FE" },
  FALHOU: { nome: "⚠ não saiu", cor: VERMELHO, fundo: "#FEF2F2" },
  RECEBIDO: { nome: "✅ recebido", cor: VERDE, fundo: VERDE_CLARO },
  CANCELADO: { nome: "cancelado", cor: "#64748B", fundo: "#F1F5F9" },
};

export default function Pedidos({ versao, onAviso }: { versao: number; onAviso: (a: Aviso) => void }) {
  const [pedidos, setPedidos] = useState<Pedido[] | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      setPedidos((await pedir<{ pedidos: Pedido[] }>("/api/store/cotacao/pedidos")).pedidos);
    } catch (e: any) {
      onAviso({ tipo: "erro", titulo: "Não carregou os pedidos", detalhe: e.message });
    }
  }, [onAviso]);
  useEffect(() => { carregar(); }, [carregar, versao]);
  useEffect(() => {
    if (!pedidos?.some((p) => p.status === "FILA")) return;
    const t = setInterval(carregar, 10_000);
    return () => clearInterval(t);
  }, [pedidos, carregar]);

  async function agir(p: Pedido, acao: "recebido" | "cancelar") {
    if (acao === "cancelar" && !window.confirm(`Cancelar o pedido para ${p.fornecedor}? Se já saiu, avise o fornecedor pelo WhatsApp.`)) return;
    setOcupado(p.id);
    try {
      const j = await pedir<{ noEstoque?: number; fora?: string[] }>("/api/store/cotacao/pedidos", "PUT", { id: p.id, acao });
      if (acao === "recebido") {
        onAviso({
          tipo: j.fora?.length ? "atencao" : "ok",
          titulo: j.noEstoque ? `${j.noEstoque} item${j.noEstoque === 1 ? "" : "s"} entrou no estoque com o custo.` : "Pedido marcado como recebido.",
          detalhe: j.fora?.length ? `Ficaram fora do estoque:\n${j.fora.join("\n")}` : "A conta a pagar você lança em Financeiro › Contas a pagar, com o vencimento do fornecedor.",
        });
      } else onAviso({ tipo: "ok", titulo: "Pedido cancelado." });
      carregar();
    } catch (e: any) {
      onAviso({ tipo: "erro", titulo: "Não deu certo", detalhe: e.message });
    } finally {
      setOcupado(null);
    }
  }

  if (!pedidos) return <div style={{ ...S.cartao, color: "#64748B" }}>Carregando…</div>;
  if (!pedidos.length) {
    return (
      <section style={{ ...S.cartao, textAlign: "center", padding: "30px 16px" }}>
        <div style={{ fontSize: 38 }}>🧾</div>
        <p style={{ ...S.texto, maxWidth: 460, margin: "6px auto 0" }}>Os pedidos aparecem aqui. Monte o primeiro no Comparativo: digite a quantidade nos itens e toque em “Revisar e enviar pedido”.</p>
      </section>
    );
  }

  return (
    <section style={{ ...S.cartao, padding: 0, overflow: "hidden" }}>
      <div style={{ padding: "12px 16px", borderBottom: "1px solid #F1F5F9", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <h2 style={{ ...S.h2, flex: 1 }}>Pedidos de compra</h2>
        <a href="/store/estoque" style={{ fontSize: 13, fontWeight: 800, color: COR }}>Ver o estoque →</a>
      </div>
      {pedidos.map((p) => {
        const st = STATUS[p.status] || STATUS.ENVIADO;
        const podeReceber = p.status === "ENVIADO" || p.status === "FALHOU";
        return (
          <div key={p.id} style={{ borderTop: "1px solid #F1F5F9" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "12px 16px" }}>
              <button type="button" onClick={() => setAberto(aberto === p.id ? null : p.id)} style={{ flex: "1 1 220px", minWidth: 0, border: 0, background: "none", textAlign: "left", padding: 0, cursor: "pointer", fontFamily: "inherit" }}>
                <div style={{ fontWeight: 900, color: "#0F172A" }}>{p.fornecedor} <span style={{ fontWeight: 600, color: "#94A3B8" }}>· {p.itens.length} item{p.itens.length === 1 ? "" : "s"}</span></div>
                <div style={{ fontSize: 12.5, color: "#64748B" }}>{new Date(p.criadoEm).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} · {aberto === p.id ? "esconder" : "ver itens e mensagem"}</div>
              </button>
              <b style={{ fontSize: 15.5 }}>{reais(p.total)}</b>
              <span style={{ ...S.chip, background: st.fundo, color: st.cor }}>{st.nome}</span>
              {podeReceber && <button type="button" disabled={ocupado === p.id} onClick={() => agir(p, "recebido")} style={{ ...S.botaoPequeno, background: VERDE, color: "#fff", border: 0 }}>Recebi a mercadoria</button>}
              {p.status !== "RECEBIDO" && p.status !== "CANCELADO" && <button type="button" disabled={ocupado === p.id} onClick={() => agir(p, "cancelar")} style={{ ...S.botaoPequeno, color: "#64748B" }}>Cancelar</button>}
            </div>
            {aberto === p.id && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12, padding: "0 16px 14px" }}>
                <div style={{ fontSize: 13.5 }}>
                  {p.itens.map((i) => (
                    <div key={i.produtoId} style={{ display: "flex", gap: 8, padding: "3px 0", borderBottom: "1px dashed #F1F5F9" }}>
                      <span style={{ flex: 1 }}>{numero(i.quantidade)} {i.unidade} · {i.nome}</span>
                      <span style={{ color: "#64748B" }}>{i.preco !== null ? reais(i.quantidade * i.preco) : "—"}</span>
                    </div>
                  ))}
                </div>
                <div style={{ background: "#E7FFDB", borderRadius: 12, padding: "10px 12px", fontSize: 13, whiteSpace: "pre-line", color: "#111B21" }}>{p.texto}</div>
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
