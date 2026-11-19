"use client";
/**
 * O FIADO DO PERÍODO PARA ASSINAR.
 *
 * Pedido do Douglas e do Victor (19/11/2026): "impressão é o cara ter ali 30
 * dias fechado o que o cara consumiu e dentro daquele mês". Escolhe o período
 * (mês atual / mês anterior / datas), a impressora cadastrada da loja, vê o
 * papel como vai sair — desenhado pelo MESMO código do Assistente
 * (lib/gerado/comanda-do-assistente.ts), como a prévia de Impressoras — e
 * manda pela fila do Assistente (api/store/employees/[id]/fechamento). O
 * papel é montado no servidor: lib/comprovante-do-fiado.ts →
 * cupomDoFechamentoDoFiado.
 */
import { useEffect, useRef, useState } from "react";
import { comandaDoAssistente } from "@/lib/gerado/comanda-do-assistente";
import { geometriaDaImpressora, lerPapel, type LinhaDoPapel } from "@/lib/papel-da-impressora";
import PapelDaComanda from "@/app/store/impressoras/PapelDaComanda";

type ImpressoraDaLoja = { name: string; label?: string; paperWidth?: string; columns?: number };
type ResumoDoPeriodo = { periodo: string; qtd: number; consumo: number; pendente: number; saldoTotal: number };

const CHAVE_DA_IMPRESSORA = "firehub.fiado.periodo.impressora.v1";

/** Dia puro (YYYY-MM-DD) no relógio deste aparelho, como o filtro da tela Fiado. */
export const diaPuro = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Mês atual (do dia 1 até hoje) ou o anterior inteiro, em dias puros. */
export function periodoDoMes(qual: "atual" | "anterior", agora = new Date()): { de: string; ate: string } {
  if (qual === "atual") return { de: diaPuro(new Date(agora.getFullYear(), agora.getMonth(), 1)), ate: diaPuro(agora) };
  return { de: diaPuro(new Date(agora.getFullYear(), agora.getMonth() - 1, 1)), ate: diaPuro(new Date(agora.getFullYear(), agora.getMonth(), 0)) };
}

/** As colunas que o Assistente usa: a calibração, senão o padrão da bobina (ComandaModeloEditor). */
const colunasDa = (p: { paperWidth?: string; columns?: number } | null) => {
  const c = Number(p?.columns);
  if (Number.isFinite(c) && c >= 24 && c <= 64) return Math.floor(c);
  return String(p?.paperWidth || "80mm").startsWith("58") ? 32 : 48;
};

