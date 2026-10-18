"use client";

/**
 * Meu aplicativo — o painel do app próprio da loja (Play Store/App Store),
 * depois que o admin ativou o plano.
 *
 * Douglas, 17/10/2026: "Nessa aba vai ter a opção de mandar notificação push,
 * quantas pessoas estão ativas no aplicativo nesse momento, quantas pessoas ele
 * tem na base, todas as informações que ele precisa."
 *
 * Os números vêm de GET /api/store/meu-aplicativo (lib/app-da-loja/numeros.ts):
 * venda pela régua dos Relatórios, período no dia operacional da loja.
 *
 * As abas moram em ABAS: "Promoções do app" e "Clube de assinatura" entram
 * ali quando existirem — aba que não funciona não aparece.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Bell, CalendarClock, CheckCircle2, Clock, Download, Radio, Send, ShoppingBag, Smartphone, TrendingUp, Users, X } from "lucide-react";

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
        position: "fixed", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 1300,
        width: "min(440px, calc(100vw - 24px))", background: fundo, borderLeft: `4px solid ${cor}`,
        borderRadius: 12, padding: "12px 14px", boxShadow: "0 10px 30px rgba(15,23,42,.18)", cursor: "pointer",
      }}
    >
      <div style={{ fontWeight: 800, fontSize: 14, color: "#0F172A" }}>{aviso.titulo}</div>
      {aviso.detalhe && <div style={{ fontSize: 13, color: "#475569", marginTop: 2 }}>{aviso.detalhe}</div>}
    </div>
  );
}

type Publico = "todos" | "ativos30";
type Envio = {
  id: string; titulo: string; mensagem: string; caminho: string | null; produtoNome: string | null; publico: Publico;
  status: "AGENDADO" | "ENVIANDO" | "ENVIADO" | "CANCELADO" | "FALHOU";
  agendadoPara: string | null; criadoEm: string; enviadoEm: string | null;
  alvo: number; aceitos: number; errosNoEnvio: number; entregues: number; errosNaEntrega: number; removidos: number;
  motivo: string | null; quem: string | null;
};
type Dados = {
  loja: { nome: string; slug: string | null; logo: string | null };
  plano: { plataformas: string | null; rotulo: string | null; valor: number; ativoDesde: string | null };
  grupo: boolean;
  numeros: {
    base: { instalacoes: number; ativosAgora: number; ativos7: number; ativos30: number; novosNoMes: number; recebemPromocao: number; semResposta: number };
    alcance: Record<Publico, number>;
    mes: { de: string; ate: string; pedidos: number; faturamento: number; ticketMedio: number };
    porDia: { dia: string; aberturas: number; pedidos: number }[];
    temAberturas: boolean;
  };
  envios: Envio[];
  regras: { limitePorDia: number; restantesHoje: number; tituloMax: number; mensagemMax: number; ativoAgoraMin: number; publicos: Record<Publico, string> };
  produtos: { id: string; nome: string; preco: number; foto: string | null }[];
};

const reais = (v: number) => (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const inteiro = (n: number) => (n || 0).toLocaleString("pt-BR");
const dataHora = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");
const diaCurto = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
const data = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR") : "—");

const cartao: React.CSSProperties = { background: "#fff", padding: "1.1rem 1.2rem", borderRadius: 16, border: "1px solid #E2E8F0", boxShadow: "0 4px 6px -1px rgba(0,0,0,0.03)" };
const tituloDoCartao: React.CSSProperties = { margin: "0 0 4px", fontWeight: 800, fontSize: "1.02rem", color: "#0F172A", display: "flex", alignItems: "center", gap: 8 };
const sub: React.CSSProperties = { margin: "0 0 14px", fontSize: "0.82rem", color: "#64748B", lineHeight: 1.5 };
const rotulo: React.CSSProperties = { display: "block", fontSize: "0.8rem", fontWeight: 700, color: "#334155", marginBottom: 6 };
const campo: React.CSSProperties = { width: "100%", padding: "10px 12px", borderRadius: 10, border: "1.5px solid #CBD5E1", fontSize: "0.9rem", boxSizing: "border-box", outline: "none", fontFamily: "inherit", background: "#fff" };
const botao = (cor = "#0F172A", ativo = true): React.CSSProperties => ({
  padding: "11px 18px", borderRadius: 10, border: "none", background: ativo ? cor : "#E2E8F0", color: ativo ? "#fff" : "#94A3B8",
  fontWeight: 800, fontSize: "0.88rem", cursor: ativo ? "pointer" : "not-allowed", display: "inline-flex", alignItems: "center", gap: 8,
});
const botaoLeve: React.CSSProperties = { padding: "7px 12px", borderRadius: 10, border: "1px solid #CBD5E1", background: "#fff", color: "#334155", fontWeight: 700, fontSize: "0.8rem", cursor: "pointer" };

const SELO_DO_ENVIO: Record<Envio["status"], { texto: string; cor: string; fundo: string }> = {
  AGENDADO: { texto: "Agendada", cor: "#1D4ED8", fundo: "#DBEAFE" },
  ENVIANDO: { texto: "Enviando", cor: "#B45309", fundo: "#FEF3C7" },
  ENVIADO: { texto: "Enviada", cor: "#047857", fundo: "#D1FAE5" },
  CANCELADO: { texto: "Cancelada", cor: "#475569", fundo: "#F1F5F9" },
  FALHOU: { texto: "Não saiu", cor: "#B91C1C", fundo: "#FEE2E2" },
};

/** As abas da tela. Promoções exclusivas do app e Clube de assinatura entram aqui quando existirem. */
const ABAS = [
  { id: "visao", rotulo: "Visão geral", icone: TrendingUp },
  { id: "notificacoes", rotulo: "Notificações", icone: Bell },
] as const;
type IdDaAba = (typeof ABAS)[number]["id"];

