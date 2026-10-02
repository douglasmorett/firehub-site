"use client";
import { useEffect, useMemo, useState } from "react";
import {
  CAMPOS_DOS_NUMEROS, DIA_DO_RELATORIO, baseDoMes, contratoEmUmaLinha, honorarioDaSemana,
  lerNumeroBR, mesAtual, mesCurto, nomeDoMes, somarMeses,
  type NumerosDoRelatorio, type SituacaoDoRelatorio,
} from "@/lib/acompanhamento-ifood/regras";

/**
 * ACOMPANHAMENTO iFOOD — os clientes que pagam a consultoria (contrato da
 * Divinos: % do repasse acima da base, com teto) e o histórico de relatórios
 * mensais de cada um. Cliente pode ser loja do FireHub ou alguém de fora.
 * Regras em lib/acompanhamento-ifood/regras.ts; o relatório do mês passado
 * vence no dia 10.
 */

type Loja = { nome: string; slug: string | null; logo: string | null; cidade: string | null };
type LojaDoSistema = { id: string; nome: string; cidade: string | null; telefone: string | null };

type Cliente = {
  id: string; lojaId: string | null; nome: string; responsavel: string | null; telefone: string | null;
  cidade: string | null; ifoodMerchantId: string | null;
  modelo: string; percentual: number; baseSemanal: number; tetoSemanal: number | null; valorFixoSemanal: number | null;
  inicioEm: string | null; status: string; observacoes: string | null; createdAt: string;
  loja: Loja | null;
  situacao: SituacaoDoRelatorio;
};
type ClienteDaLista = Cliente & {
  relatorios: number;
  ultimoRelatorio: { id: string; mes: string; status: string; numeros: NumerosDoRelatorio } | null;
  serie: { mes: string; valor: number | null }[];
};
type Relatorio = {
  id: string; mes: string; titulo: string | null; resumo: string | null; numeros: NumerosDoRelatorio;
  status: string; enviadoEm: string | null; arquivoNome: string | null; arquivoTipo: string | null;
  criadoPor: string | null; createdAt: string; updatedAt: string;
};
type Canal = { pedidos: number; valor: number; cancelados: number };
type MesNoFireHub = { mes: string; ifood: Canal; noventaENove: Canal; outros: Canal };

type Aviso = { tipo: "ok" | "erro"; texto: string } | null;

const API = "/api/admin/acompanhamento-ifood";
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const brl0 = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const inteiro = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
const emTexto = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v).replace(".", ","));

function formatar(tipo: string, v: number): string {
  if (tipo === "reais") return brl(v);
  if (tipo === "pct") return `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
  if (tipo === "nota") return v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 2 });
  return inteiro(v);
}

/** wa.me com DDI do Brasil quando o número veio só com DDD. */
function linkDoWhatsApp(tel: string | null): string | null {
  const d = (tel || "").replace(/\D/g, "");
  if (d.length < 10) return null;
  return `https://wa.me/${d.length <= 11 ? `55${d}` : d}`;
}

function inicial(nome: string) {
  return (nome || "?").trim().charAt(0).toUpperCase();
}

async function chamar(url: string, init?: RequestInit) {
  const r = await fetch(url, init);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "Não foi possível concluir.");
  return d;
}

// ─────────────────────────────────────────────────────────────────────────────