const reais = (v: number) => `R$ ${(Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function ModalDoFiadoDoPeriodo(p: {
  employeeId: string;
  nomeDoCliente: string;
  /** O período que a tela está mostrando: o papel abre nele. Vazio = todas as datas. */
  de: string;
  ate: string;
  onFechar: (recado: string | null) => void;
}) {
  const mesAtual = periodoDoMes("atual");
  const mesAnterior = periodoDoMes("anterior");
  const igual = (a: { de: string; ate: string }) => a.de === p.de && a.ate === p.ate;
  const [modo, setModo] = useState<"atual" | "anterior" | "datas">(igual(mesAtual) ? "atual" : igual(mesAnterior) ? "anterior" : "datas");
  const [de, setDe] = useState(p.de);
  const [ate, setAte] = useState(p.ate);
  const periodo = modo === "atual" ? mesAtual : modo === "anterior" ? mesAnterior : { de, ate };

  const [impressoras, setImpressoras] = useState<ImpressoraDaLoja[] | null>(null);
  const [escolhida, setEscolhida] = useState("");
  const [previa, setPrevia] = useState<{ papel: LinhaDoPapel[]; resumo: ResumoDoPeriodo } | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [etapa, setEtapa] = useState<"escolher" | "imprimindo" | "semAssistente">("escolher");
  const [erro, setErro] = useState("");
  const cupomRef = useRef<{ cupom: any; loja: string } | null>(null);

  // As impressoras cadastradas da loja (Impressoras); a última escolhida neste aparelho vem marcada.
  useEffect(() => {
    fetch("/api/store/printer-config", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => {
        const todas: any[] = Array.isArray(c?.printers) ? c.printers : [];
        const lista: ImpressoraDaLoja[] = todas
          .filter((x) => x && String(x.name || "").trim())
          .filter((x, i, t) => t.findIndex((y) => String(y.name).trim() === String(x.name).trim()) === i)
          .map((x) => ({ name: String(x.name).trim(), label: x.label, paperWidth: x.paperWidth, columns: x.columns }));
        setImpressoras(lista);
        let lembrada = "";
        try { lembrada = localStorage.getItem(CHAVE_DA_IMPRESSORA) || ""; } catch { /* sem armazenamento */ }
        setEscolhida(lista.find((x) => x.name === lembrada)?.name || lista[0]?.name || "");
      })
      .catch(() => setImpressoras([]));
  }, []);

  const impressora = impressoras?.find((x) => x.name === escolhida) || null;
  const colunas = colunasDa(impressora);
  const largura = impressora?.paperWidth || (colunas <= 32 ? "58mm" : "80mm");
  const desenhar = (c: { cupom: any; loja: string }) => lerPapel(comandaDoAssistente(c.cupom, c.loja, colunas, "safe"));

  // A prévia: o cupom que o servidor montou, sem ir para a fila.
  useEffect(() => {
    if (periodo.de && periodo.ate && periodo.de > periodo.ate) { setErro("A data inicial é depois da final."); setPrevia(null); setCarregando(false); return; }
    let vivo = true;
    setCarregando(true);
    setErro("");
    fetch(`/api/store/employees/${encodeURIComponent(p.employeeId)}/fechamento`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ de: periodo.de, ate: periodo.ate, previa: true }),
    })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!vivo) return;
        if (!r.ok) { setErro(j.error || "Não consegui montar o papel."); setPrevia(null); return; }
        cupomRef.current = { cupom: j.cupom, loja: j.loja || "" };
        setPrevia({ papel: desenhar(cupomRef.current), resumo: j.resumo });
      })
      .catch(() => { if (vivo) setErro("Sem conexão."); })
      .finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.employeeId, periodo.de, periodo.ate]);

  // Trocou a impressora: redesenha na largura dela, sem ir ao servidor.
  useEffect(() => {
    const c = cupomRef.current;
    if (c) setPrevia((v) => (v ? { ...v, papel: desenhar(c) } : v));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colunas]);

  const imprimir = async () => {
    setEtapa("imprimindo");
    setErro("");
    try { if (escolhida) localStorage.setItem(CHAVE_DA_IMPRESSORA, escolhida); } catch { /* sem armazenamento */ }
    try {
      const r = await fetch(`/api/store/employees/${encodeURIComponent(p.employeeId)}/fechamento`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ de: periodo.de, ate: periodo.ate, impressora: escolhida || undefined }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErro(j.error || "Não consegui imprimir."); setEtapa("escolher"); return; }
      // Na fila, mas ninguém puxando: não é "enviado" (como o papel do caixa).
      if (j.assistenteOuvindo === false) { setEtapa("semAssistente"); return; }
      p.onFechar(`🖨️ Fiado de ${p.nomeDoCliente} (${previa?.resumo.periodo || "período"}) enviado para ${impressora ? impressora.label || impressora.name : "a impressora do caixa"}.`);
    } catch {
      setErro("Sem conexão.");
      setEtapa("escolher");
    }
  };

  const urlDoNavegador = `/api/store/employees/${encodeURIComponent(p.employeeId)}/fechamento?de=${periodo.de}&ate=${periodo.ate}`;
  const chip = (ativo: boolean): React.CSSProperties => ({
    padding: "7px 12px", borderRadius: 8, border: "none", fontSize: "0.8rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
    background: ativo ? "#EA1D2C" : "#F1F5F9", color: ativo ? "#fff" : "#64748B",
  });
  const rotulo: React.CSSProperties = { fontSize: "0.72rem", fontWeight: 800, color: "#64748B", textTransform: "uppercase", letterSpacing: 0.3, margin: "12px 0 6px" };
  const campoDeData: React.CSSProperties = { padding: "5px 6px", borderRadius: 6, border: "1px solid #CBD5E1", fontFamily: "inherit", fontSize: "0.8rem" };
  const geometria = geometriaDaImpressora(largura, colunas);
  const r = previa?.resumo;
  const bloqueado = etapa === "imprimindo" || carregando || !!erro || !previa;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.6)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10000, padding: 12 }}>
      <div role="dialog" aria-label="Imprimir fiado para assinar" style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 820, maxHeight: "94vh", overflow: "auto", padding: 18, boxShadow: "0 20px 25px -5px rgba(0,0,0,0.15)", boxSizing: "border-box" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
          <div>
            <h3 style={{ margin: 0, fontWeight: 800, fontSize: "1.1rem", color: "#0F172A" }}>🖨️ Imprimir para assinar — {p.nomeDoCliente}</h3>
            <div style={{ fontSize: "0.8rem", color: "#64748B", marginTop: 2 }}>O consumo do período, o total, o pendente e a aba para a pessoa assinar.</div>
          </div>
          <button type="button" onClick={() => p.onFechar(null)} aria-label="Fechar" style={{ border: "none", background: "none", cursor: "pointer", color: "#64748B", fontSize: "1.1rem", fontWeight: 800 }}>✕</button>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 18, marginTop: 4 }}>
          {/* Período, impressora, resumo e botões */}
          <div style={{ flex: "1 1 300px", minWidth: 0 }}>
            <div style={rotulo}>Período</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button type="button" style={chip(modo === "atual")} onClick={() => setModo("atual")}>Mês atual</button>
              <button type="button" style={chip(modo === "anterior")} onClick={() => setModo("anterior")}>Mês anterior</button>
              <button type="button" style={chip(modo === "datas")} onClick={() => setModo("datas")}>Escolher datas</button>
            </div>
            {modo === "datas" && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, flexWrap: "wrap", fontSize: "0.78rem", fontWeight: 700, color: "#64748B" }}>
                De <input type="date" value={de} onChange={(e) => setDe(e.target.value)} style={campoDeData} />
                até <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} style={campoDeData} />
                {!de && !ate && <span style={{ fontWeight: 600 }}>(vazio = todas as datas)</span>}
              </div>
            )}

            <div style={rotulo}>Impressora</div>
            {impressoras === null ? (
              <div style={{ fontSize: "0.82rem", color: "#94A3B8" }}>Carregando impressoras...</div>
            ) : impressoras.length === 0 ? (
              <div style={{ fontSize: "0.8rem", color: "#92400E", background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 10, padding: "8px 10px", fontWeight: 600 }}>
                Nenhuma impressora cadastrada em Impressoras: o papel sai na impressora do caixa (a padrão do Assistente). Ou use o navegador.
              </div>
            ) : (
              <div style={{ display: "grid", gap: 6 }}>
                {impressoras.map((x) => {
                  const ativa = x.name === escolhida;
                  return (
                    <label key={x.name} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 10, cursor: "pointer", border: ativa ? "2px solid #0F766E" : "1.5px solid #E2E8F0", background: ativa ? "#F0FDFA" : "#fff" }}>
                      <input type="radio" name="impressora-do-fiado" checked={ativa} onChange={() => setEscolhida(x.name)} />
                      <span style={{ fontWeight: 800, fontSize: "0.85rem", color: "#0F172A" }}>{x.label || x.name}</span>
                      <span style={{ marginLeft: "auto", fontSize: "0.72rem", color: "#64748B", fontWeight: 700, textAlign: "right" }}>
                        {String(x.paperWidth || "80mm").startsWith("58") ? "58 mm" : "80 mm"}{x.label && x.label !== x.name ? ` · ${x.name}` : ""}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}

            {r && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 14 }}>
                <div style={{ background: "#F8FAFC", border: "1.5px solid #E2E8F0", borderRadius: 12, padding: "10px 12px" }}>
                  <div style={{ fontSize: "0.68rem", fontWeight: 800, color: "#64748B", textTransform: "uppercase" }}>Consumo · {r.qtd} {r.qtd === 1 ? "lançamento" : "lançamentos"}</div>
                  <div style={{ fontSize: "1.2rem", fontWeight: 900, color: "#0F172A" }}>{reais(r.consumo)}</div>
                  <div style={{ fontSize: "0.72rem", color: "#64748B" }}>{r.periodo}</div>
                </div>
                <div style={{ background: r.pendente > 0 ? "#FEF2F2" : "#F0FDFA", border: `1.5px solid ${r.pendente > 0 ? "#FECACA" : "#99F6E4"}`, borderRadius: 12, padding: "10px 12px" }}>
                  <div style={{ fontSize: "0.68rem", fontWeight: 800, color: r.pendente > 0 ? "#B71C1C" : "#0F766E", textTransform: "uppercase" }}>Pendente do período</div>
                  <div style={{ fontSize: "1.2rem", fontWeight: 900, color: r.pendente > 0 ? "#C92E09" : "#0F766E" }}>{reais(r.pendente)}</div>
                  {Math.abs(r.saldoTotal - r.pendente) > 0.004 && <div style={{ fontSize: "0.72rem", color: "#64748B" }}>Em aberto (todas as datas): {reais(r.saldoTotal)}</div>}
                </div>
              </div>
            )}

            {erro && <div role="alert" style={{ color: "#B91C1C", fontWeight: 700, fontSize: "0.82rem", marginTop: 10 }}>{erro}</div>}
            {etapa === "semAssistente" && (
              <div style={{ marginTop: 10, padding: "10px 12px", borderRadius: 10, background: "#FFFBEB", border: "1px solid #FDE68A", color: "#92400E", fontSize: "0.82rem", fontWeight: 700, lineHeight: 1.45 }}>
                ⚠️ O papel ficou na fila, mas o Assistente de Impressão desta loja não está ligado — ele sai quando o Assistente abrir. Para imprimir agora, use o navegador.
              </div>
            )}

            <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
              <a href={urlDoNavegador} target="_blank" rel="noopener" title="Abre o papel para imprimir pelo navegador (bobina 80 mm)"
                style={{ flex: "1 1 120px", padding: "11px 10px", borderRadius: 10, fontWeight: 800, fontSize: "0.85rem", border: "1.5px solid #CBD5E1", background: "#fff", color: "#475569", textAlign: "center", textDecoration: "none" }}>
                🧾 Pelo navegador
              </a>
              {etapa === "semAssistente" ? (
                <button type="button" onClick={() => p.onFechar(null)} style={{ flex: "2 1 160px", padding: "11px 10px", borderRadius: 10, fontWeight: 800, fontSize: "0.9rem", border: "none", background: "#475569", color: "#fff", cursor: "pointer", fontFamily: "inherit" }}>
                  Fechar
                </button>
              ) : (
                <button type="button" onClick={imprimir} disabled={bloqueado}
                  style={{ flex: "2 1 160px", padding: "11px 10px", borderRadius: 10, fontWeight: 800, fontSize: "0.9rem", border: "none", background: "#0F766E", color: "#fff", cursor: bloqueado ? "default" : "pointer", fontFamily: "inherit", opacity: bloqueado ? 0.6 : 1 }}>
                  {etapa === "imprimindo" ? "Enviando..." : `🖨️ Imprimir${impressora ? ` na ${impressora.label || impressora.name}` : ""}`}
                </button>
              )}
            </div>
          </div>

          {/* O papel como vai sair */}
          <div style={{ flex: "0 1 auto", minWidth: 0, margin: "0 auto", maxWidth: "100%" }}>
            <div style={rotulo}>Como vai sair — {String(largura).startsWith("58") ? "58 mm" : "80 mm"} · {colunas} colunas</div>
            <div style={{ background: "#F1F5F9", borderRadius: 12, padding: 10, maxHeight: "62vh", overflow: "auto", display: "flex", justifyContent: "center" }}>
              {previa ? (
                <PapelDaComanda linhas={previa.papel} pontos={geometria.pontos} celula={geometria.celula} escala={Math.min(0.62, 320 / geometria.pontos)} />
              ) : (
                <div style={{ color: "#94A3B8", fontSize: "0.85rem", padding: 20 }}>{carregando ? "Montando o papel..." : "Sem prévia."}</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
