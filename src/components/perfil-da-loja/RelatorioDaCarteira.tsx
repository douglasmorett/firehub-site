"use client";

/**
 * O RELATÓRIO DA CARTEIRA — para o vendedor agir (pedido do Douglas,
 * 18/10/2026): quem está esfriando ou parou (risco de cancelar), o que dá para
 * vender agrupado por produto ("12 lojas podem comprar o App da loja"), o
 * ranking por faturamento e as novas em teste com o que falta para ativarem.
 *
 * O mesmo componente no portal do vendedor (só a carteira dele,
 * /api/vendedor/carteira) e no admin (todas as lojas ou a carteira de um
 * vendedor, /api/admin/perfil-das-lojas). `fonte/<id>` abre o perfil.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { BookX, ChevronDown, ChevronRight, Download, MessageCircle, RefreshCw, Rocket, Search, Sparkles, TriangleAlert, Trophy, X } from "lucide-react";
import { useDinheiro } from "@/components/parceiro/ValoresOcultos";
import {
  CRITERIO_DO_CARDAPIO, ROTULO_DO_STATUS, csvDaCarteira,
  type RelatorioDaCarteira as Relatorio, type ResumoDoPerfil, type StatusDaAtividade,
} from "@/lib/perfil-da-loja/regras";
import { ESTILO_DO_PERFIL } from "./estilo";
import { AvisoNoTopo, GavetaDoPerfil, PilulaDoStatus, SeloDoCardapio, Tendencia, linkDoWhatsApp, type Aviso } from "./PerfilDaLoja";

type Dados = { lojas: ResumoDoPerfil[]; relatorio: Relatorio; geradoEm: string };

const COR_DO_STATUS: Record<StatusDaAtividade, string> = { ATIVA: "#22A55A", ESFRIANDO: "#E8A317", PARADA: "#E5484D", NOVA: "#3B82F6" };
const STATUS: StatusDaAtividade[] = ["ATIVA", "ESFRIANDO", "PARADA", "NOVA"];
const ROTULO_NO_PLURAL: Record<StatusDaAtividade, string> = { ATIVA: "Ativas", ESFRIANDO: "Esfriando", PARADA: "Paradas", NOVA: "Novas (teste)" };
const COR_DO_NUMERO: Record<StatusDaAtividade, string> = { ATIVA: "#15803D", ESFRIANDO: "#9A5B06", PARADA: "#B91C1C", NOVA: "#1D4ED8" };

export default function RelatorioDaCarteira({
  fonte, tema = "areia", titulo = "Carteira de clientes", vendedores, vendedorInicial = "todos", vendedorFixo,
}: {
  /** A rota da lista; o perfil de uma loja é `${fonte}/${id}`. */
  fonte: string;
  tema?: "areia" | "admin";
  titulo?: string;
  /** ADMIN: o seletor de vendedor (recorta a lista pela carteira dele). */
  vendedores?: { id: string; name: string; active: boolean }[];
  vendedorInicial?: string;
  /** ADMIN vendo a carteira de UM vendedor (/admin/parceiros/[id]): sem seletor. */
  vendedorFixo?: string;
}) {
  const dinheiro = useDinheiro();
  const [vendedor, setVendedor] = useState(vendedorInicial);
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [status, setStatus] = useState<StatusDaAtividade | null>(null);
  const [soSemCardapio, setSoSemCardapio] = useState(false);
  const [busca, setBusca] = useState("");
  const [produtoAberto, setProdutoAberto] = useState<string | null>(null);
  const [perfilId, setPerfilId] = useState<string | null>(null);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const fecharAviso = useCallback(() => setAviso(null), []);
  const fecharPerfil = useCallback(() => setPerfilId(null), []);

  const temSeletor = !!vendedores;
  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const recorte = vendedorFixo || (temSeletor && vendedor !== "todos" ? vendedor : null);
      const url = recorte ? `${fonte}?vendedor=${encodeURIComponent(recorte)}` : fonte;
      const r = await fetch(url, { cache: "no-store" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) setErro(d.error || "Não deu para carregar a carteira.");
      else setDados(d);
    } catch {
      setErro("Sem conexão. Tente de novo.");
    } finally {
      setCarregando(false);
    }
  }, [fonte, vendedor, temSeletor, vendedorFixo]);

  useEffect(() => { void carregar(); }, [carregar]);

  const rel = dados?.relatorio;
  const termo = busca.trim().toLowerCase();
  const lista = useMemo(() => {
    const todas = dados?.lojas || [];
    return todas
      .filter((l) => (!status || l.status === status) && (!soSemCardapio || !l.cardapioPuxado) && (!termo || [l.nome, l.cidade, l.vendedor?.nome].some((v) => v?.toLowerCase().includes(termo))))
      .sort((a, b) => b.valor30 - a.valor30 || a.nome.localeCompare(b.nome));
  }, [dados, status, termo, soSemCardapio]);
  const porId = useMemo(() => new Map((dados?.lojas || []).map((l) => [l.id, l])), [dados]);
  const selo = (id: string) => {
    const l = porId.get(id);
    return l ? <SeloDoCardapio puxado={l.cardapioPuxado} produtos={l.produtos} /> : null;
  };
  const maiorFaturamento = Math.max(1, ...lista.map((l) => l.valor30));
  const potencial = rel ? rel.oportunidadesPorProduto.filter((g) => g.tipo === "VENDA").reduce((t, g) => t + g.potencialMensal, 0) : 0;
  const lojasComVenda = rel ? new Set(rel.oportunidadesPorProduto.filter((g) => g.tipo === "VENDA").flatMap((g) => g.itens.map((i) => i.id))).size : 0;

  const exportar = () => {
    const blob = new Blob([csvDaCarteira(lista)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `carteira-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    setAviso({ tipo: "ok", titulo: "Planilha baixada", detalhe: `${lista.length} ${lista.length === 1 ? "loja" : "lojas"} no arquivo (abre no Excel).` });
  };

  const abrir = (id: string) => setPerfilId(id);
  const filtrar = (s: StatusDaAtividade | null) => setStatus((atual) => (atual === s ? null : s));

  return (
    <div className={`pf${tema === "admin" ? " pf-admin" : ""}`}>
      <style>{ESTILO_DO_PERFIL}</style>
      <AvisoNoTopo aviso={aviso} onFechar={fecharAviso} />
      <GavetaDoPerfil url={perfilId ? `${fonte}/${perfilId}` : null} aoFechar={fecharPerfil} tema={tema} />

      <div className="pf-relatorio">
        <div className="pf-rel-cab">
          <div>
            <h2>{titulo}</h2>
            <p className="pf-sub">
              {rel ? `${rel.total} ${rel.total === 1 ? "loja" : "lojas"} · últimos 30 dias contra os 30 anteriores` : "Carregando…"}
              {dados && ` · atualizado às ${new Date(dados.geradoEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`}
            </p>
          </div>
          <div className="pf-rel-acoes">
            {vendedores && (
              <select value={vendedor} onChange={(e) => setVendedor(e.target.value)} aria-label="Carteira de qual vendedor">
                <option value="todos">Todas as lojas</option>
                <option value="sem">Sem vendedor</option>
                {vendedores.map((v) => <option key={v.id} value={v.id}>Carteira de {v.name}{v.active ? "" : " (pausado)"}</option>)}
              </select>
            )}
            <button type="button" className="pf-botao" onClick={carregar} disabled={carregando}><RefreshCw size={14} className={carregando ? "pf-gira" : ""} aria-hidden /> Atualizar</button>
            <button type="button" className="pf-botao escuro" onClick={exportar} disabled={!lista.length}><Download size={14} aria-hidden /> Exportar CSV</button>
          </div>
        </div>

        {erro && <div className="pf-erro-caixa">{erro}<button type="button" className="pf-botao pequeno" onClick={carregar}>Tentar de novo</button></div>}

        {!rel && !erro && (
          <div className="pf-esqueleto" aria-busy="true" style={{ padding: 0 }}>
            <div style={{ height: 92 }} /><div style={{ height: 220 }} /><div style={{ height: 260 }} />
          </div>
        )}

        {rel && (
          <>
            <div className="pf-rel-kpis">
              <button type="button" className={`pf-kpi clicavel${status === null ? " on" : ""}`} onClick={() => filtrar(null)}>
                <span className="pf-rotulo">Lojas</span>
                <div className="pf-kpi-val">{rel.total}</div>
                <div className="pf-kpi-sub">todas</div>
              </button>
              {STATUS.map((s) => (
                <button key={s} type="button" className={`pf-kpi clicavel${status === s ? " on" : ""}`} onClick={() => filtrar(s)} aria-pressed={status === s}>
                  <span className="pf-rotulo" style={{ display: "flex", gap: 6, alignItems: "center" }}><i className="pf-ponto" style={{ background: COR_DO_STATUS[s] }} />{ROTULO_NO_PLURAL[s]}</span>
                  <div className="pf-kpi-val" style={{ color: COR_DO_NUMERO[s] }}>{rel.porStatus[s]}</div>
                  <div className="pf-kpi-sub">{rel.total ? Math.round((rel.porStatus[s] / rel.total) * 100) : 0}% da carteira</div>
                </button>
              ))}
              <button type="button" className={`pf-kpi clicavel kpi-cardapio${soSemCardapio ? " on" : ""}${rel.semCardapio ? " tem" : ""}`} onClick={() => setSoSemCardapio((v) => !v)} aria-pressed={soSemCardapio} title={CRITERIO_DO_CARDAPIO}>
                <span className="pf-rotulo" style={{ display: "flex", gap: 6, alignItems: "center" }}><BookX size={13} aria-hidden /> Sem cardápio</span>
                <div className="pf-kpi-val">{rel.semCardapio}</div>
                <div className="pf-kpi-sub">{rel.semCardapio ? "toque para ver quais" : "todas com cardápio"}</div>
              </button>
              <div className="pf-kpi">
                <span className="pf-rotulo">Faturamento · 30d</span>
                <div className="pf-kpi-val dinheiro">{dinheiro(rel.faturamento30)}</div>
                <div className="pf-kpi-sub"><Tendencia pct={rel.tendenciaPct} /> das lojas</div>
              </div>
              <div className="pf-kpi">
                <span className="pf-rotulo">Para vender</span>
                <div className="pf-kpi-val dinheiro">{dinheiro(potencial)}</div>
                <div className="pf-kpi-sub">por mês, em {lojasComVenda} {lojasComVenda === 1 ? "loja" : "lojas"}</div>
              </div>
            </div>

            <p className="pf-criterio"><b>Selo do cardápio:</b> {CRITERIO_DO_CARDAPIO} Abaixo disso a loja aparece como <span className="pf-selo-cardapio nao mini">SEM cardápio</span>.</p>

            <div className="pf-barra" role="img" aria-label={STATUS.map((s) => `${ROTULO_DO_STATUS[s]}: ${rel.porStatus[s]}`).join(", ")} style={{ height: 10 }}>
              {STATUS.filter((s) => rel.porStatus[s] > 0).map((s) => <span key={s} style={{ width: `${(rel.porStatus[s] / Math.max(rel.total, 1)) * 100}%`, background: COR_DO_STATUS[s] }} />)}
            </div>

            <div className="pf-duas">
              <section className="pf-painel">
                <div className="pf-painel-cab">
                  <div>
                    <h3 className="pf-h"><TriangleAlert size={17} color="#B91C1C" aria-hidden /> Risco de cancelar <small>{rel.emRisco.length} {rel.emRisco.length === 1 ? "loja" : "lojas"}</small></h3>
                    <p className="pf-sub">Esfriando ou parada — a maior perda de faturamento primeiro. Ligue antes que vire cancelamento.</p>
                  </div>
                </div>
                {rel.emRisco.length === 0 ? <div className="pf-vazio">Nenhuma loja esfriando ou parada. 🎉</div> : (
                  <ul className="pf-risco">
                    {rel.emRisco.slice(0, 12).map((l) => {
                      const whats = linkDoWhatsApp(l.telefone);
                      const perda = Math.max(0, l.valor30Anterior - l.valor30);
                      return (
                        <li key={l.id}>
                          <div style={{ minWidth: 0 }}>
                            <button type="button" className="pf-risco-nome" onClick={() => abrir(l.id)}>{l.nome} <PilulaDoStatus status={l.status} /> <SeloDoCardapio puxado={l.cardapioPuxado} produtos={l.produtos} /></button>
                            <p>{l.motivo}</p>
                          </div>
                          <div className="pf-risco-perda">{perda > 0 ? <><b>−{dinheiro(perda)}</b>em 30 dias</> : l.diasSemVenda === null ? "nunca vendeu" : "—"}</div>
                          <div className="pf-risco-acoes">
                            <button type="button" className="pf-botao pequeno" onClick={() => abrir(l.id)}>Ver perfil</button>
                            {whats && <a className="pf-botao whats pequeno" href={whats} target="_blank" rel="noreferrer"><MessageCircle size={13} aria-hidden /> WhatsApp</a>}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {rel.emRisco.length > 12 && (
                  <div style={{ padding: "0 18px 14px" }}><button type="button" className="pf-botao pequeno" onClick={() => setStatus("PARADA")}>Ver todas na lista abaixo</button></div>
                )}
              </section>

              <section className="pf-painel">
                <div className="pf-painel-cab">
                  <div>
                    <h3 className="pf-h"><Rocket size={17} color="#1D4ED8" aria-hidden /> Novas em teste <small>{rel.novas.length}</small></h3>
                    <p className="pf-sub">O que falta para cada uma ativar antes de o teste acabar — a que tem menos dias primeiro.</p>
                  </div>
                </div>
                {rel.novas.length === 0 ? <div className="pf-vazio">Nenhuma loja em teste agora.</div> : (
                  <ul className="pf-novas">
                    {rel.novas.slice(0, 12).map((l) => (
                      <li key={l.id}>
                        <div className="pf-novas-topo">
                          <button type="button" className="pf-risco-nome" onClick={() => abrir(l.id)}>{l.nome} <SeloDoCardapio puxado={l.cardapioPuxado} produtos={l.produtos} /></button>
                          <span className="pf-pilula pf-st-NOVA">{l.diasDeTeste} {l.diasDeTeste === 1 ? "dia" : "dias"} de teste</span>
                        </div>
                        <div className="pf-falta">
                          {l.ativacaoFalta.length === 0 ? <span className="ok">Ativada · {l.vendas30} vendas</span> : l.ativacaoFalta.map((f) => <span key={f}>falta: {f.charAt(0).toLowerCase() + f.slice(1)}</span>)}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>

            <section className="pf-painel">
              <div className="pf-painel-cab">
                <div>
                  <h3 className="pf-h"><Sparkles size={17} aria-hidden /> Oportunidades por produto</h3>
                  <p className="pf-sub">Quantas lojas podem comprar (serviço pago) ou ligar (incluso) cada coisa, pelos números delas. Toque para ver as lojas e o motivo.</p>
                </div>
              </div>
              {rel.oportunidadesPorProduto.length === 0 ? <div className="pf-vazio">Nenhuma oportunidade nos números de agora.</div> : (
                <div className="pf-produtos">
                  {rel.oportunidadesPorProduto.map((g) => {
                    const aberto = produtoAberto === g.chave;
                    return (
                      <div key={g.chave} className="pf-produto">
                        <button type="button" onClick={() => setProdutoAberto(aberto ? null : g.chave)} aria-expanded={aberto}>
                          <div>
                            <div className="pf-produto-nome">{g.produto}</div>
                            <div style={{ marginTop: 4 }}>{g.tipo === "VENDA" ? <span className="pf-tag venda">Serviço pago</span> : <span className="pf-tag adocao">Incluso · ligar</span>}</div>
                          </div>
                          <div className="pf-produto-n">{g.lojas}</div>
                          <div className="pf-produto-frase">
                            {aberto ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
                            {g.lojas} {g.lojas === 1 ? "loja pode" : "lojas podem"} {g.tipo === "VENDA" ? "comprar" : "ligar"}
                            {g.potencialMensal > 0 && <> · <b>{dinheiro(g.potencialMensal)}/mês</b></>}
                          </div>
                        </button>
                        {aberto && (
                          <ul>
                            {g.itens.map((i) => (
                              <li key={i.id}>
                                <div className="pf-produto-loja"><button type="button" onClick={() => abrir(i.id)}>{i.nome}</button> {selo(i.id)}</div>
                                <p>{i.motivo}</p>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="pf-painel">
              <div className="pf-painel-cab">
                <div>
                  <h3 className="pf-h"><Trophy size={17} color="#8A5A00" aria-hidden /> Ranking por faturamento <small>{lista.length} {lista.length === 1 ? "loja" : "lojas"}{status ? ` · ${ROTULO_DO_STATUS[status].toLowerCase()}` : ""}{soSemCardapio ? " · sem cardápio" : ""}</small></h3>
                  <p className="pf-sub">Faturamento de 30 dias na régua dos relatórios. Toque na linha para abrir o perfil.</p>
                </div>
              </div>
              <div className="pf-ferramentas">
                <label className="pf-busca">
                  <Search size={15} aria-hidden />
                  <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar loja, cidade ou vendedor" aria-label="Buscar loja" />
                  {busca && <button type="button" className="pf-botao fantasma pequeno" onClick={() => setBusca("")} aria-label="Limpar a busca"><X size={13} aria-hidden /></button>}
                </label>
                <div className="pf-chips">
                  <button type="button" className={`pf-chip${status === null ? " on" : ""}`} onClick={() => setStatus(null)}>Todas <span>{rel.total}</span></button>
                  {STATUS.map((s) => (
                    <button key={s} type="button" className={`pf-chip${status === s ? " on" : ""}`} onClick={() => filtrar(s)}>
                      <i className="pf-ponto" style={{ background: COR_DO_STATUS[s] }} /> {ROTULO_DO_STATUS[s]} <span>{rel.porStatus[s]}</span>
                    </button>
                  ))}
                  <button type="button" className={`pf-chip chip-sem-cardapio${soSemCardapio ? " on" : ""}`} onClick={() => setSoSemCardapio((v) => !v)} aria-pressed={soSemCardapio}>
                    <BookX size={13} aria-hidden /> Sem cardápio <span>{rel.semCardapio}</span>
                  </button>
                </div>
              </div>
              <div className="pf-tabela-rolagem">
                <table className="pf-tabela">
                  <thead>
                    <tr>
                      <th style={{ width: 44 }}>#</th>
                      <th>Loja</th>
                      <th className="dir">Faturamento 30d</th>
                      <th className="dir so-largo">Vendas</th>
                      <th className="so-largo">Tendência</th>
                      <th className="so-largo">Canal principal</th>
                      <th className="so-largo">Usa</th>
                      <th className="so-largo">Oferecer</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lista.map((l, i) => (
                      <tr key={l.id} onClick={() => abrir(l.id)} tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") abrir(l.id); }}>
                        <td><span className={`pf-pos${i < 3 && l.valor30 > 0 ? " ouro" : ""}`}>{i + 1}</span></td>
                        <td>
                          <div className="pf-loja-cel">
                            <strong>{l.nome}</strong>
                            <small style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                              <PilulaDoStatus status={l.status} curta />
                              <SeloDoCardapio puxado={l.cardapioPuxado} produtos={l.produtos} />
                              {[l.cidade, vendedores ? l.vendedor?.nome : null].filter(Boolean).join(" · ")}
                            </small>
                          </div>
                        </td>
                        <td className="dir">
                          <b>{dinheiro(l.valor30)}</b>
                          <div className="pf-mini-barra"><span style={{ width: `${(l.valor30 / maiorFaturamento) * 100}%` }} /></div>
                        </td>
                        <td className="dir so-largo">{l.vendas30.toLocaleString("pt-BR")}</td>
                        <td className="so-largo"><Tendencia pct={l.tendenciaPct} /></td>
                        <td className="so-largo">{l.canalPrincipal || <span style={{ color: "var(--pf-cinza)" }}>—</span>}</td>
                        <td className="so-largo pf-nowrap">{l.usando} de {l.totalDeRecursos}</td>
                        <td className="so-largo">
                          <div className="pf-ops-mini">
                            {l.oportunidades.slice(0, 2).map((o) => <span key={o.chave} className={`pf-tag ${o.tipo === "VENDA" ? "venda" : "adocao"}`}>{o.produto}</span>)}
                            {l.oportunidades.length > 2 && <span className="pf-tag" style={{ background: "var(--pf-neutro-bg)", color: "var(--pf-neutro)" }}>+{l.oportunidades.length - 2}</span>}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {lista.length === 0 && (
                      <tr><td colSpan={8} className="pf-vazio">Nenhuma loja{busca ? ` para "${busca}"` : ""}{status ? ` com status ${ROTULO_DO_STATUS[status].toLowerCase()}` : ""}{soSemCardapio ? " sem cardápio" : ""}.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
