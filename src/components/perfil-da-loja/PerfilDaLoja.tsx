"use client";

/**
 * O PERFIL DA LOJA na tela — a gaveta que abre do lado direito no admin
 * (Lojistas, Perfil dos clientes) e no portal do vendedor (Carteira). Os
 * números e as regras vêm prontos de lib/perfil-da-loja (o servidor monta);
 * aqui é só desenho.
 */
import { useCallback, useEffect, useState } from "react";
import {
  Activity, Check, CircleCheck, CircleDashed, CirclePause, Copy, ExternalLink, Flame, LoaderCircle, MessageCircle, Rocket, Snowflake,
  Sparkles, Store, TrendingDown, TrendingUp, Minus, Wallet, X,
} from "lucide-react";
import { useDinheiro } from "@/components/parceiro/ValoresOcultos";
import {
  ROTULO_DO_ESTADO, ROTULO_DO_STATUS,
  type EstadoDoRecurso, type GrupoDoRecurso, type PerfilDaLoja, type StatusDaAtividade,
} from "@/lib/perfil-da-loja/regras";
import { COR_DO_CANAL, ESTILO_DO_PERFIL } from "./estilo";

// ── Aviso no topo (cópia local, ver memória aviso-e-no-topo-nao-alert) ──────

export type Aviso = { tipo: "ok" | "erro" | "info"; titulo: string; detalhe?: string };
const COR_DO_AVISO = { ok: { cor: "#15803D", fundo: "#F0FDF4" }, erro: { cor: "#B91C1C", fundo: "#FEF2F2" }, info: { cor: "#1D4ED8", fundo: "#EFF6FF" } };

export function AvisoNoTopo({ aviso, onFechar }: { aviso: Aviso | null; onFechar: () => void }) {
  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(onFechar, aviso.tipo === "erro" ? 12000 : 4000);
    return () => clearTimeout(t);
  }, [aviso, onFechar]);
  if (!aviso) return null;
  const { cor, fundo } = COR_DO_AVISO[aviso.tipo];
  return (
    <div
      role={aviso.tipo === "erro" ? "alert" : "status"}
      onClick={onFechar}
      style={{
        position: "fixed", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 1200,
        width: "min(440px, calc(100vw - 24px))", background: fundo, borderLeft: `4px solid ${cor}`,
        borderRadius: 12, padding: "12px 14px", boxShadow: "0 10px 30px rgba(15,23,42,.18)", cursor: "pointer",
      }}
    >
      <div style={{ fontWeight: 800, fontSize: 14, color: "#0F172A" }}>{aviso.titulo}</div>
      {aviso.detalhe && <div style={{ fontSize: 13, color: "#475569", marginTop: 2 }}>{aviso.detalhe}</div>}
    </div>
  );
}

// ── Peças pequenas ──────────────────────────────────────────────────────────

const ICONE_DO_STATUS: Record<StatusDaAtividade, typeof Flame> = { ATIVA: Flame, ESFRIANDO: Snowflake, PARADA: CirclePause, NOVA: Rocket };

export function PilulaDoStatus({ status, curta }: { status: StatusDaAtividade; curta?: boolean }) {
  return <span className={`pf-pilula pf-st-${status}`}><i aria-hidden />{curta && status === "NOVA" ? "Nova" : ROTULO_DO_STATUS[status]}</span>;
}

export function Tendencia({ pct, sufixo = "" }: { pct: number | null; sufixo?: string }) {
  if (pct === null) return <span className="pf-tend igual"><Minus size={13} aria-hidden /> sem base</span>;
  const cls = pct > 2 ? "sobe" : pct < -2 ? "cai" : "igual";
  const Icone = cls === "sobe" ? TrendingUp : cls === "cai" ? TrendingDown : Minus;
  return <span className={`pf-tend ${cls}`}><Icone size={13} aria-hidden /> {pct > 0 ? "+" : ""}{pct}%{sufixo}</span>;
}

