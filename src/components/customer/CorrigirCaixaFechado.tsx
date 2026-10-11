"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * "Corrigir contagem" no Histórico de caixas: o operador digitou errado no
 * fechamento e o caixa ficou com falta ou sobra que não aconteceu. Muda só o
 * CONTADO; o esperado é o do fechamento. Cada correção fica registrada com o
 * antes e o depois (lib/edicao-do-caixa.ts) e o Histórico mostra.
 */
type Forma = { chave: "cash" | "debit" | "credit" | "pix" | "voucher"; nome: string; esperado: number; contado: number | null };

const fmt = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "1.234,50", "1234,5", "1234.50", "R$ 30" → número; vazio → null (não conferida). */
function lerValor(texto: string): number | null | "invalido" {
  let t = texto.replace(/R\$|\s/g, "");
  if (!t) return null;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : "invalido";
}

export default function CorrigirCaixaFechado({ sessionId, formas }: { sessionId: string; formas: Forma[] }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [valores, setValores] = useState<Record<string, string>>({});
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  const abrir = () => {
    setValores(Object.fromEntries(formas.map((f) => [f.chave, f.contado == null ? "" : fmt(f.contado)])));
    setMotivo("");
    setErro("");
    setAberto(true);
  };

  const salvar = async () => {
    const contado: Record<string, number | null> = {};
    for (const f of formas) {
      const v = lerValor(valores[f.chave] || "");
      if (v === "invalido") { setErro(`O valor de ${f.nome} não é um número.`); return; }
      contado[f.chave] = v;
    }
    if (motivo.trim().length < 3) { setErro("Diga o que estava errado — fica registrado no histórico."); return; }
    setSalvando(true);
    setErro("");
    try {
      const r = await fetch("/api/cash-session/editar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, contado, motivo }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErro(j.error || "Não consegui salvar a correção."); setSalvando(false); return; }
      setAberto(false);
      setSalvando(false);
      router.refresh();
    } catch {
      setErro("Sem conexão.");
      setSalvando(false);
    }
  };

  const botao: React.CSSProperties = {
    padding: "6px 12px", borderRadius: 8, border: "1.5px solid #E2E8F0", background: "#FFF",
    color: "#475569", fontSize: "0.76rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
  };

  if (!aberto) {
    return <button type="button" style={botao} onClick={abrir}>✏️ Corrigir contagem</button>;
  }

  return (
    <div style={{ flexBasis: "100%", border: "1.5px solid #FDE68A", background: "#FFFBEB", borderRadius: 12, padding: 12, marginTop: 4 }}>
      <div style={{ fontWeight: 800, fontSize: "0.85rem", color: "#0F172A", marginBottom: 2 }}>Corrigir a contagem deste caixa</div>
      <div style={{ fontSize: "0.74rem", color: "#92400E", marginBottom: 10, lineHeight: 1.45 }}>
        Digite o que foi contado de verdade. O esperado do sistema não muda. A correção fica registrada no histórico com o seu nome, a data e como estava antes.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 8 }}>
        {formas.map((f) => (
          <label key={f.chave} style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: "0.74rem", fontWeight: 700, color: "#334155" }}>
            {f.nome}
            <input
              type="text"
              inputMode="decimal"
              value={valores[f.chave] ?? ""}
              placeholder="em branco = não conferido"
              onChange={(e) => setValores((v) => ({ ...v, [f.chave]: e.target.value }))}
              style={{ padding: "7px 9px", borderRadius: 8, border: "1.5px solid #E2E8F0", fontSize: "0.85rem", fontFamily: "inherit", background: "#FFF" }}
            />
            <span style={{ fontWeight: 500, color: "#64748B", fontSize: "0.68rem" }}>sistema: R$ {fmt(f.esperado)}</span>
          </label>
        ))}
      </div>
      <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: "0.74rem", fontWeight: 700, color: "#334155", marginTop: 10 }}>
        O que estava errado?
        <input
          type="text"
          value={motivo}
          maxLength={500}
          placeholder='ex.: "crédito digitado errado no fechamento"'
          onChange={(e) => setMotivo(e.target.value)}
          style={{ padding: "7px 9px", borderRadius: 8, border: "1.5px solid #E2E8F0", fontSize: "0.85rem", fontFamily: "inherit", background: "#FFF" }}
        />
      </label>
      {erro && <div style={{ fontSize: "0.76rem", color: "#B71C1C", fontWeight: 700, marginTop: 8 }}>{erro}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 10, justifyContent: "flex-end" }}>
        <button type="button" style={botao} disabled={salvando} onClick={() => setAberto(false)}>Cancelar</button>
        <button
          type="button"
          disabled={salvando}
          onClick={salvar}
          style={{ ...botao, background: "#0F766E", borderColor: "#0F766E", color: "#FFF" }}
        >
          {salvando ? "Salvando…" : "Salvar correção"}
        </button>
      </div>
    </div>
  );
}
