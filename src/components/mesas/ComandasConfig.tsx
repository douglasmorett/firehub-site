"use client";

/**
 * ⚙️ Gerenciar Mesas › 🎫 Comandas — os cartões numerados (lib/comanda.ts).
 *
 * Cria uma faixa de cartões de uma vez (101 a 300), imprime os cartões com o
 * código de barras (/store/mesas/cartoes) e apaga os que nunca foram usados.
 * Os números são os mesmos das mesas: a faixa sugerida começa acima delas.
 */
import { useState } from "react";

type Comanda = { id: string; number: number; openSession: unknown };

export default function ComandasConfig({ comandas, maiorMesa, onMudou }: {
  comandas: Comanda[];
  maiorMesa: number;
  onMudou: () => void;
}) {
  const numeros = comandas.map((c) => c.number).sort((a, b) => a - b);
  const sugestao = numeros.length ? numeros[numeros.length - 1] + 1 : maiorMesa < 100 ? 101 : maiorMesa + 1;
  const [de, setDe] = useState(String(sugestao));
  const [ate, setAte] = useState(String(sugestao + 99));
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);

  async function criar() {
    setSalvando(true);
    setAviso(null);
    try {
      const r = await fetch("/api/store/tables", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comandas: { de, ate } }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Erro ao criar");
      setAviso({ ok: true, texto: j.criadas ? `${j.criadas} cartões criados.` : "Esses números já eram comandas." });
      onMudou();
    } catch (e: any) {
      setAviso({ ok: false, texto: e.message });
    } finally {
      setSalvando(false);
    }
  }

  async function apagarLivres() {
    if (!confirm("Apagar os cartões que nunca tiveram conta? Os já usados ficam (o histórico do caixa depende deles).")) return;
    setSalvando(true);
    try {
      const r = await fetch("/api/store/tables?comandasLivres=1", { method: "DELETE" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Erro ao apagar");
      setAviso({ ok: true, texto: `${j.apagadas} cartões apagados.` });
      onMudou();
    } catch (e: any) {
      setAviso({ ok: false, texto: e.message });
    } finally {
      setSalvando(false);
    }
  }

  const campo: React.CSSProperties = { width: 90, padding: "10px 12px", borderRadius: 10, border: "1.5px solid #CBD5E1", fontSize: 16, fontWeight: 800, fontFamily: "inherit" };
  const botao = (cor: string): React.CSSProperties => ({
    padding: "12px", borderRadius: 12, border: "none", background: cor, color: "#fff",
    fontSize: 15, fontWeight: 800, cursor: "pointer", fontFamily: "inherit", opacity: salvando ? 0.6 : 1,
  });

  return (
    <div style={{ padding: "8px 0 16px" }}>
      <p style={{ margin: "4px 0 12px", fontSize: 13, color: "#475569", lineHeight: 1.5 }}>
        Cartão numerado para self-service e bar: cada cliente leva o seu, e tudo o que consome entra nele — o prato da
        balança, a bebida que o garçom lança. No caixa, passe o cartão em <b>Mesas › 🎫 Comandas</b> e feche a conta como
        uma mesa.
      </p>
      <div style={{ fontSize: 14, fontWeight: 800, color: "#0F172A", marginBottom: 12 }}>
        {numeros.length
          ? `${numeros.length} cartões cadastrados (${numeros[0]} a ${numeros[numeros.length - 1]})`
          : "Nenhum cartão cadastrado"}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: "#334155" }}>Criar do nº</span>
        <input type="number" min={1} value={de} onChange={(e) => setDe(e.target.value)} style={campo} aria-label="Primeiro número" />
        <span style={{ fontSize: 14, fontWeight: 700, color: "#334155" }}>ao</span>
        <input type="number" min={1} value={ate} onChange={(e) => setAte(e.target.value)} style={campo} aria-label="Último número" />
      </div>
      <p style={{ margin: "8px 0 0", fontSize: 12, color: "#64748B" }}>
        Os números não podem ser de mesa{maiorMesa > 0 ? ` (suas mesas vão até a ${maiorMesa})` : ""}.
      </p>
      <button type="button" onClick={criar} disabled={salvando} style={{ ...botao("#334155"), width: "100%", marginTop: 12 }}>
        {salvando ? "Salvando..." : "Criar cartões"}
      </button>

      {numeros.length > 0 && (
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <a href={`/store/mesas/cartoes?de=${numeros[0]}&ate=${numeros[numeros.length - 1]}`} target="_blank" rel="noreferrer"
            style={{ ...botao("#0F766E"), flex: 1, textAlign: "center", textDecoration: "none" }}>
            🖨️ Imprimir cartões
          </a>
          <button type="button" onClick={apagarLivres} disabled={salvando} style={{ ...botao("#B91C1C"), flex: 1 }}>
            Apagar não usados
          </button>
        </div>
      )}

      {aviso && (
        <div role="status" style={{ marginTop: 10, fontSize: 13, fontWeight: 700, color: aviso.ok ? "#0F766E" : "#B71C1C" }}>
          {aviso.texto}
        </div>
      )}
      <p style={{ margin: "14px 0 0", fontSize: 12, color: "#64748B", lineHeight: 1.5 }}>
        O cartão sai com o número grande e o código de barras (Code 39), que qualquer leitor USB lê. Imprima em papel
        grosso e plastifique, ou mande o PDF para uma gráfica.
      </p>
    </div>
  );
}
