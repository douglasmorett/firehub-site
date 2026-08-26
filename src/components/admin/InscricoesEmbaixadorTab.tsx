"use client";
import { useState, useEffect } from "react";

/**
 * Aba "Inscrições" do admin — quem se candidatou a embaixador.
 *
 * Triagem, não cadastro. Marcar APROVADO aqui é um lembrete para a equipe,
 * não um gatilho: quem vira embaixador de verdade é criado à mão na aba
 * Embaixadores, onde se define código, comissão e carteira do Asaas. Aprovar
 * automático seria deixar um formulário público decidir para onde vai dinheiro.
 */

interface Inscricao {
  id: string;
  fullName: string;
  instagram: string;
  followers: number;
  whatsapp: string | null;
  email: string | null;
  message: string | null;
  status: "NOVO" | "EM_ANALISE" | "APROVADO" | "RECUSADO";
  notes: string | null;
  createdAt: string;
}

const CORES: Record<string, { bg: string; fg: string; borda: string; rotulo: string }> = {
  NOVO:       { bg: "#EFF6FF", fg: "#1D4ED8", borda: "#BFDBFE", rotulo: "🆕 Novo" },
  EM_ANALISE: { bg: "#FFFBEB", fg: "#B45309", borda: "#FDE68A", rotulo: "🔎 Em análise" },
  APROVADO:   { bg: "#F0FDF4", fg: "#15803D", borda: "#BBF7D0", rotulo: "✅ Aprovado" },
  RECUSADO:   { bg: "#FEF2F2", fg: "#991B1B", borda: "#FCA5A5", rotulo: "❌ Recusado" },
};

const ORDEM_STATUS = ["NOVO", "EM_ANALISE", "APROVADO", "RECUSADO"] as const;

function formatarSeguidores(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(".0", "")} mi`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(".0", "")} mil`;
  return String(n);
}

