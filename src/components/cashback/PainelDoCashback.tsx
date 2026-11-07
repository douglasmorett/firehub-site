"use client";
/**
 * Minha loja › Fidelidade › Cashback › "Clientes e saldos".
 *
 * Douglas, 07/11/2026: "na aba cashback já conseguir ver os clientes que usam
 * e têm crédito, tudo necessário lá" — o Alan perguntou onde ver, e estava
 * espalhado em três telas. Aqui: quanto a loja deve, o que vence, o gerado e o
 * usado no período, se quem usa compra mais, e a lista com o extrato e o
 * botão de chamar o cliente no WhatsApp (link wa.me com texto pronto — quem
 * envia é o lojista, nunca disparo automático).
 *
 * Os números vêm de /api/store/clientes/cashback/painel (lib/painel-do-cashback.ts):
 * o saldo é o mesmo do cardápio e da aba Clientes. Dar ou tirar saldo continua
 * na ficha da aba Clientes — o botão do extrato leva até lá.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, ExternalLink, MessageCircle, Search, X } from "lucide-react";
import { ATALHOS, hojeNaLoja, periodoDoAtalho, type AtalhoDePeriodo } from "@/lib/relatorios/base";
import { FUSO_PADRAO } from "@/lib/fuso";
import { haQuanto } from "@/lib/clientes-da-loja-regras";
import { linkDoWhatsAppComTexto, mensagemDoCashback, type ComparativoDoCashback, type ResumoDoPainel } from "@/lib/painel-do-cashback";

type Cliente = {
  telefone: string;
  nome: string | null;
  pedidos: number;
  ultimo: string | null;
  saldo: number;
  aReceber: number;
  proximoVencimento: { valor: number; em: string } | null;
  gerado: number;
  usado: number;
  vencido: number;
  geradoNoPeriodo: number;
  usadoNoPeriodo: number;
  vencidoNoPeriodo: number;
  vence7: number;
  vence30: number;
};

type Painel = {
  periodo: { de: string; ate: string };
  hoje: string;
  fuso?: string;
  regra: { ativo: boolean; taxa: number; validadeDias: number; maxResgatePct: number };
  loja: { nome: string; link: string };
  resumo: ResumoDoPainel;
  comparativo: ComparativoDoCashback;
  clientes: Cliente[];
};

type Movimento = {
  em: string;
  tipo: "ganho" | "uso" | "credito_manual" | "debito_manual" | "vencido" | "indicacao";
  valor: number;
  saldoDepois: number;
  pedidoNumero?: number | null;
  motivo?: string | null;
  criadoPor?: string | null;
};

type Filtro = "com_saldo" | "vence7" | "vence30" | "usaram" | "todos";
type Ordem = "saldo" | "vence" | "gerado" | "usado" | "recente" | "pedidos" | "nome";

const ROTULO_DO_FILTRO: Record<Filtro, string> = {
  com_saldo: "Com saldo",
  vence7: "Vence em 7 dias",
  vence30: "Vence em 30 dias",
  usaram: "Usaram no período",
  todos: "Todos",
};
const ROTULO_DA_ORDEM: Record<Ordem, string> = {
  saldo: "Maior saldo",
  vence: "Vence primeiro",
  gerado: "Mais cashback gerado",
  usado: "Mais cashback usado",
  recente: "Pedido mais recente",
  pedidos: "Mais pedidos",
  nome: "Nome (A–Z)",
};
// Os mesmos rótulos do extrato da aba Clientes.
const ROTULO_DO_MOVIMENTO: Record<Movimento["tipo"], string> = {
  ganho: "Cashback do pedido",
  uso: "Usado no pedido",
  credito_manual: "Saldo lançado pela loja",
  debito_manual: "Saldo tirado pela loja",
  vencido: "Venceu",
  indicacao: "Indicação — pedido do amigo",
};

const POR_VEZ = 100;
const corDoTexto = "#0F172A";
const corSuave = "#64748B";
const borda = "1.5px solid #E2E8F0";
const verde = "#047857";

const fmt = (v: number) => (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const data = (iso: string | null | undefined, fuso: string) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: fuso }) : "—");
const dataHora = (iso: string, fuso: string) =>
  new Date(iso).toLocaleString("pt-BR", { timeZone: fuso, day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
function telefoneBonito(t: string): string {
  const d = String(t || "").replace(/\D/g, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return t;
}
const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const botao = (cor: string, fundo: string, extra: React.CSSProperties = {}): React.CSSProperties => ({
  padding: "8px 12px", borderRadius: 10, border: "none", background: fundo, color: cor, fontWeight: 700,
  fontSize: "0.8rem", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, textDecoration: "none",
  fontFamily: "inherit", whiteSpace: "nowrap", ...extra,
});

// ── Aviso que desce do topo (no lugar do alert()) — cópia local, como na aba
// Clientes: o components/AvisoNoTopo.tsx ainda não é compartilhado.
type Aviso = { tipo: "ok" | "erro"; titulo: string; detalhe?: string };
function AvisoNoTopo({ aviso, onFechar }: { aviso: Aviso | null; onFechar: () => void }) {
  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(onFechar, aviso.tipo === "erro" ? 12000 : 6000);
    return () => clearTimeout(t);
  }, [aviso, onFechar]);
  if (!aviso) return null;
  const cor = aviso.tipo === "erro" ? "#DC2626" : "#059669";
  return (
    <div
      role={aviso.tipo === "erro" ? "alert" : "status"}
      onClick={onFechar}
      style={{
        position: "fixed", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 1100,
        width: "min(440px, calc(100vw - 24px))", background: aviso.tipo === "erro" ? "#FEF2F2" : "#ECFDF5", borderLeft: `4px solid ${cor}`,
        borderRadius: 12, padding: "12px 14px", boxShadow: "0 10px 30px rgba(15,23,42,.18)", cursor: "pointer",
      }}
    >
      <div style={{ fontWeight: 800, fontSize: 14, color: corDoTexto }}>{aviso.titulo}</div>
      {aviso.detalhe && <div style={{ fontSize: 13, color: "#475569", marginTop: 2 }}>{aviso.detalhe}</div>}
    </div>
  );
}

export default function PainelDoCashback({ onConfigurar }: { onConfigurar?: () => void }) {
  const [atalho, setAtalho] = useState<AtalhoDePeriodo>("30d");
  // "Hoje" no dia operacional da loja: começa pelo fuso padrão e acerta pelo da resposta.
  const [hoje, setHoje] = useState(() => hojeNaLoja(FUSO_PADRAO));
  const [painel, setPainel] = useState<Painel | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("com_saldo");
  const [ordem, setOrdem] = useState<Ordem>("saldo");
  const [quantos, setQuantos] = useState(POR_VEZ);
  const [aberto, setAberto] = useState<Cliente | null>(null);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const fecharAviso = useCallback(() => setAviso(null), []);
  const pedidoAtual = useRef(0);

  const periodo = useMemo(() => periodoDoAtalho(atalho, hoje), [atalho, hoje]);
  const consulta = `de=${periodo.de}&ate=${periodo.ate}`;

  useEffect(() => {
    const meu = ++pedidoAtual.current;
    setCarregando(true);
    fetch(`/api/store/clientes/cashback/painel?${consulta}`, { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || "Não foi possível carregar o cashback.");
        return j as Painel;
      })
      .then((j) => {
        if (meu !== pedidoAtual.current) return;
        setPainel(j);
        if (j.hoje && j.hoje !== hoje) setHoje(j.hoje);
      })
      .catch((e) => { if (meu === pedidoAtual.current) setAviso({ tipo: "erro", titulo: "O cashback não carregou", detalhe: e?.message }); })
      .finally(() => { if (meu === pedidoAtual.current) setCarregando(false); });
  }, [consulta, hoje]);

  useEffect(() => { setQuantos(POR_VEZ); }, [busca, filtro, ordem]);

  const fuso = painel?.fuso || FUSO_PADRAO;
  const lista = useMemo(() => {
    const todos = painel?.clientes || [];
    const q = busca.trim();
    const digitos = q.replace(/\D/g, "");
    const porNome = /\p{L}/u.test(q);
    const filtrados = todos.filter((c) => {
      if (filtro === "com_saldo" && !(c.saldo > 0.004)) return false;
      if (filtro === "vence7" && !(c.vence7 > 0.004)) return false;
      if (filtro === "vence30" && !(c.vence30 > 0.004)) return false;
      if (filtro === "usaram" && !(c.usadoNoPeriodo > 0.004)) return false;
      if (q && porNome) return semAcento(c.nome || "").includes(semAcento(q));
      if (q && digitos.length >= 3) return String(c.telefone).replace(/\D/g, "").includes(digitos);
      return true;
    });
    const nome = (c: Cliente) => semAcento(c.nome || "~");
    const vence = (c: Cliente) => (c.proximoVencimento ? Date.parse(c.proximoVencimento.em) : Infinity);
    const cmp: Record<Ordem, (a: Cliente, b: Cliente) => number> = {
      saldo: (a, b) => b.saldo - a.saldo,
      vence: (a, b) => vence(a) - vence(b) || b.saldo - a.saldo,
      gerado: (a, b) => b.gerado - a.gerado,
      usado: (a, b) => b.usado - a.usado,
      recente: (a, b) => (b.ultimo || "").localeCompare(a.ultimo || ""),
      pedidos: (a, b) => b.pedidos - a.pedidos,
      nome: (a, b) => nome(a).localeCompare(nome(b)),
    };
    return [...filtrados].sort(cmp[ordem]);
  }, [painel, busca, filtro, ordem]);

  const mensagem = (c: Cliente) =>
    mensagemDoCashback({ nome: c.nome, saldo: c.saldo, loja: painel?.loja.nome || "", proximoVencimento: c.proximoVencimento, fuso, link: painel?.loja.link });
  const whats = (c: Cliente) => (c.saldo > 0.004 ? linkDoWhatsAppComTexto(c.telefone, mensagem(c)) : null);

  const r = painel?.resumo;
  const comp = painel?.comparativo;
  const regra = painel?.regra;
  const comValidade = (regra?.validadeDias || 0) > 0;

  return (
    <div style={{ color: corDoTexto }}>
      <style>{`
        .cb-tabela { width: 100%; border-collapse: collapse; }
        .cb-tabela th { text-align: left; font-size: .7rem; text-transform: uppercase; letter-spacing: .03em; color: ${corSuave}; font-weight: 700; padding: 9px 10px; border-bottom: ${borda}; white-space: nowrap; }
        .cb-tabela td { padding: 10px; border-bottom: 1px solid #F1F5F9; font-size: .84rem; vertical-align: middle; }
        .cb-tabela tbody tr:hover { background: #F8FAFC; }
        .cb-num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
        .cb-cards { display: none; }
        @media (max-width: 760px) { .cb-tabela { display: none; } .cb-cards { display: grid; gap: 10px; } }
      `}</style>
      <AvisoNoTopo aviso={aviso} onFechar={fecharAviso} />

      {regra && !regra.ativo && (
        <div style={{ background: "#FFFBEB", border: "1.5px solid #FDE68A", borderRadius: 12, padding: "10px 14px", marginBottom: 14, fontSize: "0.82rem", color: "#92400E" }}>
          O cashback está <b>desligado</b>: nenhum pedido novo gera nem usa saldo. O saldo que os clientes já têm continua aqui.
          {onConfigurar && <> <button type="button" onClick={onConfigurar} style={{ ...botao("#92400E", "transparent", { padding: 0, textDecoration: "underline" }) }}>Ligar em Configuração</button></>}
        </div>
      )}

      {/* Período: os atalhos dos relatórios, no dia operacional da loja. */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14, alignItems: "center" }}>
        <span style={{ fontSize: "0.78rem", fontWeight: 700, color: corSuave, marginRight: 4 }}>Período:</span>
        {ATALHOS.filter((a) => a.chave !== "hoje" && a.chave !== "ontem").map((a) => (
          <button
            key={a.chave}
            type="button"
            onClick={() => setAtalho(a.chave)}
            style={botao(atalho === a.chave ? "#fff" : "#334155", atalho === a.chave ? "#334155" : "#F1F5F9", { padding: "6px 11px" })}
          >
            {a.rotulo}
          </button>
        ))}
        {carregando && <span style={{ fontSize: "0.76rem", color: corSuave }}>carregando…</span>}
      </div>

      {/* Resumo */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10, marginBottom: 16 }}>
        <Cartao titulo="Saldo em aberto" valor={r ? fmt(r.saldoEmAberto) : "—"} destaque
          detalhe={r ? `o que a loja deve a ${r.clientesComSaldo} cliente${r.clientesComSaldo === 1 ? "" : "s"}${r.aReceber > 0 ? ` · + ${fmt(r.aReceber)} a receber` : ""}` : undefined} />
        <Cartao titulo="Gerado no período" valor={r ? fmt(r.geradoNoPeriodo) : "—"} detalhe="entrou no saldo (pedido entregue, lançamento, indicação)" />
        <Cartao titulo="Usado no período" valor={r ? fmt(r.usadoNoPeriodo) : "—"}
          detalhe={r && r.vencidoNoPeriodo > 0 ? `e ${fmt(r.vencidoNoPeriodo)} venceram sem uso` : "abatido nos pedidos"} />
        {comValidade ? (
          <Cartao titulo="Vence em 7 dias" valor={r ? fmt(r.vence7) : "—"} alerta={!!r && r.vence7 > 0}
            onClick={r && r.clientesQueVencem7 ? () => { setFiltro("vence7"); setOrdem("vence"); } : undefined}
            detalhe={r ? `${r.clientesQueVencem7} cliente${r.clientesQueVencem7 === 1 ? "" : "s"} · 30 dias: ${fmt(r.vence30)}` : undefined} />
        ) : (
          <Cartao titulo="Validade" valor="Não vence" detalhe="a loja não definiu validade para o saldo" />
        )}
        <Cartao titulo="Vendas de quem usa" valor={comp ? `${comp.participacao.toLocaleString("pt-BR")}%` : "—"}
          detalhe={comp ? `${fmt(comp.usaram.valor)} de ${fmt(comp.valorDaLoja)} vendidos no período` : undefined} />
      </div>

      {comp && <Comparativo c={comp} />}

      {/* Lista */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", margin: "18px 0 10px" }}>
        <div style={{ position: "relative", flex: "1 1 220px" }}>
          <Search size={16} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: corSuave }} />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome ou telefone"
            style={{ width: "100%", padding: "9px 12px 9px 32px", borderRadius: 10, border: borda, fontSize: "0.86rem", outline: "none", boxSizing: "border-box", fontFamily: "inherit" }}
          />
        </div>
        <select value={ordem} onChange={(e) => setOrdem(e.target.value as Ordem)} style={{ padding: "9px 10px", borderRadius: 10, border: borda, fontSize: "0.84rem", fontFamily: "inherit", background: "#fff" }}>
          {(Object.keys(ROTULO_DA_ORDEM) as Ordem[]).map((o) => <option key={o} value={o}>{ROTULO_DA_ORDEM[o]}</option>)}
        </select>
        <a href={`/api/store/clientes/cashback/painel?${consulta}&formato=csv`} style={botao("#fff", "#15803D")}>
          <Download size={15} /> Excel
        </a>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
        {(Object.keys(ROTULO_DO_FILTRO) as Filtro[])
          .filter((f) => comValidade || (f !== "vence7" && f !== "vence30"))
          .map((f) => (
            <button key={f} type="button" onClick={() => setFiltro(f)}
              style={botao(filtro === f ? "#fff" : "#334155", filtro === f ? "#0F766E" : "#F1F5F9", { padding: "6px 11px" })}>
              {ROTULO_DO_FILTRO[f]}
            </button>
          ))}
        <span style={{ fontSize: "0.78rem", color: corSuave, alignSelf: "center" }}>{lista.length} cliente{lista.length === 1 ? "" : "s"}</span>
      </div>

      {painel && lista.length === 0 && (
        <div style={{ textAlign: "center", padding: 28, color: corSuave, fontSize: "0.86rem", background: "#F8FAFC", borderRadius: 12 }}>
          {painel.clientes.length === 0 ? "Nenhum cliente ganhou ou usou cashback ainda." : "Nenhum cliente neste filtro."}
        </div>
      )}

      {lista.length > 0 && (
        <>
          <table className="cb-tabela">
            <thead>
              <tr>
                <th>Cliente</th>
                <th className="cb-num">Saldo</th>
                {comValidade && <th>Vence</th>}
                <th className="cb-num">Gerado</th>
                <th className="cb-num">Usado</th>
                <th className="cb-num">Pedidos</th>
                <th>Último pedido</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {lista.slice(0, quantos).map((c) => {
                const w = whats(c);
                return (
                  <tr key={c.telefone}>
                    <td>
                      <div style={{ fontWeight: 700 }}>{c.nome || "Sem nome"}</div>
                      <div style={{ fontSize: "0.76rem", color: corSuave }}>{telefoneBonito(c.telefone)}</div>
                    </td>
                    <td className="cb-num" style={{ fontWeight: 800, color: c.saldo > 0 ? verde : corSuave }}>{fmt(c.saldo)}</td>
                    {comValidade && (
                      <td style={{ whiteSpace: "nowrap", fontSize: "0.8rem", color: c.vence7 > 0 ? "#B45309" : corDoTexto }}>
                        {c.proximoVencimento ? <>{data(c.proximoVencimento.em, fuso)}<div style={{ fontSize: "0.72rem", color: corSuave }}>{fmt(c.proximoVencimento.valor)}</div></> : "—"}
                      </td>
                    )}
                    <td className="cb-num">{fmt(c.gerado)}{c.geradoNoPeriodo > 0 && <div style={{ fontSize: "0.72rem", color: corSuave }}>{fmt(c.geradoNoPeriodo)} no período</div>}</td>
                    <td className="cb-num">{fmt(c.usado)}{c.usadoNoPeriodo > 0 && <div style={{ fontSize: "0.72rem", color: corSuave }}>{fmt(c.usadoNoPeriodo)} no período</div>}</td>
                    <td className="cb-num">{c.pedidos}</td>
                    <td style={{ fontSize: "0.8rem", whiteSpace: "nowrap" }}>{data(c.ultimo, fuso)}<div style={{ fontSize: "0.72rem", color: corSuave }}>{haQuanto(c.ultimo, new Date(), fuso)}</div></td>
                    <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                      <span style={{ display: "inline-flex", gap: 6 }}>
                        {w && <a href={w} target="_blank" rel="noopener noreferrer" title="Abre o WhatsApp com a mensagem pronta" style={botao("#fff", "#16A34A", { padding: "6px 10px" })}><MessageCircle size={14} /> Avisar</a>}
                        <button type="button" onClick={() => setAberto(c)} style={botao("#334155", "#F1F5F9", { padding: "6px 10px" })}>Extrato</button>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="cb-cards">
            {lista.slice(0, quantos).map((c) => {
              const w = whats(c);
              return (
                <div key={c.telefone} style={{ background: "#fff", border: borda, borderRadius: 12, padding: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700 }}>{c.nome || "Sem nome"}</div>
                      <div style={{ fontSize: "0.76rem", color: corSuave }}>{telefoneBonito(c.telefone)} · {c.pedidos} pedido{c.pedidos === 1 ? "" : "s"} · {haQuanto(c.ultimo, new Date(), fuso)}</div>
                    </div>
                    <div style={{ fontWeight: 900, color: c.saldo > 0 ? verde : corSuave, whiteSpace: "nowrap" }}>{fmt(c.saldo)}</div>
                  </div>
                  <div style={{ fontSize: "0.76rem", color: corSuave, marginTop: 6 }}>
                    Gerado {fmt(c.gerado)} · Usado {fmt(c.usado)}
                    {comValidade && c.proximoVencimento && <> · <span style={{ color: c.vence7 > 0 ? "#B45309" : corSuave }}>{fmt(c.proximoVencimento.valor)} vence {data(c.proximoVencimento.em, fuso)}</span></>}
                  </div>
                  <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                    {w && <a href={w} target="_blank" rel="noopener noreferrer" style={botao("#fff", "#16A34A", { padding: "6px 10px" })}><MessageCircle size={14} /> Avisar no WhatsApp</a>}
                    <button type="button" onClick={() => setAberto(c)} style={botao("#334155", "#F1F5F9", { padding: "6px 10px" })}>Extrato</button>
                  </div>
                </div>
              );
            })}
          </div>

          {lista.length > quantos && (
            <div style={{ textAlign: "center", marginTop: 12 }}>
              <button type="button" onClick={() => setQuantos((q) => q + POR_VEZ)} style={botao("#334155", "#F1F5F9")}>
                Mostrar mais ({lista.length - quantos} restantes)
              </button>
            </div>
          )}
        </>
      )}

      {aberto && (
        <Extrato
          c={aberto}
          fuso={fuso}
          comValidade={comValidade}
          whats={whats(aberto)}
          mensagem={aberto.saldo > 0.004 ? mensagem(aberto) : null}
          onFechar={() => setAberto(null)}
          avisar={setAviso}
        />
      )}
    </div>
  );
}

function Cartao({ titulo, valor, detalhe, destaque, alerta, onClick }: { titulo: string; valor: string; detalhe?: string; destaque?: boolean; alerta?: boolean; onClick?: () => void }) {
  const cor = destaque ? verde : alerta ? "#B45309" : corDoTexto;
  return (
    <div
      onClick={onClick}
      title={onClick ? "Ver na lista" : undefined}
      style={{
        background: destaque ? "linear-gradient(135deg, #ECFDF5, #F0FDFA)" : alerta ? "#FFFBEB" : "#fff",
        border: `1.5px solid ${destaque ? "#A7F3D0" : alerta ? "#FDE68A" : "#E2E8F0"}`, borderRadius: 14, padding: 12,
        cursor: onClick ? "pointer" : "default",
      }}
    >
      <div style={{ fontSize: "0.7rem", fontWeight: 700, color: destaque || alerta ? cor : corSuave, textTransform: "uppercase" }}>{titulo}</div>
      <div style={{ fontSize: "1.35rem", fontWeight: 900, color: cor, marginTop: 4 }}>{valor}</div>
      {detalhe && <div style={{ fontSize: "0.72rem", color: destaque || alerta ? cor : corSuave, marginTop: 2, lineHeight: 1.4 }}>{detalhe}</div>}
    </div>
  );
}

/** Quem usou cashback no período × quem pediu e não usou — ticket médio e frequência pela régua da venda. */
function Comparativo({ c }: { c: ComparativoDoCashback }) {
  const u = c.usaram, n = c.naoUsaram;
  // A frase só aparece com os dois grupos presentes: sem um deles, não há com o que comparar.
  const diferenca = (a: number, b: number) => (b > 0 ? Math.round(((a - b) / b) * 100) : null);
  const ticket = diferenca(u.ticketMedio, n.ticketMedio);
  const freq = diferenca(u.frequencia, n.frequencia);
  const frase = (rotulo: string, d: number | null) =>
    d === null ? null : d === 0 ? `${rotulo} igual` : `${rotulo} ${Math.abs(d)}% ${d > 0 ? "maior" : "menor"}`;
  const resumo = u.clientes > 0 && n.clientes > 0 ? [frase("ticket médio", ticket), frase("frequência", freq)].filter(Boolean).join(" e ") : null;
  const linha = (rot: string, a: string, b: string) => (
    <tr>
      <td style={{ padding: "7px 10px", fontSize: "0.82rem", color: corSuave }}>{rot}</td>
      <td style={{ padding: "7px 10px", fontSize: "0.88rem", fontWeight: 800, textAlign: "right", color: verde }}>{a}</td>
      <td style={{ padding: "7px 10px", fontSize: "0.88rem", fontWeight: 700, textAlign: "right" }}>{b}</td>
    </tr>
  );
  return (
    <div style={{ background: "#fff", border: borda, borderRadius: 14, padding: 14 }}>
      <div style={{ fontWeight: 800, fontSize: "0.92rem" }}>Quem usa cashback compra mais?</div>
      <div style={{ fontSize: "0.76rem", color: corSuave, marginTop: 2 }}>
        No período, clientes que usaram saldo em pelo menos um pedido × clientes que pediram e não usaram (identificados pelo telefone; mesa e iFood ficam fora).
      </div>
      {resumo && (
        <div style={{ marginTop: 8, fontSize: "0.84rem", fontWeight: 700, color: verde }}>
          Quem usa cashback: {resumo}.
        </div>
      )}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8, minWidth: 320 }}>
          <thead>
            <tr>
              <th></th>
              <th style={{ textAlign: "right", fontSize: "0.7rem", textTransform: "uppercase", color: verde, padding: "4px 10px" }}>Usaram</th>
              <th style={{ textAlign: "right", fontSize: "0.7rem", textTransform: "uppercase", color: corSuave, padding: "4px 10px" }}>Não usaram</th>
            </tr>
          </thead>
          <tbody>
            {linha("Clientes", String(u.clientes), String(n.clientes))}
            {linha("Ticket médio", fmt(u.ticketMedio), fmt(n.ticketMedio))}
            {linha("Pedidos por cliente", u.frequencia.toLocaleString("pt-BR"), n.frequencia.toLocaleString("pt-BR"))}
            {linha("Vendido", fmt(u.valor), fmt(n.valor))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Extrato({ c, fuso, comValidade, whats, mensagem, onFechar, avisar }: {
  c: Cliente; fuso: string; comValidade: boolean; whats: string | null; mensagem: string | null; onFechar: () => void; avisar: (a: Aviso) => void;
}) {
  const [movimentos, setMovimentos] = useState<Movimento[] | null>(null);
  useEffect(() => {
    let vivo = true;
    // O extrato é o da ficha da aba Clientes — a mesma conta, sem rota nova.
    fetch(`/api/store/clientes/detalhe?telefone=${encodeURIComponent(c.telefone)}`, { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || "Não foi possível abrir o extrato.");
        if (vivo) setMovimentos(j.cashback?.movimentos || []);
      })
      .catch((e) => { if (vivo) { setMovimentos([]); avisar({ tipo: "erro", titulo: "Extrato não carregou", detalhe: e?.message }); } });
    return () => { vivo = false; };
  }, [c.telefone, avisar]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onFechar(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onFechar]);

  const copiar = async () => {
    if (!mensagem) return;
    try { await navigator.clipboard.writeText(mensagem); avisar({ tipo: "ok", titulo: "Mensagem copiada" }); }
    catch { avisar({ tipo: "erro", titulo: "Não deu para copiar", detalhe: "Use o botão do WhatsApp." }); }
  };

  return (
    <div onClick={onFechar} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", zIndex: 1000, display: "flex", justifyContent: "flex-end" }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true"
        style={{ width: "min(520px, 100vw)", height: "100%", background: "#F8FAFC", overflowY: "auto", boxShadow: "-10px 0 30px rgba(15,23,42,.18)" }}>
        <div style={{ position: "sticky", top: 0, background: "#fff", borderBottom: borda, padding: "14px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: "1.02rem" }}>{c.nome || "Sem nome"}</div>
            <div style={{ fontSize: "0.78rem", color: corSuave }}>{telefoneBonito(c.telefone)}</div>
          </div>
          <button type="button" onClick={onFechar} aria-label="Fechar" style={botao(corSuave, "#F1F5F9", { padding: 8 })}><X size={18} /></button>
        </div>
        <div style={{ padding: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
            <Cartao titulo="Saldo" valor={fmt(c.saldo)} destaque />
            <Cartao titulo="Gerado" valor={fmt(c.gerado)} />
            <Cartao titulo="Usado" valor={fmt(c.usado)} />
          </div>
          {(c.aReceber > 0 || (comValidade && c.proximoVencimento) || c.vencido > 0) && (
            <div style={{ fontSize: "0.8rem", color: corSuave, marginTop: 8, lineHeight: 1.6 }}>
              {comValidade && c.proximoVencimento && <div><b style={{ color: "#B45309" }}>{fmt(c.proximoVencimento.valor)}</b> vence em {data(c.proximoVencimento.em, fuso)}</div>}
              {c.aReceber > 0 && <div>{fmt(c.aReceber)} a receber (pedido ainda não entregue)</div>}
              {c.vencido > 0 && <div>{fmt(c.vencido)} já venceram sem uso</div>}
            </div>
          )}

          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
            {whats && <a href={whats} target="_blank" rel="noopener noreferrer" style={botao("#fff", "#16A34A")}><MessageCircle size={15} /> Avisar no WhatsApp</a>}
            {mensagem && <button type="button" onClick={copiar} style={botao("#334155", "#E2E8F0")}>Copiar mensagem</button>}
            <a href={`/store/clientes?telefone=${encodeURIComponent(c.telefone)}`} style={botao("#334155", "#E2E8F0")}>
              <ExternalLink size={14} /> Ficha completa · dar ou tirar saldo
            </a>
          </div>
          {mensagem && (
            <div style={{ marginTop: 10, background: "#fff", border: borda, borderRadius: 10, padding: "9px 12px", fontSize: "0.8rem", color: "#334155", whiteSpace: "pre-wrap" }}>
              {mensagem}
            </div>
          )}

          <div style={{ fontWeight: 800, fontSize: "0.9rem", margin: "16px 0 8px" }}>Extrato</div>
          {movimentos === null && <div style={{ fontSize: "0.82rem", color: corSuave }}>Carregando…</div>}
          {movimentos && movimentos.length === 0 && <div style={{ fontSize: "0.82rem", color: corSuave }}>Nenhuma movimentação de cashback.</div>}
          <div style={{ display: "grid", gap: 6 }}>
            {(movimentos || []).map((m, i) => (
              <div key={i} style={{ background: "#fff", border: borda, borderRadius: 10, padding: "9px 12px", display: "flex", justifyContent: "space-between", gap: 10 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: "0.84rem" }}>{ROTULO_DO_MOVIMENTO[m.tipo]}{m.pedidoNumero ? ` #${m.pedidoNumero}` : ""}</div>
                  <div style={{ fontSize: "0.74rem", color: corSuave }}>{dataHora(m.em, fuso)}{m.motivo ? ` · ${m.motivo}` : ""}{m.criadoPor ? ` · por ${m.criadoPor}` : ""}</div>
                </div>
                <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  <div style={{ fontWeight: 800, color: m.valor >= 0 ? verde : "#B91C1C" }}>{m.valor >= 0 ? "+" : "−"} {fmt(Math.abs(m.valor))}</div>
                  <div style={{ fontSize: "0.7rem", color: corSuave }}>saldo {fmt(m.saldoDepois)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
