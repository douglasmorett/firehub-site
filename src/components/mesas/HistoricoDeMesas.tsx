"use client";

/**
 * Histórico de mesas — as contas fechadas no dia, mesa a mesa: número da mesa,
 * garçom, abertura, fechamento, valor e forma de pagamento; clicando, as
 * rodadas com os itens, cada baixa e o consumo por pessoa. Embaixo, o que foi
 * vendido nas mesas do dia, por produto.
 *
 * Pedido do Allan (Delicias de Casa, 17/10/2026): mesa fechada sumia de Mesas
 * e virava rodadas "N/A" em Pedidos, sem como saber como a mesa pagou.
 *
 * A tela só desenha o que /api/store/mesas/historico devolve; as contas estão
 * em lib/relatorios/historico-de-mesas.ts, pela régua do Relatório de Mesas
 * (Garçons): o "Consumo" daqui é o "Consumo nas mesas" de lá. Nem o "hoje" é
 * daqui: "Hoje" e "Ontem" vão como atalho e o servidor resolve no dia
 * operacional da loja (vira às 5h) — às 2h da manhã, "Hoje" ainda é o turno
 * que está aberto.
 */

import { Fragment, useEffect, useState } from "react";
import { fmtDia, hojeNaLoja } from "@/lib/relatorios/base";
import { fusoDoNavegador } from "@/lib/relatorios/relatorio-de-mesas";
import type { DetalheDaMesa, HistoricoDeMesas as Historico, LinhaDoHistorico } from "@/lib/relatorios/historico-de-mesas";

type Resposta = Historico & { periodo: { de: string; ate: string; hoje: string } };

