"use client";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * "+ Lançar entrada/retirada esquecida" no Histórico de caixas, e o Excluir
 * do lançamento feito por engano. A sangria esquecida conta NAQUELE caixa e
 * corrige o fechamento dele (Victor, Pizzaria 17, 14/10/2026); a regra está em
 * lib/lancamento-tardio-do-caixa.ts e cada lançamento fica registrado como
 * as correções de contagem (quem, quando, o antes e o depois).
 *
 * O bloco "Entradas e retiradas" é de servidor; isto são as ilhas de clique.
 * O aviso mora no provedor que embrulha o bloco: o botão Excluir some da tela
 * com a linha quando a página recarrega, e o aviso dele tem de sobreviver.
 */

// ── Aviso que desce do topo e some sozinho (no lugar do alert()) ──────────
// Mesma interface do components/AvisoNoTopo.tsx de outra frente (ver
// store/financeiro/DespesasLancadas.tsx): quando estiver no master, trocar pelo import.
type Aviso = { tipo: "ok" | "erro" | "atencao" | "info"; titulo: string; detalhe?: string };
const COR_DO_AVISO: Record<Aviso["tipo"], { cor: string; fundo: string }> = {
  ok: { cor: "#059669", fundo: "#ECFDF5" },
  erro: { cor: "#DC2626", fundo: "#FEF2F2" },
  atencao: { cor: "#D97706", fundo: "#FFFBEB" },
  info: { cor: "#2563EB", fundo: "#EFF6FF" },
};
function AvisoNoTopo({ aviso, onFechar }: { aviso: Aviso | null; onFechar: () => void }) {
  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(onFechar, aviso.tipo === "erro" ? 12000 : 8000);
    return () => clearTimeout(t);
  }, [aviso, onFechar]);
  if (!aviso) return null;
  const { cor, fundo } = COR_DO_AVISO[aviso.tipo];
  return (
    <div
      role={aviso.tipo === "erro" ? "alert" : "status"}
      onClick={onFechar}
      style={{
        position: "fixed", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 1100,
        width: "min(440px, calc(100vw - 24px))", background: fundo, borderLeft: `4px solid ${cor}`,
        borderRadius: 12, padding: "12px 14px", boxShadow: "0 10px 30px rgba(15,23,42,.18)", cursor: "pointer",
      }}
    >
      <div style={{ fontWeight: 800, fontSize: 14, color: "#0F172A" }}>{aviso.titulo}</div>
      {aviso.detalhe && <div style={{ fontSize: 13, color: "#475569", marginTop: 2 }}>{aviso.detalhe}</div>}
    </div>
  );
}

const AvisoDoCaixa = createContext<(a: Aviso) => void>(() => {});

export function LancamentosTardiosDoCaixa({ children }: { children: React.ReactNode }) {
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const fechar = useCallback(() => setAviso(null), []);
  return (
    <AvisoDoCaixa.Provider value={setAviso}>
      <AvisoNoTopo aviso={aviso} onFechar={fechar} />
      {children}
    </AvisoDoCaixa.Provider>
  );
}