const dataBR = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—");
const haQuanto = (iso: string | null | undefined) => {
  if (!iso) return "nunca";
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return d <= 0 ? "hoje" : d === 1 ? "ontem" : `há ${d} dias`;
};
const nomeDoMes = (ym: string) => {
  const [a, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, 15)).toLocaleDateString("pt-BR", { month: "long", timeZone: "UTC" });
};
const soDigitos = (t: string | null | undefined) => String(t || "").replace(/\D/g, "");
export const linkDoWhatsApp = (t: string | null | undefined) => {
  const d = soDigitos(t);
  return d ? `https://wa.me/${d.length <= 11 ? `55${d}` : d}` : null;
};

async function copiar(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    const campo = document.createElement("textarea");
    campo.value = texto;
    document.body.appendChild(campo);
    campo.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { /* sem cópia */ }
    campo.remove();
    return ok;
  }
}

const GRUPOS: GrupoDoRecurso[] = ["Canais de venda", "Operação", "Gestão", "Clientes e marketing"];
const ICONE_DO_ESTADO: Record<EstadoDoRecurso, typeof Check> = { USANDO: CircleCheck, LIGADO: Activity, PARADO: CirclePause, NUNCA: CircleDashed };

// ── O perfil ────────────────────────────────────────────────────────────────