export default function MeuAplicativoClient() {
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aba, setAba] = useState<IdDaAba>("visao");
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const fecharAviso = useCallback(() => setAviso(null), []);

  const carregar = useCallback(async () => {
    try {
      const r = await fetch("/api/store/meu-aplicativo", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) {
        if (j.irPara) { window.location.href = j.irPara; return; }
        throw new Error(j.error || "Erro ao carregar");
      }
      setDados(j);
      setErro(null);
    } catch (e: any) {
      setErro(e.message);
    }
  }, []);
  useEffect(() => { carregar(); }, [carregar]);
  // "Ativos agora" muda sozinho: atualiza a cada minuto com a tela aberta.
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible") carregar(); }, 60_000);
    return () => clearInterval(t);
  }, [carregar]);
  useEffect(() => {
    try { if (window.location.hash === "#notificacoes") setAba("notificacoes"); } catch {}
  }, []);

  if (erro && !dados) return <div style={{ padding: 24, color: "#B91C1C", fontWeight: 600 }}>{erro}</div>;
  if (!dados) return <div style={{ padding: 24, color: "#64748B" }}>Carregando…</div>;

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "20px 16px 60px", boxSizing: "border-box" }}>
      <style>{CSS}</style>
      <AvisoNoTopo aviso={aviso} onFechar={fecharAviso} />

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ width: 44, height: 44, borderRadius: 12, background: "#0F172A", display: "grid", placeItems: "center", flexShrink: 0 }}>
          <Smartphone size={24} color="#FACC15" />
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h1 style={{ fontSize: 24, fontWeight: 900, color: "#0F172A", margin: 0 }}>Meu aplicativo</h1>
          <div style={{ fontSize: 13, color: "#64748B" }}>
            {dados.plano.rotulo ? `${dados.plano.rotulo} · ` : ""}ativo desde {data(dados.plano.ativoDesde)}
            {dados.plano.valor ? ` · ${reais(dados.plano.valor)}/mês no boleto` : ""}
          </div>
        </div>
      </div>

      <div className="ma-abas" role="tablist">
        {ABAS.map((a) => {
          const Icone = a.icone;
          return (
            <button key={a.id} role="tab" aria-selected={aba === a.id} className={`ma-aba${aba === a.id ? " ativa" : ""}`} onClick={() => setAba(a.id)}>
              <Icone size={16} /> {a.rotulo}
            </button>
          );
        })}
      </div>

      {aba === "visao" && (
        <VisaoGeral
          dados={dados}
          irParaNotificacoes={() => {
            setAba("notificacoes");
            // O botão fica no fim da Visão geral: no celular, a aba nova abriria rolada lá embaixo.
            requestAnimationFrame(() => document.querySelector(".ma-abas")?.scrollIntoView({ block: "start", behavior: "smooth" }));
          }}
        />
      )}
      {aba === "notificacoes" && <Notificacoes dados={dados} avisar={setAviso} recarregar={carregar} />}
    </div>
  );
}

// ── VISÃO GERAL ─────────────────────────────────────────────────────────────

function Numero({ icone, rotulo, valor, detalhe, destaque }: { icone: React.ReactNode; rotulo: string; valor: string; detalhe?: string; destaque?: boolean }) {
  return (
    <div className={`ma-num${destaque ? " destaque" : ""}`}>
      <div className="ma-num-rotulo">{icone}{rotulo}</div>
      <div className="ma-num-valor">{valor}</div>
      {detalhe && <div className="ma-num-detalhe">{detalhe}</div>}
    </div>
  );
}

