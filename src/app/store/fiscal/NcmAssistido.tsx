"use client";

/**
 * NCM ASSISTIDO — o painel da aba Produtos da tela fiscal.
 *
 * A sugestão (lib/nfce/ncm-sugerido) roda aqui, no navegador, com as palavras
 * do nome e da categoria. O painel agrupa por CATEGORIA porque é assim que o
 * cardápio se organiza e que o lojista pensa ("as pizzas", "as bebidas"): uma
 * categoria de 26 pizzas vira um clique, com confirmação. Onde a regra fiscal
 * depende de um fato que o nome não diz (a carne passa de 20% do peso? o suco
 * é 100%?), a categoria pergunta antes — nunca chuta.
 *
 * Tudo o que é aplicado por aqui fica MARCADO como sugestão até alguém
 * revisar ("revisar com o contador"), e a planilha leva a lista inteira, com
 * as fontes, para o contador.
 */
import { useMemo, useState } from "react";
import { Download, Sparkles, ChevronDown, ChevronUp, CheckCircle2, AlertTriangle } from "lucide-react";
import {
  cestComPontos,
  montarLote,
  ncmComPontos,
  ncmSugeridoEmTexto,
  resumirPorCategoria,
  situacaoDoNcmGravado,
  type SugestaoDoProduto,
} from "@/lib/nfce/ncm-sugerido";

export type SugestaoComAtual = SugestaoDoProduto & { ncmAtual: string | null };

type Props = {
  sugestoes: SugestaoComAtual[];
  marcas: Record<string, { ncm: string; regra: string; em: string }>;
  ehTitular: boolean;
  papelDoUsuario: string;
  aoAtualizar: () => void | Promise<void>;
};

const CONFIANCA = { alta: "alta", media: "média", baixa: "baixa" } as const;