const reais = (v: number) => `${v < -0.004 ? "−" : ""}R$ ${Math.abs(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const resultado = (d: number | null) => (d == null ? "sem conferência" : Math.abs(d) < 0.01 ? "confere" : d < 0 ? `faltou ${reais(-d)}` : `sobrou ${reais(d)}`);

type Resposta = {
  antes: { expectedCash: number | null; difference: number | null; contouDinheiro: boolean };
  depois: { expectedCash: number | null; difference: number | null };
};

/** O que mudou no fechamento, em uma frase: o esperado em dinheiro e o resultado. */
function oQueMudou(r: Resposta): string {
  const esperado = `Dinheiro esperado ${reais(r.antes.expectedCash ?? 0)} → ${reais(r.depois.expectedCash ?? 0)}.`;
  if (r.antes.difference == null) return `${esperado} O caixa não teve conferência: não há falta nem sobra para corrigir.`;
  if (!r.antes.contouDinheiro) return `${esperado} O dinheiro não foi contado neste caixa: o resultado continua ${resultado(r.depois.difference)}.`;
  return `${esperado} Resultado: ${resultado(r.antes.difference)} → ${resultado(r.depois.difference)}.`;
}

const botao: React.CSSProperties = {
  padding: "6px 12px", borderRadius: 8, border: "1.5px solid #E2E8F0", background: "#FFF",
  color: "#475569", fontSize: "0.76rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
};
const campo: React.CSSProperties = {
  padding: "7px 9px", borderRadius: 8, border: "1.5px solid #E2E8F0", fontSize: "0.85rem", fontFamily: "inherit", background: "#FFF",
};

export function LancarMovimentoEsquecido({ sessionId, caixaDe }: { sessionId: string; caixaDe: string }) {
  const router = useRouter();
  const avisar = useContext(AvisoDoCaixa);
  const [aberto, setAberto] = useState(false);
  const [tipo, setTipo] = useState<"SAIDA" | "ENTRADA">("SAIDA");
  const [valor, setValor] = useState("");
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  const abrir = () => { setTipo("SAIDA"); setValor(""); setMotivo(""); setErro(""); setAberto(true); };

  const salvar = async () => {
    if (!valor.trim()) { setErro("Digite o valor."); return; }
    if (motivo.trim().length < 3) { setErro("Diga o motivo — fica registrado no histórico."); return; }
    setSalvando(true);
    setErro("");
    try {
      const r = await fetch("/api/cash-session/lancamento-tardio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, tipo, valor, motivo }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErro(j.error || "Não consegui lançar."); setSalvando(false); return; }
      setAberto(false);
      setSalvando(false);
      avisar({ tipo: "ok", titulo: `${tipo === "SAIDA" ? "Retirada" : "Entrada"} lançada no caixa de ${caixaDe}`, detalhe: oQueMudou(j as Resposta) });
      router.refresh();
    } catch {
      setErro("Sem conexão.");
      setSalvando(false);
    }
  };

  if (!aberto) {
    return <button type="button" style={botao} onClick={abrir}>+ Lançar entrada/retirada esquecida</button>;
  }

  const opcao = (t: "SAIDA" | "ENTRADA", rotulo: string) => (
    <button
      type="button"
      onClick={() => setTipo(t)}
      style={{ ...botao, flex: "1 1 160px", ...(tipo === t ? { borderColor: t === "SAIDA" ? "#C92E09" : "#0F766E", color: t === "SAIDA" ? "#C92E09" : "#0F766E", background: t === "SAIDA" ? "#FEF2F2" : "#F0FDFA" } : {}) }}
    >
      {rotulo}
    </button>
  );

  return (
    <div style={{ border: "1.5px solid #FDE68A", background: "#FFFBEB", borderRadius: 12, padding: 12, marginTop: 8 }}>
      <div style={{ fontWeight: 800, fontSize: "0.85rem", color: "#0F172A", marginBottom: 2 }}>Lançar entrada ou retirada esquecida</div>
      <div style={{ fontSize: "0.74rem", color: "#92400E", marginBottom: 10, lineHeight: 1.45 }}>
        Conta neste caixa e corrige o fechamento dele: o dinheiro esperado e a falta ou sobra são refeitos. Fica registrado no histórico com o seu nome, a data e como estava antes.
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {opcao("SAIDA", "Retirada (sangria)")}
        {opcao("ENTRADA", "Entrada (suprimento)")}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: "0.74rem", fontWeight: 700, color: "#334155", flex: "1 1 120px" }}>
          Valor
          <input type="text" inputMode="decimal" value={valor} placeholder="ex.: 50,00" onChange={(e) => setValor(e.target.value)} style={campo} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: "0.74rem", fontWeight: 700, color: "#334155", flex: "3 1 220px" }}>
          Motivo
          <input
            type="text"
            value={motivo}
            maxLength={200}
            placeholder='ex.: "pagamento do gás, esqueci de lançar"'
            onChange={(e) => setMotivo(e.target.value)}
            style={campo}
          />
        </label>
      </div>
      {erro && <div style={{ fontSize: "0.76rem", color: "#B71C1C", fontWeight: 700, marginTop: 8 }}>{erro}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 10, justifyContent: "flex-end" }}>
        <button type="button" style={botao} disabled={salvando} onClick={() => setAberto(false)}>Cancelar</button>
        <button type="button" disabled={salvando} onClick={salvar} style={{ ...botao, background: "#0F766E", borderColor: "#0F766E", color: "#FFF" }}>
          {salvando ? "Salvando…" : "Lançar neste caixa"}
        </button>
      </div>
    </div>
  );
}

/** O Excluir do lançamento tardio: pede o porquê, que vai para o registro. */
export function ExcluirLancamentoTardio({ movimentoId, rotulo }: { movimentoId: string; rotulo: string }) {
  const router = useRouter();
  const avisar = useContext(AvisoDoCaixa);
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  const excluir = async () => {
    if (motivo.trim().length < 3) { setErro("Diga por que excluir."); return; }
    setSalvando(true);
    setErro("");
    try {
      const r = await fetch("/api/cash-session/lancamento-tardio", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ movimentoId, motivo }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErro(j.error || "Não consegui excluir."); setSalvando(false); return; }
      avisar({ tipo: "ok", titulo: `${rotulo} excluída`, detalhe: oQueMudou(j as Resposta) });
      router.refresh();
    } catch {
      setErro("Sem conexão.");
      setSalvando(false);
    }
  };

  if (!aberto) {
    return (
      <button type="button" onClick={() => { setMotivo(""); setErro(""); setAberto(true); }} style={{ ...botao, padding: "2px 8px", fontSize: "0.7rem", color: "#B71C1C", borderColor: "#FECACA" }}>
        Excluir
      </button>
    );
  }

  return (
    <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 4 }}>
      <input
        type="text"
        value={motivo}
        maxLength={200}
        autoFocus
        placeholder='Por que excluir? ex.: "lancei duas vezes"'
        onChange={(e) => setMotivo(e.target.value)}
        style={{ ...campo, padding: "4px 8px", fontSize: "0.76rem", flex: "1 1 200px" }}
      />
      <button type="button" style={{ ...botao, padding: "3px 8px", fontSize: "0.7rem" }} disabled={salvando} onClick={() => setAberto(false)}>Cancelar</button>
      <button type="button" disabled={salvando} onClick={excluir} style={{ ...botao, padding: "3px 8px", fontSize: "0.7rem", background: "#B71C1C", borderColor: "#B71C1C", color: "#FFF" }}>
        {salvando ? "Excluindo…" : "Confirmar exclusão"}
      </button>
      {erro && <span style={{ flexBasis: "100%", fontSize: "0.72rem", color: "#B71C1C", fontWeight: 700 }}>{erro}</span>}
    </span>
  );
}