function VisaoGeral({ dados, irParaNotificacoes }: { dados: Dados; irParaNotificacoes: () => void }) {
  const { base, mes, porDia, temAberturas, alcance } = dados.numeros;
  return (
    <div style={{ display: "grid", gap: 16 }}>
      {!temAberturas && (
        <div className="ma-nota">
          <b>Os números de “ativos” começam quando os clientes abrirem a versão nova do app</b> — ela chega sozinha na próxima vez que
          cada cliente abrir o aplicativo. Até lá, a base mostra quem já pediu pelo app.
        </div>
      )}

      <div className="ma-grade">
        <Numero
          destaque
          icone={<span className="ma-pulso" aria-hidden />}
          rotulo="Ativos agora"
          valor={inteiro(base.ativosAgora)}
          detalhe={`com o app aberto nos últimos ${dados.regras.ativoAgoraMin} min`}
        />
        <Numero icone={<Download size={14} />} rotulo="Clientes com o app" valor={inteiro(base.instalacoes)} detalhe="aparelhos na sua base" />
        <Numero icone={<Users size={14} />} rotulo="Ativos em 7 dias" valor={inteiro(base.ativos7)} detalhe="abriram ou pediram" />
        <Numero icone={<Users size={14} />} rotulo="Ativos em 30 dias" valor={inteiro(base.ativos30)} detalhe="abriram ou pediram" />
        <Numero icone={<TrendingUp size={14} />} rotulo="Novos no mês" valor={inteiro(base.novosNoMes)} detalhe={`desde ${diaCurto(mes.de)}`} />
        <Numero icone={<Bell size={14} />} rotulo="Aceitam promoção" valor={inteiro(alcance.todos)} detalhe="recebem a notificação" />
      </div>

      <div style={cartao}>
        <h2 style={tituloDoCartao}><ShoppingBag size={18} /> Vendas pelo app — este mês</h2>
        <p style={sub}>
          De {diaCurto(mes.de)} a {diaCurto(mes.ate)}, na mesma régua dos Relatórios: sem cancelados, o dia vira às 5h.
          {dados.grupo ? " Somando todas as unidades da conta." : ""}
        </p>
        <div className="ma-grade ma-grade-3">
          <Numero icone={<ShoppingBag size={14} />} rotulo="Pedidos pelo app" valor={inteiro(mes.pedidos)} />
          <Numero icone={<TrendingUp size={14} />} rotulo="Faturamento pelo app" valor={reais(mes.faturamento)} />
          <Numero icone={<TrendingUp size={14} />} rotulo="Ticket médio do app" valor={mes.pedidos ? reais(mes.ticketMedio) : "—"} />
        </div>
      </div>

      <div className="ma-grade ma-grade-2">
        <div style={cartao}>
          <h2 style={tituloDoCartao}>Aparelhos que abriram o app</h2>
          <p style={sub}>Por dia, últimos 30 dias. Cada celular conta uma vez por dia.</p>
          <Barras dados={porDia.map((d) => ({ dia: d.dia, valor: d.aberturas }))} cor="#2563EB" media unidade={(n) => `${n} ${n === 1 ? "aparelho" : "aparelhos"}`} />
        </div>
        <div style={cartao}>
          <h2 style={tituloDoCartao}>Pedidos pelo app</h2>
          <p style={sub}>Por dia, últimos 30 dias.</p>
          <Barras dados={porDia.map((d) => ({ dia: d.dia, valor: d.pedidos }))} cor="#0F766E" unidade={(n) => `${n} ${n === 1 ? "pedido" : "pedidos"}`} />
        </div>
      </div>

      <div style={{ ...cartao, display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", justifyContent: "space-between" }}>
        <div style={{ minWidth: 0, flex: "1 1 280px" }}>
          <h2 style={tituloDoCartao}><Bell size={18} /> Avise seus clientes sem gastar nada</h2>
          <p style={{ ...sub, margin: 0 }}>
            A notificação chega no celular de quem aceitou promoções no app: hoje são <b>{inteiro(alcance.todos)}</b>.
            {base.semResposta > 0 && ` Outros ${inteiro(base.semResposta)} ainda não responderam — a pergunta aparece quando abrirem a versão nova do app.`}
          </p>
        </div>
        <button style={botao("#0F172A")} onClick={irParaNotificacoes}><Send size={16} /> Mandar notificação</button>
      </div>

      <div style={cartao}>
        <h2 style={tituloDoCartao}><CheckCircle2 size={18} /> Seu plano</h2>
        <div className="ma-plano">
          <div><span>Plano</span><b>{dados.plano.rotulo || "—"}</b></div>
          <div><span>Ativo desde</span><b>{data(dados.plano.ativoDesde)}</b></div>
          <div><span>Mensalidade</span><b>{dados.plano.valor ? `${reais(dados.plano.valor)}/mês` : "—"}</b></div>
          <div><span>Cobrança</span><b>No boleto, junto com a mensalidade do FireHub</b></div>
        </div>
      </div>
    </div>
  );
}

/** Barras de um valor por dia. Uma série, um eixo; o valor de cada dia no toque/hover. */
function Barras({ dados, cor, unidade, media }: { dados: { dia: string; valor: number }[]; cor: string; unidade: (n: number) => string; media?: boolean }) {
  const max = Math.max(1, ...dados.map((d) => d.valor));
  const total = dados.reduce((s, d) => s + d.valor, 0);
  const [foco, setFoco] = useState<number | null>(null);
  const L = 300, A = 96, passo = L / dados.length, larg = Math.max(2, passo - 2);
  const atual = foco != null ? dados[foco] : null;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#64748B", marginBottom: 6, minHeight: 18 }}>
        {/* Aparelhos por dia não somam: o mesmo celular abre em vários dias. Ali vale a média. */}
        <span>{atual ? `${diaCurto(atual.dia)}: ${unidade(atual.valor)}` : media ? `Média: ${unidade(Math.round(total / Math.max(1, dados.filter((d) => d.valor > 0).length)))} por dia` : `Total: ${unidade(total)}`}</span>
        <span>máx. {inteiro(max)}</span>
      </div>
      <svg viewBox={`0 0 ${L} ${A}`} width="100%" height={120} preserveAspectRatio="none" role="img" aria-label={`Total ${unidade(total)} em 30 dias`} onMouseLeave={() => setFoco(null)}>
        <line x1={0} x2={L} y1={A - 0.5} y2={A - 0.5} stroke="#E2E8F0" strokeWidth={1} />
        {dados.map((d, i) => {
          const h = d.valor > 0 ? Math.max(2, (d.valor / max) * (A - 6)) : 0;
          return (
            <g key={d.dia} onMouseEnter={() => setFoco(i)} onClick={() => setFoco(i)}>
              <rect x={i * passo} y={0} width={passo} height={A} fill="transparent" />
              {h > 0 && <rect x={i * passo + 1} y={A - h} width={larg} height={h} rx={1.5} fill={cor} opacity={foco == null || foco === i ? 1 : 0.45} />}
            </g>
          );
        })}
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#94A3B8", marginTop: 4 }}>
        <span>{diaCurto(dados[0]?.dia || "")}</span>
        <span>hoje</span>
      </div>
    </div>
  );
}

// ── NOTIFICAÇÕES ────────────────────────────────────────────────────────────

function proximaHoraCheia(): string {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setMinutes(0, 0, 0);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function Notificacoes({ dados, avisar, recarregar }: { dados: Dados; avisar: (a: Aviso) => void; recarregar: () => Promise<void> }) {
  const { regras, numeros } = dados;
  const [titulo, setTitulo] = useState("");
  const [mensagem, setMensagem] = useState("");
  const [link, setLink] = useState<"cardapio" | "produto" | "nenhum">("cardapio");
  const [produtoId, setProdutoId] = useState("");
  const [busca, setBusca] = useState("");
  const [publico, setPublico] = useState<Publico>("todos");
  const [quando, setQuando] = useState<"agora" | "agendar">("agora");
  const [horario, setHorario] = useState(proximaHoraCheia);
  const [confirmar, setConfirmar] = useState(false);
  const [enviando, setEnviando] = useState(false);

  const produto = dados.produtos.find((p) => p.id === produtoId) || null;
  const filtrados = useMemo(() => {
    const b = busca.trim().toLowerCase();
    return (b ? dados.produtos.filter((p) => p.nome.toLowerCase().includes(b)) : dados.produtos).slice(0, 60);
  }, [busca, dados.produtos]);

  const alcance = numeros.alcance[publico];
  const tamTitulo = [...titulo].length, tamMensagem = [...mensagem].length;
  const problema =
    !titulo.trim() ? "Escreva o título." :
    !mensagem.trim() ? "Escreva a mensagem." :
    tamTitulo > regras.tituloMax ? "Título grande demais." :
    tamMensagem > regras.mensagemMax ? "Mensagem grande demais." :
    link === "produto" && !produto ? "Escolha o produto." :
    quando === "agora" && regras.restantesHoje <= 0 ? `Você já usou as ${regras.limitePorDia} de hoje.` :
    quando === "agora" && alcance === 0 ? "Ninguém desse público aceitou promoções ainda." :
    quando === "agendar" && !horario ? "Escolha o horário." :
    null;

  const enviar = async () => {
    setEnviando(true);
    try {
      const r = await fetch("/api/store/meu-aplicativo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          titulo, mensagem, publico,
          comLink: link !== "nenhum",
          produtoId: link === "produto" ? produtoId : "",
          agendarPara: quando === "agendar" ? new Date(horario).toISOString() : undefined,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Não consegui enviar.");
      const e: Envio = j.envio;
      if (e?.status === "AGENDADO") avisar({ tipo: "ok", titulo: "Notificação agendada", detalhe: `Sai em ${dataHora(e.agendadoPara)}.` });
      else if (e?.status === "ENVIADO") avisar({ tipo: "ok", titulo: "Notificação enviada", detalhe: `${inteiro(e.aceitos)} de ${inteiro(e.alvo)} celulares receberam do serviço de notificações. A confirmação de entrega aparece no histórico em uns 15 minutos.` });
      else avisar({ tipo: "atencao", titulo: "A notificação não saiu", detalhe: e?.motivo || "Tente de novo em alguns minutos." });
      setTitulo(""); setMensagem(""); setConfirmar(false);
      await recarregar();
    } catch (err: any) {
      avisar({ tipo: "erro", titulo: "Não enviou", detalhe: err.message });
      setConfirmar(false);
    } finally {
      setEnviando(false);
    }
  };

  const cancelar = async (id: string) => {
    const r = await fetch(`/api/store/meu-aplicativo?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) avisar({ tipo: "erro", titulo: "Não cancelou", detalhe: j.error });
    else avisar({ tipo: "ok", titulo: "Agendamento cancelado", detalhe: "A vaga do dia voltou." });
    await recarregar();
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="ma-grade ma-compor">
        <div style={cartao}>
          <h2 style={tituloDoCartao}><Send size={18} /> Nova notificação</h2>
          <p style={sub}>
            Chega no celular de quem tem o app e aceitou promoções — de graça, sem WhatsApp.
            Você pode mandar <b>{regras.restantesHoje}</b> de {regras.limitePorDia} hoje.
          </p>

          <label style={rotulo} htmlFor="ma-titulo">Título <span className="ma-conta">{tamTitulo}/{regras.tituloMax}</span></label>
          <input id="ma-titulo" style={campo} value={titulo} maxLength={regras.tituloMax + 10} onChange={(e) => setTitulo(e.target.value)} placeholder="Ex.: 🍕 Pizza grande por R$ 49,90 hoje" />

          <label style={{ ...rotulo, marginTop: 12 }} htmlFor="ma-msg">Mensagem <span className="ma-conta">{tamMensagem}/{regras.mensagemMax}</span></label>
          <textarea id="ma-msg" style={{ ...campo, minHeight: 84, resize: "vertical" }} value={mensagem} maxLength={regras.mensagemMax + 20} onChange={(e) => setMensagem(e.target.value)} placeholder="Ex.: Só até as 23h. Toque e peça pelo app." />

          <span style={{ ...rotulo, marginTop: 12 }}>Ao tocar, abre</span>
          <div className="ma-opcoes">
            {([["cardapio", "O cardápio"], ["produto", "Um produto"], ["nenhum", "Só o app"]] as const).map(([v, t]) => (
              <label key={v} className={`ma-opcao${link === v ? " marcada" : ""}`}>
                <input type="radio" name="ma-link" checked={link === v} onChange={() => setLink(v)} /> {t}
              </label>
            ))}
          </div>
          {link === "produto" && (
            <div style={{ marginTop: 8 }}>
              <input style={campo} value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar produto…" aria-label="Buscar produto" />
              <div className="ma-produtos" role="radiogroup" aria-label="Produto">
                {filtrados.length === 0 && <div style={{ padding: 10, fontSize: 13, color: "#94A3B8" }}>Nenhum produto com esse nome.</div>}
                {filtrados.map((p) => (
                  <button key={p.id} type="button" role="radio" aria-checked={produtoId === p.id} className={`ma-produto${produtoId === p.id ? " marcado" : ""}`} onClick={() => setProdutoId(p.id)}>
                    {p.foto
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={p.foto} alt="" className="ma-produto-foto" />
                      : <span className="ma-produto-foto ma-produto-sem-foto"><ShoppingBag size={16} /></span>}
                    <span className="ma-produto-nome">{p.nome}</span>
                    <span className="ma-produto-preco">{reais(p.preco)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <span style={{ ...rotulo, marginTop: 12 }}>Para quem</span>
          <div className="ma-opcoes">
            {(["todos", "ativos30"] as Publico[]).map((p) => (
              <label key={p} className={`ma-opcao${publico === p ? " marcada" : ""}`}>
                <input type="radio" name="ma-publico" checked={publico === p} onChange={() => setPublico(p)} />
                {regras.publicos[p]} <b>({inteiro(numeros.alcance[p])})</b>
              </label>
            ))}
          </div>

          <span style={{ ...rotulo, marginTop: 12 }}>Quando</span>
          <div className="ma-opcoes">
            <label className={`ma-opcao${quando === "agora" ? " marcada" : ""}`}><input type="radio" name="ma-quando" checked={quando === "agora"} onChange={() => setQuando("agora")} /> Agora</label>
            <label className={`ma-opcao${quando === "agendar" ? " marcada" : ""}`}><input type="radio" name="ma-quando" checked={quando === "agendar"} onChange={() => setQuando("agendar")} /> Agendar</label>
          </div>
          {quando === "agendar" && (
            <input type="datetime-local" style={{ ...campo, marginTop: 8 }} value={horario} onChange={(e) => setHorario(e.target.value)} aria-label="Horário do envio" />
          )}

          <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 16, flexWrap: "wrap" }}>
            <button style={botao("#0F172A", !problema)} disabled={!!problema} onClick={() => setConfirmar(true)}>
              {quando === "agora" ? <Send size={16} /> : <CalendarClock size={16} />} {quando === "agora" ? "Revisar e enviar" : "Revisar e agendar"}
            </button>
            {problema && <span style={{ fontSize: 12.5, color: "#64748B" }}>{problema}</span>}
          </div>
        </div>

        <div className="ma-previa" style={{ ...cartao, display: "grid", justifyItems: "center", alignContent: "start", gap: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: "#64748B", textTransform: "uppercase", letterSpacing: ".04em" }}>Como o cliente vê</div>
          <Celular nomeDoApp={dados.loja.nome} logo={dados.loja.logo} titulo={titulo} mensagem={mensagem} />
          <div className="ma-previa-nota" style={{ fontSize: 12, color: "#94A3B8", textAlign: "center", maxWidth: 260 }}>
            O celular mostra até umas duas linhas da mensagem fechada; o resto aparece quando o cliente puxa a notificação.
          </div>
        </div>
      </div>

      <div style={cartao}>
        <h2 style={tituloDoCartao}><Clock size={18} /> Enviadas</h2>
        <p style={sub}>
          “Receberam” é quem o serviço de notificações aceitou na hora; “entregues” é a confirmação do Google/Apple, uns 15 minutos depois.
          Celular de onde o app foi desinstalado sai da base sozinho.
        </p>
        {dados.envios.length === 0 ? (
          <div style={{ color: "#94A3B8", fontSize: 14 }}>Nenhuma notificação ainda.</div>
        ) : (
          <div className="ma-lista">
            {dados.envios.map((e) => {
              const selo = SELO_DO_ENVIO[e.status];
              return (
                <div key={e.id} className="ma-envio">
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <span className="ma-selo" style={{ color: selo.cor, background: selo.fundo }}>{selo.texto}</span>
                    <span style={{ fontSize: 12.5, color: "#64748B" }}>
                      {e.status === "AGENDADO" ? `sai em ${dataHora(e.agendadoPara)}` : dataHora(e.enviadoEm || e.agendadoPara || e.criadoEm)}
                      {" · "}{dados.regras.publicos[e.publico] || e.publico}
                      {e.produtoNome ? ` · abre ${e.produtoNome}` : e.caminho ? " · abre o cardápio" : ""}
                    </span>
                    {e.status === "AGENDADO" && <button style={{ ...botaoLeve, marginLeft: "auto" }} onClick={() => cancelar(e.id)}><X size={13} style={{ verticalAlign: -2 }} /> Cancelar</button>}
                  </div>
                  <div style={{ fontWeight: 800, color: "#0F172A", marginTop: 6 }}>{e.titulo}</div>
                  <div style={{ color: "#475569", fontSize: 13.5, whiteSpace: "pre-wrap" }}>{e.mensagem}</div>
                  {(e.status === "ENVIADO" || e.status === "FALHOU") && (
                    <div className="ma-contas">
                      <span><b>{inteiro(e.alvo)}</b> no público</span>
                      <span><b>{inteiro(e.aceitos)}</b> receberam</span>
                      {e.entregues === 0 && e.errosNaEntrega === 0 && e.aceitos > 0 && e.enviadoEm && Date.now() - new Date(e.enviadoEm).getTime() < 30 * 60 * 1000
                        ? <span style={{ color: "#94A3B8" }}>confirmando a entrega…</span>
                        : <span><b>{inteiro(e.entregues)}</b> entregues</span>}
                      {e.errosNoEnvio + e.errosNaEntrega > 0 && <span><b>{inteiro(e.errosNoEnvio + e.errosNaEntrega)}</b> com erro</span>}
                      {e.removidos > 0 && <span><b>{inteiro(e.removidos)}</b> {e.removidos === 1 ? "desinstalou o app" : "desinstalaram o app"}</span>}
                    </div>
                  )}
                  {e.motivo && e.status !== "ENVIADO" && <div style={{ fontSize: 12.5, color: "#B45309", marginTop: 4 }}>{e.motivo}</div>}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="ma-nota">
        <b>Dica:</b> 1 a 2 notificações por semana, perto da hora das refeições, com uma oferta de verdade.
        Notificação demais faz o cliente desligar os avisos ou desinstalar o app — por isso o limite de {regras.limitePorDia} por dia.
      </div>

      {confirmar && (
        <div className="ma-fundo" role="dialog" aria-modal="true" aria-labelledby="ma-conf-titulo" onClick={() => !enviando && setConfirmar(false)}>
          <div className="ma-modal" onClick={(e) => e.stopPropagation()}>
            <h3 id="ma-conf-titulo" style={{ margin: "0 0 6px", fontSize: 18, fontWeight: 900, color: "#0F172A" }}>
              {quando === "agora" ? "Enviar agora?" : "Agendar a notificação?"}
            </h3>
            <p style={{ margin: "0 0 12px", color: "#475569", fontSize: 14, lineHeight: 1.5 }}>
              {quando === "agora"
                ? <>Vai para <b>{inteiro(alcance)}</b> {alcance === 1 ? "celular" : "celulares"} ({regras.publicos[publico].toLowerCase()}). Depois de enviada, não dá para apagar do celular do cliente.</>
                : <>Sai em <b>{dataHora(new Date(horario).toISOString())}</b> para {regras.publicos[publico].toLowerCase()}. Até lá você pode cancelar.</>}
            </p>
            <div style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 12, padding: 12, marginBottom: 14 }}>
              <div style={{ fontWeight: 800, color: "#0F172A" }}>{titulo}</div>
              <div style={{ color: "#475569", fontSize: 13.5, whiteSpace: "pre-wrap" }}>{mensagem}</div>
              <div style={{ color: "#94A3B8", fontSize: 12, marginTop: 6 }}>
                Ao tocar: {link === "nenhum" ? "abre o app" : link === "produto" ? `abre ${produto?.nome}` : "abre o cardápio"}
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button style={botaoLeve} disabled={enviando} onClick={() => setConfirmar(false)}>Voltar</button>
              <button style={botao("#0F172A", !enviando)} disabled={enviando} onClick={enviar}>
                <Radio size={16} /> {enviando ? "Enviando…" : quando === "agora" ? "Enviar agora" : "Agendar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** A prévia: a notificação na tela de bloqueio de um celular. */
function Celular({ nomeDoApp, logo, titulo, mensagem }: { nomeDoApp: string; logo: string | null; titulo: string; mensagem: string }) {
  const [semLogo, setSemLogo] = useState(false);
  const agora = new Date();
  return (
    <div className="ma-celular" aria-label="Prévia da notificação no celular">
      <div className="ma-tela">
        <div className="ma-hora">{agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</div>
        <div className="ma-data">{(() => { const t = agora.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" }); return t.charAt(0).toUpperCase() + t.slice(1); })()}</div>
        <div className="ma-notif">
          <div className="ma-notif-topo">
            {logo && !semLogo
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={logo} alt="" className="ma-notif-icone" onError={() => setSemLogo(true)} />
              : <span className="ma-notif-icone ma-notif-icone-vazio"><Smartphone size={11} color="#fff" /></span>}
            <span className="ma-notif-app">{nomeDoApp}</span>
            <span className="ma-notif-agora">agora</span>
          </div>
          <div className="ma-notif-titulo">{titulo.trim() || "Título da notificação"}</div>
          <div className="ma-notif-texto">{mensagem.trim() || "A mensagem aparece aqui."}</div>
        </div>
      </div>
    </div>
  );
}

const CSS = `
.ma-abas { display: flex; gap: 6px; margin: 18px 0 16px; border-bottom: 1px solid #E2E8F0; overflow-x: auto; overflow-y: hidden; scrollbar-width: none; }
.ma-aba { display: inline-flex; align-items: center; gap: 6px; padding: 10px 14px; border: none; background: none; font-weight: 800; font-size: .9rem; color: #64748B; cursor: pointer; border-bottom: 3px solid transparent; margin-bottom: -1px; white-space: nowrap; }
.ma-aba.ativa { color: #0F172A; border-bottom-color: #FACC15; }
.ma-grade { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); }
.ma-grade-3 { grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); }
.ma-grade-2 { grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px; }
.ma-compor { grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr); gap: 16px; }
@media (max-width: 820px) { .ma-compor { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 380px) { .ma-grade-2 { grid-template-columns: minmax(0, 1fr); } }
.ma-previa { align-self: start; position: sticky; top: 16px; }
.ma-produtos { margin-top: 6px; max-height: 232px; overflow-y: auto; border: 1.5px solid #CBD5E1; border-radius: 10px; padding: 4px; display: grid; gap: 2px; }
.ma-produto { display: flex; align-items: center; gap: 10px; width: 100%; padding: 6px 8px; border: 1.5px solid transparent; border-radius: 8px; background: #fff; cursor: pointer; text-align: left; font-family: inherit; }
.ma-produto:hover { background: #F8FAFC; }
.ma-produto.marcado { border-color: #0F172A; background: #F8FAFC; }
.ma-produto-foto { width: 40px; height: 40px; border-radius: 8px; object-fit: cover; flex-shrink: 0; }
.ma-produto-sem-foto { display: grid; place-items: center; background: #F1F5F9; color: #94A3B8; }
.ma-produto-nome { flex: 1; min-width: 0; font-size: .88rem; font-weight: 700; color: #0F172A; overflow-wrap: anywhere; }
.ma-produto-preco { font-size: .82rem; color: #475569; font-variant-numeric: tabular-nums; white-space: nowrap; }
.ma-num { background: #fff; border: 1px solid #E2E8F0; border-radius: 14px; padding: 12px 14px; min-width: 0; }
.ma-num.destaque { background: #0F172A; border-color: #0F172A; }
.ma-num.destaque .ma-num-rotulo, .ma-num.destaque .ma-num-detalhe { color: #CBD5E1; }
.ma-num.destaque .ma-num-valor { color: #FACC15; }
.ma-num-rotulo { display: flex; align-items: center; gap: 6px; font-size: .78rem; font-weight: 700; color: #64748B; }
.ma-num-valor { font-size: 1.6rem; font-weight: 900; color: #0F172A; margin-top: 4px; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.ma-num-detalhe { font-size: .74rem; color: #94A3B8; margin-top: 2px; }
.ma-pulso { width: 9px; height: 9px; border-radius: 50%; background: #22C55E; box-shadow: 0 0 0 0 rgba(34,197,94,.6); animation: ma-pulso 1.8s infinite; }
@keyframes ma-pulso { 0% { box-shadow: 0 0 0 0 rgba(34,197,94,.55); } 70% { box-shadow: 0 0 0 8px rgba(34,197,94,0); } 100% { box-shadow: 0 0 0 0 rgba(34,197,94,0); } }
@media (prefers-reduced-motion: reduce) { .ma-pulso { animation: none; } }
.ma-nota { background: #FFFBEB; border: 1px solid #FDE68A; color: #78350F; border-radius: 12px; padding: 12px 14px; font-size: .86rem; line-height: 1.5; }
.ma-plano { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); margin-top: 8px; }
.ma-plano span { display: block; font-size: .75rem; color: #64748B; font-weight: 700; }
.ma-plano b { color: #0F172A; font-size: .92rem; }
.ma-conta { float: right; font-weight: 600; color: #94A3B8; }
.ma-opcoes { display: flex; flex-wrap: wrap; gap: 8px; }
.ma-opcao { display: inline-flex; align-items: center; gap: 6px; padding: 8px 12px; border: 1.5px solid #CBD5E1; border-radius: 10px; font-size: .84rem; color: #334155; cursor: pointer; background: #fff; }
.ma-opcao.marcada { border-color: #0F172A; background: #F8FAFC; font-weight: 700; }
.ma-opcao input { accent-color: #0F172A; margin: 0; }
.ma-lista { display: grid; gap: 10px; }
.ma-envio { border: 1px solid #E2E8F0; border-radius: 12px; padding: 12px; min-width: 0; }
.ma-selo { font-size: .72rem; font-weight: 800; padding: 3px 8px; border-radius: 999px; }
.ma-contas { display: flex; flex-wrap: wrap; gap: 6px 14px; margin-top: 8px; font-size: .8rem; color: #475569; }
.ma-contas b { color: #0F172A; }
.ma-fundo { position: fixed; inset: 0; background: rgba(15,23,42,.55); z-index: 1200; display: grid; place-items: center; padding: 16px; }
.ma-modal { background: #fff; border-radius: 16px; padding: 18px; width: min(460px, 100%); box-shadow: 0 20px 50px rgba(15,23,42,.3); box-sizing: border-box; }
.ma-celular { width: 250px; max-width: 100%; aspect-ratio: 9 / 18; border-radius: 34px; background: #0F172A; padding: 10px; box-sizing: border-box; box-shadow: 0 12px 30px rgba(15,23,42,.25); }
.ma-tela { height: 100%; border-radius: 26px; background: linear-gradient(160deg, #334155, #1E293B 55%, #0F172A); padding: 28px 10px 10px; box-sizing: border-box; overflow: hidden; }
.ma-hora { text-align: center; color: #fff; font-size: 44px; font-weight: 300; line-height: 1; }
.ma-data { text-align: center; color: #CBD5E1; font-size: 12px; margin: 6px 0 18px; }
.ma-notif { background: rgba(255,255,255,.92); border-radius: 16px; padding: 10px 11px; }
.ma-notif-topo { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
.ma-notif-icone { width: 18px; height: 18px; border-radius: 5px; object-fit: cover; }
.ma-notif-icone-vazio { display: grid; place-items: center; background: #0F172A; }
.ma-notif-app { font-size: 11px; font-weight: 700; color: #334155; flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-transform: uppercase; letter-spacing: .02em; }
.ma-notif-agora { font-size: 11px; color: #64748B; }
.ma-notif-titulo { font-size: 13px; font-weight: 800; color: #0F172A; overflow-wrap: anywhere; }
.ma-notif-texto { font-size: 12.5px; color: #334155; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
/* No fim de propósito: vence as regras de cima. No celular a prévia vem antes do formulário e encolhe: a loja vê o aviso enquanto escreve. */
@media (max-width: 820px) {
  .ma-previa { position: static; order: -1; }
  .ma-celular { aspect-ratio: auto; height: 290px; width: 240px; border-radius: 30px 30px 0 0; padding-bottom: 0; }
  .ma-tela { border-radius: 22px 22px 0 0; padding-top: 20px; }
  .ma-hora { font-size: 36px; }
  .ma-previa-nota { display: none; }
}
`;
