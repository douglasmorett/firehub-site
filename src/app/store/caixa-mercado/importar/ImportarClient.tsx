"use client";

/**
 * O cadastro do mercado em lote (lib/caixa-mercado/importar.ts):
 * 1. a planilha do PDV antigo (CSV/XLSX), com mapeamento de colunas e prévia;
 * 2. os XML das notas de COMPRA (vários ou .zip): NCM/CEST e custo pelo EAN;
 * 3. NCM pela IA para o que sobrar ("sugerido, conferir");
 * 4. a planilha por NCM para o contador, e a volta dela aplicando a regra;
 * 5. a conferência: unidade, códigos e o que falta em cada produto.
 */
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import { CAMPOS_DA_PLANILHA, lerLinhasDaPlanilha, type Mapeamento } from "@/lib/caixa-mercado/importacao/planilha";

type Produto = { id: string; nome: string; precoCentavos: number; unidade: "UN" | "KG"; ncm: string | null; ncmSugerido: boolean; eans: string[]; plu: string | null; ativo: boolean };
const reais = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function ImportarClient() {
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [linhas, setLinhas] = useState<string[][] | null>(null);
  const [mapa, setMapa] = useState<Mapeamento | null>(null);
  const [cabecalho, setCabecalho] = useState(true);
  const [ocupado, setOcupado] = useState("");
  const [resumo, setResumo] = useState<string[]>([]);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [filtro, setFiltro] = useState<"todos" | "semNcm" | "sugerido" | "semCodigo" | "semPreco">("todos");
  const [busca, setBusca] = useState("");
  const [edicao, setEdicao] = useState<Record<string, { unidade: "UN" | "KG"; eans: string; plu: string }>>({});

  const avisar = (ok: boolean, texto: string) => { setAviso({ ok, texto }); setTimeout(() => setAviso(null), 7000); };

  const carregar = useCallback(async () => {
    const r = await fetch("/api/store/caixa-mercado/catalogo?todos=1", { cache: "no-store" });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return avisar(false, d?.error || "Não deu para carregar os produtos.");
    setProdutos(d.produtos || []);
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);

  async function lerArquivo(f: File | undefined) {
    if (!f) return;
    setOcupado("ler");
    const fd = new FormData();
    fd.append("arquivo", f);
    const r = await fetch("/api/store/caixa-mercado/importar/ler", { method: "POST", body: fd });
    const d = await r.json().catch(() => ({}));
    setOcupado("");
    if (!r.ok) return avisar(false, d?.error || "Não deu para ler.");
    setLinhas(d.linhas);
    setMapa(d.mapeamento);
  }

  const previa = useMemo(() => (linhas && mapa ? lerLinhasDaPlanilha(linhas, mapa, cabecalho) : null), [linhas, mapa, cabecalho]);

  async function importarPlanilha() {
    if (!linhas || !mapa) return;
    setOcupado("planilha");
    const r = await fetch("/api/store/caixa-mercado/importar/planilha", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ linhas, mapeamento: mapa, cabecalho }) });
    const d = await r.json().catch(() => ({}));
    setOcupado("");
    if (!r.ok) return avisar(false, d?.error || "A importação falhou.");
    setResumo([`Planilha: ${d.lidas} linhas lidas, ${d.criados} produtos criados, ${d.atualizados} atualizados, ${d.codigos} códigos de barras.${d.descartadas ? ` ${d.descartadas} linhas sem descrição ignoradas.` : ""}`, ...(d.avisos || [])]);
    setLinhas(null);
    avisar(true, "Planilha importada.");
    await carregar();
  }

  async function importarXml(lista: FileList | null) {
    if (!lista?.length) return;
    setOcupado("xml");
    const fd = new FormData();
    for (const f of Array.from(lista)) fd.append("arquivos", f);
    const r = await fetch("/api/store/caixa-mercado/importar/xml", { method: "POST", body: fd });
    const d = await r.json().catch(() => ({}));
    setOcupado("");
    if (!r.ok) return avisar(false, d?.error || "A importação falhou.");
    setResumo([
      `Notas de compra: ${d.notas} nota(s), ${d.itens} itens. NCM completado em ${d.ncmCompletados} produto(s), ${d.criados} produto(s) novo(s) (sem preço = inativos até você preencher), ${d.atualizados} atualizados (custo). ${d.semEan} itens sem código de barras.`,
      ...(d.ignorados?.length ? [`Arquivos que não eram NF-e: ${d.ignorados.join(", ")}`] : []),
      ...(d.divergencias || []).map((x: string) => `NCM diferente (mantido o do cadastro): ${x}`),
    ]);
    avisar(true, "XML importados.");
    await carregar();
  }

  async function ncmPelaIa() {
    setOcupado("ia");
    let total = 0, pular = 0;
    for (let volta = 0; volta < 100; volta++) {
      const r = await fetch("/api/store/caixa-mercado/importar/ncm-ia", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pular }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { avisar(false, d?.error || "A IA falhou."); break; }
      total += d.sugeridos || 0;
      pular += d.semResposta || 0;
      if (!d.sugeridos && !d.semResposta) break;
    }
    setOcupado("");
    setResumo([`IA: NCM sugerido para ${total} produto(s) — marcados "sugerido, conferir".${pular ? ` ${pular} ficaram sem NCM (descrição vaga demais).` : ""}`]);
    await carregar();
  }

  async function voltaDoContador(f: File | undefined) {
    if (!f) return;
    setOcupado("contador");
    const fd = new FormData();
    fd.append("arquivo", f);
    const r = await fetch("/api/store/caixa-mercado/contador", { method: "POST", body: fd });
    const d = await r.json().catch(() => ({}));
    setOcupado("");
    if (!r.ok) return avisar(false, d?.error || "Não deu para aplicar.");
    setResumo([`Contador: regra gravada para ${d.ncms} NCM(s), aplicada a ${d.produtos} produto(s).`, ...(d.erros || [])]);
    avisar(true, "Tributação aplicada por NCM.");
  }

  async function salvarProduto(p: Produto, e = edicao[p.id]) {
    if (!e) return;
    const r = await fetch("/api/store/caixa-mercado/produto", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ produtoId: p.id, unidade: e.unidade, eans: e.eans.split(/[\s,;]+/).filter(Boolean), plu: e.plu, ncmConferido: p.ncmSugerido }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return avisar(false, d?.error || "Não deu para salvar.");
    setEdicao((x) => { const y = { ...x }; delete y[p.id]; return y; });
    avisar(true, `${p.nome} salvo.`);
    await carregar();
  }

  const lista = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return produtos.filter((p) => {
      if (t && !p.nome.toLowerCase().includes(t) && !p.eans.some((e) => e.includes(t))) return false;
      if (filtro === "semNcm") return !p.ncm;
      if (filtro === "sugerido") return p.ncmSugerido;
      if (filtro === "semCodigo") return p.eans.length === 0 && !p.plu;
      if (filtro === "semPreco") return p.precoCentavos <= 0;
      return true;
    }).slice(0, 300);
  }, [produtos, filtro, busca]);
  const contagem = {
    semNcm: produtos.filter((p) => !p.ncm).length,
    sugerido: produtos.filter((p) => p.ncmSugerido).length,
    semCodigo: produtos.filter((p) => p.eans.length === 0 && !p.plu).length,
    semPreco: produtos.filter((p) => p.precoCentavos <= 0).length,
  };

  return (
    <div style={S.pagina}>
      {aviso && <div style={{ ...S.aviso, background: aviso.ok ? "#ECFDF3" : "#FEF2F2", color: aviso.ok ? "#14532D" : "#7F1D1D" }} onClick={() => setAviso(null)}>{aviso.texto}</div>}
      <Link href="/store/caixa-mercado" style={{ color: "#57524C", fontSize: 14 }}>← Caixa de mercado</Link>
      <h1 style={{ margin: "8px 0 0", fontSize: 26, fontWeight: 900 }}>Importar produtos do mercado</h1>
      <p style={S.sub}>{produtos.length} produtos no cadastro. A ordem que funciona: 1) planilha do sistema antigo, 2) XML das notas de compra, 3) IA para o que sobrar sem NCM, 4) planilha para o contador.</p>

      {resumo.length > 0 && (
        <div style={{ ...S.cartao, background: "#F0FDF4", borderColor: "#BBF7D0" }} data-testid="resumo">
          {resumo.slice(0, 30).map((r, i) => <p key={i} style={{ margin: "4px 0", fontSize: 14 }}>{r}</p>)}
          {resumo.length > 30 && <p style={S.sub}>… e mais {resumo.length - 30} avisos.</p>}
        </div>
      )}

      <div style={S.cartao}>
        <h2 style={S.h2}>1. Planilha do sistema antigo (CSV ou Excel)</h2>
        <p style={S.sub}>Exporte o cadastro de produtos do PDV que o mercado usa hoje: código de barras, descrição, preço, unidade, NCM, CEST, estoque.</p>
        <input type="file" accept=".csv,.txt,.xlsx" onChange={(e) => void lerArquivo(e.target.files?.[0])} disabled={Boolean(ocupado)} aria-label="Planilha" />
        {linhas && mapa && previa && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10, marginTop: 12 }}>
              {CAMPOS_DA_PLANILHA.map((c) => (
                <label key={c.campo} style={S.rotulo}>{c.nome}{c.obrigatorio ? " *" : ""}
                  <select style={S.select} value={mapa[c.campo]} onChange={(e) => setMapa({ ...mapa, [c.campo]: Number(e.target.value) })} aria-label={c.nome}>
                    <option value={-1}>— não tem —</option>
                    {linhas[0].map((h, i) => <option key={i} value={i}>{cabecalho ? h || `Coluna ${i + 1}` : `Coluna ${i + 1}`}</option>)}
                  </select>
                </label>
              ))}
            </div>
            <label style={{ display: "flex", gap: 6, marginTop: 8, fontSize: 14 }}><input type="checkbox" checked={cabecalho} onChange={(e) => setCabecalho(e.target.checked)} /> A primeira linha é o cabeçalho</label>
            <p style={S.sub}>Prévia ({previa.itens.length} produtos{previa.descartadas ? `, ${previa.descartadas} linhas sem descrição` : ""}):</p>
            <div style={{ overflowX: "auto" }}>
              <table style={S.tabela}>
                <thead><tr><th style={S.th}>Descrição</th><th style={S.th}>EAN</th><th style={S.th}>Preço</th><th style={S.th}>Un</th><th style={S.th}>NCM</th><th style={S.th}>CEST</th><th style={S.th}>Estoque</th><th style={S.th}>Avisos</th></tr></thead>
                <tbody>
                  {previa.itens.slice(0, 10).map((i) => (
                    <tr key={i.linha}><td style={S.td}>{i.descricao}</td><td style={S.td}>{i.codigos.join(", ")}</td><td style={S.td}>{i.precoCentavos != null ? reais(i.precoCentavos) : "—"}</td><td style={S.td}>{i.unidade}</td><td style={S.td}>{i.ncm || "—"}</td><td style={S.td}>{i.cest || ""}</td><td style={S.td}>{i.estoque ?? ""}</td><td style={{ ...S.td, color: "#B45309" }}>{i.avisos.join("; ")}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button style={{ ...S.cta, marginTop: 12 }} disabled={Boolean(ocupado) || mapa.descricao < 0} onClick={importarPlanilha}>{ocupado === "planilha" ? "Importando…" : `Importar ${previa.itens.length} produtos`}</button>
          </>
        )}
      </div>

      <div style={S.cartao}>
        <h2 style={S.h2}>2. XML das notas de compra</h2>
        <p style={S.sub}>Os XML das NF-e que os fornecedores mandam (pode selecionar vários ou um .zip). O NCM e o CEST que o fornecedor declarou completam o cadastro pelo código de barras; o custo é atualizado; o que não existe é criado (sem preço, inativo, para você preencher).</p>
        <input type="file" accept=".xml,.zip" multiple onChange={(e) => void importarXml(e.target.files)} disabled={Boolean(ocupado)} aria-label="XML das notas" />
        {ocupado === "xml" && <p style={S.sub}>Lendo as notas…</p>}
      </div>

      <div style={S.cartao}>
        <h2 style={S.h2}>3. NCM pela IA ({contagem.semNcm} sem NCM)</h2>
        <p style={S.sub}>Para o que sobrou sem NCM, a IA sugere pela descrição. Fica marcado "sugerido, conferir" e o contador confere na planilha do passo 4.</p>
        <button style={S.botaoLeve} disabled={Boolean(ocupado) || contagem.semNcm === 0} onClick={ncmPelaIa}>{ocupado === "ia" ? "Pensando…" : "Sugerir NCM com IA"}</button>
      </div>

      <div style={S.cartao}>
        <h2 style={S.h2}>4. Planilha para o contador (tributação por NCM)</h2>
        <p style={S.sub}>Uma linha por NCM, com exemplos e uma sugestão de CFOP, CSOSN/CST, PIS e COFINS. O contador corrige e devolve; a regra vale para todos os produtos daquele NCM.</p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <a href="/api/store/caixa-mercado/contador" style={{ ...S.cta, textDecoration: "none" }}>Baixar planilha do contador</a>
          <label style={S.rotulo}>Devolvida pelo contador:
            <input type="file" accept=".xlsx,.csv" onChange={(e) => void voltaDoContador(e.target.files?.[0])} disabled={Boolean(ocupado)} aria-label="Planilha do contador" />
          </label>
        </div>
      </div>

      <div style={S.cartao}>
        <h2 style={S.h2}>5. Conferência do cadastro</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "8px 0" }}>
          {([["todos", `Todos (${produtos.length})`], ["semNcm", `Sem NCM (${contagem.semNcm})`], ["sugerido", `NCM sugerido (${contagem.sugerido})`], ["semCodigo", `Sem código (${contagem.semCodigo})`], ["semPreco", `Sem preço (${contagem.semPreco})`]] as const).map(([k, t]) => (
            <button key={k} style={{ ...S.botaoLeve, ...(filtro === k ? { background: "#FFF7ED", borderColor: "#FDBA74" } : {}) }} onClick={() => setFiltro(k)}>{t}</button>
          ))}
          <input style={S.select} placeholder="Buscar nome ou código" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar" />
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={S.tabela}>
            <thead><tr><th style={S.th}>Produto</th><th style={S.th}>Preço</th><th style={S.th}>NCM</th><th style={S.th}>Unidade</th><th style={S.th}>Códigos de barras</th><th style={S.th}>PLU balança</th><th style={S.th}></th></tr></thead>
            <tbody>
              {lista.map((p) => {
                const e = edicao[p.id];
                return (
                  <tr key={p.id}>
                    <td style={S.td}>{p.nome}{!p.ativo && <small style={{ color: "#B45309" }}> (inativo)</small>}</td>
                    <td style={S.td}>{p.precoCentavos > 0 ? reais(p.precoCentavos) : "—"}</td>
                    <td style={S.td}>{p.ncm || "—"}{p.ncmSugerido && <small style={{ color: "#B45309" }}> sugerido, conferir</small>}</td>
                    <td style={S.td}>
                      <select style={S.select} value={e?.unidade ?? p.unidade} onChange={(ev) => setEdicao({ ...edicao, [p.id]: { unidade: ev.target.value as any, eans: e?.eans ?? p.eans.join(" "), plu: e?.plu ?? p.plu ?? "" } })}>
                        <option value="UN">UN</option><option value="KG">KG</option>
                      </select>
                    </td>
                    <td style={S.td}><input style={S.select} value={e?.eans ?? p.eans.join(" ")} onChange={(ev) => setEdicao({ ...edicao, [p.id]: { unidade: e?.unidade ?? p.unidade, eans: ev.target.value, plu: e?.plu ?? p.plu ?? "" } })} /></td>
                    <td style={S.td}><input style={{ ...S.select, width: 80 }} value={e?.plu ?? p.plu ?? ""} onChange={(ev) => setEdicao({ ...edicao, [p.id]: { unidade: e?.unidade ?? p.unidade, eans: e?.eans ?? p.eans.join(" "), plu: ev.target.value } })} /></td>
                    <td style={S.td}>{(e || p.ncmSugerido) && <button style={S.botaoLeve} onClick={() => void salvarProduto(p, e ?? { unidade: p.unidade, eans: p.eans.join(" "), plu: p.plu ?? "" })}>{p.ncmSugerido && !e ? "NCM conferido" : "Salvar"}</button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p style={S.sub}>Preço e NCM se corrigem no Cardápio (o produto é o mesmo). Mostrando até 300.</p>
      </div>
    </div>
  );
}

const S: Record<string, CSSProperties> = {
  pagina: { maxWidth: 1240, margin: "0 auto", padding: "20px 16px 72px", color: "#15120F", fontFamily: "Inter, system-ui, sans-serif" },
  sub: { color: "#57524C", margin: "6px 0", fontSize: 14, lineHeight: 1.5 },
  h2: { margin: 0, fontSize: 18 },
  cartao: { marginTop: 16, padding: 18, borderRadius: 18, background: "#fff", border: "1px solid #E9E3DC" },
  cta: { display: "inline-flex", alignItems: "center", height: 42, padding: "0 18px", border: 0, borderRadius: 12, background: "#EA580C", color: "#fff", fontWeight: 800, fontSize: 15, cursor: "pointer" },
  botaoLeve: { height: 38, padding: "0 14px", borderRadius: 10, border: "1px solid #D6D3D1", background: "#fff", color: "#57524C", fontWeight: 700, cursor: "pointer" },
  select: { height: 36, borderRadius: 8, border: "1px solid #CBD5E1", padding: "0 8px", background: "#fff", fontSize: 14, maxWidth: "100%" },
  rotulo: { display: "flex", flexDirection: "column", gap: 4, fontSize: 13, fontWeight: 700, color: "#3F3A35" },
  tabela: { width: "100%", borderCollapse: "collapse", fontSize: 13, marginTop: 8 },
  th: { textAlign: "left", padding: "6px 8px", borderBottom: "2px solid #E9E3DC", whiteSpace: "nowrap" },
  td: { padding: "6px 8px", borderBottom: "1px solid #F1F5F9", verticalAlign: "middle" },
  aviso: { position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)", zIndex: 10060, width: "min(560px, calc(100% - 32px))", padding: "12px 16px", borderRadius: 14, fontSize: 14, fontWeight: 600, boxShadow: "0 12px 30px rgba(0,0,0,.15)", cursor: "pointer" },
};
