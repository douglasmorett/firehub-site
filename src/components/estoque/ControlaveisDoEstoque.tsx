"use client";
/**
 * A aba "Controláveis" do Estoque: o Relatório dos controláveis — desperdício
 * completo e incompleto, segurança alimentar, condimentos, refeição da equipe,
 * diferença de inventário, rendimento e indiretos, em R$ e % da venda líquida.
 *
 * A conta é de lib/cmv/controlaveis.ts (rota /api/store/estoque/controlaveis);
 * o CSV, o Excel e a página A4, de lib/cmv/controlaveis-exportar.ts. Mora
 * dentro do EstoqueClient e usa as classes dele (items-table, btn-primary...).
 * Só aparece para quem vê dados sensíveis.
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Download, Printer, RefreshCw } from "lucide-react";
import {
  CLASSES, COMO_LER_O_RELATORIO, DESCRICAO_DO_ONDE_ESTA_O_DINHEIRO, ORDEM_DAS_SECOES, ROTULO_DA_CLASSE, SECOES_DA_CONTAGEM, sumiuOuSobrou, TITULO_DA_SECAO,
  type Classe, type Comparacao, type IdDaSecao, type LinhaDoRelatorio, type RelatorioDosControlaveis, type Secao,
} from "@/lib/cmv/controlaveis";
import { gerarCsv, gerarExcel, gerarHtmlDeImpressao, linhasDoResumo, nomeDoArquivo } from "@/lib/cmv/controlaveis-exportar";

// ── Aviso que desce do topo e some sozinho (no lugar do alert()) ──────────
// Cópia do de components/estoque/DesperdicioDoEstoque.tsx.
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
    const t = setTimeout(onFechar, aviso.tipo === "erro" ? 12000 : 6000);
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

type Resposta = { hoje: string; semana: { comecaEm: number }; relatorio: RelatorioDosControlaveis };

const fmtR = (v: number | null | undefined) => (v == null ? "—" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v));
const fmtP = (v: number | null | undefined) => (v == null ? "—" : `${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`);
const fmtQ = (q: number) => q.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
const diaBr = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const quandoBr = (iso: string) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const somar = (dia: string, n: number) => { const d = new Date(`${dia}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const inicioDaSemana = (dia: string, comecaEm: number) => somar(dia, -((new Date(`${dia}T12:00:00Z`).getUTCDay() - comecaEm + 7) % 7));

const DIFERENCA: IdDaSecao[] = ["inventario", "rendimento"];
const ICONE: Record<IdDaSecao, string> = {
  completo: "🍔", incompleto: "🥬", seguranca: "🌡️", condimentos: "🧂", break: "🍽️", inventario: "📦", rendimento: "⚖️", indiretos: "🧻",
};

type Coluna = "nome" | "quantidade" | "custoUnitario" | "total";

/** "Como ler este relatório": aberta na 1ª vez; se a pessoa fechar, o navegador lembra. */
const CHAVE_COMO_LER = "firehub:controlaveis:como-ler-fechado";
function ComoLer() {
  const [aberta, setAberta] = useState(true);
  useEffect(() => {
    try { if (localStorage.getItem(CHAVE_COMO_LER) === "1") setAberta(false); } catch {}
  }, []);
  const alternar = () => setAberta((a) => {
    try { if (a) localStorage.setItem(CHAVE_COMO_LER, "1"); else localStorage.removeItem(CHAVE_COMO_LER); } catch {}
    return !a;
  });
  return (
    <div style={{ background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 12, marginBottom: "1rem" }}>
      <button type="button" onClick={alternar} aria-expanded={aberta}
        style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", background: "none", border: "none", cursor: "pointer", textAlign: "left", color: "#1E3A8A" }}>
        {aberta ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <span style={{ fontWeight: 800, fontSize: "0.9rem" }}>📖 Como ler este relatório</span>
      </button>
      {aberta && (
        <ul style={{ margin: 0, padding: "0 14px 12px 34px", display: "grid", gap: 4, fontSize: "0.82rem", lineHeight: 1.45, color: "#334155" }}>
          {COMO_LER_O_RELATORIO.map((t) => <li key={t}>{t}</li>)}
        </ul>
      )}
    </div>
  );
}

/** "sumiu" / "sobrou" ao lado do número da diferença. */
function RotuloDaDiferenca({ v }: { v: number }) {
  const t = sumiuOuSobrou(v);
  if (!t) return null;
  return <span style={{ fontSize: "0.7rem", fontWeight: 800, marginLeft: 4, color: v < 0 ? "#B91C1C" : "#047857" }}>{t}</span>;
}

export default function ControlaveisDoEstoque() {
  const [dados, setDados] = useState<Resposta | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const fecharAviso = useCallback(() => setAviso(null), []);
  const [abertas, setAbertas] = useState<Set<IdDaSecao>>(new Set(ORDEM_DAS_SECOES));
  const [menuExportar, setMenuExportar] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const carregar = useCallback(async (periodo?: { de: string; ate: string }) => {
    setCarregando(true);
    try {
      const q = periodo?.de && periodo?.ate ? `?de=${periodo.de}&ate=${periodo.ate}` : "";
      const r = await fetch(`/api/store/estoque/controlaveis${q}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || "Não deu para carregar o relatório.");
      setDados(d);
      setDe(d.relatorio.periodo.de);
      setAte(d.relatorio.periodo.ate);
    } catch (e: any) {
      setAviso({ tipo: "erro", titulo: "Controláveis", detalhe: e?.message || "Não deu para carregar." });
    } finally {
      setCarregando(false);
    }
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  useEffect(() => {
    if (!menuExportar) return;
    const fora = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuExportar(false); };
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, [menuExportar]);

  const atalhos = useMemo(() => {
    if (!dados) return [];
    const { hoje, semana } = dados;
    const estaSemana = inicioDaSemana(hoje, semana.comecaEm);
    const mes = `${hoje.slice(0, 7)}-01`;
    const fimMesAnterior = somar(mes, -1);
    return [
      { rotulo: "Semana do CMV anterior", de: somar(estaSemana, -7), ate: somar(estaSemana, -1) },
      { rotulo: "Esta semana", de: estaSemana, ate: hoje },
      { rotulo: "Este mês", de: mes, ate: hoje },
      { rotulo: "Mês anterior", de: `${fimMesAnterior.slice(0, 7)}-01`, ate: fimMesAnterior },
    ];
  }, [dados]);

  const rel = dados?.relatorio;

  const baixar = (conteudo: string, tipo: string, extensao: string) => {
    if (!rel) return;
    const blob = new Blob([conteudo], { type: tipo });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${nomeDoArquivo(rel)}.${extensao}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    setMenuExportar(false);
  };

  const abrirImpressao = (imprimirJa: boolean) => {
    if (!rel) return;
    setMenuExportar(false);
    const janela = window.open("", "_blank");
    if (!janela) {
      setAviso({ tipo: "atencao", titulo: "O navegador bloqueou a janela", detalhe: "Libere as janelas (pop-up) deste site para imprimir ou salvar em PDF." });
      return;
    }
    janela.document.open();
    janela.document.write(gerarHtmlDeImpressao(rel));
    janela.document.close();
    janela.focus();
    if (imprimirJa) setTimeout(() => janela.print(), 400);
  };

  const trocarClasse = async (insumoId: string, classe: Classe | "") => {
    try {
      const r = await fetch("/api/store/estoque/controlaveis/classe", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stockItemId: insumoId, classe: classe || null }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error || "Não deu para gravar.");
      setAviso({ tipo: "ok", titulo: "Classe gravada", detalhe: "O relatório foi refeito com a classe nova." });
      await carregar({ de, ate });
    } catch (e: any) {
      setAviso({ tipo: "erro", titulo: "Classe do insumo", detalhe: e?.message });
    }
  };

  const alternar = (id: IdDaSecao) => setAbertas((a) => { const n = new Set(a); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div className="controlaveis">
      <AvisoNoTopo aviso={aviso} onFechar={fecharAviso} />
      <ComoLer />

      {/* Período e exportar */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "flex-end", marginBottom: "1rem" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {atalhos.map((a) => {
            const ativo = a.de === de && a.ate === ate;
            return (
              <button key={a.rotulo} type="button" onClick={() => carregar(a)}
                style={{ fontSize: "0.8rem", fontWeight: 700, padding: "7px 12px", borderRadius: 999, border: "1px solid #E7DDD3", background: ativo ? "#1C1917" : "#FAF6F2", color: ativo ? "#fff" : "#1C1917", cursor: "pointer" }}>
                {a.rotulo}
              </button>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
          <label style={{ fontSize: "0.72rem", fontWeight: 700, color: "#64748B" }}>De<br />
            <input type="date" value={de} onChange={(e) => setDe(e.target.value)} style={{ padding: "6px 8px", border: "1px solid #E7DDD3", borderRadius: 8 }} />
          </label>
          <label style={{ fontSize: "0.72rem", fontWeight: 700, color: "#64748B" }}>Até<br />
            <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} style={{ padding: "6px 8px", border: "1px solid #E7DDD3", borderRadius: 8 }} />
          </label>
          <button type="button" className="btn-secondary" onClick={() => carregar({ de, ate })} disabled={carregando} style={{ padding: "8px 12px" }}>
            <RefreshCw size={15} /> {carregando ? "Calculando..." : "Ver"}
          </button>
        </div>
        <div style={{ flex: 1 }} />
        <button type="button" className="btn-secondary" onClick={() => abrirImpressao(true)} disabled={!rel}>
          <Printer size={16} /> Imprimir
        </button>
        <div ref={menuRef} style={{ position: "relative" }}>
          <button type="button" className="btn-primary" onClick={() => setMenuExportar((v) => !v)} disabled={!rel} aria-haspopup="menu" aria-expanded={menuExportar}>
            <Download size={16} /> ⬇️ Exportar
          </button>
          {menuExportar && rel && (
            <div role="menu" style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 50, background: "#fff", border: "1px solid #E7DDD3", borderRadius: 12, boxShadow: "0 12px 30px rgba(15,23,42,.15)", minWidth: 250, overflow: "hidden" }}>
              {[
                { rotulo: "PDF (A4)", detalhe: "Abre a impressão: escolha “Salvar como PDF”", acao: () => abrirImpressao(true) },
                { rotulo: "Excel (.xls)", detalhe: "Resumo e uma aba por seção", acao: () => baixar(gerarExcel(rel), "application/vnd.ms-excel;charset=utf-8", "xls") },
                { rotulo: "Planilha CSV", detalhe: "Separada por ; com vírgula decimal", acao: () => baixar(gerarCsv(rel), "text/csv;charset=utf-8", "csv") },
              ].map((o) => (
                <button key={o.rotulo} role="menuitem" type="button" onClick={o.acao}
                  style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 14px", border: "none", borderBottom: "1px solid #F1F5F9", background: "#fff", cursor: "pointer" }}>
                  <div style={{ fontWeight: 800, fontSize: "0.86rem", color: "#1C1917" }}>{o.rotulo}</div>
                  <div style={{ fontSize: "0.74rem", color: "#64748B" }}>{o.detalhe}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {!rel ? (
        <div className="empty-state"><h3>{carregando ? "Calculando o relatório..." : "Não deu para carregar o relatório."}</h3></div>
      ) : (
        <div style={{ opacity: carregando ? 0.55 : 1, transition: "opacity .2s" }}>
          {/* Cabeçalho */}
          <div style={{ background: "#1C1917", color: "#fff", borderRadius: 14, padding: "14px 18px", marginBottom: "1rem", display: "flex", flexWrap: "wrap", gap: "0.75rem 2rem", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: "0.72rem", fontWeight: 800, color: "#FDBA74", textTransform: "uppercase", letterSpacing: ".04em" }}>Relatório dos controláveis</div>
              <div style={{ fontSize: "1.15rem", fontWeight: 900 }}>{rel.loja}</div>
            </div>
            <Info rotulo="Período" valor={`${diaBr(rel.periodo.de)} a ${diaBr(rel.periodo.ate)}`} />
            <Info rotulo="Venda líquida" valor={fmtR(rel.venda)} />
            {rel.contagem && <Info rotulo="Contagens" valor={`${diaBr(rel.contagem.de)} a ${diaBr(rel.contagem.ate)}`} />}
            <Info rotulo="Gerado em" valor={quandoBr(rel.geradoEm)} />
          </div>

          {/* Avisos do que deixa o número errado */}
          {rel.avisos.length > 0 && (
            <div style={{ display: "grid", gap: 6, marginBottom: "1rem" }}>
              {rel.avisos.map((a, i) => (
                <div key={i} style={{ fontSize: "0.82rem", lineHeight: 1.45, padding: "8px 12px", borderRadius: 10, background: a.tipo === "info" ? "#EFF6FF" : a.tipo === "erro" ? "#FEF2F2" : "#FFFBEB", borderLeft: `4px solid ${a.tipo === "info" ? "#2563EB" : a.tipo === "erro" ? "#DC2626" : "#D97706"}`, color: "#334155" }}>
                  {a.texto}
                </div>
              ))}
            </div>
          )}

          {/* Cartões de resumo */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0.75rem", marginBottom: "1.25rem" }}>
            <Cartao destaque rotulo="Total dos controláveis" valor={rel.resumo.totalControlaveis} pct={rel.resumo.pct.totalControlaveis} cmp={rel.anterior?.comparacao.totalControlaveis} />
            {ORDEM_DAS_SECOES.map((id) => (
              <Cartao key={id} rotulo={`${ICONE[id]} ${TITULO_DA_SECAO[id]}`} valor={rel.resumo.porSecao[id]} pct={rel.resumo.pct.porSecao[id]}
                cmp={rel.anterior?.comparacao[id]} diferenca={DIFERENCA.includes(id)} falta={rel.secoes[id].falta}
                onClick={() => { setAbertas((a) => new Set(a).add(id)); document.getElementById(`secao-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }); }} />
            ))}
          </div>
          {rel.anterior && (
            <p style={{ fontSize: "0.76rem", color: "#64748B", margin: "-0.6rem 0 1rem" }}>
              ▲ / ▼ comparado com {diaBr(rel.anterior.de)} a {diaBr(rel.anterior.ate)} (mesmo número de dias), em pontos da % da venda. Vermelho = piorou.
              Não há meta de perda cadastrada nas Metas; a % é sobre a venda líquida (sem taxa de entrega).
            </p>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 420px), 1fr))", gap: "1rem", marginBottom: "1.25rem" }}>
            {/* Resumo final como no papel */}
            <div style={caixa}>
              <h3 style={tituloCaixa}>Resumo</h3>
              <table className="items-table" style={{ fontSize: "0.85rem" }}>
                <tbody>
                  {linhasDoResumo(rel).map((l) => (
                    <tr key={l.rotulo} style={l.destaque ? { fontWeight: 800, background: "#FAF6F2" } : undefined}>
                      <td>{l.rotulo}</td>
                      <td style={{ textAlign: "right", color: l.valor < 0 ? "#B91C1C" : undefined, whiteSpace: "nowrap" }}>{fmtR(l.valor)}{(l.rotulo.startsWith("Diferença") || l.rotulo === TITULO_DA_SECAO.rendimento) && <RotuloDaDiferenca v={l.valor} />}</td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{fmtP(l.pct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Onde está o dinheiro */}
            <div style={caixa}>
              <h3 style={{ ...tituloCaixa, marginBottom: "0.25rem" }}>💸 Onde está o dinheiro</h3>
              <p style={{ fontSize: "0.78rem", color: "#64748B", margin: "0 0 0.6rem", lineHeight: 1.45 }}>{DESCRICAO_DO_ONDE_ESTA_O_DINHEIRO}</p>
              {rel.ondeEstaODinheiro.length === 0 ? (
                <p style={{ fontSize: "0.85rem", color: "#94A3B8" }}>Nada custou no período.</p>
              ) : (
                <div style={{ display: "grid", gap: 6 }}>
                  {rel.ondeEstaODinheiro.map((i, n) => {
                    const max = rel.ondeEstaODinheiro[0].valor || 1;
                    return (
                      <div key={`${i.secao}-${i.nome}-${n}`} style={{ fontSize: "0.82rem" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                          <span style={{ fontWeight: 700, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n + 1}. {i.nome}</span>
                          <span style={{ fontWeight: 800, whiteSpace: "nowrap" }}>{fmtR(i.valor)}</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ flex: 1, height: 6, background: "#F1F5F9", borderRadius: 99 }}>
                            <div style={{ width: `${Math.max(3, (i.valor / max) * 100)}%`, height: "100%", background: "#C92E09", borderRadius: 99 }} />
                          </div>
                          <span style={{ fontSize: "0.7rem", color: "#64748B", whiteSpace: "nowrap" }}>{TITULO_DA_SECAO[i.secao]}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* As seções */}
          {ORDEM_DAS_SECOES.map((id) => (
            <SecaoDoRelatorio key={id} secao={rel.secoes[id]} aberta={abertas.has(id)} onAlternar={() => alternar(id)}
              venda={SECOES_DA_CONTAGEM.includes(id) && rel.contagem ? rel.contagem.venda : rel.venda}
              recorte={SECOES_DA_CONTAGEM.includes(id) && rel.contagem ? `${diaBr(rel.contagem.de)} a ${diaBr(rel.contagem.ate)}` : null}
              onClasse={trocarClasse} />
          ))}
        </div>
      )}
    </div>
  );
}

const caixa: React.CSSProperties = { background: "#fff", border: "1px solid #E7DDD3", borderRadius: 14, padding: "12px 14px", minWidth: 0 };
const tituloCaixa: React.CSSProperties = { fontSize: "0.95rem", fontWeight: 800, margin: "0 0 0.6rem" };

function Info({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div>
      <div style={{ fontSize: "0.68rem", fontWeight: 700, color: "#A8A29E", textTransform: "uppercase" }}>{rotulo}</div>
      <div style={{ fontSize: "0.95rem", fontWeight: 800 }}>{valor}</div>
    </div>
  );
}

function Seta({ cmp }: { cmp?: Comparacao }) {
  if (!cmp) return null;
  if (cmp.sentido === "igual") return <span style={{ fontSize: "0.72rem", color: "#94A3B8", fontWeight: 700 }}>= igual</span>;
  const subiu = (cmp.pontos ?? cmp.valor) > 0;
  const cor = cmp.sentido === "pior" ? "#DC2626" : "#059669";
  const texto = cmp.pontos != null ? `${Math.abs(cmp.pontos).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} pt` : fmtR(Math.abs(cmp.valor));
  return <span style={{ fontSize: "0.72rem", color: cor, fontWeight: 800 }} title={`Diferença para o período anterior: ${fmtR(cmp.valor)}`}>{subiu ? "▲" : "▼"} {texto}</span>;
}

function Cartao({ rotulo, valor, pct, cmp, destaque, diferenca, falta, onClick }: {
  rotulo: string; valor: number; pct: number | null; cmp?: Comparacao; destaque?: boolean; diferenca?: boolean; falta?: string | null; onClick?: () => void;
}) {
  const cor = destaque ? "#fff" : diferenca ? (valor < 0 ? "#B91C1C" : valor > 0 ? "#047857" : "#1C1917") : "#C92E09";
  return (
    <button type="button" onClick={onClick} disabled={!onClick}
      style={{
        textAlign: "left", background: destaque ? "#C92E09" : "#fff", border: `1px solid ${destaque ? "#C92E09" : "#E7DDD3"}`, borderRadius: 12,
        padding: "12px 14px", cursor: onClick ? "pointer" : "default", color: destaque ? "#fff" : "#1C1917", gridColumn: destaque ? "span 1" : undefined,
      }}>
      <div style={{ fontSize: "0.72rem", fontWeight: 800, color: destaque ? "#FFEDD5" : "#64748B", textTransform: "uppercase" }}>{rotulo}</div>
      {falta ? (
        <div style={{ fontSize: "0.78rem", color: "#B45309", fontWeight: 700, marginTop: 4 }}>Falta contagem</div>
      ) : (
        <>
          <div style={{ fontSize: destaque ? "1.45rem" : "1.2rem", fontWeight: 900, color: cor, marginTop: 2 }}>{fmtR(valor)}</div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
            <span style={{ fontSize: "0.8rem", fontWeight: 700, color: destaque ? "#fff" : "#475569" }}>{fmtP(pct)} da venda{diferenca && <RotuloDaDiferenca v={valor} />}</span>
            {destaque ? <span style={{ background: "#fff", borderRadius: 99, padding: "1px 6px" }}><Seta cmp={cmp} /></span> : <Seta cmp={cmp} />}
          </div>
        </>
      )}
    </button>
  );
}

function SecaoDoRelatorio({ secao, aberta, onAlternar, venda, recorte, onClasse }: {
  secao: Secao; aberta: boolean; onAlternar: () => void; venda: number; recorte: string | null; onClasse: (insumoId: string, classe: Classe | "") => void;
}) {
  const dif = DIFERENCA.includes(secao.id);
  const comClasse = SECOES_DA_CONTAGEM.includes(secao.id);
  const [ordem, setOrdem] = useState<{ col: Coluna; desc: boolean }>({ col: "total", desc: !dif });
  const [aberto, setAberto] = useState<string | null>(null);

  const ordenar = (l: LinhaDoRelatorio[]) => [...l].sort((a, b) => {
    const va = a[ordem.col], vb = b[ordem.col];
    const r = typeof va === "string" ? va.localeCompare(String(vb), "pt-BR") : (Number(va ?? -Infinity) - Number(vb ?? -Infinity));
    return ordem.desc ? -r : r;
  });
  const cabecalho = (col: Coluna, rotulo: string, direita = true) => (
    <th style={{ textAlign: direita ? "right" : "left", cursor: "pointer", whiteSpace: "nowrap", userSelect: "none" }}
      onClick={() => setOrdem((o) => ({ col, desc: o.col === col ? !o.desc : col !== "nome" }))}>
      {rotulo}{ordem.col === col ? (ordem.desc ? " ↓" : " ↑") : ""}
    </th>
  );
  const pct = (v: number) => (venda > 0 ? fmtP(Math.round((v / venda) * 10000) / 100) : "—");
  const colunas = comClasse ? 7 : 6;

  const tabela = (linhas: LinhaDoRelatorio[], rodape?: { rotulo: string; valor: number }) => (
    <div className="items-table-wrapper">
      <table className="items-table" style={{ fontSize: "0.85rem" }}>
        <thead>
          <tr>
            <th style={{ width: 24 }} />
            {cabecalho("nome", "Item", false)}
            {comClasse && <th>Classe</th>}
            {cabecalho("quantidade", dif ? "Diferença" : "Qtde")}
            {cabecalho("custoUnitario", "Custo unit.")}
            {cabecalho("total", dif ? "Diferença R$" : "Custo total")}
            <th style={{ textAlign: "right" }}>% venda</th>
          </tr>
        </thead>
        <tbody>
          {ordenar(linhas).map((l) => {
            const temDetalhe = Boolean(l.lancamentos?.length || l.conta);
            const estaAberto = aberto === l.chave;
            const corDif = dif ? (l.total < 0 ? "#B91C1C" : l.total > 0 ? "#047857" : undefined) : undefined;
            return (
              <Fragment key={l.chave}>
                <tr onClick={() => temDetalhe && setAberto(estaAberto ? null : l.chave)} style={{ cursor: temDetalhe ? "pointer" : "default" }}>
                  <td style={{ color: "#94A3B8" }}>{temDetalhe ? (estaAberto ? <ChevronDown size={15} /> : <ChevronRight size={15} />) : null}</td>
                  <td className="name-col">
                    {l.nome}
                    {l.lancamentos && <span style={{ display: "block", fontSize: "0.72rem", color: "#94A3B8", fontWeight: 600 }}>{l.tipo === "PRODUTO" ? "Produto" : "Insumo"} · {l.lancamentos.length} lançamento(s)</span>}
                  </td>
                  {comClasse && (
                    <td onClick={(e) => e.stopPropagation()}>
                      {l.insumoId && (
                        <select value={l.classePalpite ? "" : l.classe} onChange={(e) => onClasse(l.insumoId!, e.target.value as Classe | "")}
                          aria-label={`Classe de ${l.nome}`} style={{ fontSize: "0.78rem", padding: "3px 6px", borderRadius: 8, border: "1px solid #E7DDD3", background: "#FAF6F2" }}>
                          <option value="">{l.classe ? `${ROTULO_DA_CLASSE[l.classe]} (automático)` : "Automático"}</option>
                          {CLASSES.map((c) => <option key={c} value={c}>{ROTULO_DA_CLASSE[c]}</option>)}
                        </select>
                      )}
                    </td>
                  )}
                  <td style={{ textAlign: "right", whiteSpace: "nowrap", color: corDif, fontWeight: dif ? 700 : undefined }}>{dif && l.quantidade > 0 ? "+" : ""}{fmtQ(l.quantidade)} {l.unidade}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{fmtR(l.custoUnitario)}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap", fontWeight: 800, color: corDif }}>{l.semCusto && l.total === 0 ? <span style={{ color: "#B45309" }}>sem custo</span> : <>{fmtR(l.total)}{dif && <RotuloDaDiferenca v={l.total} />}</>}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{pct(l.total)}</td>
                </tr>
                {estaAberto && (
                  <tr>
                    <td colSpan={colunas} style={{ background: "#FAF6F2", padding: "8px 12px" }}>
                      {l.conta && (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 18px", fontSize: "0.8rem" }}>
                          <Conta rotulo="Abertura" v={l.conta.abertura} u={l.unidade} />
                          <Conta rotulo="+ Entradas" v={l.conta.entradas} u={l.unidade} />
                          <Conta rotulo="− Fechamento" v={l.conta.fechamento} u={l.unidade} />
                          <Conta rotulo="= Consumo real" v={l.conta.real} u={l.unidade} forte />
                          <span style={{ color: "#CBD5E1" }}>|</span>
                          <Conta rotulo="Vendas (ficha)" v={l.conta.vendas} u={l.unidade} />
                          <Conta rotulo="Equipe" v={l.conta.equipe} u={l.unidade} />
                          <Conta rotulo="Perdas lançadas" v={l.conta.perdas} u={l.unidade} />
                          <Conta rotulo="Saídas à mão" v={l.conta.saidas} u={l.unidade} />
                          <Conta rotulo="= Explicado" v={l.conta.explicado} u={l.unidade} forte />
                        </div>
                      )}
                      {l.lancamentos && (
                        <table style={{ width: "100%", fontSize: "0.78rem", borderCollapse: "collapse" }}>
                          <thead><tr style={{ color: "#64748B", textAlign: "left" }}><th>Quando</th><th>Quem</th><th>Motivo</th><th>Origem</th><th style={{ textAlign: "right" }}>Qtde</th><th style={{ textAlign: "right" }}>Valor</th></tr></thead>
                          <tbody>
                            {l.lancamentos.map((x, i) => (
                              <tr key={i} style={{ borderTop: "1px solid #E7DDD3" }}>
                                <td style={{ padding: "3px 4px", whiteSpace: "nowrap" }}>{quandoBr(x.quando)}</td>
                                <td style={{ padding: "3px 4px" }}>{x.quem || "—"}</td>
                                <td style={{ padding: "3px 4px" }}>{x.motivo || "—"}</td>
                                <td style={{ padding: "3px 4px" }}>{x.origem}</td>
                                <td style={{ padding: "3px 4px", textAlign: "right", whiteSpace: "nowrap" }}>{x.quantidade == null ? "—" : `${fmtQ(x.quantidade)} ${x.unidade || ""}`}</td>
                                <td style={{ padding: "3px 4px", textAlign: "right", whiteSpace: "nowrap" }}>{x.valor == null ? <span style={{ color: "#B45309" }}>sem valor</span> : `${fmtR(x.valor)}${x.estimado ? " (estimado)" : ""}`}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
          {rodape && (
            <tr style={{ fontWeight: 800, background: "#FAF6F2" }}>
              <td />
              <td colSpan={colunas - 3}>{rodape.rotulo}</td>
              <td style={{ textAlign: "right", whiteSpace: "nowrap", color: dif && rodape.valor < 0 ? "#B91C1C" : undefined }}>{fmtR(rodape.valor)}{dif && <RotuloDaDiferenca v={rodape.valor} />}</td>
              <td style={{ textAlign: "right" }}>{pct(rodape.valor)}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );

  return (
    <section id={`secao-${secao.id}`} style={{ ...caixa, marginBottom: "0.85rem", padding: 0, scrollMarginTop: 80 }}>
      <button type="button" onClick={onAlternar} aria-expanded={aberta}
        style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", background: "none", border: "none", cursor: "pointer", textAlign: "left" }}>
        {aberta ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        <span style={{ fontSize: "1rem", fontWeight: 900, flex: 1, minWidth: 0 }}>{ICONE[secao.id]} {secao.titulo}</span>
        {secao.falta ? <span style={{ fontSize: "0.8rem", fontWeight: 700, color: "#B45309" }}>falta contagem</span> : (
          <>
            <span style={{ fontWeight: 900, color: dif ? (secao.total < 0 ? "#B91C1C" : secao.total > 0 ? "#047857" : undefined) : "#C92E09", whiteSpace: "nowrap" }}>{fmtR(secao.total)}{dif && <RotuloDaDiferenca v={secao.total} />}</span>
            <span style={{ fontSize: "0.82rem", fontWeight: 700, color: "#475569", whiteSpace: "nowrap", minWidth: 64, textAlign: "right" }}>{fmtP(secao.pct)}</span>
          </>
        )}
      </button>
      {aberta && (
        <div style={{ padding: "0 14px 14px" }}>
          <p style={{ fontSize: "0.8rem", color: "#64748B", margin: "0 0 0.6rem", lineHeight: 1.45 }}>
            {secao.descricao}{recorte ? ` Contagens de ${recorte}.` : ""}
            {secao.semValor > 0 && <strong style={{ color: "#B45309" }}> {secao.semValor} sem valor (fora do total).</strong>}
          </p>
          {secao.falta ? (
            <p style={{ fontSize: "0.85rem", color: "#B45309", fontWeight: 600 }}>{secao.falta}</p>
          ) : secao.linhas.length === 0 && !secao.cancelados?.length ? (
            <p style={{ fontSize: "0.85rem", color: "#94A3B8" }}>Nada no período.</p>
          ) : secao.id === "inventario" ? (
            <>
              <h4 style={{ fontSize: "0.85rem", margin: "0.3rem 0" }}>Alimentos</h4>
              {tabela(secao.linhas.filter((l) => l.grupo !== "EMBALAGENS"), { rotulo: "Diferença de alimentos", valor: secao.grupos?.alimentos ?? 0 })}
              <h4 style={{ fontSize: "0.85rem", margin: "0.8rem 0 0.3rem" }}>Embalagens</h4>
              {tabela(secao.linhas.filter((l) => l.grupo === "EMBALAGENS"), { rotulo: "Diferença de embalagens", valor: secao.grupos?.embalagens ?? 0 })}
            </>
          ) : (
            secao.linhas.length > 0 && tabela(secao.linhas, { rotulo: `Total ${secao.id === "completo" && secao.cancelados?.length ? "(com os cancelados)" : ""}`, valor: secao.total })
          )}
          {secao.cancelados && secao.cancelados.length > 0 && (
            <>
              <h4 style={{ fontSize: "0.85rem", margin: "0.9rem 0 0.3rem" }}>❌ Pedidos cancelados depois de produzidos</h4>
              <div className="items-table-wrapper">
                <table className="items-table" style={{ fontSize: "0.83rem" }}>
                  <thead><tr><th>Pedido</th><th>Quando</th><th>Quando cancelou</th><th>Motivo</th><th style={{ textAlign: "right" }}>Custo</th></tr></thead>
                  <tbody>
                    {secao.cancelados.map((c) => (
                      <tr key={c.numero + c.quando}>
                        <td className="name-col">{c.numero}</td><td>{quandoBr(c.quando)}</td><td>{c.etapa}</td><td className="notes-col">{c.motivo || "—"}</td>
                        <td style={{ textAlign: "right", fontWeight: 700 }}>{c.valor == null ? <span style={{ color: "#B45309" }}>sem ficha</span> : fmtR(c.valor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function Conta({ rotulo, v, u, forte }: { rotulo: string; v: number; u: string; forte?: boolean }) {
  return (
    <span style={{ whiteSpace: "nowrap" }}>
      <span style={{ color: "#64748B" }}>{rotulo}: </span>
      <strong style={{ fontWeight: forte ? 900 : 700 }}>{fmtQ(v)} {u}</strong>
    </span>
  );
}
