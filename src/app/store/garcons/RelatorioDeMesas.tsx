"use client";

/**
 * Relatório de mesas da loja — a taxa de serviço arrecadada (total e por
 * garçom) e as vendas separadas por origem: balcão, mesa, delivery e retirada.
 *
 * Mora no módulo de garçons porque foi de lá que o dono pediu (17/09/2026):
 * "no módulo garçom ter a opção de relatório de mesas, informando quanto foi
 * arrecadado de taxa de serviço, total ou separado por garçom, e no relatório
 * tem que ter separado quanto vendeu balcão, mesa e delivery".
 *
 * A tela só desenha o que /api/store/mesas/relatorio devolve. Nenhuma conta
 * mora aqui: se a régua de origem ou o dia operacional mudarem, mudam num
 * lugar só (o servidor), e a tela continua certa.
 */

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Loader2, UtensilsCrossed, Store, Bike, ShoppingBag } from "lucide-react";

type Relatorio = {
  periodo: { de: string; ate: string };
  mesas: {
    fechadas: number;
    consumo: number;
    taxaServico: number;
    gorjetas: number;
    totalPago: number;
    porGarcom: { waiterId: string | null; nome: string; mesas: number; taxaServico: number; gorjetas: number; consumo: number }[];
  };
  vendas: {
    total: number;
    porOrigem: Record<"MESA" | "BALCAO" | "DELIVERY" | "RETIRADA", { valor: number; pedidos: number }>;
    deliveryPorCanal: { canal: string; valor: number; pedidos: number }[];
  };
};

const fmt = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v || 0);

