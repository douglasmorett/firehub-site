"use client";
/**
 * Motoboys › Ranking. O mesmo ranking do relatório
 * (/store/relatorios/ranking-de-entregadores), com o período por atalho e a
 * chave do "mostrar no app dos entregadores" — desligada de fábrica (Douglas,
 * 24/10/2026: "só mostrar para o motoboy se ativarem").
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PALETA } from "@/lib/paleta-brasa";
import RankingDeEntregadores, { type RespostaDoRanking } from "@/components/relatorios/RankingDeEntregadores";

const PERIODOS = [
  { chave: "hoje", rotulo: "Hoje" },
  { chave: "ontem", rotulo: "Ontem" },
  { chave: "7d", rotulo: "7 dias" },
  { chave: "30d", rotulo: "30 dias" },
  { chave: "mes", rotulo: "Este mês" },
] as const;

const diaBr = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

export default function RankingDosMotoboys() {
  const [periodo, setPeriodo] = useState<string>("7d");
  const [dados, setDados] = useState<RespostaDoRanking | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [noApp, setNoApp] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [avisoDoApp, setAvisoDoApp] = useState<string | null>(null);

  const carregar = useCallback(async (p: string) => {
    setCarregando(true);
    setErro(null);
    try {
      const r = await fetch(`/api/store/relatorios/ranking-de-entregadores?tela=motoboys&atalho=${p}`, { cache: "no-store" });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j) throw new Error(j?.error || "Não consegui montar o ranking.");
      setDados(j);
      setNoApp(Boolean(j.rankingNoApp));
    } catch (e: any) {
      setErro(e?.message || "Não consegui montar o ranking.");
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { carregar(periodo); }, [periodo, carregar]);

  const alternarNoApp = async () => {
    const novo = !noApp;
    setSalvando(true);
    setAvisoDoApp(null);
    try {
      const r = await fetch("/api/store/relatorios/ranking-de-entregadores", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rankingNoApp: novo }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(j?.error || "Não consegui salvar.");
      setNoApp(novo);
      setAvisoDoApp(novo
        ? "Ligado: os motoboys veem a aba Ranking no app (ao abrir o app de novo)."
        : "Desligado: a aba Ranking some do app dos motoboys.");
    } catch (e: any) {
      setAvisoDoApp(e?.message || "Não consegui salvar.");
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div style={{ color: PALETA.carvao }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: "1rem" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 900 }}>🏆 Ranking dos entregadores</h2>
          <p style={{ margin: "2px 0 0", fontSize: "0.8rem", color: PALETA.areiaTinta }}>
            {dados ? (dados.periodo.de === dados.periodo.ate ? diaBr(dados.periodo.de) : `${diaBr(dados.periodo.de)} a ${diaBr(dados.periodo.ate)}`) : "…"}
            {" "}· o dia vira às 5h · ▲▼ comparado com o período anterior
          </p>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {PERIODOS.map((p) => (
            <button key={p.chave} type="button" onClick={() => setPeriodo(p.chave)} aria-pressed={periodo === p.chave}
              style={{
                padding: "6px 12px", borderRadius: 999, fontSize: "0.8rem", fontWeight: 800, cursor: "pointer", fontFamily: "inherit",
                border: `1.5px solid ${periodo === p.chave ? PALETA.carvao : PALETA.areiaBorda}`,
                background: periodo === p.chave ? PALETA.carvao : "#fff", color: periodo === p.chave ? "#fff" : PALETA.carvao,
              }}>
              {p.rotulo}
            </button>
          ))}
          <Link href="/store/relatorios/ranking-de-entregadores" style={{ padding: "6px 12px", fontSize: "0.8rem", fontWeight: 800, color: PALETA.brasaTinta, textDecoration: "underline" }}>
            Abrir em Relatórios (Excel e outros períodos)
          </Link>
        </div>
      </div>

      {/* Mostrar no app: desligado de fábrica. */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", padding: "0.8rem 1rem", marginBottom: "1.1rem", borderRadius: 14, border: `1.5px solid ${noApp ? PALETA.okBorda : PALETA.areiaBorda}`, background: noApp ? PALETA.okClaro : PALETA.areia }}>
        <div style={{ minWidth: 0, flex: "1 1 320px" }}>
          <div style={{ fontWeight: 900, fontSize: "0.92rem" }}>📱 Mostrar o ranking no app dos motoboys</div>
          <div style={{ fontSize: "0.78rem", color: PALETA.areiaTinta, marginTop: 2, lineHeight: 1.45 }}>
            Ligado, cada motoboy vê no app quem está em primeiro, a posição e os números dele (entregas, tempo, prazo, volta) e o que pesa no score — sem valores em dinheiro.
            {avisoDoApp && <strong style={{ display: "block", color: PALETA.carvao, marginTop: 4 }}>{avisoDoApp}</strong>}
          </div>
        </div>
        <button type="button" role="switch" aria-checked={noApp} onClick={alternarNoApp} disabled={salvando || !dados}
          style={{ position: "relative", width: 54, height: 30, borderRadius: 999, border: "none", cursor: "pointer", background: noApp ? PALETA.ok : "#CBD5E1", opacity: salvando ? 0.6 : 1, flexShrink: 0 }}>
          <span style={{ position: "absolute", top: 3, left: noApp ? 27 : 3, width: 24, height: 24, borderRadius: 999, background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,0.25)", transition: "left 0.15s" }} />
          <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>{noApp ? "Ligado" : "Desligado"}</span>
        </button>
      </div>

      {erro && (
        <div role="alert" style={{ background: PALETA.graveClaro, border: `1px solid ${PALETA.graveBorda}`, color: PALETA.grave, borderRadius: 12, padding: "0.8rem 1rem", marginBottom: "1rem", fontWeight: 700, fontSize: "0.88rem" }}>
          {erro}
        </div>
      )}
      <div style={{ opacity: carregando ? 0.55 : 1, transition: "opacity 0.15s" }} aria-busy={carregando || undefined}>
        {dados ? <RankingDeEntregadores dados={dados} /> : carregando && <p style={{ color: PALETA.areiaTinta }}>Montando o ranking…</p>}
      </div>
    </div>
  );
}
