"use client";

/**
 * As seções que fazem do portal do embaixador o lugar ÚNICO de quem é
 * embaixador e vendedor ao mesmo tempo (pedido do dono, 27/09/2026):
 *
 *   • MÉDIA MENSAL — o que a carteira rendeu de verdade (ciclos pagos) nos
 *     últimos meses, e a previsão deste mês;
 *   • INADIMPLÊNCIA — as lojas dele com mensalidade em aberto, vencida ou a
 *     vencer, com a mensagem de cobrança pronta no WhatsApp;
 *   • CARTEIRA DE VENDAS — as lojas que o admin pôs com ele para atender
 *     (3% da mensalidade), separadas das que ele indicou, com o "já entrei
 *     em contato" da carteira do vendedor.
 */
import { useState } from "react";
import type { AtividadeDaLoja } from "@/lib/atividade-da-loja";
import type { CobrancaDaLoja } from "@/lib/comissao-da-carteira";

export type LojaDaCarteiraDeVendas = {
  id: string;
  storeName: string;
  storePhone: string | null;
  city: string | null;
  slug: string | null;
  status: "TRIAL" | "ACTIVE" | "INACTIVE";
  trialDaysRemaining: number;
  monthSales: number;
  platformFee: number;
  /** Os 3% deste mês nesta loja (0 quando ele mesmo indicou a loja). */
  ambassadorProfit: number;
  atendimento: "AGUARDANDO" | "ATENDIDO";
  atribuidoEm: string | null;
  atividade: AtividadeDaLoja | null;
  suaIndicacao: boolean;
};

export type LojaInadimplente = {
  id: string;
  storeName: string;
  storePhone: string | null;
  /** "indicada" (comissão de embaixador) ou "vendas" (3%) — ou as duas. */
  vinculo: string;
  cobranca: CobrancaDaLoja;
};

export type ExtrasDoEmbaixador = {
  nomeDoEmbaixador: string;
  previsaoDoMes: number;
  mediaMensal: { media: number; porMes: { yearMonth: string; valor: number }[] };
  inadimplentes: LojaInadimplente[];
  vendas: { sellerPercent: number; lojas: LojaDaCarteiraDeVendas[] } | null;
};

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const data = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—");
const mesLegivel = (ym: string) => {
  const [a, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, 1)).toLocaleDateString("pt-BR", { month: "short", year: "2-digit", timeZone: "UTC" });
};

function linkDoWhatsApp(telefone: string | null, texto?: string): string | null {
  const d = String(telefone || "").replace(/\D/g, "");
  if (d.length < 10) return null;
  const numero = d.length <= 11 ? `55${d}` : d;
  return `https://wa.me/${numero}${texto ? `?text=${encodeURIComponent(texto)}` : ""}`;
}

function textoDoUltimoPedido(a: AtividadeDaLoja | null): string {
  if (!a || a.diasSemPedido === null) return "nunca vendeu";
  if (a.diasSemPedido === 0) return "vendeu hoje";
  if (a.diasSemPedido === 1) return "vendeu ontem";
  return `sem pedido há ${a.diasSemPedido} dias`;
}

const caixa: React.CSSProperties = { background: "#FFFFFF", border: "1.5px solid #E2E8F0", borderRadius: 14, padding: "18px 20px", marginTop: 24 };
const titulo: React.CSSProperties = { fontSize: "1.1rem", fontWeight: 800, color: "#0F172A", margin: 0 };
const sub: React.CSSProperties = { fontSize: "0.82rem", color: "#64748B", marginTop: 4 };