/** "YYYY-MM-DD" do relógio deste navegador — o PC da loja está no fuso dela. */
function diaLocal(deslocamentoDias = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + deslocamentoDias);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export default function RelatorioDeMesas({ onVoltar }: { onVoltar: () => void }) {
  const [filtro, setFiltro] = useState<"hoje" | "ontem" | "periodo">("hoje");
  const [de, setDe] = useState(diaLocal());
  const [ate, setAte] = useState(diaLocal());
  const [dados, setDados] = useState<Relatorio | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");

  const janela = useMemo(() => {
    if (filtro === "hoje") return { de: diaLocal(), ate: diaLocal() };
    if (filtro === "ontem") return { de: diaLocal(-1), ate: diaLocal(-1) };
    return { de, ate };
  }, [filtro, de, ate]);

  useEffect(() => {
    let vivo = true;
    setCarregando(true);
    setErro("");
    fetch(`/api/store/mesas/relatorio?de=${janela.de}&ate=${janela.ate}`)
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!vivo) return;
        if (!r.ok) { setErro(j?.error || "Não consegui carregar o relatório."); setDados(null); }
        else setDados(j);
      })
      .catch(() => vivo && setErro("Sem conexão. Tente de novo."))
      .finally(() => vivo && setCarregando(false));
    return () => { vivo = false; };
  }, [janela.de, janela.ate]);

  const origem = dados?.vendas.porOrigem;
  const total = dados?.vendas.total || 0;
  const pct = (v: number) => (total > 0 ? `${((v / total) * 100).toFixed(0)}%` : "—");

  const botaoFiltro = (chave: typeof filtro, rotulo: string) => (
    <button
      key={chave}
      onClick={() => setFiltro(chave)}
      style={{ padding: "8px 16px", borderRadius: 6, border: "none", background: filtro === chave ? "#fff" : "transparent", color: filtro === chave ? "#475569" : "#64748B", fontWeight: 700, cursor: "pointer", boxShadow: filtro === chave ? "0 2px 4px rgba(0,0,0,0.05)" : "none" }}
    >
      {rotulo}
    </button>
  );

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
        <button onClick={onVoltar} style={{ background: "#F1F5F9", border: "none", padding: 10, borderRadius: 8, cursor: "pointer", display: "flex" }}>
          <ArrowLeft size={20} color="#475569" />
        </button>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: "#1E293B", display: "flex", alignItems: "center", gap: 10 }}>
          <UtensilsCrossed size={26} color="#475569" /> Relatório de Mesas
        </h1>
      </div>

      {/* ── Período ── */}
      <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #E2E8F0", padding: 24, marginBottom: 24 }}>
        <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", marginBottom: 20 }}>
          <div style={{ display: "flex", gap: 8, background: "#F8FAFC", padding: 4, borderRadius: 10, border: "1px solid #E2E8F0" }}>
            {botaoFiltro("hoje", "Hoje")}
            {botaoFiltro("ontem", "Ontem")}
            {botaoFiltro("periodo", "Período")}
          </div>
          {filtro === "periodo" && (
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <input type="date" value={de} onChange={(e) => setDe(e.target.value)} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #E2E8F0", fontFamily: "inherit", color: "#1E293B" }} />
              <span style={{ color: "#94A3B8" }}>até</span>
              <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #E2E8F0", fontFamily: "inherit", color: "#1E293B" }} />
            </div>
          )}
          <span style={{ marginLeft: "auto", fontSize: 12, color: "#94A3B8" }}>
            O dia vira às 5h da manhã: mesa fechada de madrugada conta no dia anterior.
          </span>
        </div>

        {erro && (
          <div role="alert" style={{ background: "#FEF2F2", color: "#B71C1C", border: "1px solid #FECACA", borderRadius: 10, padding: "10px 12px", fontSize: 13, fontWeight: 600, marginBottom: 14 }}>
            {erro}
          </div>
        )}

        {/* ── Números das mesas ── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16 }}>
          <div style={{ background: "#F0EDFF", padding: 20, borderRadius: 12, border: "1px solid #E0D4FF" }}>
            <div style={{ fontSize: 13, color: "#334155", fontWeight: 700, marginBottom: 4 }}>Mesas fechadas</div>
            <div style={{ fontSize: 28, fontWeight: 900, color: "#0F172A" }}>{carregando ? "…" : dados?.mesas.fechadas ?? 0}</div>
          </div>
          <div style={{ background: "#F8FAFC", padding: 20, borderRadius: 12, border: "1px solid #E2E8F0" }}>
            <div style={{ fontSize: 13, color: "#475569", fontWeight: 700, marginBottom: 4 }}>Consumo nas mesas</div>
            <div style={{ fontSize: 24, fontWeight: 900, color: "#1E293B" }}>{carregando ? "…" : fmt(dados?.mesas.consumo || 0)}</div>
          </div>
          <div style={{ background: "#ECFDF5", padding: 20, borderRadius: 12, border: "1px solid #A7F3D0" }}>
            <div style={{ fontSize: 13, color: "#047857", fontWeight: 900, marginBottom: 4 }}>Taxa de serviço arrecadada</div>
            <div style={{ fontSize: 28, fontWeight: 900, color: "#065F46" }}>{carregando ? "…" : fmt(dados?.mesas.taxaServico || 0)}</div>
          </div>
          <div style={{ background: "#F8FAFC", padding: 20, borderRadius: 12, border: "1px solid #E2E8F0" }}>
            <div style={{ fontSize: 13, color: "#475569", fontWeight: 700, marginBottom: 4 }}>Gorjetas extras</div>
            <div style={{ fontSize: 24, fontWeight: 900, color: "#1E293B" }}>{carregando ? "…" : fmt(dados?.mesas.gorjetas || 0)}</div>
          </div>
        </div>
      </div>

      {/* ── Taxa de serviço por garçom ── */}
      <h3 style={{ fontSize: 18, fontWeight: 800, color: "#1E293B", marginBottom: 12 }}>Taxa de serviço por garçom</h3>
      <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #E2E8F0", overflow: "hidden", marginBottom: 28 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#F8FAFC", borderBottom: "2px solid #E2E8F0", textAlign: "left" }}>
              <th style={{ padding: "14px 16px", color: "#475569", fontWeight: 700, fontSize: 13 }}>Garçom</th>
              <th style={{ padding: "14px 16px", color: "#475569", fontWeight: 700, fontSize: 13, textAlign: "right" }}>Mesas</th>
              <th style={{ padding: "14px 16px", color: "#475569", fontWeight: 700, fontSize: 13, textAlign: "right" }}>Consumo</th>
              <th style={{ padding: "14px 16px", color: "#1E293B", fontWeight: 800, fontSize: 13, textAlign: "right" }}>Taxa de serviço</th>
              <th style={{ padding: "14px 16px", color: "#475569", fontWeight: 700, fontSize: 13, textAlign: "right" }}>Gorjetas</th>
            </tr>
          </thead>
          <tbody>
            {carregando ? (
              <tr><td colSpan={5} style={{ padding: 40, textAlign: "center" }}><Loader2 className="animate-spin mx-auto text-slate-400" size={32} /></td></tr>
            ) : !dados || dados.mesas.porGarcom.length === 0 ? (
              <tr><td colSpan={5} style={{ padding: 40, textAlign: "center", color: "#94A3B8" }}>Nenhuma mesa fechada no período.</td></tr>
            ) : (
              <>
                {dados.mesas.porGarcom.map((g) => (
                  <tr key={g.waiterId || "__sem__"} style={{ borderBottom: "1px solid #E2E8F0" }}>
                    <td style={{ padding: "14px 16px", fontWeight: 700, color: g.waiterId ? "#1E293B" : "#94A3B8", fontStyle: g.waiterId ? "normal" : "italic" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ width: 30, height: 30, borderRadius: "50%", background: g.waiterId ? "#F0EDFF" : "#F1F5F9", color: g.waiterId ? "#475569" : "#94A3B8", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 13 }}>
                          {g.nome.charAt(0).toUpperCase()}
                        </div>
                        {g.nome}
                      </div>
                    </td>
                    <td style={{ padding: "14px 16px", textAlign: "right", color: "#475569", fontWeight: 600 }}>{g.mesas}</td>
                    <td style={{ padding: "14px 16px", textAlign: "right", color: "#475569" }}>{fmt(g.consumo)}</td>
                    <td style={{ padding: "14px 16px", textAlign: "right", fontWeight: 800, color: "#15803D" }}>{fmt(g.taxaServico)}</td>
                    <td style={{ padding: "14px 16px", textAlign: "right", color: "#B45309", fontWeight: 700 }}>{g.gorjetas > 0 ? fmt(g.gorjetas) : "—"}</td>
                  </tr>
                ))}
                <tr style={{ background: "#F8FAFC", borderTop: "2px solid #E2E8F0" }}>
                  <td style={{ padding: "14px 16px", fontWeight: 900, color: "#1E293B" }}>Total</td>
                  <td style={{ padding: "14px 16px", textAlign: "right", fontWeight: 800 }}>{dados.mesas.fechadas}</td>
                  <td style={{ padding: "14px 16px", textAlign: "right", fontWeight: 800 }}>{fmt(dados.mesas.consumo)}</td>
                  <td style={{ padding: "14px 16px", textAlign: "right", fontWeight: 900, color: "#065F46" }}>{fmt(dados.mesas.taxaServico)}</td>
                  <td style={{ padding: "14px 16px", textAlign: "right", fontWeight: 800, color: "#B45309" }}>{dados.mesas.gorjetas > 0 ? fmt(dados.mesas.gorjetas) : "—"}</td>
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Vendas por origem ── */}
      <h3 style={{ fontSize: 18, fontWeight: 800, color: "#1E293B", marginBottom: 12 }}>Vendas por origem</h3>
      <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #E2E8F0", overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#F8FAFC", borderBottom: "2px solid #E2E8F0", textAlign: "left" }}>
              <th style={{ padding: "14px 16px", color: "#475569", fontWeight: 700, fontSize: 13 }}>Origem</th>
              <th style={{ padding: "14px 16px", color: "#475569", fontWeight: 700, fontSize: 13, textAlign: "right" }}>Pedidos</th>
              <th style={{ padding: "14px 16px", color: "#1E293B", fontWeight: 800, fontSize: 13, textAlign: "right" }}>Vendido</th>
              <th style={{ padding: "14px 16px", color: "#475569", fontWeight: 700, fontSize: 13, textAlign: "right" }}>% do total</th>
            </tr>
          </thead>
          <tbody>
            {carregando || !origem ? (
              <tr><td colSpan={4} style={{ padding: 40, textAlign: "center" }}><Loader2 className="animate-spin mx-auto text-slate-400" size={32} /></td></tr>
            ) : (
              <>
                {([
                  ["BALCAO", "Balcão", <Store key="b" size={16} color="#4338CA" />, "#E0E7FF"],
                  ["MESA", "Mesa", <UtensilsCrossed key="m" size={16} color="#C2410C" />, "#FFEDD5"],
                  ["DELIVERY", "Delivery", <Bike key="d" size={16} color="#1D4ED8" />, "#EFF6FF"],
                  ["RETIRADA", "Retirada (site / app)", <ShoppingBag key="r" size={16} color="#15803D" />, "#ECFDF3"],
                ] as const).map(([chave, rotulo, icone, fundo]) => (
                  <tr key={chave} style={{ borderBottom: "1px solid #E2E8F0" }}>
                    <td style={{ padding: "14px 16px", fontWeight: 700, color: "#1E293B" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{ width: 30, height: 30, borderRadius: 8, background: fundo, display: "flex", alignItems: "center", justifyContent: "center" }}>{icone}</div>
                        {rotulo}
                      </div>
                    </td>
                    <td style={{ padding: "14px 16px", textAlign: "right", color: "#475569", fontWeight: 600 }}>{origem[chave].pedidos}</td>
                    <td style={{ padding: "14px 16px", textAlign: "right", fontWeight: 800, color: "#1E293B" }}>{fmt(origem[chave].valor)}</td>
                    <td style={{ padding: "14px 16px", textAlign: "right", color: "#64748B", fontWeight: 700 }}>{pct(origem[chave].valor)}</td>
                  </tr>
                ))}
                {/* O delivery aberto por plataforma: iFood, 99Food, site… É o que
                    o lojista precisa para comparar com o repasse de cada uma. */}
                {dados!.vendas.deliveryPorCanal.map((c) => (
                  <tr key={c.canal} style={{ borderBottom: "1px solid #F1F5F9", background: "#FAFBFF" }}>
                    <td style={{ padding: "8px 16px 8px 56px", color: "#64748B", fontSize: 13 }}>↳ {c.canal}</td>
                    <td style={{ padding: "8px 16px", textAlign: "right", color: "#94A3B8", fontSize: 13 }}>{c.pedidos}</td>
                    <td style={{ padding: "8px 16px", textAlign: "right", color: "#475569", fontSize: 13, fontWeight: 600 }}>{fmt(c.valor)}</td>
                    <td style={{ padding: "8px 16px", textAlign: "right", color: "#94A3B8", fontSize: 13 }}>{pct(c.valor)}</td>
                  </tr>
                ))}
                <tr style={{ background: "#F8FAFC", borderTop: "2px solid #E2E8F0" }}>
                  <td style={{ padding: "14px 16px", fontWeight: 900, color: "#1E293B" }}>Total vendido</td>
                  <td style={{ padding: "14px 16px", textAlign: "right", fontWeight: 800 }}>
                    {Object.values(origem).reduce((s, o) => s + o.pedidos, 0)}
                  </td>
                  <td style={{ padding: "14px 16px", textAlign: "right", fontWeight: 900, color: "#1E293B", fontSize: 16 }}>{fmt(total)}</td>
                  <td style={{ padding: "14px 16px", textAlign: "right", fontWeight: 800, color: "#64748B" }}>100%</td>
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>

      <p style={{ margin: "12px 4px 0", fontSize: 12, color: "#94A3B8", lineHeight: 1.5 }}>
        Mesa: o que entrou pelas mesas fechadas no período, já sem taxa de serviço e gorjeta (é o consumo). Balcão, delivery e retirada: pedidos não cancelados criados no período.
        A taxa de serviço não entra em "Vendido" — ela é do garçom.
      </p>
    </>
  );
}