export function VisaoDoPerfil({ perfil, avisar }: { perfil: PerfilDaLoja; avisar: (a: Aviso) => void }) {
  const dinheiro = useDinheiro();
  const [filtro, setFiltro] = useState<EstadoDoRecurso | "TODOS">("TODOS");
  const { loja, atividade: a, financeiro: f } = perfil;
  const IconeStatus = ICONE_DO_STATUS[a.status];
  const whats = linkDoWhatsApp(loja.telefone);
  const recursos = filtro === "TODOS" ? perfil.recursos : perfil.recursos.filter((r) => r.estado === filtro);
  const feitos = perfil.ativacao?.filter((p) => p.feito).length ?? 0;

  const copiarArgumento = async (texto: string, produto: string) => {
    const ok = await copiar(texto);
    avisar(ok ? { tipo: "ok", titulo: "Argumento copiado", detalhe: `${produto} — é só colar na conversa.` } : { tipo: "erro", titulo: "Não deu para copiar", detalhe: "Selecione o texto e copie à mão." });
  };

  return (
    <div className="pf-perfil">
      <header className="pf-cab">
        {loja.logo ? <img className="pf-logo" src={loja.logo} alt="" /> : <div className="pf-logo" aria-hidden>{(loja.nome || "?").trim().charAt(0).toUpperCase()}</div>}
        <div style={{ minWidth: 0 }}>
          <div className="pf-nome">{loja.nome}</div>
          <div className="pf-cab-info">
            {loja.cidade && <span>{loja.cidade}</span>}
            <span>cliente desde {dataBR(loja.criadaEm)}</span>
            {loja.vendedor && <span>vendedor: {loja.vendedor.nome}</span>}
            {loja.embaixador && <span>indicada por {loja.embaixador.nome}</span>}
            {loja.lojasNaConta > 0 && <span>+{loja.lojasNaConta} {loja.lojasNaConta === 1 ? "loja" : "lojas"} na conta</span>}
          </div>
        </div>
        <div className="pf-cab-acoes">
          {whats && <a className="pf-botao whats pequeno" href={whats} target="_blank" rel="noreferrer"><MessageCircle size={14} aria-hidden /> WhatsApp</a>}
          {loja.slug && <a className="pf-botao pequeno" href={`/loja/${loja.slug}`} target="_blank" rel="noreferrer"><ExternalLink size={14} aria-hidden /> Cardápio</a>}
        </div>
      </header>

      <section className={`pf-faixa pf-st-${a.status}`}>
        <div className="pf-faixa-icone"><IconeStatus size={22} aria-hidden /></div>
        <div>
          <strong>{ROTULO_DO_STATUS[a.status]}</strong>
          <p>{a.motivo}</p>
          <div className="pf-sinal">
            {perfil.ultimoSinalDoPainel
              ? <>Último sinal de uso do sistema: {perfil.ultimoSinalDoPainel.oQue}, {haQuanto(perfil.ultimoSinalDoPainel.em)} ({dataBR(perfil.ultimoSinalDoPainel.em)}). O FireHub não registra o login do lojista.</>
              : "Nenhum sinal de uso registrado (o FireHub não registra o login do lojista)."}
          </div>
        </div>
      </section>

      <div className="pf-kpis">
        <div className="pf-kpi">
          <span className="pf-rotulo">Vendas · 30 dias</span>
          <div className="pf-kpi-val">{a.d30.vendas.toLocaleString("pt-BR")}</div>
          <div className="pf-kpi-sub"><Tendencia pct={a.tendenciaPct} /> <span>antes: {a.d30Anterior.vendas.toLocaleString("pt-BR")}</span></div>
        </div>
        <div className="pf-kpi">
          <span className="pf-rotulo">Faturamento · 30 dias</span>
          <div className="pf-kpi-val">{dinheiro(a.d30.valor)}</div>
          <div className="pf-kpi-sub">antes: {dinheiro(a.d30Anterior.valor)}</div>
        </div>
        <div className="pf-kpi">
          <span className="pf-rotulo">Ticket médio</span>
          <div className="pf-kpi-val">{dinheiro(a.ticketMedio30)}</div>
          <div className="pf-kpi-sub">valor ÷ vendas, 30 dias</div>
        </div>
        <div className="pf-kpi">
          <span className="pf-rotulo">Últimos 7 dias</span>
          <div className="pf-kpi-val">{a.d7.vendas.toLocaleString("pt-BR")}</div>
          <div className="pf-kpi-sub">{dinheiro(a.d7.valor)} · última venda {haQuanto(a.ultimaVendaEm)}</div>
        </div>
      </div>

      <section className="pf-painel">
        <div className="pf-painel-cab">
          <div>
            <h3 className="pf-h">Canais que vendem <small>últimos 30 dias</small></h3>
            <p className="pf-sub">Vendas na régua dos relatórios: mesa conta uma vez por conta, cancelado e reposição ficam de fora.</p>
          </div>
        </div>
        {a.canais.length === 0 ? (
          <div className="pf-vazio">Nenhuma venda nos últimos 30 dias.</div>
        ) : (
          <div className="pf-canais">
            <div className="pf-barra" role="img" aria-label={a.canais.map((c) => `${c.nome} ${c.pct}%`).join(", ")}>
              {a.canais.map((c) => <span key={c.canal} style={{ width: `${c.pct}%`, background: COR_DO_CANAL[c.canal] }} title={`${c.nome}: ${c.pct}%`} />)}
            </div>
            <ul>
              {a.canais.map((c) => (
                <li key={c.canal}>
                  <i style={{ background: COR_DO_CANAL[c.canal] }} aria-hidden />
                  <span>{c.nome}</span>
                  <b>{c.pct.toLocaleString("pt-BR")}%</b>
                  <small>{c.vendas.toLocaleString("pt-BR")} vendas · {dinheiro(c.valor)}</small>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="pf-painel">
        <div className="pf-painel-cab">
          <div>
            <h3 className="pf-h"><Sparkles size={17} aria-hidden /> O que oferecer <small>{perfil.oportunidades.length} {perfil.oportunidades.length === 1 ? "oportunidade" : "oportunidades"}, a mais forte primeiro</small></h3>
            <p className="pf-sub">Cada uma sai dos dados da loja. “Serviço pago” gera receita; “Incluso” é recurso que a loja já tem e não usa — ligar segura o cliente.</p>
          </div>
        </div>
        {perfil.oportunidades.length === 0 ? (
          <div className="pf-vazio">
            {a.status === "PARADA" ? "Loja parada: antes de oferecer qualquer coisa, ligar e entender por que parou de vender." : "Nada a oferecer agora — a loja já usa o que os números dela pedem."}
          </div>
        ) : (
          <ol className="pf-ops">
            {perfil.oportunidades.map((o, i) => (
              <li key={o.chave} className={`pf-op ${o.tipo === "VENDA" ? "venda" : "adocao"}`}>
                <span className="pf-op-n">{i + 1}</span>
                <div className="pf-op-cab">
                  <strong>{o.produto}</strong>
                  {o.tipo === "VENDA"
                    ? <span className="pf-tag venda"><Wallet size={11} aria-hidden /> Serviço pago{o.valorMensal ? ` · ${dinheiro(o.valorMensal)}/mês` : ""}</span>
                    : <span className="pf-tag adocao">Incluso · ligar</span>}
                </div>
                <p className="pf-op-motivo">{o.motivo}</p>
                <div className="pf-argumento">
                  <q>{o.argumento}</q>
                  <button type="button" className="pf-botao pequeno" onClick={() => copiarArgumento(o.argumento, o.produto)} aria-label={`Copiar o argumento de ${o.produto}`}>
                    <Copy size={13} aria-hidden /> Copiar
                  </button>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      {perfil.ativacao && (
        <section className="pf-painel">
          <div className="pf-painel-cab">
            <div>
              <h3 className="pf-h"><Rocket size={17} aria-hidden /> Ativação do teste <small>{feitos} de {perfil.ativacao.length} · {a.diasDeTeste} {a.diasDeTeste === 1 ? "dia restante" : "dias restantes"}</small></h3>
              <p className="pf-sub">O que a loja já fez e o que falta para estar usando de verdade quando o teste acabar.</p>
            </div>
          </div>
          <div className="pf-progresso" aria-hidden><span style={{ width: `${(feitos / perfil.ativacao.length) * 100}%` }} /></div>
          <ul className="pf-ativacao">
            {perfil.ativacao.map((p) => (
              <li key={p.chave} className={p.feito ? "feito" : ""}>
                {p.feito ? <CircleCheck size={17} color="#15803D" aria-hidden /> : <CircleDashed size={17} color="#9A5B06" aria-hidden />}
                <span>{p.texto}</span>
                <small>{p.detalhe}</small>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="pf-painel">
        <div className="pf-painel-cab">
          <div>
            <h3 className="pf-h"><Store size={17} aria-hidden /> Funcionalidades <small>usa {perfil.contagem.USANDO} de {perfil.recursos.length}</small></h3>
            <p className="pf-sub">Uso = evento nos últimos 30 dias (pedido, resposta, lançamento). Configuração salva sem uso aparece como parada.</p>
          </div>
          <div className="pf-chips" role="group" aria-label="Filtrar funcionalidades">
            {(["TODOS", "USANDO", "LIGADO", "PARADO", "NUNCA"] as const).map((e) => (
              <button key={e} type="button" className={`pf-chip${filtro === e ? " on" : ""}`} onClick={() => setFiltro(e)} aria-pressed={filtro === e}>
                {e === "TODOS" ? "Todas" : ROTULO_DO_ESTADO[e]} <span>{e === "TODOS" ? perfil.recursos.length : perfil.contagem[e]}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="pf-recursos">
          {GRUPOS.map((g) => {
            const doGrupo = recursos.filter((r) => r.grupo === g);
            if (!doGrupo.length) return null;
            return (
              <div key={g} className="pf-grupo">
                <h4>{g}</h4>
                <ul>
                  {doGrupo.map((r) => {
                    const Icone = ICONE_DO_ESTADO[r.estado];
                    return (
                      <li key={r.chave} className={`pf-rec ${r.estado}`}>
                        <span className="pf-rec-nome">{r.nome}{r.pago && <span className="pf-tag venda">pago</span>}</span>
                        <span className={`pf-pilula pf-es-${r.estado}`}><Icone size={12} aria-hidden /> {ROTULO_DO_ESTADO[r.estado]}</span>
                        <span className="pf-rec-ev">{r.evidencia}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      </section>

      <div className="pf-duas">
        <section className="pf-painel">
          <div className="pf-painel-cab"><h3 className="pf-h"><Wallet size={17} aria-hidden /> Serviços pagos</h3></div>
          <ul className="pf-lista-simples">
            {perfil.servicosPagos.map((s) => (
              <li key={s.chave}>
                <span>{s.nome}</span>
                {s.contratado
                  ? <b style={{ color: "#15803D" }}>✓ {s.valorMensal ? `${dinheiro(s.valorMensal)}/mês` : s.rotuloDoValor || "contratado"}</b>
                  : <b className="fraco">não contratado</b>}
              </li>
            ))}
            <li><span><strong>Total em serviços</strong></span><b>{dinheiro(f.totalDosServicos)}/mês</b></li>
          </ul>
        </section>
        <section className="pf-painel">
          <div className="pf-painel-cab"><h3 className="pf-h">Mensalidade FireHub</h3></div>
          <ul className="pf-lista-simples">
            <li><span>Mensalidade de {nomeDoMes(f.mensalidadeDoMes.mes)}</span><b>{f.isenta ? "isenta" : `${dinheiro(f.mensalidadeDoMes.valor)} · ${f.mensalidadeDoMes.situacao}`}</b></li>
            <li>
              <span>Em aberto</span>
              {f.emAberto
                ? <b style={{ color: "#B91C1C" }}>{dinheiro(f.emAberto.valor)} · {f.emAberto.meses} {f.emAberto.meses === 1 ? "boleto" : "boletos"}{f.emAberto.diasDeAtraso > 0 ? ` · ${f.emAberto.diasDeAtraso} dias de atraso` : ""}</b>
                : <b style={{ color: "#15803D" }}>nada</b>}
            </li>
            <li><span>Isenção</span><b className={f.isenta ? "" : "fraco"}>{f.isenta ? `isenta (${f.motivoDaIsencao})` : "paga mensalidade"}</b></li>
            <li><span>Cliente desde</span><b>{dataBR(f.clienteDesde)}</b></li>
            <li><span>Teste grátis</span><b className="fraco">{f.testeAte ? `${new Date(f.testeAte).getTime() > Date.now() ? "até" : "acabou em"} ${dataBR(f.testeAte)}` : "sem teste registrado"}</b></li>
          </ul>
        </section>
      </div>
    </div>
  );
}

// ── A gaveta (busca o perfil e mostra) ────────────────────────────────────────

export function GavetaDoPerfil({ url, aoFechar, tema = "areia" }: { url: string | null; aoFechar: () => void; tema?: "areia" | "admin" }) {
  const [perfil, setPerfil] = useState<PerfilDaLoja | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const fecharAviso = useCallback(() => setAviso(null), []);

  useEffect(() => {
    if (!url) return;
    let vivo = true;
    setPerfil(null);
    setErro(null);
    fetch(url, { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!vivo) return;
        if (!r.ok) setErro(d.error || "Não deu para abrir o perfil.");
        else setPerfil(d);
      })
      .catch(() => vivo && setErro("Sem conexão. Tente de novo."));
    return () => { vivo = false; };
  }, [url]);

  useEffect(() => {
    if (!url) return;
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") aoFechar(); };
    const antes = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", tecla);
    return () => { window.removeEventListener("keydown", tecla); document.body.style.overflow = antes; };
  }, [url, aoFechar]);

  if (!url) return null;
  return (
    <div className={`pf${tema === "admin" ? " pf-admin" : ""}`}>
      <style>{ESTILO_DO_PERFIL}</style>
      <AvisoNoTopo aviso={aviso} onFechar={fecharAviso} />
      <div className="pf-gaveta-fundo" onClick={aoFechar}>
        <aside className="pf-gaveta" role="dialog" aria-modal="true" aria-label="Perfil da loja" onClick={(e) => e.stopPropagation()}>
          <div className="pf-gaveta-topo">
            <strong>{perfil ? `Perfil · ${perfil.loja.nome}` : "Perfil da loja"}</strong>
            <button type="button" className="pf-fechar" onClick={aoFechar} aria-label="Fechar o perfil"><X size={17} aria-hidden /></button>
          </div>
          {erro ? (
            <div className="pf-perfil"><div className="pf-erro-caixa">{erro}<button type="button" className="pf-botao pequeno" onClick={aoFechar}>Fechar</button></div></div>
          ) : !perfil ? (
            <div className="pf-esqueleto" aria-busy="true" aria-label="Carregando o perfil">
              <div style={{ height: 64 }} /><div style={{ height: 76 }} />
              <div style={{ height: 90 }} /><div style={{ height: 160 }} /><div style={{ height: 320 }} />
              <span style={{ display: "flex", gap: 8, alignItems: "center", color: "var(--pf-cinza)", fontSize: "0.82rem" }}><LoaderCircle size={15} className="pf-gira" aria-hidden /> Juntando os números da loja…</span>
            </div>
          ) : (
            <VisaoDoPerfil perfil={perfil} avisar={setAviso} />
          )}
        </aside>
      </div>
    </div>
  );
}