export default function AcompanhamentoIfoodTab() {
  const [clientes, setClientes] = useState<ClienteDaLista[]>([]);
  const [lojas, setLojas] = useState<LojaDoSistema[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<Aviso>(null);
  const [filtro, setFiltro] = useState<"ATIVO" | "PAUSADO" | "ENCERRADO" | "TODOS">("ATIVO");
  const [busca, setBusca] = useState("");
  const [abertoId, setAbertoId] = useState<string | null>(null);
  const [novoCliente, setNovoCliente] = useState(false);

  const avisar = (a: Aviso) => setAviso(a);
  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), aviso.tipo === "erro" ? 6000 : 3500);
    return () => clearTimeout(t);
  }, [aviso]);

  const carregar = async () => {
    try {
      const d = await chamar(API);
      setClientes(d.clientes || []);
      setLojas(d.lojasDoSistema || []);
      setErro(null);
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setCarregando(false);
    }
  };
  useEffect(() => { void carregar(); }, []);

  const devido = somarMeses(mesAtual(), -1);
  const ativos = clientes.filter((c) => c.status === "ATIVO");
  const devendo = ativos.filter((c) => c.situacao.tipo !== "NADA_DEVIDO");
  const enviados = devendo.filter((c) => c.situacao.tipo === "ENVIADO").length;
  const atrasados = devendo.filter((c) => c.situacao.tipo === "ATRASADO").length;
  const honorarioDoMes = clientes.reduce(
    (s, c) => s + (c.ultimoRelatorio?.mes === devido ? c.ultimoRelatorio.numeros.honorario || 0 : 0), 0,
  );

  const visiveis = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return clientes
      .filter((c) => filtro === "TODOS" || c.status === filtro)
      .filter((c) => !t || [c.nome, c.responsavel, c.cidade, c.loja?.nome].some((v) => v?.toLowerCase().includes(t)));
  }, [clientes, filtro, busca]);

  const contagem = (s: string) => clientes.filter((c) => s === "TODOS" || c.status === s).length;

  return (
    <div className="aci">
      <EstiloDaAba />
      {aviso && <div className={`aci-aviso ${aviso.tipo}`} role="status">{aviso.tipo === "ok" ? "✓ " : "⚠ "}{aviso.texto}</div>}

      {abertoId ? (
        <FichaDoCliente
          id={abertoId}
          lojas={lojas}
          onVoltar={() => setAbertoId(null)}
          onMudou={() => void carregar()}
          onApagado={() => { setAbertoId(null); void carregar(); }}
          avisar={avisar}
        />
      ) : (
        <>
          <div className="aci-kpis">
            <div className="fha-kpi">
              <div className="fha-kpi-lbl">Clientes ativos</div>
              <div className="fha-kpi-val">{ativos.length}</div>
              <div className="fha-kpi-sub">{clientes.length - ativos.length} pausados ou encerrados</div>
            </div>
            <div className="fha-kpi">
              <div className="fha-kpi-lbl">Relatórios de {nomeDoMes(devido, true)}</div>
              <div className="fha-kpi-val">{enviados}<span className="aci-kpi-de"> de {devendo.length}</span></div>
              <div className="fha-kpi-sub">enviados · prazo dia {DIA_DO_RELATORIO}</div>
            </div>
            <div className="fha-kpi">
              <div className="fha-kpi-lbl">Atrasados</div>
              <div className="fha-kpi-val" style={{ color: atrasados ? "#B91C1C" : undefined }}>{atrasados}</div>
              <div className="fha-kpi-sub">{atrasados ? "relatório passou do dia 10" : "nenhum relatório atrasado"}</div>
            </div>
            <div className="fha-kpi">
              <div className="fha-kpi-lbl">Honorário de {nomeDoMes(devido, true)}</div>
              <div className="fha-kpi-val">{brl0(honorarioDoMes)}</div>
              <div className="fha-kpi-sub">somado dos relatórios do mês</div>
            </div>
          </div>

          <div className="fha-section">
            <div className="fha-section-head">
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {([["ATIVO", "Ativos"], ["PAUSADO", "Pausados"], ["ENCERRADO", "Encerrados"], ["TODOS", "Todos"]] as const).map(([k, r]) => (
                  <button key={k} className={`fha-chip${filtro === k ? " on" : ""}`} onClick={() => setFiltro(k)}>
                    {r} · {contagem(k)}
                  </button>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <input className="fha-input" style={{ padding: "8px 12px", width: 220 }} placeholder="Buscar cliente…" value={busca} onChange={(e) => setBusca(e.target.value)} />
                <button className="fha-btn fha-btn-primary" style={{ padding: "8px 14px" }} onClick={() => setNovoCliente(true)}>+ Novo cliente</button>
              </div>
            </div>

            {carregando ? (
              <p className="aci-vazio">Carregando…</p>
            ) : erro ? (
              <p className="aci-vazio" style={{ color: "#B91C1C" }}>{erro}</p>
            ) : visiveis.length === 0 ? (
              <div className="aci-vazio">
                {clientes.length === 0 ? (
                  <>
                    <div style={{ fontSize: "2rem", marginBottom: 6 }}>🛵</div>
                    <strong style={{ color: "#0F172A" }}>Nenhum cliente no acompanhamento ainda.</strong>
                    <div style={{ marginTop: 4 }}>Cadastre quem paga o acompanhamento do iFood — loja do FireHub ou de fora do sistema.</div>
                    <button className="fha-btn fha-btn-primary" style={{ padding: "8px 14px", marginTop: 14 }} onClick={() => setNovoCliente(true)}>+ Cadastrar o primeiro</button>
                  </>
                ) : `Nenhum cliente${busca ? ` para "${busca}"` : " nesta situação"}.`}
              </div>
            ) : (
              <div className="aci-grade">
                {visiveis.map((c) => <CartaoDoCliente key={c.id} c={c} onAbrir={() => setAbertoId(c.id)} />)}
              </div>
            )}
          </div>
        </>
      )}

      {novoCliente && (
        <ModalDoCliente
          lojas={lojas}
          ocupadas={new Set(clientes.map((c) => c.lojaId).filter(Boolean) as string[])}
          onFechar={() => setNovoCliente(false)}
          onSalvo={(id) => { setNovoCliente(false); avisar({ tipo: "ok", texto: "Cliente cadastrado." }); void carregar(); setAbertoId(id); }}
          avisar={avisar}
        />
      )}
    </div>
  );
}

// ─── Cartão da lista ─────────────────────────────────────────────────────────

function SeloDaSituacao({ s }: { s: SituacaoDoRelatorio }) {
  if (s.tipo === "NADA_DEVIDO") return <span className="aci-selo neutro">— Nenhum relatório devido</span>;
  const mes = nomeDoMes(s.mes, true);
  if (s.tipo === "ENVIADO") return <span className="aci-selo ok">✓ {mes} enviado</span>;
  if (s.tipo === "ATRASADO") return <span className="aci-selo ruim">● {mes} atrasado {s.diasDeAtraso} {s.diasDeAtraso === 1 ? "dia" : "dias"}</span>;
  const prazo = s.diasParaOPrazo < 0 ? `passou ${-s.diasParaOPrazo}d do prazo` : s.diasParaOPrazo === 0 ? "vence hoje" : `faltam ${s.diasParaOPrazo} dias`;
  if (s.tipo === "RASCUNHO") return <span className={`aci-selo ${s.diasParaOPrazo < 0 ? "ruim" : "atencao"}`}>✎ {mes} em rascunho · {prazo}</span>;
  return <span className="aci-selo atencao">◷ {mes} a fazer · {prazo}</span>;
}

function SeloDoStatus({ status }: { status: string }) {
  if (status === "ATIVO") return null;
  return <span className="aci-selo neutro">{status === "PAUSADO" ? "⏸ Pausado" : "■ Encerrado"}</span>;
}

/** A linha do "Total faturamento" dos relatórios, sem eixo: só a tendência. */
function MiniLinha({ serie }: { serie: { mes: string; valor: number | null }[] }) {
  const pts = serie.filter((p) => p.valor !== null).slice(-6) as { mes: string; valor: number }[];
  if (pts.length < 2) return null;
  const max = Math.max(...pts.map((p) => p.valor), 1);
  const w = 96, h = 28;
  const xy = pts.map((p, i) => [(i / (pts.length - 1)) * (w - 6) + 3, h - 3 - (p.valor / max) * (h - 6)]);
  const ultimo = xy[xy.length - 1];
  const subiu = pts[pts.length - 1].valor >= pts[pts.length - 2].valor;
  return (
    <svg width={w} height={h} aria-label="Tendência do faturamento nos relatórios" role="img">
      <polyline points={xy.map((p) => p.join(",")).join(" ")} fill="none" stroke="#E8360C" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={ultimo[0]} cy={ultimo[1]} r={3.5} fill="#E8360C" stroke="#FFFFFF" strokeWidth={2} />
      <title>{subiu ? "Subiu" : "Caiu"} no último relatório</title>
    </svg>
  );
}

function CartaoDoCliente({ c, onAbrir }: { c: ClienteDaLista; onAbrir: () => void }) {
  const ult = c.ultimoRelatorio;
  return (
    <button className={`aci-cartao${c.status !== "ATIVO" ? " apagado" : ""}`} onClick={onAbrir}>
      <div className="aci-cartao-topo">
        {c.loja?.logo ? <img src={c.loja.logo} alt="" className="aci-logo" /> : <div className="aci-logo aci-logo-letra">{inicial(c.nome)}</div>}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="aci-nome">{c.nome}</div>
          <div className="fha-sub">
            {[c.responsavel, c.cidade || c.loja?.cidade].filter(Boolean).join(" · ") || "—"}
          </div>
        </div>
        <MiniLinha serie={c.serie} />
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
        <span className={`aci-selo ${c.lojaId ? "firehub" : "neutro"}`}>{c.lojaId ? "🔥 Usa o FireHub" : "Fora do sistema"}</span>
        <SeloDoStatus status={c.status} />
      </div>
      <div className="aci-contrato">{contratoEmUmaLinha(c)}</div>
      <div className="aci-cartao-pe">
        <SeloDaSituacao s={c.situacao} />
        <span className="fha-sub" style={{ marginTop: 0 }}>
          {ult
            ? `${c.relatorios} ${c.relatorios === 1 ? "relatório" : "relatórios"}${ult.numeros.totalFaturamento != null ? ` · ${mesCurto(ult.mes)} ${brl0(ult.numeros.totalFaturamento)}` : ""}`
            : "sem relatório ainda"}
        </span>
      </div>
    </button>
  );
}

// ─── Ficha do cliente ────────────────────────────────────────────────────────

function FichaDoCliente({ id, lojas, onVoltar, onMudou, onApagado, avisar }: {
  id: string; lojas: LojaDoSistema[];
  onVoltar: () => void; onMudou: () => void; onApagado: () => void; avisar: (a: Aviso) => void;
}) {
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [relatorios, setRelatorios] = useState<Relatorio[]>([]);
  const [fireHub, setFireHub] = useState<MesNoFireHub[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState(false);
  const [relatorioAberto, setRelatorioAberto] = useState<null | { novo: true } | { editar: Relatorio }>(null);
  const [confirmarExclusao, setConfirmarExclusao] = useState(false);

  const carregar = async () => {
    try {
      const d = await chamar(`${API}/${id}`);
      setCliente(d.cliente);
      setRelatorios(d.relatorios || []);
      setFireHub(d.fireHub || null);
      setErro(null);
    } catch (e: any) {
      setErro(e.message);
    }
  };
  useEffect(() => { void carregar(); }, [id]);

  const mudarStatus = async (status: string) => {
    try {
      await chamar(`${API}/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
      avisar({ tipo: "ok", texto: status === "ATIVO" ? "Cliente reativado." : status === "PAUSADO" ? "Acompanhamento pausado." : "Acompanhamento encerrado. O histórico fica guardado." });
      await carregar(); onMudou();
    } catch (e: any) { avisar({ tipo: "erro", texto: e.message }); }
  };

  const apagar = async () => {
    try {
      await chamar(`${API}/${id}`, { method: "DELETE" });
      avisar({ tipo: "ok", texto: "Cliente e relatórios apagados." });
      onApagado();
    } catch (e: any) { avisar({ tipo: "erro", texto: e.message }); }
  };

  if (erro) return (
    <div>
      <button className="fha-btn" onClick={onVoltar}>← Todos os clientes</button>
      <p style={{ color: "#B91C1C", marginTop: 16 }}>{erro}</p>
    </div>
  );
  if (!cliente) return <p className="aci-vazio">Carregando…</p>;

  const wa = linkDoWhatsApp(cliente.telefone);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <button className="fha-btn" onClick={onVoltar}>← Todos os clientes</button>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="fha-btn" onClick={() => setEditando(true)}>✎ Editar cliente</button>
          <select className="fha-select" value={cliente.status} onChange={(e) => void mudarStatus(e.target.value)} aria-label="Situação do acompanhamento">
            <option value="ATIVO">● Ativo</option>
            <option value="PAUSADO">⏸ Pausado</option>
            <option value="ENCERRADO">■ Encerrado</option>
          </select>
          <button className="fha-btn fha-btn-primary" onClick={() => setRelatorioAberto({ novo: true })}>+ Relatório do mês</button>
        </div>
      </div>

      {/* Cabeçalho */}
      <div className="fha-section" style={{ padding: 20, marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
          {cliente.loja?.logo ? <img src={cliente.loja.logo} alt="" className="aci-logo grande" /> : <div className="aci-logo grande aci-logo-letra">{inicial(cliente.nome)}</div>}
          <div style={{ flex: 1, minWidth: 220 }}>
            <h2 style={{ margin: 0, fontSize: "1.35rem", fontWeight: 900, color: "#0F172A", letterSpacing: "-0.3px" }}>{cliente.nome}</h2>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "8px 0" }}>
              <span className={`aci-selo ${cliente.lojaId ? "firehub" : "neutro"}`}>{cliente.lojaId ? "🔥 Usa o FireHub" : "Fora do sistema"}</span>
              <SeloDoStatus status={cliente.status} />
              <SeloDaSituacao s={cliente.situacao} />
            </div>
            <div className="aci-dados">
              <div><span>Responsável</span>{cliente.responsavel || "—"}</div>
              <div><span>WhatsApp</span>{wa ? <a className="fha-link" href={wa} target="_blank" rel="noreferrer">{cliente.telefone}</a> : cliente.telefone || "—"}</div>
              <div><span>Cidade</span>{cliente.cidade || cliente.loja?.cidade || "—"}</div>
              <div><span>Desde</span>{new Date(cliente.inicioEm || cliente.createdAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}</div>
              {cliente.loja?.slug && <div><span>Cardápio</span><a className="fha-link" href={`/loja/${cliente.loja.slug}`} target="_blank" rel="noreferrer">/loja/{cliente.loja.slug}</a></div>}
              {cliente.ifoodMerchantId && <div><span>Merchant iFood</span><code style={{ fontSize: "0.72rem" }}>{cliente.ifoodMerchantId}</code></div>}
            </div>
            {cliente.observacoes && <p className="aci-obs">{cliente.observacoes}</p>}
          </div>
        </div>
      </div>

      <div className="aci-duas">
        <Contrato cliente={cliente} />
        <GraficoDoFaturamento relatorios={relatorios} baseSemanal={cliente.baseSemanal} />
      </div>

      {fireHub && <PedidosNoFireHub meses={fireHub} />}

      {/* Histórico */}
      <div className="fha-section" style={{ marginTop: 14 }}>
        <div className="fha-section-head">
          <h3>Histórico de relatórios</h3>
          <span className="fha-sub" style={{ marginTop: 0 }}>{relatorios.length} {relatorios.length === 1 ? "relatório" : "relatórios"}</span>
        </div>
        {relatorios.length === 0 ? (
          <div className="aci-vazio">
            Nenhum relatório ainda. O de cada mês sai até o dia {DIA_DO_RELATORIO} do mês seguinte.
            <div><button className="fha-btn fha-btn-primary" style={{ padding: "8px 14px", marginTop: 12 }} onClick={() => setRelatorioAberto({ novo: true })}>+ Guardar o primeiro</button></div>
          </div>
        ) : (
          <div className="aci-linha-do-tempo">
            {relatorios.map((r) => (
              <ItemDoHistorico
                key={r.id}
                r={r}
                anterior={relatorios.find((x) => x.mes === somarMeses(r.mes, -1)) || null}
                onEditar={() => setRelatorioAberto({ editar: r })}
                onMudou={() => { void carregar(); onMudou(); }}
                avisar={avisar}
              />
            ))}
          </div>
        )}
      </div>

      <div style={{ marginTop: 24, textAlign: "right" }}>
        {confirmarExclusao ? (
          <span style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
            <span className="fha-sub" style={{ marginTop: 0 }}>Apaga o cliente e os {relatorios.length} relatórios. Para quem só parou, use “Encerrado”.</span>
            <button className="fha-btn" onClick={() => setConfirmarExclusao(false)}>Cancelar</button>
            <button className="fha-btn" style={{ color: "#B91C1C", borderColor: "#FCA5A5" }} onClick={() => void apagar()}>Apagar de vez</button>
          </span>
        ) : (
          <button className="fha-btn" style={{ color: "#94A3B8" }} onClick={() => setConfirmarExclusao(true)}>Apagar cadastro…</button>
        )}
      </div>

      {editando && (
        <ModalDoCliente
          lojas={lojas}
          ocupadas={new Set()}
          inicial={cliente}
          onFechar={() => setEditando(false)}
          onSalvo={() => { setEditando(false); avisar({ tipo: "ok", texto: "Cliente atualizado." }); void carregar(); onMudou(); }}
          avisar={avisar}
        />
      )}
      {relatorioAberto && (
        <ModalDoRelatorio
          clienteId={cliente.id}
          contrato={cliente}
          inicial={"editar" in relatorioAberto ? relatorioAberto.editar : null}
          mesesComRelatorio={new Set(relatorios.map((r) => r.mes))}
          onFechar={() => setRelatorioAberto(null)}
          onSalvo={(substituiu) => {
            setRelatorioAberto(null);
            avisar({ tipo: "ok", texto: substituiu ? "Relatório atualizado." : "Relatório guardado no histórico." });
            void carregar(); onMudou();
          }}
          avisar={avisar}
        />
      )}
    </div>
  );
}

/** O contrato e a conta da semana: digita o repasse, sai o honorário. */
function Contrato({ cliente }: { cliente: Cliente }) {
  const [repasse, setRepasse] = useState("");
  const valor = lerNumeroBR(repasse);
  const conta = valor !== null ? honorarioDaSemana(cliente, valor) : null;
  return (
    <div className="fha-section" style={{ padding: 18 }}>
      <div className="fha-kpi-lbl">Contrato</div>
      <div style={{ fontSize: "1.05rem", fontWeight: 800, color: "#0F172A", margin: "6px 0 2px" }}>{contratoEmUmaLinha(cliente)}</div>
      <div className="fha-sub">
        {cliente.modelo === "FIXO" ? "Valor fixo toda semana, junto com o repasse." : `Base semanal de ${brl(cliente.baseSemanal)} — o repasse que já existia antes do acompanhamento.`}
      </div>

      <div className="aci-calc">
        <label htmlFor="aci-repasse" className="fha-kpi-lbl" style={{ display: "block", marginBottom: 6 }}>Conta da semana</label>
        <input id="aci-repasse" className="fha-input" style={{ width: "100%" }} inputMode="decimal" placeholder="Repasse da semana, ex.: 812,40" value={repasse} onChange={(e) => setRepasse(e.target.value)} />
        {conta && (
          <div className="aci-calc-res">
            <div><span>Acima da base</span>{brl(conta.novo)}</div>
            <div><span>Honorário</span><strong>{brl(conta.honorario)}</strong>{cliente.modelo !== "FIXO" && conta.noTeto && <em> · no teto</em>}</div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * "Total faturamento" de cada relatório, por mês, com a base do contrato no
 * tamanho do mês como linha de referência. Uma série: uma cor, sem legenda.
 */
function GraficoDoFaturamento({ relatorios, baseSemanal }: { relatorios: Relatorio[]; baseSemanal: number }) {
  const [foco, setFoco] = useState<number | null>(null);
  const pts = [...relatorios]
    .filter((r) => r.numeros.totalFaturamento != null)
    .sort((a, b) => a.mes.localeCompare(b.mes))
    .slice(-12)
    .map((r) => ({ mes: r.mes, valor: r.numeros.totalFaturamento as number, base: baseDoMes(baseSemanal, r.mes), pedidos: r.numeros.pedidos ?? null }));

  if (pts.length === 0) {
    return (
      <div className="fha-section" style={{ padding: 18 }}>
        <div className="fha-kpi-lbl">Total faturamento por mês</div>
        <p className="fha-sub" style={{ marginTop: 10 }}>O gráfico aparece quando os relatórios tiverem o “Total faturamento” do Financeiro do iFood.</p>
      </div>
    );
  }

  const W = 520, H = 190, padE = 54, padB = 24, padT = 12;
  // Topo do eixo num número redondo (1, 2, 2,5 ou 5 × 10ⁿ por marca), para as marcas não saírem "788".
  const maior = Math.max(...pts.map((p) => Math.max(p.valor, p.base)), 1);
  const passo = (() => {
    const bruto = maior / 3;
    const pot = 10 ** Math.floor(Math.log10(bruto));
    return ([1, 2, 2.5, 5, 10].find((m) => m * pot >= bruto) || 10) * pot;
  })();
  const max = Math.ceil(maior / passo) * passo;
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / max);
  const slot = (W - padE) / pts.length;
  const larg = Math.min(36, slot * 0.6);
  const ticks = Array.from({ length: Math.round(max / passo) + 1 }, (_, i) => Math.round(i * passo));
  const f = foco !== null ? pts[foco] : null;

  return (
    <div className="fha-section" style={{ padding: 18, position: "relative" }}>
      <div className="fha-kpi-lbl">Total faturamento por mês</div>
      <div className="fha-sub" style={{ marginBottom: 8 }}>Dos relatórios guardados · tracejado = base do contrato no mês</div>
      {/* No celular o gráfico não encolhe abaixo de 440 px: rola dentro do cartão, não a página. */}
      <div className="aci-grafico">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Total faturamento do iFood por mês" onMouseLeave={() => setFoco(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padE} x2={W} y1={y(t)} y2={y(t)} stroke="#EEF0F3" strokeWidth={1} />
            <text x={padE - 8} y={y(t) + 4} textAnchor="end" fontSize={10} fill="#94A3B8">{t >= 1000 ? `${(t / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil` : t}</text>
          </g>
        ))}
        {pts.map((p, i) => {
          const cx = padE + slot * i + slot / 2;
          const topo = y(p.valor);
          const alt = Math.max(2, H - padB - topo);
          return (
            <g key={p.mes}>
              {/* alvo do hover maior que a barra */}
              <rect x={padE + slot * i} y={padT} width={slot} height={H - padT - padB} fill="transparent" onMouseEnter={() => setFoco(i)} />
              <path
                d={alt < 6
                  ? `M${cx - larg / 2},${H - padB} h${larg} v-2 h-${larg} Z`
                  : `M${cx - larg / 2},${H - padB} V${topo + 4} Q${cx - larg / 2},${topo} ${cx - larg / 2 + 4},${topo} H${cx + larg / 2 - 4} Q${cx + larg / 2},${topo} ${cx + larg / 2},${topo + 4} V${H - padB} Z`}
                fill="#E8360C" opacity={foco === null || foco === i ? 1 : 0.45} style={{ pointerEvents: "none" }}
              />
              <line x1={cx - slot / 2 + 4} x2={cx + slot / 2 - 4} y1={y(p.base)} y2={y(p.base)} stroke="#475569" strokeWidth={1.5} strokeDasharray="4 3" style={{ pointerEvents: "none" }} />
              <text x={cx} y={H - 8} textAnchor="middle" fontSize={10.5} fill={foco === i ? "#0F172A" : "#64748B"} fontWeight={foco === i ? 700 : 500}>{mesCurto(p.mes)}</text>
            </g>
          );
        })}
        <line x1={padE} x2={W} y1={H - padB} y2={H - padB} stroke="#CBD5E1" strokeWidth={1} />
      </svg>
      </div>
      {f && (
        <div className="aci-dica" style={{ left: `calc(${((padE + slot * foco! + slot / 2) / W) * 100}% )` }}>
          <strong>{nomeDoMes(f.mes)}</strong>
          <div>Total faturamento <b>{brl(f.valor)}</b></div>
          <div>Base do mês {brl(f.base)}</div>
          <div>{f.valor >= f.base ? "Acima" : "Abaixo"} da base em <b>{brl(Math.abs(f.valor - f.base))}</b></div>
          {f.pedidos != null && <div>{inteiro(f.pedidos)} pedidos</div>}
        </div>
      )}
    </div>
  );
}

/** O que a integração do FireHub registrou, por canal (régua do DRE). */
function PedidosNoFireHub({ meses }: { meses: MesNoFireHub[] }) {
  const linhas = [...meses].reverse();
  const algum = linhas.some((m) => m.ifood.pedidos + m.noventaENove.pedidos + m.outros.pedidos > 0);
  return (
    <div className="fha-section" style={{ marginTop: 14 }}>
      <div className="fha-section-head">
        <h3>Pedidos registrados no FireHub</h3>
        <span className="fha-sub" style={{ marginTop: 0 }}>Valor dos pedidos não cancelados. Confere com o portal — o líquido é o do Financeiro do iFood.</span>
      </div>
      {!algum ? (
        <p className="aci-vazio">Nenhum pedido nos últimos 6 meses.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="fha-table">
            <thead>
              <tr>
                <th>Mês</th><th style={{ textAlign: "right" }}>iFood · pedidos</th><th style={{ textAlign: "right" }}>iFood · valor</th>
                <th style={{ textAlign: "right" }}>Ticket</th><th style={{ textAlign: "right" }}>Cancelados</th>
                <th style={{ textAlign: "right" }}>99Food</th><th style={{ textAlign: "right" }}>Outros canais</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((m) => {
                const total = m.ifood.pedidos + m.ifood.cancelados;
                return (
                  <tr key={m.mes}>
                    <td style={{ fontWeight: 700, color: "#0F172A" }}>{nomeDoMes(m.mes)}{m.mes === mesAtual() && <span className="fha-sub" style={{ display: "inline", marginLeft: 6 }}>até agora</span>}</td>
                    <td style={{ textAlign: "right" }}>{inteiro(m.ifood.pedidos)}</td>
                    <td style={{ textAlign: "right", fontWeight: 700 }}>{brl(m.ifood.valor)}</td>
                    <td style={{ textAlign: "right" }}>{m.ifood.pedidos ? brl(m.ifood.valor / m.ifood.pedidos) : "—"}</td>
                    <td style={{ textAlign: "right" }}>{m.ifood.cancelados ? `${m.ifood.cancelados} (${((m.ifood.cancelados / total) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%)` : "—"}</td>
                    <td style={{ textAlign: "right" }}>{m.noventaENove.pedidos ? `${inteiro(m.noventaENove.pedidos)} · ${brl0(m.noventaENove.valor)}` : "—"}</td>
                    <td style={{ textAlign: "right" }}>{m.outros.pedidos ? `${inteiro(m.outros.pedidos)} · ${brl0(m.outros.valor)}` : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Variacao({ atual, antes }: { atual?: number | null; antes?: number | null }) {
  if (atual == null || antes == null || antes === 0) return null;
  const v = ((atual - antes) / antes) * 100;
  if (Math.abs(v) < 0.5) return <span className="aci-var">= mês anterior</span>;
  return (
    <span className={`aci-var ${v > 0 ? "sobe" : "desce"}`}>
      {v > 0 ? "▲" : "▼"} {Math.abs(v).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}% vs mês anterior
    </span>
  );
}

function ItemDoHistorico({ r, anterior, onEditar, onMudou, avisar }: {
  r: Relatorio; anterior: Relatorio | null; onEditar: () => void; onMudou: () => void; avisar: (a: Aviso) => void;
}) {
  const [confirmar, setConfirmar] = useState(false);
  const arquivo = `${API}/relatorios/${r.id}/arquivo`;

  const marcar = async (status: string) => {
    try {
      await chamar(`${API}/relatorios/${r.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
      onMudou();
    } catch (e: any) { avisar({ tipo: "erro", texto: e.message }); }
  };
  const apagar = async () => {
    try {
      await chamar(`${API}/relatorios/${r.id}`, { method: "DELETE" });
      avisar({ tipo: "ok", texto: `Relatório de ${nomeDoMes(r.mes)} apagado.` });
      onMudou();
    } catch (e: any) { avisar({ tipo: "erro", texto: e.message }); }
  };

  const numeros = CAMPOS_DOS_NUMEROS.filter((c) => r.numeros[c.chave] != null);

  return (
    <div className="aci-item">
      <div className={`aci-ponto ${r.status === "ENVIADO" ? "ok" : ""}`} aria-hidden />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "baseline" }}>
          <div>
            <span className="aci-mes">{nomeDoMes(r.mes)}</span>
            {r.titulo && <span style={{ color: "#334155", fontWeight: 600, marginLeft: 8 }}>{r.titulo}</span>}
          </div>
          <span className={`aci-selo ${r.status === "ENVIADO" ? "ok" : "atencao"}`}>
            {r.status === "ENVIADO"
              ? `✓ Enviado${r.enviadoEm ? ` em ${new Date(r.enviadoEm).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}` : ""}`
              : "✎ Rascunho"}
          </span>
        </div>

        {r.resumo && <p className="aci-resumo">{r.resumo}</p>}

        {numeros.length > 0 && (
          <div className="aci-numeros">
            {numeros.map((c) => (
              <div key={c.chave} className="aci-numero">
                <span>{c.rotulo}</span>
                <strong>{formatar(c.tipo, r.numeros[c.chave] as number)}</strong>
                {(c.chave === "totalFaturamento" || c.chave === "pedidos") && <Variacao atual={r.numeros[c.chave]} antes={anterior?.numeros[c.chave]} />}
              </div>
            ))}
          </div>
        )}

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10, alignItems: "center" }}>
          {r.arquivoNome ? (
            <>
              <a className="fha-btn fha-btn-dark" href={arquivo} target="_blank" rel="noreferrer">📄 Abrir relatório</a>
              <a className="fha-btn" href={`${arquivo}?baixar=1`}>Baixar</a>
            </>
          ) : <span className="fha-sub" style={{ marginTop: 0 }}>Sem arquivo anexado</span>}
          <button className="fha-btn" onClick={onEditar}>✎ Editar / trocar arquivo</button>
          {r.status === "ENVIADO"
            ? <button className="fha-btn" onClick={() => void marcar("RASCUNHO")}>Voltar a rascunho</button>
            : <button className="fha-btn" onClick={() => void marcar("ENVIADO")}>✓ Marcar como enviado</button>}
          {confirmar ? (
            <>
              <button className="fha-btn" onClick={() => setConfirmar(false)}>Cancelar</button>
              <button className="fha-btn" style={{ color: "#B91C1C", borderColor: "#FCA5A5" }} onClick={() => void apagar()}>Apagar este relatório</button>
            </>
          ) : (
            <button className="fha-btn" style={{ color: "#94A3B8" }} onClick={() => setConfirmar(true)}>Apagar…</button>
          )}
        </div>
        <div className="fha-sub" style={{ marginTop: 6 }}>
          {r.arquivoNome && `${r.arquivoNome} · `}guardado em {new Date(r.createdAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}{r.criadoPor ? ` por ${r.criadoPor}` : ""}
        </div>
      </div>
    </div>
  );
}

// ─── Modais ──────────────────────────────────────────────────────────────────

function ModalDoCliente({ lojas, ocupadas, inicial, onFechar, onSalvo, avisar }: {
  lojas: LojaDoSistema[]; ocupadas: Set<string>; inicial?: Cliente;
  onFechar: () => void; onSalvo: (id: string) => void; avisar: (a: Aviso) => void;
}) {
  const [usaFireHub, setUsaFireHub] = useState(inicial ? !!inicial.lojaId : true);
  const [lojaId, setLojaId] = useState(inicial?.lojaId || "");
  const [buscaLoja, setBuscaLoja] = useState("");
  const [f, setF] = useState({
    nome: inicial?.nome || "",
    responsavel: inicial?.responsavel || "",
    telefone: inicial?.telefone || "",
    cidade: inicial?.cidade || "",
    ifoodMerchantId: inicial?.ifoodMerchantId || "",
    modelo: inicial?.modelo || "PERCENTUAL",
    percentual: emTexto(inicial?.percentual ?? 5),
    baseSemanal: emTexto(inicial?.baseSemanal ?? null),
    tetoSemanal: emTexto(inicial ? inicial.tetoSemanal : 250),
    valorFixoSemanal: emTexto(inicial?.valorFixoSemanal ?? null),
    inicioEm: (inicial?.inicioEm || new Date().toISOString()).slice(0, 10),
    observacoes: inicial?.observacoes || "",
  });
  const [salvando, setSalvando] = useState(false);
  const muda = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  const opcoes = useMemo(() => {
    const t = buscaLoja.trim().toLowerCase();
    return lojas
      .filter((l) => !ocupadas.has(l.id) || l.id === lojaId)
      .filter((l) => !t || l.nome.toLowerCase().includes(t) || l.cidade?.toLowerCase().includes(t))
      .slice(0, 80);
  }, [lojas, buscaLoja, ocupadas, lojaId]);
  const lojaEscolhida = lojas.find((l) => l.id === lojaId);

  const salvar = async () => {
    if (usaFireHub && !lojaId) { avisar({ tipo: "erro", texto: "Escolha a loja do FireHub." }); return; }
    if (!usaFireHub && !f.nome.trim()) { avisar({ tipo: "erro", texto: "Diga o nome da loja." }); return; }
    setSalvando(true);
    try {
      const corpo = { ...f, lojaId: usaFireHub ? lojaId : null, nome: usaFireHub && !inicial ? "" : f.nome };
      const d = inicial
        ? await chamar(`${API}/${inicial.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) })
        : await chamar(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
      onSalvo(d.cliente.id);
    } catch (e: any) {
      avisar({ tipo: "erro", texto: e.message });
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="fha-modal-fundo" onMouseDown={(e) => { if (e.target === e.currentTarget && !salvando) onFechar(); }}>
      <div className="fha-modal aci-modal">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3>{inicial ? "Editar cliente" : "Novo cliente do acompanhamento"}</h3>
          <button onClick={onFechar} className="aci-x" aria-label="Fechar">✕</button>
        </div>

        <div className="aci-alterna">
          <button className={usaFireHub ? "on" : ""} onClick={() => setUsaFireHub(true)}>🔥 Usa o FireHub</button>
          <button className={!usaFireHub ? "on" : ""} onClick={() => setUsaFireHub(false)}>Fora do sistema</button>
        </div>

        {usaFireHub ? (
          <div className="aci-campo">
            <label>Loja do FireHub</label>
            {lojaEscolhida ? (
              <div className="aci-escolhida">
                <span><strong>{lojaEscolhida.nome}</strong>{lojaEscolhida.cidade ? ` · ${lojaEscolhida.cidade}` : ""}</span>
                <button className="fha-btn" onClick={() => setLojaId("")}>Trocar</button>
              </div>
            ) : (
              <>
                <input className="fha-input" autoFocus placeholder="Buscar pelo nome ou cidade…" value={buscaLoja} onChange={(e) => setBuscaLoja(e.target.value)} />
                <div className="aci-lista-lojas">
                  {opcoes.length === 0 ? <div className="fha-sub" style={{ padding: 10 }}>Nenhuma loja livre com esse nome.</div> : opcoes.map((l) => (
                    <button key={l.id} onClick={() => { setLojaId(l.id); if (!f.telefone && l.telefone) setF((x) => ({ ...x, telefone: l.telefone! })); }}>
                      <strong>{l.nome}</strong>{l.cidade && <span> · {l.cidade}</span>}
                    </button>
                  ))}
                </div>
              </>
            )}
            {inicial && (
              <>
                <label style={{ marginTop: 10 }}>Nome no acompanhamento</label>
                <input className="fha-input" value={f.nome} onChange={muda("nome")} />
              </>
            )}
          </div>
        ) : (
          <div className="aci-campo">
            <label>Nome da loja</label>
            <input className="fha-input" autoFocus value={f.nome} onChange={muda("nome")} placeholder="Ex.: Divinos Burger" />
          </div>
        )}

        <div className="aci-grade-campos">
          <div className="aci-campo"><label>Responsável</label><input className="fha-input" value={f.responsavel} onChange={muda("responsavel")} placeholder="Quem decide na loja" /></div>
          <div className="aci-campo"><label>WhatsApp</label><input className="fha-input" value={f.telefone} onChange={muda("telefone")} placeholder="(22) 99999-0000" /></div>
          <div className="aci-campo"><label>Cidade</label><input className="fha-input" value={f.cidade} onChange={muda("cidade")} /></div>
          <div className="aci-campo"><label>Merchant ID do iFood <em>(opcional)</em></label><input className="fha-input" value={f.ifoodMerchantId} onChange={muda("ifoodMerchantId")} placeholder="d44f62fe-…" /></div>
        </div>

        <div className="aci-bloco">
          <div className="fha-kpi-lbl" style={{ marginBottom: 8 }}>Contrato</div>
          <div className="aci-alterna pequeno">
            <button className={f.modelo === "PERCENTUAL" ? "on" : ""} onClick={() => setF((x) => ({ ...x, modelo: "PERCENTUAL" }))}>% acima da base</button>
            <button className={f.modelo === "FIXO" ? "on" : ""} onClick={() => setF((x) => ({ ...x, modelo: "FIXO" }))}>Fixo por semana</button>
          </div>
          <div className="aci-grade-campos">
            {f.modelo === "PERCENTUAL" ? (
              <>
                <div className="aci-campo"><label>Percentual (%)</label><input className="fha-input" inputMode="decimal" value={f.percentual} onChange={muda("percentual")} /></div>
                <div className="aci-campo"><label>Base semanal (R$)</label><input className="fha-input" inputMode="decimal" value={f.baseSemanal} onChange={muda("baseSemanal")} placeholder="49,31" /></div>
                <div className="aci-campo"><label>Teto por semana (R$)</label><input className="fha-input" inputMode="decimal" value={f.tetoSemanal} onChange={muda("tetoSemanal")} placeholder="vazio = sem teto" /></div>
              </>
            ) : (
              <div className="aci-campo"><label>Valor por semana (R$)</label><input className="fha-input" inputMode="decimal" value={f.valorFixoSemanal} onChange={muda("valorFixoSemanal")} placeholder="250,00" /></div>
            )}
            <div className="aci-campo"><label>Início</label><input className="fha-input" type="date" value={f.inicioEm} onChange={muda("inicioEm")} /></div>
          </div>
        </div>

        <div className="aci-campo">
          <label>Observações</label>
          <textarea className="fha-input" rows={3} value={f.observacoes} onChange={muda("observacoes")} placeholder="Combinados, pasta dos prints, empréstimo ativo no iFood…" style={{ resize: "vertical" }} />
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          <button className="fha-btn" style={{ padding: "9px 14px" }} onClick={onFechar} disabled={salvando}>Cancelar</button>
          <button className="fha-btn fha-btn-primary" style={{ padding: "9px 16px" }} onClick={() => void salvar()} disabled={salvando}>
            {salvando ? "Salvando…" : inicial ? "Salvar" : "Cadastrar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ModalDoRelatorio({ clienteId, contrato, inicial, mesesComRelatorio, onFechar, onSalvo, avisar }: {
  clienteId: string; contrato: Cliente; inicial: Relatorio | null; mesesComRelatorio: Set<string>;
  onFechar: () => void; onSalvo: (substituiu: boolean) => void; avisar: (a: Aviso) => void;
}) {
  const [mes, setMes] = useState(inicial?.mes || somarMeses(mesAtual(), -1));
  const [titulo, setTitulo] = useState(inicial?.titulo || "");
  const [resumo, setResumo] = useState(inicial?.resumo || "");
  const [status, setStatus] = useState(inicial?.status || "RASCUNHO");
  const [numeros, setNumeros] = useState<Record<string, string>>(
    Object.fromEntries(CAMPOS_DOS_NUMEROS.map((c) => [c.chave, emTexto(inicial?.numeros[c.chave] ?? null)])),
  );
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [salvando, setSalvando] = useState(false);
  const jaExiste = !inicial && mesesComRelatorio.has(mes);

  const salvar = async () => {
    const lidos: Record<string, number> = {};
    for (const c of CAMPOS_DOS_NUMEROS) {
      const t = numeros[c.chave]?.trim();
      if (!t) continue;
      const n = lerNumeroBR(t);
      if (n === null) { avisar({ tipo: "erro", texto: `“${c.rotulo}” não é um número: ${t}` }); return; }
      lidos[c.chave] = n;
    }
    if (arquivo && arquivo.size > 8 * 1024 * 1024) { avisar({ tipo: "erro", texto: "Arquivo acima de 8 MB." }); return; }

    const form = new FormData();
    form.set("mes", mes);
    form.set("titulo", titulo);
    form.set("resumo", resumo);
    form.set("status", status);
    form.set("numeros", JSON.stringify(lidos));
    if (arquivo) form.set("arquivo", arquivo);

    setSalvando(true);
    try {
      const d = await chamar(`${API}/${clienteId}/relatorios`, { method: "POST", body: form });
      onSalvo(!!d.substituiu);
    } catch (e: any) {
      avisar({ tipo: "erro", texto: e.message });
    } finally {
      setSalvando(false);
    }
  };

  const honorarioSugerido = contrato.modelo === "FIXO" ? null : "Some o honorário das semanas do mês (extratos de terça).";

  return (
    <div className="fha-modal-fundo" onMouseDown={(e) => { if (e.target === e.currentTarget && !salvando) onFechar(); }}>
      <div className="fha-modal aci-modal">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3>{inicial ? `Relatório de ${nomeDoMes(inicial.mes)}` : "Guardar relatório do mês"}</h3>
          <button onClick={onFechar} className="aci-x" aria-label="Fechar">✕</button>
        </div>

        <div className="aci-grade-campos">
          <div className="aci-campo">
            <label>Mês analisado</label>
            <input className="fha-input" type="month" value={mes} onChange={(e) => setMes(e.target.value)} disabled={!!inicial} />
          </div>
          <div className="aci-campo">
            <label>Situação</label>
            <select className="fha-input" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="RASCUNHO">Rascunho</option>
              <option value="ENVIADO">Já enviei ao cliente</option>
            </select>
          </div>
        </div>
        {jaExiste && <p className="aci-alerta">Já existe o relatório de {nomeDoMes(mes)}. Salvar substitui o que você mudar (o arquivo só se escolher outro).</p>}

        <div className="aci-campo">
          <label>Título <em>(opcional)</em></label>
          <input className="fha-input" value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ex.: Combos com foto puxaram o ticket" />
        </div>
        <div className="aci-campo">
          <label>Resumo do mês</label>
          <textarea className="fha-input" rows={3} value={resumo} onChange={(e) => setResumo(e.target.value)} style={{ resize: "vertical" }}
            placeholder="Uma frase: o que aconteceu e por qual alavanca (visitas, conversão ou ticket)." />
        </div>

        <div className="aci-bloco">
          <div className="fha-kpi-lbl" style={{ marginBottom: 8 }}>Números do mês <span style={{ textTransform: "none", fontWeight: 600 }}>— Portal do Parceiro, tudo opcional</span></div>
          <div className="aci-grade-campos tres">
            {CAMPOS_DOS_NUMEROS.map((c) => (
              <div key={c.chave} className="aci-campo">
                <label>{c.rotulo}{c.tipo === "pct" ? " (%)" : c.tipo === "reais" ? " (R$)" : ""}</label>
                <input className="fha-input" inputMode="decimal" value={numeros[c.chave]} onChange={(e) => setNumeros((x) => ({ ...x, [c.chave]: e.target.value }))}
                  title={c.chave === "honorario" ? honorarioSugerido || undefined : undefined} />
              </div>
            ))}
          </div>
        </div>

        <div className="aci-campo">
          <label>Arquivo do relatório <em>(.html do modelo ou .pdf, até 8 MB)</em></label>
          <input type="file" accept=".html,.htm,.pdf" onChange={(e) => setArquivo(e.target.files?.[0] || null)} />
          {inicial?.arquivoNome && !arquivo && <div className="fha-sub">Atual: {inicial.arquivoNome} — deixe vazio para manter.</div>}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          <button className="fha-btn" style={{ padding: "9px 14px" }} onClick={onFechar} disabled={salvando}>Cancelar</button>
          <button className="fha-btn fha-btn-primary" style={{ padding: "9px 16px" }} onClick={() => void salvar()} disabled={salvando}>
            {salvando ? "Guardando…" : "Guardar no histórico"}
          </button>
        </div>
      </div>
    </div>
  );
}

function EstiloDaAba() {
  return (
    <style>{`
      .aci-aviso { position: fixed; top: 16px; left: 50%; transform: translateX(-50%); z-index: 1000; padding: 11px 18px; border-radius: 12px; font-size: 0.86rem; font-weight: 700; box-shadow: 0 10px 30px rgba(15,23,42,.18); animation: aci-desce .22s ease-out; max-width: calc(100vw - 32px); }
      .aci-aviso.ok { background: #0B0B0C; color: #FFFFFF; }
      .aci-aviso.erro { background: #B91C1C; color: #FFFFFF; }
      @keyframes aci-desce { from { opacity: 0; transform: translate(-50%, -10px); } to { opacity: 1; transform: translate(-50%, 0); } }
      @media (prefers-reduced-motion: reduce) { .aci-aviso { animation: none; } }
      .aci-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 14px; margin-bottom: 14px; }
      .aci-kpi-de { font-size: 1rem; color: #94A3B8; font-weight: 700; }
      .aci-vazio { padding: 32px 20px; text-align: center; color: #64748B; font-size: 0.86rem; }
      .aci-grade { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; padding: 16px; }
      .aci-cartao { text-align: left; background: #FFFFFF; border: 1px solid #E5E7EB; border-radius: 14px; padding: 16px; cursor: pointer; font-family: inherit; display: flex; flex-direction: column; transition: border-color .15s, box-shadow .15s, transform .15s; }
      .aci-cartao:hover { border-color: #CBD5E1; box-shadow: 0 6px 18px rgba(15,23,42,.07); transform: translateY(-1px); }
      .aci-cartao:focus-visible { outline: 2px solid #E8360C; outline-offset: 2px; }
      .aci-cartao.apagado { opacity: .65; }
      .aci-cartao-topo { display: flex; gap: 12px; align-items: center; }
      .aci-cartao-pe { margin-top: auto; padding-top: 12px; border-top: 1px solid #F1F3F5; display: flex; flex-direction: column; gap: 6px; }
      .aci-nome { font-weight: 800; color: #0F172A; font-size: 0.98rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .aci-logo { width: 42px; height: 42px; border-radius: 10px; object-fit: cover; flex-shrink: 0; border: 1px solid #EEF0F3; }
      .aci-logo.grande { width: 64px; height: 64px; border-radius: 14px; }
      .aci-logo-letra { display: flex; align-items: center; justify-content: center; background: #FFF1EC; color: #E8360C; font-weight: 900; font-size: 1.1rem; }
      .aci-logo.grande.aci-logo-letra { font-size: 1.6rem; }
      .aci-contrato { font-size: 0.8rem; color: #334155; font-weight: 600; margin: 10px 0 12px; }
      .aci-selo { display: inline-flex; align-items: center; gap: 4px; padding: 3px 9px; border-radius: 999px; font-size: 0.7rem; font-weight: 800; white-space: nowrap; align-self: flex-start; }
      .aci-selo.ok { background: #DCFCE7; color: #166534; }
      .aci-selo.atencao { background: #FEF3C7; color: #92400E; }
      .aci-selo.ruim { background: #FEE2E2; color: #B91C1C; }
      .aci-selo.neutro { background: #F1F5F9; color: #475569; }
      .aci-selo.firehub { background: #FFF1EC; color: #C2410C; }
      .aci-dados { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 10px 18px; margin-top: 6px; font-size: 0.84rem; color: #0F172A; font-weight: 600; }
      .aci-dados span { display: block; color: #64748B; font-size: 0.66rem; font-weight: 700; text-transform: uppercase; letter-spacing: .4px; margin-bottom: 1px; }
      .aci-obs { margin: 12px 0 0; padding: 10px 12px; background: #F8FAFC; border-radius: 10px; font-size: 0.82rem; color: #334155; white-space: pre-wrap; }
      .aci-duas { display: grid; grid-template-columns: minmax(260px, 1fr) minmax(300px, 1.6fr); gap: 14px; }
      @media (max-width: 960px) { .aci-duas { grid-template-columns: 1fr; } }
      .aci-calc { margin-top: 16px; padding-top: 14px; border-top: 1px solid #F1F3F5; }
      .aci-calc-res { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 10px; font-size: 0.9rem; color: #0F172A; }
      .aci-calc-res span { display: block; color: #64748B; font-size: 0.68rem; font-weight: 700; text-transform: uppercase; }
      .aci-calc-res strong { font-size: 1.15rem; font-weight: 900; }
      .aci-calc-res em { color: #92400E; font-style: normal; font-weight: 700; font-size: 0.76rem; }
      .aci-dica { position: absolute; top: 58px; transform: translateX(-50%); background: #0B0B0C; color: #E2E8F0; border-radius: 10px; padding: 9px 12px; font-size: 0.76rem; line-height: 1.5; pointer-events: none; white-space: nowrap; box-shadow: 0 8px 20px rgba(15,23,42,.2); }
      .aci-dica strong { color: #FFFFFF; display: block; text-transform: capitalize; }
      .aci-dica b { color: #FFFFFF; }
      .aci-linha-do-tempo { padding: 6px 18px 12px; }
      .aci-item { display: flex; gap: 14px; padding: 16px 0; border-bottom: 1px solid #F1F3F5; position: relative; }
      .aci-item:last-child { border-bottom: none; }
      .aci-ponto { width: 12px; height: 12px; border-radius: 50%; border: 2px solid #F59E0B; background: #FFFFFF; margin-top: 5px; flex-shrink: 0; }
      .aci-ponto.ok { border-color: #16A34A; background: #16A34A; }
      .aci-mes { font-weight: 900; color: #0F172A; font-size: 1rem; text-transform: capitalize; }
      .aci-resumo { margin: 6px 0 0; color: #334155; font-size: 0.86rem; line-height: 1.5; white-space: pre-wrap; }
      .aci-grafico { overflow-x: auto; }
      .aci-grafico svg { min-width: 440px; display: block; }
      .aci-numeros { display: grid; grid-template-columns: repeat(auto-fill, minmax(128px, 1fr)); gap: 8px; margin-top: 10px; }
      .aci-numero { background: #F8FAFC; border: 1px solid #EEF0F3; border-radius: 10px; padding: 8px 10px; }
      .aci-numero span { display: block; color: #64748B; font-size: 0.66rem; font-weight: 700; text-transform: uppercase; letter-spacing: .3px; }
      .aci-numero strong { color: #0F172A; font-size: 0.98rem; font-weight: 800; }
      .aci-var { display: block; font-size: 0.68rem; font-weight: 700; color: #64748B; margin-top: 1px; }
      .aci-var.sobe { color: #15803D; }
      .aci-var.desce { color: #B91C1C; }
      .aci-modal { max-width: 620px; max-height: calc(100vh - 32px); overflow-y: auto; }
      .aci-x { background: none; border: none; color: #94A3B8; font-size: 1.2rem; cursor: pointer; }
      .aci-campo { display: flex; flex-direction: column; gap: 4px; margin-top: 10px; min-width: 0; }
      .aci-campo label { font-size: 0.72rem; font-weight: 700; color: #475569; }
      .aci-campo label em { font-weight: 500; color: #94A3B8; font-style: normal; }
      .aci-campo .fha-input { padding: 9px 12px; width: 100%; }
      .aci-grade-campos { display: grid; grid-template-columns: 1fr 1fr; gap: 0 12px; }
      .aci-grade-campos.tres { grid-template-columns: repeat(3, 1fr); }
      @media (max-width: 560px) { .aci-grade-campos, .aci-grade-campos.tres { grid-template-columns: 1fr; } }
      .aci-bloco { margin-top: 14px; padding: 14px; background: #F8FAFC; border: 1px solid #EEF0F3; border-radius: 12px; }
      .aci-alterna { display: inline-flex; background: #F1F5F9; border-radius: 10px; padding: 3px; gap: 2px; }
      .aci-alterna button { border: none; background: none; padding: 8px 14px; border-radius: 8px; font-family: inherit; font-size: 0.8rem; font-weight: 700; color: #475569; cursor: pointer; }
      .aci-alterna button.on { background: #FFFFFF; color: #0F172A; box-shadow: 0 1px 3px rgba(15,23,42,.12); }
      .aci-alterna.pequeno button { padding: 6px 12px; font-size: 0.76rem; }
      .aci-lista-lojas { max-height: 200px; overflow-y: auto; border: 1px solid #E2E8F0; border-radius: 10px; margin-top: 6px; }
      .aci-lista-lojas button { display: block; width: 100%; text-align: left; padding: 9px 12px; border: none; border-bottom: 1px solid #F1F3F5; background: #FFFFFF; font-family: inherit; font-size: 0.83rem; color: #0F172A; cursor: pointer; }
      .aci-lista-lojas button:hover { background: #FFF7F3; }
      .aci-lista-lojas button span { color: #64748B; }
      .aci-escolhida { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid #FDBA9C; background: #FFF7F3; border-radius: 10px; font-size: 0.86rem; color: #0F172A; }
      .aci-alerta { margin: 8px 0 0; padding: 9px 12px; background: #FEF3C7; color: #92400E; border-radius: 10px; font-size: 0.8rem; font-weight: 600; }
    `}</style>
  );
}