const fmt = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v || 0);
const fmtQtd = (n: number) => (Math.round((n || 0) * 100) / 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
const nomeDaMesa = (m: { numero: number; nome: string | null }) => (m.nome ? `Mesa ${m.numero} · ${m.nome}` : `Mesa ${m.numero}`);
const duracao = (min: number) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)}h${String(min % 60).padStart(2, "0")}`);

const celula: React.CSSProperties = { padding: "10px 12px", borderBottom: "1px solid #E2E8F0", fontSize: 13, color: "#334155", verticalAlign: "top" };
const cabecalho: React.CSSProperties = { padding: "10px 12px", fontSize: 12, fontWeight: 700, color: "#475569", textAlign: "left", background: "#F8FAFC", borderBottom: "2px solid #E2E8F0", whiteSpace: "nowrap" };

/** As formas da mesa numa linha: "Dinheiro R$ 30,00 + Pix R$ 12,00". */
function FormasDaMesa({ m }: { m: LinhaDoHistorico }) {
  if (m.pagamentos.length === 0) return <span style={{ color: "#94A3B8" }}>Liberada sem pagamento</span>;
  return (
    <span>
      {m.pagamentos.map((p, i) => (
        <Fragment key={p.forma}>
          {i > 0 && <span style={{ color: "#94A3B8" }}> + </span>}
          <strong style={{ color: "#0F172A" }}>{p.forma}</strong> {fmt(p.valor)}
        </Fragment>
      ))}
      {m.troco > 0 && <div style={{ fontSize: 11, color: "#94A3B8" }}>troco devolvido {fmt(m.troco)}</div>}
    </span>
  );
}

export default function HistoricoDeMesas({ onFechar }: { onFechar: () => void }) {
  const [filtro, setFiltro] = useState<"hoje" | "ontem" | "dia">("hoje");
  // O dia OPERACIONAL (vira às 5h), não o do calendário.
  const [dia, setDia] = useState(() => hojeNaLoja(fusoDoNavegador()));
  const [dados, setDados] = useState<Resposta | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [aberta, setAberta] = useState<string | null>(null);
  const [detalhe, setDetalhe] = useState<DetalheDaMesa | null>(null);
  const [carregandoDetalhe, setCarregandoDetalhe] = useState(false);
  const [erroDoDetalhe, setErroDoDetalhe] = useState("");

  const consulta = filtro === "dia" ? `de=${dia}&ate=${dia}` : `atalho=${filtro}`;

  useEffect(() => {
    let vivo = true;
    setCarregando(true);
    setErro("");
    setAberta(null);
    fetch(`/api/store/mesas/historico?${consulta}`, { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!vivo) return;
        if (!r.ok) { setErro(j?.error || "Não consegui carregar o histórico."); setDados(null); }
        else setDados(j);
      })
      .catch(() => vivo && setErro("Sem conexão. Tente de novo."))
      .finally(() => vivo && setCarregando(false));
    return () => { vivo = false; };
  }, [consulta]);

  // O detalhe vem no clique: a lista não carrega os itens de cada mesa.
  useEffect(() => {
    if (!aberta) { setDetalhe(null); return; }
    let vivo = true;
    setCarregandoDetalhe(true);
    setErroDoDetalhe("");
    setDetalhe(null);
    fetch(`/api/store/mesas/historico?sessao=${encodeURIComponent(aberta)}`, { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!vivo) return;
        if (!r.ok) setErroDoDetalhe(j?.error || "Não consegui abrir a mesa.");
        else setDetalhe(j.mesa);
      })
      .catch(() => vivo && setErroDoDetalhe("Sem conexão. Tente de novo."))
      .finally(() => vivo && setCarregandoDetalhe(false));
    return () => { vivo = false; };
  }, [aberta]);

  const escolher = (chave: typeof filtro) => {
    // "Escolher dia" abre no dia que está na tela, já resolvido pelo servidor.
    if (chave === "dia" && filtro !== "dia" && dados?.periodo) setDia(dados.periodo.de);
    setFiltro(chave);
  };

  const r = dados?.resumo;
  const periodoNaTela = dados?.periodo ? fmtDia(dados.periodo.de) : "";

  const botao = (chave: typeof filtro, rotulo: string) => (
    <button key={chave} type="button" onClick={() => escolher(chave)} style={{
      padding: "7px 14px", borderRadius: 8, border: "none", fontFamily: "inherit", cursor: "pointer", fontWeight: 700, fontSize: 13,
      background: filtro === chave ? "#fff" : "transparent", color: filtro === chave ? "#0F172A" : "#64748B",
      boxShadow: filtro === chave ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
    }}>{rotulo}</button>
  );

  const cartao = (rotulo: string, valor: string, nota?: string) => (
    <div style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 12, padding: "12px 14px", minWidth: 0 }}>
      <div style={{ fontSize: 12, color: "#64748B", fontWeight: 700 }}>{rotulo}</div>
      <div style={{ fontSize: 20, fontWeight: 900, color: "#0F172A", marginTop: 2 }}>{carregando ? "…" : valor}</div>
      {nota && <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 2 }}>{nota}</div>}
    </div>
  );

  return (
    <div onClick={onFechar} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: "#fff", borderRadius: 18, width: "100%", maxWidth: 1080, maxHeight: "92vh",
        display: "flex", flexDirection: "column", boxShadow: "0 20px 60px rgba(0,0,0,0.3)", overflow: "hidden",
      }}>
        {/* ── Cabeçalho e período ── */}
        <div style={{ padding: "14px 18px", borderBottom: "1px solid #E2E8F0", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
          <h3 style={{ margin: 0, fontWeight: 800, fontSize: 18, color: "#0F172A" }}>📋 Histórico de mesas</h3>
          <div style={{ display: "flex", gap: 4, background: "#F1F5F9", padding: 3, borderRadius: 10 }}>
            {botao("hoje", "Hoje")}
            {botao("ontem", "Ontem")}
            {botao("dia", "Escolher dia")}
          </div>
          {filtro === "dia" && (
            <input type="date" value={dia} onChange={(e) => e.target.value && setDia(e.target.value)}
              style={{ padding: "7px 10px", borderRadius: 8, border: "1px solid #E2E8F0", fontFamily: "inherit", color: "#0F172A" }} />
          )}
          <button type="button" onClick={onFechar} aria-label="Fechar" style={{ marginLeft: "auto", background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#475569" }}>✕</button>
          <div style={{ flexBasis: "100%", fontSize: 12, color: "#94A3B8" }}>
            {/* O dia que o servidor resolveu: às 2h, "Hoje" mostra a data de ontem — o turno aberto. */}
            {!carregando && periodoNaTela && <strong style={{ color: "#475569" }}>{periodoNaTela} · </strong>}
            Mesas fechadas no dia. O dia vira às 5h da manhã: mesa fechada de madrugada conta no dia anterior.
          </div>
        </div>

        <div style={{ overflowY: "auto", padding: 18 }}>
          {erro && (
            <div role="alert" style={{ background: "#FEF2F2", color: "#B71C1C", border: "1px solid #FECACA", borderRadius: 10, padding: "10px 12px", fontSize: 13, fontWeight: 600, marginBottom: 14 }}>
              {erro}
            </div>
          )}

          {/* ── Resumo do dia ── */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 12 }}>
            {cartao("Mesas fechadas", String(r?.fechadas ?? 0))}
            {cartao("Consumo", fmt(r?.consumo || 0), "O lançado nas contas, sem taxa, gorjeta e troco")}
            {cartao("Ticket médio", r && r.fechadas > 0 ? fmt(r.ticketMedio) : "—", "Consumo ÷ mesas")}
            {cartao("Taxa de serviço", fmt(r?.taxaServico || 0), r && r.gorjetas > 0 ? `+ ${fmt(r.gorjetas)} de gorjeta` : undefined)}
            {r && r.descontoNoFechamento > 0 && cartao("Desconto no fechamento", fmt(r.descontoNoFechamento), `Em ${r.mesasComDesconto} ${r.mesasComDesconto === 1 ? "conta" : "contas"} · à parte`)}
            {cartao("Total das contas", fmt(r?.totalDasContas || 0), "Consumo − desconto + taxa + gorjeta")}
          </div>

          {/* ── Por forma de pagamento ── */}
          {!carregando && r && r.porForma.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
              {r.porForma.map((f) => (
                <span key={f.chave} style={{ background: "#F0FDFA", border: "1px solid #99F6E4", color: "#134E4A", borderRadius: 999, padding: "5px 12px", fontSize: 12, fontWeight: 700 }}>
                  {f.rotulo}: {fmt(f.valor)} <span style={{ fontWeight: 500, color: "#0F766E" }}>· {f.mesas} {f.mesas === 1 ? "mesa" : "mesas"}</span>
                </span>
              ))}
              {r.troco > 0 && (
                <span style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", color: "#475569", borderRadius: 999, padding: "5px 12px", fontSize: 12, fontWeight: 600 }}>
                  Troco devolvido: {fmt(r.troco)} (já fora do Dinheiro)
                </span>
              )}
            </div>
          )}

          {/* ── As mesas ── */}
          <div style={{ border: "1px solid #E2E8F0", borderRadius: 12, overflowX: "auto", marginBottom: 20 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
              <thead>
                <tr>
                  <th style={cabecalho}>Mesa</th>
                  <th style={cabecalho}>Garçom</th>
                  <th style={cabecalho}>Abertura</th>
                  <th style={cabecalho}>Fechamento</th>
                  <th style={{ ...cabecalho, textAlign: "right" }}>Valor</th>
                  <th style={cabecalho}>Forma de pagamento</th>
                </tr>
              </thead>
              <tbody>
                {carregando ? (
                  <tr><td colSpan={6} style={{ ...celula, textAlign: "center", padding: 30, color: "#94A3B8" }}>Carregando…</td></tr>
                ) : !dados || dados.mesas.length === 0 ? (
                  <tr><td colSpan={6} style={{ ...celula, textAlign: "center", padding: 30, color: "#94A3B8" }}>Nenhuma mesa fechada neste dia.</td></tr>
                ) : dados.mesas.map((m) => (
                  <Fragment key={m.id}>
                    <tr onClick={() => setAberta(aberta === m.id ? null : m.id)} style={{ cursor: "pointer", background: aberta === m.id ? "#FAF6F2" : undefined }}
                      title="Clique para ver os itens e os detalhes">
                      <td style={celula}>
                        <strong style={{ color: "#0F172A" }}>{aberta === m.id ? "▾" : "▸"} {nomeDaMesa(m.mesa)}</strong>
                        {m.cliente && <div style={{ fontSize: 11, color: "#64748B" }}>{m.cliente}</div>}
                      </td>
                      <td style={{ ...celula, color: m.garcom === "Sem garçom" ? "#94A3B8" : "#334155" }}>{m.garcom}</td>
                      <td style={celula}>{m.abertura}</td>
                      <td style={celula}>
                        {m.fechamento}
                        <div style={{ fontSize: 11, color: "#94A3B8" }}>{duracao(m.permanenciaMin)} na mesa</div>
                      </td>
                      <td style={{ ...celula, textAlign: "right", whiteSpace: "nowrap" }}>
                        <strong style={{ color: "#0F172A" }}>{fmt(m.totalDaConta)}</strong>
                        {(m.taxa > 0 || m.gorjeta > 0 || m.desconto > 0) && (
                          <div style={{ fontSize: 11, color: "#94A3B8" }}>consumo {fmt(m.consumo)}</div>
                        )}
                      </td>
                      <td style={celula}><FormasDaMesa m={m} /></td>
                    </tr>
                    {aberta === m.id && (
                      <tr>
                        <td colSpan={6} style={{ ...celula, background: "#FFFCF9", padding: "12px 16px" }}>
                          {carregandoDetalhe && <div style={{ color: "#94A3B8" }}>Abrindo a mesa…</div>}
                          {erroDoDetalhe && <div role="alert" style={{ color: "#B71C1C", fontWeight: 600 }}>{erroDoDetalhe}</div>}
                          {detalhe && detalhe.id === m.id && <DetalheDaConta d={detalhe} />}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          {/* ── O que foi vendido nas mesas ── */}
          {!carregando && dados && dados.itens.length > 0 && (
            <>
              <h4 style={{ margin: "0 0 8px", fontSize: 15, fontWeight: 800, color: "#0F172A" }}>O que foi vendido nas mesas</h4>
              <div style={{ border: "1px solid #E2E8F0", borderRadius: 12, overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={cabecalho}>Produto</th>
                      <th style={{ ...cabecalho, textAlign: "right" }}>Qtd</th>
                      <th style={{ ...cabecalho, textAlign: "right" }}>Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dados.itens.map((it) => (
                      <tr key={it.nome}>
                        <td style={celula}>{it.nome}</td>
                        <td style={{ ...celula, textAlign: "right", fontWeight: 700 }}>{fmtQtd(it.quantidade)}</td>
                        <td style={{ ...celula, textAlign: "right" }}>{fmt(it.valor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p style={{ margin: "8px 2px 0", fontSize: 11, color: "#94A3B8", lineHeight: 1.5 }}>
                Os itens das mesas fechadas neste dia, pelo preço lançado (antes de desconto e sem taxa). Com categoria, opções e
                meia pizza: Relatórios › Itens vendidos, filtrando Mesa.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** O "máximo de detalhes" de uma conta, aberto embaixo da linha dela. */
function DetalheDaConta({ d }: { d: DetalheDaMesa }) {
  const linhaDeValor = (rotulo: string, valor: string, forte = false) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontWeight: forte ? 800 : 500, color: forte ? "#0F172A" : "#475569" }}>
      <span>{rotulo}</span><span>{valor}</span>
    </div>
  );
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
      {/* Rodadas e itens */}
      <div>
        <div style={{ fontWeight: 800, color: "#0F172A", marginBottom: 6 }}>
          {d.rodadas} {d.rodadas === 1 ? "rodada" : "rodadas"}
        </div>
        {d.pedidos.map((p) => (
          <div key={p.id} style={{ marginBottom: 10, opacity: p.cancelado ? 0.55 : 1 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#64748B" }}>
              Pedido #{p.numero ?? "—"} {p.hora && `· ${p.hora}`} {p.cancelado ? "· cancelado (fora da conta)" : `· ${fmt(p.total)}`}
            </div>
            {p.itens.map((it, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13, textDecoration: p.cancelado ? "line-through" : undefined }}>
                <span>
                  {fmtQtd(it.quantidade)}x {it.nome}
                  {it.pessoa && <span style={{ color: "#94A3B8" }}> · {it.pessoa}</span>}
                  {it.obs && <div style={{ fontSize: 11, color: "#94A3B8" }}>Obs: {it.obs}</div>}
                </span>
                <span style={{ whiteSpace: "nowrap" }}>{fmt(it.valor)}</span>
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* A conta e os pagamentos */}
      <div style={{ fontSize: 13 }}>
        <div style={{ fontWeight: 800, color: "#0F172A", marginBottom: 6 }}>A conta</div>
        {linhaDeValor("Consumo", fmt(d.consumo))}
        {d.desconto > 0 && linhaDeValor("Desconto no fechamento", `− ${fmt(d.desconto)}`)}
        {d.taxa > 0 && linhaDeValor("Taxa de serviço", fmt(d.taxa))}
        {d.gorjeta > 0 && linhaDeValor("Gorjeta", fmt(d.gorjeta))}
        <div style={{ borderTop: "1px solid #E2E8F0", margin: "4px 0" }} />
        {linhaDeValor("Total da conta", fmt(d.totalDaConta), true)}

        <div style={{ fontWeight: 800, color: "#0F172A", margin: "12px 0 6px" }}>Pagamentos</div>
        {d.baixas.length === 0 ? (
          <div style={{ color: "#94A3B8" }}>{d.pagamentos.length > 0 ? "Forma não registrada (conta antiga)." : "Mesa liberada sem pagamento."}</div>
        ) : d.baixas.map((b, i) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
            <span>
              <strong>{b.forma}</strong>
              <span style={{ color: "#94A3B8", fontSize: 12 }}>
                {b.pessoa ? ` · ${b.pessoa}` : ""}{b.hora ? ` · ${b.hora}` : ""}{b.por ? ` · ${b.por}` : ""}
              </span>
            </span>
            <span style={{ whiteSpace: "nowrap" }}>{fmt(b.valor)}</span>
          </div>
        ))}
        {d.troco > 0 && <div style={{ color: "#64748B", marginTop: 2 }}>Troco devolvido: {fmt(d.troco)}</div>}

        {d.pessoas.length > 0 && (
          <>
            <div style={{ fontWeight: 800, color: "#0F172A", margin: "12px 0 6px" }}>Por pessoa (consumo)</div>
            {d.pessoas.map((p) => <Fragment key={p.id}>{linhaDeValor(p.nome, fmt(p.consumo))}</Fragment>)}
          </>
        )}

        <div style={{ marginTop: 12, fontSize: 12, color: "#64748B", lineHeight: 1.5 }}>
          Aberta {d.abertura} · fechada {d.fechamento} ({duracao(d.permanenciaMin)})
          {d.fechadaPor && <> · fechou: {d.fechadaPor}</>}
          {d.observacao && <div>Obs. da mesa: {d.observacao}</div>}
        </div>
      </div>
    </div>
  );
}