export default function SecoesDoEmbaixador({ nomeDoEmbaixador, previsaoDoMes, mediaMensal, inadimplentes, vendas }: ExtrasDoEmbaixador) {
  const [lojas, setLojas] = useState(vendas?.lojas || []);
  const [salvando, setSalvando] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<"aguardando" | "todas">((vendas?.lojas || []).some((l) => l.atendimento === "AGUARDANDO") ? "aguardando" : "todas");

  const marcar = async (loja: LojaDaCarteiraDeVendas, status: "ATENDIDO" | "AGUARDANDO") => {
    setSalvando(loja.id);
    try {
      const r = await fetch(`/api/vendedor/clientes/${loja.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (r.ok) setLojas((prev) => prev.map((l) => (l.id === loja.id ? { ...l, atendimento: status } : l)));
      else alert("Não consegui salvar. Tente de novo.");
    } finally {
      setSalvando(null);
    }
  };

  const vencidas = inadimplentes.filter((l) => l.cobranca.vencida);
  const aVencer = inadimplentes.filter((l) => !l.cobranca.vencida);
  const totalEmAberto = inadimplentes.reduce((s, l) => s + l.cobranca.pendente, 0);
  const comissaoDeVendas = lojas.reduce((s, l) => s + l.ambassadorProfit, 0);
  const aguardando = lojas.filter((l) => l.atendimento === "AGUARDANDO");
  const visiveis = filtro === "aguardando" ? aguardando : lojas;

  return (
    <>
      {/* ── QUANTO ENTRA POR MÊS ── */}
      <div style={caixa}>
        <h3 style={titulo}>💰 Quanto você recebe por mês</h3>
        <div style={sub}>Média dos últimos {mediaMensal.porMes.length} meses (só o que a loja pagou) e a previsão deste mês, somando indicações, rede e carteira de vendas.</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginTop: 14 }}>
          <div style={{ background: "#F0FDFA", border: "1px solid #99F6E4", borderRadius: 12, padding: "12px 14px" }}>
            <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#0F766E", textTransform: "uppercase" }}>Média mensal</div>
            <div style={{ fontSize: "1.5rem", fontWeight: 900, color: "#0F766E" }}>{brl(mediaMensal.media)}</div>
          </div>
          <div style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 12, padding: "12px 14px" }}>
            <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#475569", textTransform: "uppercase" }}>Previsão deste mês</div>
            <div style={{ fontSize: "1.5rem", fontWeight: 900, color: "#0F172A" }}>{brl(previsaoDoMes)}</div>
          </div>
          {mediaMensal.porMes.map((m) => (
            <div key={m.yearMonth} style={{ background: "#FFFFFF", border: "1px solid #E2E8F0", borderRadius: 12, padding: "12px 14px" }}>
              <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#94A3B8", textTransform: "uppercase" }}>{mesLegivel(m.yearMonth)}</div>
              <div style={{ fontSize: "1.1rem", fontWeight: 800, color: m.valor > 0 ? "#0F172A" : "#94A3B8" }}>{brl(m.valor)}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── INADIMPLÊNCIA ── */}
      <div style={caixa}>
        <h3 style={titulo}>⚠️ Mensalidades em aberto {inadimplentes.length > 0 ? `· ${brl(totalEmAberto)}` : ""}</h3>
        <div style={sub}>
          Loja que não paga a mensalidade não gera comissão. Mande a mensagem pronta e ajude a regularizar — {vencidas.length} vencida{vencidas.length === 1 ? "" : "s"}, {aVencer.length} a vencer.
        </div>
        {inadimplentes.length === 0 ? (
          <div style={{ marginTop: 12, fontSize: "0.9rem", color: "#0F766E", fontWeight: 700 }}>✓ Nenhuma loja sua com mensalidade em aberto.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
            {[...vencidas, ...aVencer].map((l) => {
              const c = l.cobranca;
              const msg =
                `Olá! Aqui é ${nomeDoEmbaixador}, da FireHub. Vi que a mensalidade de ${mesLegivel(c.yearMonth)} da ${l.storeName} ` +
                `(${brl(c.pendente)}) ${c.vencida ? `venceu em ${data(c.vencimento)} e ainda está em aberto` : `vence em ${data(c.vencimento)}`}. ` +
                `Posso te ajudar a regularizar?${c.boletoUrl ? ` O link para pagar é este: ${c.boletoUrl}` : ""}`;
              const wa = linkDoWhatsApp(l.storePhone, msg);
              return (
                <div key={l.id} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 10, border: `1.5px solid ${c.vencida ? "#FECACA" : "#FDE68A"}`, background: c.vencida ? "#FEF2F2" : "#FFFBEB" }}>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ fontWeight: 800, color: "#0F172A" }}>{l.storeName} <span style={{ fontSize: "0.72rem", color: "#64748B", fontWeight: 600 }}>· {l.vinculo}</span></div>
                    <div style={{ fontSize: "0.8rem", color: c.vencida ? "#B91C1C" : "#92400E", fontWeight: 700 }}>
                      {brl(c.pendente)}{c.ciclos > 1 ? ` (${c.ciclos} meses)` : ` · ${mesLegivel(c.yearMonth)}`}
                      {c.vencida ? ` · vencida há ${c.diasDeAtraso} dia${c.diasDeAtraso === 1 ? "" : "s"}` : ` · vence ${data(c.vencimento)}`}
                    </div>
                  </div>
                  {wa ? (
                    <a href={wa} target="_blank" rel="noreferrer" style={{ background: "#25D366", color: "#fff", fontWeight: 800, fontSize: "0.8rem", padding: "8px 12px", borderRadius: 8, textDecoration: "none" }}>💬 Cobrar no WhatsApp</a>
                  ) : (
                    <span style={{ fontSize: "0.75rem", color: "#94A3B8" }}>sem telefone</span>
                  )}
                  {c.boletoUrl && (
                    <a href={c.boletoUrl} target="_blank" rel="noreferrer" style={{ fontSize: "0.78rem", color: "#475569", fontWeight: 700 }}>ver boleto</a>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── CARTEIRA DE VENDAS (3%) ── */}
      {vendas && (
        <div style={caixa}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
            <div>
              <h3 style={titulo}>💼 Sua carteira de vendas · {vendas.sellerPercent}% da mensalidade</h3>
              <div style={sub}>
                Lojas que a FireHub trouxe e colocou com você para atender. São separadas das que você indicou: aqui você ganha {vendas.sellerPercent}% por cuidar do cliente.
                {" "}Previsão deste mês: <b style={{ color: "#0F172A" }}>{brl(comissaoDeVendas)}</b>.
              </div>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {([["aguardando", `Aguardando contato (${aguardando.length})`], ["todas", `Todas (${lojas.length})`]] as const).map(([k, r]) => (
                <button key={k} type="button" onClick={() => setFiltro(k)} style={{ padding: "6px 12px", borderRadius: 999, border: `1.5px solid ${filtro === k ? "#0F172A" : "#E2E8F0"}`, background: filtro === k ? "#0F172A" : "#fff", color: filtro === k ? "#fff" : "#475569", fontWeight: 700, fontSize: "0.78rem", cursor: "pointer" }}>{r}</button>
              ))}
            </div>
          </div>
          {lojas.length === 0 ? (
            <div style={{ marginTop: 12, fontSize: "0.9rem", color: "#64748B" }}>Nenhuma loja na sua carteira de vendas ainda.</div>
          ) : visiveis.length === 0 ? (
            <div style={{ marginTop: 12, fontSize: "0.9rem", color: "#0F766E", fontWeight: 700 }}>✓ Todas as lojas já foram contatadas.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
              {visiveis.map((l) => {
                const aguarda = l.atendimento === "AGUARDANDO";
                const wa = linkDoWhatsApp(l.storePhone, `Olá! Aqui é ${nomeDoEmbaixador}, da FireHub. Sou o responsável por acompanhar a ${l.storeName} — posso te ajudar a começar a vender pelo sistema?`);
                return (
                  <div key={l.id} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 10, border: `1.5px solid ${aguarda ? "#FDE68A" : "#E2E8F0"}`, background: aguarda ? "#FFFBEB" : "#fff" }}>
                    <div style={{ flex: 1, minWidth: 220 }}>
                      <div style={{ fontWeight: 800, color: "#0F172A" }}>
                        {l.storeName}
                        {l.city ? <span style={{ fontSize: "0.75rem", color: "#64748B", fontWeight: 600 }}> · {l.city}</span> : null}
                      </div>
                      <div style={{ fontSize: "0.78rem", color: "#64748B" }}>
                        {l.status === "TRIAL" ? `em teste, ${l.trialDaysRemaining} dia${l.trialDaysRemaining === 1 ? "" : "s"}` : l.status === "ACTIVE" ? "ativa" : "inativa"}
                        {" · "}{textoDoUltimoPedido(l.atividade)}
                        {" · "}vendeu {brl(l.monthSales)} no mês
                        {l.suaIndicacao ? " · você indicou (ganha como embaixador)" : ` · seus ${vendas.sellerPercent}%: ${brl(l.ambassadorProfit)}`}
                        {l.atribuidoEm ? ` · com você desde ${data(l.atribuidoEm)}` : ""}
                      </div>
                    </div>
                    {wa && <a href={wa} target="_blank" rel="noreferrer" style={{ background: "#25D366", color: "#fff", fontWeight: 800, fontSize: "0.8rem", padding: "8px 12px", borderRadius: 8, textDecoration: "none" }}>💬 WhatsApp</a>}
                    <button type="button" disabled={salvando === l.id} onClick={() => marcar(l, aguarda ? "ATENDIDO" : "AGUARDANDO")}
                      style={{ padding: "8px 12px", borderRadius: 8, border: `1.5px solid ${aguarda ? "#0F766E" : "#E2E8F0"}`, background: aguarda ? "#0F766E" : "#fff", color: aguarda ? "#fff" : "#475569", fontWeight: 800, fontSize: "0.8rem", cursor: "pointer" }}>
                      {salvando === l.id ? "Salvando…" : aguarda ? "✓ Já entrei em contato" : "Desfazer contato"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </>
  );
}