export default function InscricoesEmbaixadorTab() {
  const [itens, setItens] = useState<Inscricao[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [aviso, setAviso] = useState<string>("");
  const [filtro, setFiltro] = useState<"TODOS" | (typeof ORDEM_STATUS)[number]>("TODOS");
  const [salvando, setSalvando] = useState<string | null>(null);

  useEffect(() => { carregar(); }, []);

  async function carregar() {
    setCarregando(true);
    try {
      const r = await fetch("/api/admin/inscricoes-embaixador");
      const d = await r.json();
      setItens(d.inscricoes || []);
      setAviso(d.aviso || "");
    } catch {
      setAviso("Não consegui carregar as inscrições.");
    } finally {
      setCarregando(false);
    }
  }

  async function mudarStatus(id: string, status: string) {
    setSalvando(id);
    // Otimista: a lista já reflete a escolha. Dando errado, `carregar()` no
    // finally traz de volta o que o banco realmente tem.
    setItens((prev) => prev.map((i) => (i.id === id ? { ...i, status: status as any } : i)));
    try {
      await fetch("/api/admin/inscricoes-embaixador", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
    } finally {
      setSalvando(null);
      carregar();
    }
  }

  const visiveis = filtro === "TODOS" ? itens : itens.filter((i) => i.status === filtro);
  const contar = (s: string) => itens.filter((i) => i.status === s).length;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 18 }}>
        <div>
          <h2 style={{ fontSize: "1.35rem", fontWeight: 900, color: "#0F172A", margin: 0 }}>
            Inscrições para embaixador
          </h2>
          <p style={{ fontSize: "0.85rem", color: "#64748B", margin: "4px 0 0" }}>
            Quem se candidatou pelo site. Aprovar aqui é só marcação — o cadastro
            do embaixador continua sendo feito à mão na aba Embaixadores.
          </p>
        </div>
        <button
          onClick={carregar}
          style={{ padding: "9px 16px", borderRadius: 10, border: "1px solid #CBD5E1", background: "#fff", fontWeight: 700, fontSize: "0.82rem", cursor: "pointer" }}
        >
          ↻ Atualizar
        </button>
      </div>

      {aviso && (
        <div style={{ background: "#FFFBEB", border: "1px solid #FDE68A", color: "#92400E", padding: "12px 15px", borderRadius: 12, fontSize: "0.85rem", marginBottom: 16, lineHeight: 1.55 }}>
          ⚠️ {aviso}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 }}>
        {(["TODOS", ...ORDEM_STATUS] as const).map((s) => (
          <button
            key={s}
            onClick={() => setFiltro(s as any)}
            style={{
              padding: "7px 14px", borderRadius: 50, fontWeight: 700, fontSize: "0.8rem", cursor: "pointer",
              border: `1.5px solid ${filtro === s ? "#0F172A" : "#E2E8F0"}`,
              background: filtro === s ? "#0F172A" : "#fff",
              color: filtro === s ? "#fff" : "#475569",
            }}
          >
            {s === "TODOS" ? `Todas (${itens.length})` : `${CORES[s].rotulo} (${contar(s)})`}
          </button>
        ))}
      </div>

      {carregando ? (
        <div style={{ padding: 40, textAlign: "center", color: "#64748B" }}>Carregando…</div>
      ) : visiveis.length === 0 ? (
        <div style={{ padding: "48px 20px", textAlign: "center", color: "#64748B", background: "#F8FAFC", borderRadius: 16, border: "1px dashed #CBD5E1" }}>
          <div style={{ fontSize: "2.2rem", marginBottom: 8 }}>📭</div>
          Nenhuma inscrição {filtro === "TODOS" ? "ainda" : "com este status"}.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {visiveis.map((i) => {
            const c = CORES[i.status] || CORES.NOVO;
            return (
              <div key={i.id} style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 16, padding: "16px 18px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 14, flexWrap: "wrap" }}>
                  <div style={{ minWidth: 220, flex: 1 }}>
                    <div style={{ fontWeight: 900, fontSize: "1rem", color: "#0F172A" }}>{i.fullName}</div>
                    <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 6, fontSize: "0.85rem" }}>
                      <a
                        href={`https://instagram.com/${i.instagram}`}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: "#DB2777", fontWeight: 800, textDecoration: "none" }}
                      >
                        @{i.instagram}
                      </a>
                      <span style={{ color: "#0F172A", fontWeight: 700 }}>
                        👥 {formatarSeguidores(i.followers)} seguidores
                      </span>
                      {i.whatsapp && (
                        <a
                          href={`https://wa.me/55${i.whatsapp}`}
                          target="_blank"
                          rel="noreferrer"
                          style={{ color: "#15803D", fontWeight: 700, textDecoration: "none" }}
                        >
                          💬 {i.whatsapp}
                        </a>
                      )}
                      {i.email && <span style={{ color: "#64748B" }}>✉️ {i.email}</span>}
                    </div>
                    {i.message && (
                      <div style={{ marginTop: 10, fontSize: "0.85rem", color: "#475569", background: "#F8FAFC", padding: "9px 12px", borderRadius: 10, lineHeight: 1.55 }}>
                        {i.message}
                      </div>
                    )}
                    <div style={{ marginTop: 8, fontSize: "0.75rem", color: "#94A3B8" }}>
                      Inscrito em {new Date(i.createdAt).toLocaleString("pt-BR")}
                    </div>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
                    <span style={{ padding: "5px 12px", borderRadius: 50, background: c.bg, color: c.fg, border: `1px solid ${c.borda}`, fontWeight: 800, fontSize: "0.76rem", whiteSpace: "nowrap" }}>
                      {c.rotulo}
                    </span>
                    <select
                      value={i.status}
                      disabled={salvando === i.id}
                      onChange={(e) => mudarStatus(i.id, e.target.value)}
                      style={{ padding: "7px 10px", borderRadius: 10, border: "1px solid #CBD5E1", fontSize: "0.8rem", fontWeight: 700, background: "#fff", cursor: "pointer" }}
                    >
                      {ORDEM_STATUS.map((s) => (
                        <option key={s} value={s}>{CORES[s].rotulo}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