export default function NcmAssistido({ sugestoes, marcas, ehTitular, papelDoUsuario, aoAtualizar }: Props) {
  const categorias = useMemo(() => {
    // Categoria com produto sem NCM primeiro: é o que falta fazer.
    return resumirPorCategoria(sugestoes).sort((a, b) => Number(b.semNcm > 0) - Number(a.semNcm > 0) || a.categoria.localeCompare(b.categoria, "pt-BR"));
  }, [sugestoes]);
  const [respostas, setRespostas] = useState<Record<string, Record<string, string>>>({});
  // "Substituir também o NCM já gravado" refaz só a SUGESTÃO que ninguém
  // revisou. O NCM revisado pelo contador (ou digitado à mão) só entra com a
  // SEGUNDA escolha, que aparece embaixo da primeira dizendo quantos são.
  const [substituir, setSubstituir] = useState<Record<string, boolean>>({});
  const [substituirRevisados, setSubstituirRevisados] = useState<Record<string, boolean>>({});
  const [aberta, setAberta] = useState<string | null>(null);
  const [aplicando, setAplicando] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{ ok: boolean; texto: string } | null>(null);

  const semNcm = sugestoes.filter((s) => String(s.ncmAtual ?? "").replace(/\D/g, "").length !== 8);
  const comPergunta = semNcm.filter((s) => s.opcoes.length > 1);
  const semSugestao = semNcm.filter((s) => s.opcoes.length === 0);
  // A MESMA regra do lote (lib/nfce/ncm-sugerido → situacaoDoNcmGravado).
  const marcados = sugestoes.filter((s) => situacaoDoNcmGravado(s.ncmAtual, marcas[s.produtoId]) === "sugestao");

  /** As opções do lote da categoria: a segunda escolha só vale com a primeira marcada. */
  const opcoesDoLote = (categoria: string) => ({
    marcas,
    substituirNcmGravado: substituir[categoria] === true,
    substituirRevisados: substituir[categoria] === true && substituirRevisados[categoria] === true,
  });

  const aplicar = async (categoria: string, produtos: SugestaoComAtual[]) => {
    if (!ehTitular) return;
    const r = montarLote(produtos, respostas[categoria] ?? {}, opcoesDoLote(categoria));
    if (r.lote.length === 0) {
      setResultado({ ok: false, texto: `Nada para aplicar em "${categoria}".` });
      return;
    }
    const sobrescritos = new Set(r.revisadosSobrescritos.map((s) => s.produtoId));
    const resumo = r.lote
      .slice(0, 12)
      .map((l) => {
        const p = produtos.find((x) => x.produtoId === l.productId);
        const revisado = sobrescritos.has(l.productId) && p?.ncmAtual ? ` ⚠ troca o NCM revisado ${ncmComPontos(String(p.ncmAtual).replace(/\D/g, ""))}` : "";
        return `• ${p?.nome ?? l.productId}: NCM ${ncmComPontos(l.ncm)}${l.cest ? ` · CEST ${cestComPontos(l.cest)}` : ""} · CFOP ${l.cfop}${l.csosn ? ` · CSOSN ${l.csosn}` : ""}${revisado}`;
      })
      .join("\n");
    const ok = window.confirm(
      // O que não tem volta vem PRIMEIRO: quantos NCM já revisados serão trocados.
      (r.revisadosSobrescritos.length
        ? `ATENÇÃO: ${r.revisadosSobrescritos.length} produto(s) com NCM já REVISADO (pelo contador ou digitado à mão) serão SOBRESCRITOS pela sugestão e voltam a ficar marcados para revisar.\n\n`
        : "") +
        `Aplicar a sugestão em ${r.lote.length} produto(s) de "${categoria}"?\n\n${resumo}${r.lote.length > 12 ? `\n… e mais ${r.lote.length - 12}.` : ""}` +
        (r.semResposta.length ? `\n\n${r.semResposta.length} produto(s) ficam de fora: falta responder a pergunta.` : "") +
        (r.mantidos.length ? `\n${r.mantidos.length} produto(s) já têm NCM e ficam como estão.` : "") +
        (r.revisados.length ? `\n${r.revisados.length} produto(s) com NCM já revisado (pelo contador ou digitado à mão) ficam como estão.` : "") +
        "\n\nÉ uma SUGESTÃO: os produtos ficam marcados para você revisar com o contador (baixe a planilha)."
    );
    if (!ok) return;
    setAplicando(categoria);
    setResultado(null);
    try {
      const res = await fetch("/api/store/fiscal/products", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lote: r.lote }),
      });
      const dados = await res.json().catch(() => ({}));
      setResultado({
        ok: res.ok,
        texto: res.ok
          ? dados.mensagem || dados.aviso || `${dados.count} produto(s) gravados.`
          : `${dados.mensagem || dados.error || "Não consegui gravar."}${Array.isArray(dados.problemas) ? " " + dados.problemas.join(" ") : ""}`,
      });
      if (res.ok) await aoAtualizar();
    } catch {
      setResultado({ ok: false, texto: "Não consegui falar com o servidor. Nada foi gravado." });
    } finally {
      setAplicando(null);
    }
  };

  const marcarRevisados = async () => {
    if (!ehTitular || marcados.length === 0) return;
    if (!window.confirm(`Marcar ${marcados.length} produto(s) como revisados pelo contador? A marca "sugestão aplicada" sai deles.`)) return;
    try {
      const res = await fetch("/api/store/fiscal/products", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revisados: marcados.map((m) => m.produtoId) }),
      });
      const dados = await res.json().catch(() => ({}));
      setResultado({ ok: res.ok, texto: dados.mensagem || dados.error || (res.ok ? "Feito." : "Não consegui marcar.") });
      if (res.ok) await aoAtualizar();
    } catch {
      setResultado({ ok: false, texto: "Não consegui falar com o servidor." });
    }
  };

  const botao = (ativo: boolean) =>
    ({
      padding: "8px 14px",
      borderRadius: 8,
      border: "none",
      background: ativo ? "#1C1917" : "#CBD5E1",
      color: "#fff",
      fontWeight: 800,
      fontSize: "0.8rem",
      cursor: ativo ? "pointer" : "not-allowed",
    }) as const;

  return (
    <section aria-labelledby="ncm-assistido-titulo" style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 14, padding: "1.1rem 1.2rem", marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0, flex: "1 1 280px" }}>
          <h2 id="ncm-assistido-titulo" style={{ margin: 0, fontSize: "1rem", fontWeight: 800, color: "#1E293B", display: "flex", alignItems: "center", gap: 8 }}>
            <Sparkles size={18} color="#B45309" aria-hidden /> NCM assistido
          </h2>
          <p style={{ margin: "6px 0 0", fontSize: "0.8rem", color: "#475569", lineHeight: 1.5 }}>
            Sugestão de NCM, CEST, CFOP e CSOSN pelas palavras do nome e da categoria, com a fonte de cada regra. É
            sugestão: <strong>revise com o seu contador</strong> — a classificação fiscal é responsabilidade da empresa.
          </p>
        </div>
        <a
          href="/api/store/fiscal/products/planilha"
          download
          style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8, border: "1.5px solid #1C1917", color: "#1C1917", fontWeight: 800, fontSize: "0.8rem", textDecoration: "none", background: "#fff" }}
        >
          <Download size={15} aria-hidden /> Baixar planilha para o contador
        </a>
      </div>

      <p style={{ margin: "12px 0 0", fontSize: "0.8rem", color: "#334155" }}>
        <strong>{semNcm.length}</strong> de {sugestoes.length} produto(s) sem NCM · {comPergunta.length} precisam de uma escolha ·{" "}
        {semSugestao.length} sem sugestão{marcados.length > 0 ? ` · ${marcados.length} com sugestão aplicada, a revisar` : ""}
      </p>

      {resultado && (
        <p
          role="status"
          style={{
            margin: "10px 0 0",
            padding: "8px 12px",
            borderRadius: 8,
            fontSize: "0.8rem",
            lineHeight: 1.5,
            color: resultado.ok ? "#134E4A" : "#B71C1C",
            background: resultado.ok ? "#F0FDFA" : "#FEF2F2",
            border: `1px solid ${resultado.ok ? "#99F6E4" : "#FECACA"}`,
          }}
        >
          {resultado.texto}
        </p>
      )}

      {!ehTitular && papelDoUsuario && (
        <p style={{ margin: "10px 0 0", fontSize: "0.75rem", color: "#94A3B8" }}>
          Só o responsável pela loja aplica a sugestão. Você pode baixar a planilha e ver as sugestões.
        </p>
      )}

      <ul style={{ listStyle: "none", margin: "12px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        {categorias.map((c) => {
          const produtos = c.produtos as SugestaoComAtual[];
          const lote = montarLote(produtos, respostas[c.categoria] ?? {}, opcoesDoLote(c.categoria));
          // Quantos NCM revisados a segunda escolha trocaria (com a primeira marcada, sem a segunda).
          const revisaveis = substituir[c.categoria] === true
            ? montarLote(produtos, respostas[c.categoria] ?? {}, { marcas, substituirNcmGravado: true }).revisados.length
            : 0;
          const faltaResponder = c.perguntas.some((q) => !(respostas[c.categoria] ?? {})[q.pergunta.id]);
          const idBase = `ncm-cat-${c.categoria.normalize("NFD").replace(/[^A-Za-z0-9]+/g, "-").toLowerCase()}`;
          const expandida = aberta === c.categoria;
          const regraPrincipal = produtos.find((p) => p.regra && p.opcoes.length === 1);
          return (
            <li key={c.categoria} style={{ border: "1px solid #E2E8F0", borderRadius: 12, padding: "10px 12px", background: c.semNcm > 0 ? "#FFFBF5" : "#FAFAFA" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <div style={{ minWidth: 0, flex: "1 1 220px" }}>
                  <strong style={{ fontSize: "0.88rem", color: "#1E293B" }}>{c.categoria}</strong>
                  <span style={{ fontSize: "0.75rem", color: c.semNcm > 0 ? "#B45309" : "#0F766E", marginLeft: 8 }}>
                    {c.produtos.length} produto(s){c.semNcm > 0 ? ` · ${c.semNcm} sem NCM` : " · todos com NCM"}
                  </span>
                  <div style={{ fontSize: "0.75rem", color: "#475569", marginTop: 3, lineHeight: 1.45 }}>
                    {c.regras.length === 0
                      ? "Sem sugestão para esta categoria."
                      : c.regras.map((r) => `${r.rotulo} (${r.quantos})`).join(" · ")}
                    {regraPrincipal && c.perguntas.length === 0 && (
                      <>
                        {" — "}NCM {ncmSugeridoEmTexto(regraPrincipal)}
                        {regraPrincipal.opcoes[0]?.cest ? ` · CEST ${cestComPontos(regraPrincipal.opcoes[0].cest)}` : ""} · CFOP {regraPrincipal.cfop}
                        {regraPrincipal.csosn ? ` · CSOSN ${regraPrincipal.csosn}` : ""}
                      </>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  aria-expanded={expandida}
                  aria-controls={`${idBase}-detalhe`}
                  onClick={() => setAberta(expandida ? null : c.categoria)}
                  style={{ background: "none", border: "none", color: "#334155", fontWeight: 700, fontSize: "0.78rem", cursor: "pointer", display: "flex", alignItems: "center", gap: 4, padding: 4 }}
                >
                  {expandida ? <ChevronUp size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />} {expandida ? "Fechar" : "Ver e aplicar"}
                </button>
              </div>

              {expandida && (
                <div id={`${idBase}-detalhe`} style={{ marginTop: 10 }}>
                  {c.perguntas.map((q) => (
                    <fieldset key={q.pergunta.id} style={{ border: "1px solid #FDE68A", background: "#FFF7E6", borderRadius: 10, padding: "8px 12px", margin: "0 0 10px", minWidth: 0 }}>
                      <legend style={{ fontSize: "0.8rem", fontWeight: 800, color: "#92400E", padding: "0 4px" }}>
                        {q.pergunta.texto} <span style={{ fontWeight: 500 }}>({q.produtos} produto(s))</span>
                      </legend>
                      <p id={`${idBase}-${q.pergunta.id}-ajuda`} style={{ margin: "0 0 6px", fontSize: "0.75rem", color: "#78350F", lineHeight: 1.45 }}>
                        {q.pergunta.ajuda}
                      </p>
                      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                        {q.opcoes.map((o) => (
                          <label key={o.chave} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.8rem", fontWeight: 600, color: "#334155", cursor: ehTitular ? "pointer" : "default" }}>
                            <input
                              type="radio"
                              name={`${idBase}-${q.pergunta.id}`}
                              value={o.chave}
                              disabled={!ehTitular}
                              aria-describedby={`${idBase}-${q.pergunta.id}-ajuda`}
                              checked={(respostas[c.categoria] ?? {})[q.pergunta.id] === o.chave}
                              onChange={() => setRespostas((r) => ({ ...r, [c.categoria]: { ...(r[c.categoria] ?? {}), [q.pergunta.id]: o.chave } }))}
                              style={{ accentColor: "#1C1917" }}
                            />
                            {o.rotulo}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  ))}

                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.75rem" }}>
                      <caption style={{ textAlign: "left", fontSize: "0.72rem", color: "#64748B", padding: "0 0 4px" }}>
                        Sugestão por produto de {c.categoria}
                      </caption>
                      <thead>
                        <tr style={{ background: "#F1F5F9", color: "#475569", textAlign: "left" }}>
                          <th scope="col" style={{ padding: "6px 8px" }}>Produto</th>
                          <th scope="col" style={{ padding: "6px 8px" }}>Gravado</th>
                          <th scope="col" style={{ padding: "6px 8px" }}>Sugestão</th>
                          <th scope="col" style={{ padding: "6px 8px" }}>CFOP / CSOSN</th>
                          <th scope="col" style={{ padding: "6px 8px" }}>Confiança</th>
                        </tr>
                      </thead>
                      <tbody>
                        {produtos.map((p) => (
                          <tr key={p.produtoId} style={{ borderBottom: "1px solid #F1F5F9", verticalAlign: "top" }}>
                            <td style={{ padding: "6px 8px", fontWeight: 700, color: "#1E293B" }}>
                              {p.nome}
                              {p.avisos.length > 0 && (
                                <span style={{ display: "block", fontWeight: 400, color: "#92400E", marginTop: 2, lineHeight: 1.4 }}>{p.avisos[0]}</span>
                              )}
                            </td>
                            <td style={{ padding: "6px 8px", color: "#64748B" }}>{p.ncmAtual ? ncmComPontos(p.ncmAtual) : "—"}</td>
                            <td style={{ padding: "6px 8px" }}>
                              {p.opcoes.length === 0 ? (
                                <span style={{ color: "#B71C1C" }}>sem sugestão</span>
                              ) : (
                                <>
                                  {ncmSugeridoEmTexto(p)}
                                  {p.opcoes.some((o) => o.cest) && (
                                    <span style={{ display: "block", color: "#64748B" }}>
                                      CEST {[...new Set(p.opcoes.map((o) => (o.cest ? cestComPontos(o.cest) : "—")))].join(" ou ")}
                                    </span>
                                  )}
                                </>
                              )}
                            </td>
                            <td style={{ padding: "6px 8px" }}>{p.cfop ? `${p.cfop} / ${p.csosn ?? "CST"}` : "—"}</td>
                            <td style={{ padding: "6px 8px", color: p.confianca === "baixa" ? "#B45309" : "#334155" }}>{p.regra ? CONFIANCA[p.confianca] : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10, flexWrap: "wrap" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
                      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.78rem", color: "#475569", cursor: ehTitular ? "pointer" : "default" }}>
                        <input
                          type="checkbox"
                          disabled={!ehTitular}
                          checked={substituir[c.categoria] === true}
                          onChange={(e) => {
                            const marcado = e.target.checked;
                            setSubstituir((s) => ({ ...s, [c.categoria]: marcado }));
                            // Desmarcar a primeira desfaz a segunda: ela não fica ligada escondida para a próxima vez.
                            if (!marcado) setSubstituirRevisados((s) => ({ ...s, [c.categoria]: false }));
                          }}
                          style={{ accentColor: "#1C1917" }}
                        />
                        <span>
                          Substituir também o NCM já gravado{" "}
                          <span style={{ color: "#64748B" }}>(só a sugestão ainda não revisada)</span>
                        </span>
                      </label>
                      {/* A SEGUNDA escolha: sobrescrever o NCM que o contador já revisou
                          (ou que alguém digitou à mão). Só aparece quando há algum. */}
                      {substituir[c.categoria] === true && revisaveis > 0 && (
                        <label style={{ display: "flex", alignItems: "flex-start", gap: 6, fontSize: "0.78rem", color: "#92400E", fontWeight: 700, cursor: ehTitular ? "pointer" : "default", marginLeft: 20 }}>
                          <input
                            type="checkbox"
                            disabled={!ehTitular}
                            checked={substituirRevisados[c.categoria] === true}
                            onChange={(e) => setSubstituirRevisados((s) => ({ ...s, [c.categoria]: e.target.checked }))}
                            aria-describedby={`${idBase}-revisados-ajuda`}
                            style={{ accentColor: "#B45309", marginTop: 2 }}
                          />
                          <span>
                            Incluir também {revisaveis} produto(s) com NCM já revisado ou digitado à mão
                            <span id={`${idBase}-revisados-ajuda`} style={{ display: "block", fontWeight: 400, color: "#78350F", lineHeight: 1.4 }}>
                              Eles são sobrescritos pela sugestão e voltam a ficar marcados para revisar com o contador.
                            </span>
                          </span>
                        </label>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => aplicar(c.categoria, produtos)}
                      disabled={!ehTitular || aplicando !== null || lote.lote.length === 0}
                      style={botao(ehTitular && aplicando === null && lote.lote.length > 0)}
                    >
                      {aplicando === c.categoria ? "Aplicando…" : `Aplicar nesta categoria (${lote.lote.length})`}
                    </button>
                    {faltaResponder && c.perguntas.length > 0 && (
                      <span style={{ fontSize: "0.75rem", color: "#B45309", display: "flex", alignItems: "center", gap: 4 }}>
                        <AlertTriangle size={13} aria-hidden /> Responda a pergunta acima para incluir os produtos com duas opções.
                      </span>
                    )}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {marcados.length > 0 && ehTitular && (
        <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={marcarRevisados}
            style={{ padding: "8px 14px", borderRadius: 8, border: "1.5px solid #0F766E", background: "#fff", color: "#0F766E", fontWeight: 800, fontSize: "0.8rem", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <CheckCircle2 size={15} aria-hidden /> O contador revisou as {marcados.length} sugestões aplicadas
          </button>
          <span style={{ fontSize: "0.75rem", color: "#64748B" }}>Só depois de o contador conferir a planilha.</span>
        </div>
      )}
    </section>
  );
}
