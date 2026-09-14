"use client";

/**
 * Em pedido de iFood/99Food, o entregador recebe o que veio do app ou o que a
 * loja combinou com ele?
 *
 * ── Por que isto vive na aba de Motoboys ────────────────────────────────────
 *
 * Nasceu na tela de Entrega, junto das faixas de taxa — e ali estava errado:
 * é uma decisão sobre PAGAMENTO DO ENTREGADOR, não sobre quanto o cliente
 * paga. Quem procura "quanto pago ao motoboy" abre Motoboys, não Entrega.
 *
 * A escolha é da loja inteira, não de um entregador: o mesmo pedido de app não
 * pode valer um número para um e outro para outro.
 */

import { useState } from "react";
import { explicarRegraDoApp, lerRegraDeRepasse, type OrigemDoRepasseNoApp } from "@/lib/repasse-do-entregador";

export default function RegraDoPagamentoDoApp({ deliveryConfig }: { deliveryConfig?: unknown }) {
  // O valor vem do servidor junto da página — /api/store-settings só tem PUT,
  // e inventar um GET só para ler uma chave seria rota nova para nada.
  const regraInicial = lerRegraDeRepasse(deliveryConfig);
  const [valor, setValor] = useState<OrigemDoRepasseNoApp>(() => regraInicial.marketplace);
  const [fixo, setFixo] = useState<string>(() =>
    regraInicial.valorFixoApp == null ? "" : String(regraInicial.valorFixoApp).replace(".", ","),
  );
  const carregando = false;
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState("");

  /** "4,00" e "4.00" viram 4. Vazio vira nulo. */
  const numeroDoCampo = (t: string): number | null => {
    const limpo = t.replace(/\s/g, "").replace(",", ".");
    if (!limpo) return null;
    const n = Number(limpo);
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
  };

  const gravar = async (modo: OrigemDoRepasseNoApp, textoDoFixo: string) => {
    setSalvando(true);
    setAviso("");
    try {
      const r = await fetch("/api/store-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        // Campo próprio: a rota mescla dentro do deliveryConfig sem apagar o
        // frete grátis, o pedido mínimo nem as áreas de risco.
        body: JSON.stringify({
          repasseDoEntregador: {
            separado: true,
            marketplace: modo,
            valorFixoApp: numeroDoCampo(textoDoFixo),
          },
        }),
      });
      if (!r.ok) throw new Error("salvar");
      setAviso("Salvo.");
      setTimeout(() => setAviso(""), 2200);
      return true;
    } catch {
      setAviso("Não consegui salvar agora. Tente de novo.");
      return false;
    } finally {
      setSalvando(false);
    }
  };

  const escolher = async (novo: OrigemDoRepasseNoApp) => {
    const anterior = valor;
    setValor(novo);
    // No FIXO sem valor ainda, não grava: espera a loja digitar quanto paga,
    // senão o relatório passaria a devolver "não configurado" sem ela saber.
    if (novo === "FIXO" && numeroDoCampo(fixo) == null) return;
    const ok = await gravar(novo, fixo);
    if (!ok) setValor(anterior);
  };

  const OPCOES: { v: OrigemDoRepasseNoApp; t: string; d: string }[] = [
    {
      v: "TABELA",
      t: "O valor que eu combinei com ele",
      d: "O acerto do entregador — faixa de km, valor por entrega ou diária, cadastrado aqui embaixo.",
    },
    {
      v: "APP",
      t: "O valor que veio do app",
      d: "A taxa de entrega que o iFood/99 pagou naquele pedido vai inteira para o entregador.",
    },
    {
      v: "FIXO",
      t: "Um valor fixo, só para pedido de app",
      d: "Sempre o mesmo por entrega de iFood/99, sem olhar a taxa nem a distância. No pedido do seu site continua valendo a taxa do próprio pedido.",
    },
  ];

  return (
    <div style={{ border: "1.5px solid #FED7AA", background: "#FFFBF5", borderRadius: 14, padding: "14px 16px", marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
        <b style={{ fontSize: "0.95rem", color: "#9A3412" }}>🔴 Pedido de iFood, 99Food e outros apps</b>
        {salvando && <span style={{ fontSize: "0.74rem", color: "#94A3B8" }}>salvando…</span>}
        {aviso && <span style={{ fontSize: "0.74rem", fontWeight: 700, color: aviso === "Salvo." ? "#16A34A" : "#B91C1C" }}>{aviso}</span>}
      </div>
      <p style={{ margin: "0 0 11px", fontSize: "0.8rem", color: "#64748B", lineHeight: 1.5 }}>
        Nesses pedidos, o que o entregador recebe é:
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 9 }}>
        {OPCOES.map((op) => (
          <button
            key={op.v}
            type="button"
            disabled={carregando}
            onClick={() => escolher(op.v)}
            style={{
              textAlign: "left", padding: "11px 13px", borderRadius: 11, cursor: carregando ? "wait" : "pointer",
              border: `2px solid ${valor === op.v ? "#C2410C" : "#E2E8F0"}`,
              background: valor === op.v ? "#FFF7ED" : "#fff", fontFamily: "inherit",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: "0.85rem", fontWeight: 800, color: valor === op.v ? "#9A3412" : "#334155" }}>
              <span>{valor === op.v ? "●" : "○"}</span>{op.t}
            </div>
            <div style={{ fontSize: "0.75rem", color: "#64748B", marginTop: 3, lineHeight: 1.45 }}>{op.d}</div>
          </button>
        ))}
      </div>

      {valor === "FIXO" && (
        <div style={{
          marginTop: 10, padding: "11px 13px", borderRadius: 11,
          background: "#fff", border: "2px solid #C2410C",
          display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
        }}>
          <label htmlFor="repasse-fixo-app" style={{ fontSize: "0.83rem", fontWeight: 800, color: "#9A3412" }}>
            Quanto você paga por entrega de app?
          </label>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: "0.85rem", fontWeight: 800, color: "#64748B" }}>R$</span>
            <input
              id="repasse-fixo-app"
              type="text"
              inputMode="decimal"
              placeholder="4,00"
              value={fixo}
              onChange={(e) => setFixo(e.target.value)}
              onBlur={() => gravar("FIXO", fixo)}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              style={{
                width: 100, padding: "8px 11px", borderRadius: 9,
                border: "1.5px solid #FDBA74", fontSize: "0.9rem", fontWeight: 800,
                fontFamily: "monospace", outline: "none",
              }}
            />
          </div>
          <span style={{ fontSize: "0.72rem", color: "#94A3B8" }}>
            Vale para iFood, 99Food e outros apps. Salva ao sair do campo.
          </span>
        </div>
      )}

      <p style={{
        margin: "10px 0 0", fontSize: "0.76rem", lineHeight: 1.5,
        color: valor === "APP" ? "#334155" : "#92400E",
        background: valor === "APP" ? "#F8FAFC" : "#FFFBEB",
        border: `1px solid ${valor === "APP" ? "#E2E8F0" : "#FDE68A"}`,
        borderRadius: 9, padding: "8px 11px",
      }}>
        {explicarRegraDoApp({ separado: true, marketplace: valor, valorFixoApp: numeroDoCampo(fixo) })}
      </p>
    </div>
  );
}
