"use client";

/**
 * O PAINEL DO BILL LIGADO (/store/bill com o serviço ligado). A tela desligada
 * (a página de venda, `Oferta` em BillClient.tsx) não passa por aqui.
 *
 * Douglas, 17/10/2026: "melhorar o painel dele, deixar mais intuitivo, com mais
 * informação, registro de histórico, tudo que você achar que precisa, dar uma
 * geral no Bill assessor". Quatro abas:
 *
 * - Visão geral: o que o Bill fez hoje / 7 dias / este mês (dia de operação da
 *   loja, vira às 5h), o que ele pausou e segue pausado (com Reativar), os
 *   últimos lançamentos e a assinatura.
 * - Conversa: a mesma conversa do WhatsApp + "O que posso pedir" — o exemplo
 *   vai para a caixa de texto, sem enviar (o Bill grava de verdade).
 * - Histórico: filtros por tipo, período, canal e texto, "carregar mais" e o
 *   Desfazer — só no lançamento mais novo, a regra do "desfaz" do WhatsApp.
 * - Configuração: assinatura, números que falam com o Bill e o desligar.
 *
 * Os números vêm de lib/assessor/painel*.ts; a tela não conta nada de novo.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import ConversaComOBill from "@/components/bill/ConversaComOBill";
import InterruptorDoModulo from "@/components/modulos/InterruptorDoModulo";
import RostoDoBill, { type EmocaoDoBill } from "@/components/bill/RostoDoBill";
import {
  ondeVer, rotuloDoRegistro, PERIODOS_DO_RESUMO, PERIODOS_DO_HISTORICO, TIPOS_DO_REGISTRO, ROTULO_DO_REGISTRO,
  type PeriodoDoResumo, type ResumoDoBill, type TipoDoRegistro,
} from "@/lib/assessor/painel";
import {
  LayoutDashboard, MessageCircle, History, Settings, Search, Undo2, ExternalLink, Phone, Lightbulb, LoaderCircle,
  Package, Wallet, CirclePause, Store, RefreshCw, Plus, TriangleAlert, CalendarClock,
} from "lucide-react";

// ── Tipos que vêm das rotas ─────────────────────────────────────────────────

export type EstadoDoBill = { ativo: boolean; cobradoEsteMes: boolean; testeAte: string | null; emTeste: boolean; jaTestou: boolean; isento?: boolean;
  /** Desligamento marcado para a virada do mês (lib/modulo-pago.ts). */
  desligaEm?: string | null; fimDoMes?: string | null };
export type DadosDoBill = {
  estado: EstadoDoBill;
  preco: number;
  diasDeTeste: number;
  numerosDoDono: string[];
  numeroDoRobo: string | null;
  numeroPrincipal?: string | null;
  ligadoDesde?: string | null;
  aceiteAtual?: { versao: string; em: string } | null;
};
export type AvisoDoBill = { tipo: "ok" | "erro"; titulo: string; detalhe?: string };

type Linha = {
  id: string; tipo: string; resumo: string; canal: string; quem: string; criadoEm: string; dia: string;
  desfeitoEm: string | null; podeDesfazer: boolean;
};
type Pausado = { id: string; nome: string; categoria: string | null; pausadoEm: string; canal: string };
type Resumo = {
  hoje: string;
  periodo: { chave: PeriodoDoResumo; de: string; ate: string };
  resumo: ResumoDoBill;
  mensagensDoDono: number;
  pausadosAgora: Pausado[];
  ultimos: Linha[];
};
type Aba = "geral" | "conversa" | "historico" | "config";
type FiltroPedido = { tipo?: string; periodo?: string; vez: number };

// ── Formatação ──────────────────────────────────────────────────────────────

const fmtR = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fone = (d: string) => {
  const n = d.replace(/^55/, "");
  return n.length >= 10 ? `(${n.slice(0, 2)}) ${n.slice(2, n.length - 4)}-${n.slice(-4)}` : d;
};
/** A cor de cada tipo vai como variável CSS (--cor) para o estilo da etiqueta. */
const corVar = (c: string) => ({ "--cor": c }) as React.CSSProperties;
const diaCurto = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
const dataBr = (iso: string) => new Date(iso).toLocaleDateString("pt-BR");
const diaEHora = (iso: string) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const horaDe = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
function somarDias(dia: string, n: number) {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
function rotuloDoDia(dia: string, hoje: string | null) {
  if (hoje && dia === hoje) return "Hoje";
  if (hoje && dia === somarDias(hoje, -1)) return "Ontem";
  return `${SEMANA[new Date(`${dia}T12:00:00Z`).getUTCDay()]}, ${diaCurto(dia)}${hoje && dia.slice(0, 4) !== hoje.slice(0, 4) ? `/${dia.slice(0, 4)}` : ""}`;
}

const ABAS: { chave: Aba; rotulo: string; icone: typeof LayoutDashboard }[] = [
  { chave: "geral", rotulo: "Visão geral", icone: LayoutDashboard },
  { chave: "conversa", rotulo: "Conversa", icone: MessageCircle },
  { chave: "historico", rotulo: "Histórico", icone: History },
  { chave: "config", rotulo: "Configuração", icone: Settings },
];

/**
 * O que dá para pedir — só o que as ferramentas do Bill fazem de verdade
 * (lib/assessor/ferramentas.ts e cardapio.ts). `consulta` = só lê, não grava.
 */
const EXEMPLOS: { grupo: string; icone: typeof Package; cor: string; itens: { texto: string; consulta?: boolean }[] }[] = [
  {
    grupo: "Estoque", icone: Package, cor: "#2563EB",
    itens: [
      { texto: "Comprei 10 Coca lata no Atacadão, paguei 45 no Pix" },
      { texto: "Chegou 5 kg de mussarela, deu 210 reais, boleto para dia 30" },
      { texto: "Perdi 2 kg de mussarela, estragou" },
      { texto: "Quanto tem de Coca lata?", consulta: true },
      { texto: "O que está abaixo do mínimo?", consulta: true },
    ],
  },
  {
    grupo: "Financeiro", icone: Wallet, cor: "#DC2626",
    itens: [
      { texto: "Paguei o gás, 130 reais" },
      { texto: "Chegou o boleto da Enel, 412,30, vence dia 25" },
      { texto: "Paguei o boleto da Enel no Pix" },
      { texto: "O que vence essa semana?", consulta: true },
    ],
  },
  {
    grupo: "Cardápio", icone: CirclePause, cor: "#B45309",
    itens: [
      { texto: "Acabou a esfirra de frango, pausa" },
      { texto: "Volta a esfirra de frango" },
      { texto: "Quais itens estão pausados?", consulta: true },
    ],
  },
  {
    grupo: "Loja", icone: Store, cor: "#475569",
    itens: [
      { texto: "Tô sem motoboy, fecha o site" },
      { texto: "Pode abrir o site" },
      { texto: "Muda a taxa do bairro Centro para 8 reais" },
      { texto: "Quanto está a entrega de cada bairro?", consulta: true },
      { texto: "Desfaz o último lançamento" },
    ],
  },
];

const FRASE_DO_HUMOR: Partial<Record<EmocaoDoBill, string>> = {
  ouvindo: "Estou ouvindo…",
  pensando: "Resolvendo…",
  feliz: "Feito!",
  piscada: "Desfeito. Tudo certo.",
  erro: "Algo deu errado — veja o aviso no topo.",
};

// ── A tela ──────────────────────────────────────────────────────────────────

export default function PainelDoBill({ dados, setAviso, salvando, onDesligar, onContinuar }: {
  dados: DadosDoBill;
  setAviso: (a: AvisoDoBill) => void;
  salvando: boolean;
  onDesligar: () => void;
  /** Desmarca o desligamento da virada do mês. */
  onContinuar: () => void;
}) {
  const [aba, setAba] = useState<Aba>("geral");
  // Cada lançamento (conversa, desfazer, reativar) recarrega o resumo e o histórico.
  const [versao, setVersao] = useState(0);
  const mudou = useCallback(() => setVersao((v) => v + 1), []);
  // O rosto do topo: o que a conversa está fazendo, ou o resultado da última ação da tela.
  const [humorDaConversa, setHumorDaConversa] = useState<EmocaoDoBill>("normal");
  const [humorDaAcao, setHumorDaAcao] = useState<EmocaoDoBill | null>(null);
  const timerDoHumor = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sugestao, setSugestao] = useState<{ texto: string; vez: number } | null>(null);
  const [filtroPedido, setFiltroPedido] = useState<FiltroPedido | null>(null);
  const caixaDaConversa = useRef<HTMLDivElement | null>(null);

  const reagir = useCallback((h: EmocaoDoBill | null, ms = 2600) => {
    if (timerDoHumor.current) clearTimeout(timerDoHumor.current);
    setHumorDaAcao(h);
    if (h && h !== "pensando") timerDoHumor.current = setTimeout(() => setHumorDaAcao(null), ms);
  }, []);
  useEffect(() => () => { if (timerDoHumor.current) clearTimeout(timerDoHumor.current); }, []);

  // A aba fica no endereço (#historico): F5 e o "voltar" do celular não perdem o lugar.
  useEffect(() => {
    const h = window.location.hash.replace("#", "");
    if (ABAS.some((a) => a.chave === h)) setAba(h as Aba);
  }, []);
  const abrir = useCallback((a: Aba) => {
    setAba(a);
    try { window.history.replaceState(null, "", a === "geral" ? window.location.pathname + window.location.search : `#${a}`); } catch {}
  }, []);

  const usarExemplo = useCallback((texto: string) => {
    setSugestao({ texto, vez: Date.now() });
    abrir("conversa");
    setTimeout(() => caixaDaConversa.current?.scrollIntoView({ behavior: "smooth", block: "end" }), 60);
  }, [abrir]);

  const verNoHistorico = useCallback((f: Omit<FiltroPedido, "vez">) => {
    setFiltroPedido({ ...f, vez: Date.now() });
    abrir("historico");
  }, [abrir]);

  async function desfazer(l: Linha) {
    reagir("pensando");
    try {
      const r = await fetch("/api/store/assessor/registros", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ desfazer: l.id }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Não deu para desfazer.");
      setAviso({ tipo: "ok", titulo: "Desfeito", detalhe: String(j.desfeito || l.resumo) });
      reagir("piscada");
      mudou();
    } catch (e: any) {
      setAviso({ tipo: "erro", titulo: "Não desfiz", detalhe: e.message });
      reagir("erro", 4000);
      mudou();
    }
  }

  async function reativar(p: Pausado) {
    reagir("pensando");
    try {
      const r = await fetch("/api/store/assessor/cardapio", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reativar: p.id }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Não deu para reativar.");
      setAviso({ tipo: "ok", titulo: `${p.nome} voltou ao cardápio`, detalhe: "Já aparece de novo no site, no robô, no balcão, no totem e nos combos. No iFood, reative pelo app do iFood." });
      reagir("feliz");
      mudou();
    } catch (e: any) {
      setAviso({ tipo: "erro", titulo: "Não reativei", detalhe: e.message });
      reagir("erro", 4000);
    }
  }

  const { estado } = dados;
  const humor: EmocaoDoBill = humorDaAcao ?? (aba === "conversa" ? humorDaConversa : "normal");
  const selo = estado.isento ? "LIGADO · ISENTO" : estado.emTeste && estado.testeAte ? `GRÁTIS até ${dataBr(estado.testeAte)}` : "LIGADO";

  return (
    <div className="painel-bill">
      <style>{CSS_DO_PAINEL}</style>

      <header className="pb-topo">
        <RostoDoBill tamanho={60} seguirMouse emocao={humor} />
        <div className="pb-topo-texto">
          <div className="pb-topo-linha">
            <h1>Bill, seu assessor</h1>
            <span className="pb-selo">{selo}</span>
          </div>
          <p aria-live="polite">{FRASE_DO_HUMOR[humor] || "Cuido do seu estoque, do seu financeiro e do seu cardápio pelo WhatsApp. Mande áudio, texto ou a foto da nota."}</p>
        </div>
      </header>

      {dados.numerosDoDono.length === 0 && (
        <div className="pb-alerta">
          <TriangleAlert size={18} />
          <div>
            <b>Falta o seu número.</b> O Bill só atende pelo WhatsApp os números cadastrados como do dono.{" "}
            <a href="/store/minha-loja">Cadastrar em Minha Loja</a>. Enquanto isso, use a aba Conversa.
          </div>
        </div>
      )}

      <nav className="pb-abas" role="tablist" aria-label="Seções do Bill">
        {ABAS.map((a) => (
          <button key={a.chave} role="tab" aria-selected={aba === a.chave} className={aba === a.chave ? "on" : ""} onClick={() => abrir(a.chave)}>
            <a.icone size={16} /> {a.rotulo}
          </button>
        ))}
      </nav>

      {aba === "geral" && (
        <VisaoGeral dados={dados} versao={versao} onDesfazer={desfazer} onReativar={reativar}
          irParaConversa={() => abrir("conversa")} irParaConfig={() => abrir("config")} verNoHistorico={verNoHistorico} usarExemplo={usarExemplo} />
      )}

      {/* A conversa fica montada nas outras abas: o rascunho e as falas novas não se perdem. */}
      <section className="pb-conversa" style={{ display: aba === "conversa" ? undefined : "none" }}>
        <div className="pb-conversa-caixa" ref={caixaDaConversa}>
          <div className="pb-conversa-topo">
            <RostoDoBill tamanho={34} emocao={humorDaConversa} />
            <div>
              <b>Converse com o Bill</b>
              <small>A mesma conversa do WhatsApp — o que ele lança aqui vale de verdade.</small>
            </div>
          </div>
          <ConversaComOBill altura={480} aoGravar={mudou} aoMudarEstado={setHumorDaConversa} sugestao={sugestao} />
        </div>
        <OQuePossoPedir usarExemplo={usarExemplo} />
      </section>

      {aba === "historico" && <Historico versao={versao} filtroPedido={filtroPedido} onDesfazer={desfazer} />}

      {aba === "config" && <Configuracao dados={dados} salvando={salvando} onDesligar={onDesligar} onContinuar={onContinuar} />}
    </div>
  );
}

// ── Visão geral ─────────────────────────────────────────────────────────────

function VisaoGeral({ dados, versao, onDesfazer, onReativar, irParaConversa, irParaConfig, verNoHistorico, usarExemplo }: {
  dados: DadosDoBill;
  versao: number;
  onDesfazer: (l: Linha) => Promise<void>;
  onReativar: (p: Pausado) => Promise<void>;
  irParaConversa: () => void;
  irParaConfig: () => void;
  verNoHistorico: (f: { tipo?: string; periodo?: string }) => void;
  usarExemplo: (t: string) => void;
}) {
  const [periodo, setPeriodo] = useState<PeriodoDoResumo>("hoje");
  const [r, setR] = useState<Resumo | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [reativando, setReativando] = useState<string | null>(null);
  const pedido = useRef(0);

  useEffect(() => {
    const n = ++pedido.current;
    setErro(null);
    fetch(`/api/store/assessor/resumo?periodo=${periodo}`, { cache: "no-store" })
      .then(async (res) => {
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j.error || "Não consegui carregar o resumo.");
        if (n === pedido.current) setR(j);
      })
      .catch((e) => { if (n === pedido.current) setErro(e.message); });
  }, [periodo, versao]);

  const s = r?.resumo;
  const nadaNoPeriodo = s && s.lancamentos === 0 && s.desfeitos === 0 && (r?.mensagensDoDono ?? 0) === 0;
  const rotuloPeriodo = r ? (r.periodo.de === r.periodo.ate ? diaCurto(r.periodo.de) : `${diaCurto(r.periodo.de)} a ${diaCurto(r.periodo.ate)}`) : "";

  return (
    <div className="pb-grade">
      <section className="pb-card pb-largo">
        <div className="pb-card-topo">
          <div>
            <h2>O que o Bill fez</h2>
            <small>{rotuloPeriodo && <>{rotuloPeriodo} · </>}o dia da loja vira às 5h</small>
          </div>
          <div className="pb-pilulas" role="group" aria-label="Período">
            {PERIODOS_DO_RESUMO.map((p) => (
              <button key={p.chave} className={periodo === p.chave ? "on" : ""} aria-pressed={periodo === p.chave} onClick={() => setPeriodo(p.chave)}>{p.rotulo}</button>
            ))}
          </div>
        </div>

        {erro && <div className="pb-erro">{erro}</div>}
        {!r && !erro && <div className="pb-carregando"><LoaderCircle size={16} className="pb-gira" /> Carregando…</div>}

        {s && (
          <>
            <div className="pb-kpis">
              <Kpi titulo="Lançamentos" valor={String(s.lancamentos)} sub={[s.desfeitos ? `${s.desfeitos} desfeito${s.desfeitos > 1 ? "s" : ""}` : "", `${r!.mensagensDoDono} mensage${r!.mensagensDoDono === 1 ? "m" : "ns"} para o Bill`].filter(Boolean).join(" · ")} onClick={() => verNoHistorico({ periodo })} />
              <Kpi titulo="Compras" valor={fmtR(s.compras.valor)} sub={`${s.compras.qtd} compra${s.compras.qtd === 1 ? "" : "s"} no estoque`} cor="#2563EB" onClick={() => verNoHistorico({ tipo: "COMPRA", periodo })} />
              <Kpi titulo="Despesas" valor={fmtR(s.despesas.valor)} sub={`${s.despesas.qtd} despesa${s.despesas.qtd === 1 ? "" : "s"} paga${s.despesas.qtd === 1 ? "" : "s"}`} cor="#DC2626" onClick={() => verNoHistorico({ tipo: "DESPESA", periodo })} />
              <Kpi titulo="Contas a pagar anotadas" valor={fmtR(s.contasAnotadas.valor)} sub={`${s.contasAnotadas.qtd} conta${s.contasAnotadas.qtd === 1 ? "" : "s"}`} cor="#7C3AED" onClick={() => verNoHistorico({ tipo: "CONTA", periodo })} />
              <Kpi titulo="Contas pagas" valor={fmtR(s.contasPagas.valor)} sub={`${s.contasPagas.qtd} baixa${s.contasPagas.qtd === 1 ? "" : "s"}`} cor="#059669" onClick={() => verNoHistorico({ tipo: "CONTA_PAGA", periodo })} />
            </div>

            <div className="pb-tipos">
              {TIPOS_DO_REGISTRO.filter((t) => (s.porTipo[t] || 0) > 0).map((t) => {
                const n = s.porTipo[t] || 0;
                const rot = ROTULO_DO_REGISTRO[t];
                return (
                  <button key={t} className="pb-tipo" onClick={() => verNoHistorico({ tipo: t, periodo })} style={corVar(rot.cor)}>
                    <i /> {rot.texto} <b>{n}</b>
                  </button>
                );
              })}
            </div>
            <p className="pb-nota">
              Valores como estão no Estoque e no Financeiro, lançados pelo Bill no período. O que foi desfeito não entra. Toque num número para ver os lançamentos.
            </p>

            {nadaNoPeriodo && (
              <div className="pb-vazio">
                <b>Nada lançado {periodo === "hoje" ? "hoje" : "no período"}.</b> Experimente: <button className="pb-link" onClick={() => usarExemplo("Comprei 10 Coca lata no Atacadão, paguei 45 no Pix")}>“Comprei 10 Coca lata, paguei 45 no Pix”</button> — ou mande um áudio do seu WhatsApp para o número da loja.
              </div>
            )}
          </>
        )}
      </section>

      <section className="pb-card">
        <div className="pb-card-topo">
          <div>
            <h2>Pausados pelo Bill</h2>
            <small>Seguem fora do cardápio agora</small>
          </div>
        </div>
        {!r ? <div className="pb-carregando"><LoaderCircle size={16} className="pb-gira" /></div>
          : r.pausadosAgora.length === 0 ? <div className="pb-vazio-curto">Nenhum item pausado pelo Bill no momento.</div>
          : (
            <ul className="pb-pausados">
              {r.pausadosAgora.map((p) => (
                <li key={p.id}>
                  <div>
                    <b>{p.nome}</b>
                    <small>{p.categoria ? `${p.categoria} · ` : ""}pausado em {diaEHora(p.pausadoEm)} pelo {p.canal === "PAINEL" ? "painel" : "WhatsApp"}</small>
                  </div>
                  <button className="pb-botao" disabled={reativando === p.id}
                    onClick={async () => { setReativando(p.id); await onReativar(p); setReativando(null); }}>
                    {reativando === p.id ? "Reativando…" : "Reativar"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        <p className="pb-nota">Reativar aqui volta o item (e a meia pizza do sabor) no site, robô, balcão, totem e combos. O iFood tem o cardápio dele.</p>
      </section>

      <section className="pb-card">
        <div className="pb-card-topo">
          <div>
            <h2>Assinatura</h2>
            <small>{dados.estado.isento ? "Conta isenta" : `${fmtR(dados.preco)} por mês no boleto do FireHub`}</small>
          </div>
        </div>
        <StatusDaAssinatura dados={dados} />
        <button className="pb-link" onClick={irParaConfig}>Números, termo e desligar →</button>
      </section>

      <section className="pb-card pb-largo">
        <div className="pb-card-topo">
          <div>
            <h2>Últimos lançamentos</h2>
            <small>Os 5 mais novos, de qualquer dia</small>
          </div>
          <button className="pb-botao pb-botao-claro" onClick={() => verNoHistorico({})}>Ver histórico completo</button>
        </div>
        {!r ? <div className="pb-carregando"><LoaderCircle size={16} className="pb-gira" /></div>
          : r.ultimos.length === 0 ? (
            <div className="pb-vazio">
              Nada lançado ainda. Os lançamentos aparecem aqui e também em Estoque e Financeiro, como se você tivesse digitado.{" "}
              <button className="pb-link" onClick={irParaConversa}>Abrir a conversa</button>
            </div>
          ) : (
            <ul className="pb-lista">
              {r.ultimos.map((l) => <LinhaDoRegistro key={l.id} l={l} hoje={r.hoje} onDesfazer={onDesfazer} />)}
            </ul>
          )}
      </section>
    </div>
  );
}

function Kpi({ titulo, valor, sub, cor, onClick }: { titulo: string; valor: string; sub: string; cor?: string; onClick?: () => void }) {
  return (
    <button className="pb-kpi" onClick={onClick} style={cor ? corVar(cor) : undefined}>
      <span>{titulo}</span>
      <b>{valor}</b>
      <small>{sub}</small>
    </button>
  );
}

function StatusDaAssinatura({ dados }: { dados: DadosDoBill }) {
  const { estado } = dados;
  const linhas: [string, string][] = [];
  if (dados.ligadoDesde) linhas.push(["Ligado desde", dataBr(dados.ligadoDesde)]);
  if (estado.isento) {
    linhas.push(["Cobrança", "Isenta — não entra no boleto"]);
  } else {
    linhas.push(["Preço desta loja", `${fmtR(dados.preco)} por mês`]);
    if (estado.emTeste && estado.testeAte) linhas.push(["Grátis até", dataBr(estado.testeAte)]);
    else if (estado.testeAte) linhas.push(["Teste grátis", `usado (terminou ${dataBr(estado.testeAte)})`]);
    // No teste grátis o "cobradoEsteMes" é previsão (o teste acaba dentro do mês): dá para desligar antes e não pagar.
    linhas.push(["Este mês", estado.emTeste ? (estado.cobradoEsteMes ? "grátis por enquanto — se continuar ligado depois do teste, entra no boleto" : "dentro do teste grátis") : estado.cobradoEsteMes ? "já entra no boleto" : "ainda não cobrado"]);
  }
  return (
    <dl className="pb-dl">
      {linhas.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
    </dl>
  );
}

// ── Uma linha do histórico ──────────────────────────────────────────────────

function LinhaDoRegistro({ l, hoje, onDesfazer, comDia = true }: { l: Linha; hoje: string | null; onDesfazer: (l: Linha) => Promise<void>; comDia?: boolean }) {
  const [confirmando, setConfirmando] = useState(false);
  const [desfazendo, setDesfazendo] = useState(false);
  const rot = rotuloDoRegistro(l.tipo);
  const ver = ondeVer(l.tipo);
  return (
    <li className={`pb-linha${l.desfeitoEm ? " desfeita" : ""}`}>
      <span className="pb-etiqueta" style={corVar(rot.cor)}>{rot.texto}</span>
      <div className="pb-linha-corpo">
        <div className="pb-linha-resumo">{l.resumo}</div>
        <div className="pb-linha-meta">
          {comDia ? `${rotuloDoDia(l.dia, hoje)} ${horaDe(l.criadoEm)}` : horaDe(l.criadoEm)} · <span className="pb-quem">{l.quem}</span>
          {l.desfeitoEm && <> · <span className="pb-desfeito"><Undo2 size={11} /> desfeito {horaDe(l.desfeitoEm)}</span></>}
          {ver && !l.desfeitoEm && <> · <a href={ver.href}>{ver.rotulo} <ExternalLink size={11} /></a></>}
        </div>
      </div>
      {l.podeDesfazer && (
        <button className={`pb-botao pb-desfazer${confirmando ? " confirma" : ""}`} disabled={desfazendo}
          onBlur={() => setConfirmando(false)}
          onClick={async () => {
            if (!confirmando) { setConfirmando(true); return; }
            setDesfazendo(true);
            await onDesfazer(l);
            setDesfazendo(false);
            setConfirmando(false);
          }}>
          <Undo2 size={14} /> {desfazendo ? "Desfazendo…" : confirmando ? "Toque de novo" : "Desfazer"}
        </button>
      )}
    </li>
  );
}

// ── O que posso pedir ───────────────────────────────────────────────────────

function OQuePossoPedir({ usarExemplo }: { usarExemplo: (t: string) => void }) {
  return (
    <aside className="pb-card pb-exemplos">
      <div className="pb-card-topo">
        <div>
          <h2><Lightbulb size={17} /> O que posso pedir</h2>
          <small>Toque num exemplo: ele vai para a caixa de texto, você ajusta e envia.</small>
        </div>
      </div>
      {EXEMPLOS.map((g) => (
        <div key={g.grupo} className="pb-exemplo-grupo">
          <div className="pb-exemplo-titulo" style={{ color: g.cor }}><g.icone size={15} /> {g.grupo}</div>
          <div className="pb-exemplo-lista">
            {g.itens.map((e) => (
              <button key={e.texto} onClick={() => usarExemplo(e.texto)}>
                {e.texto}{e.consulta && <em>só consulta</em>}
              </button>
            ))}
          </div>
        </div>
      ))}
      <p className="pb-nota">Também vale foto da nota ou do boleto (botão da câmera) e áudio (microfone). Pelo WhatsApp é igual: do seu número para o da loja.</p>
    </aside>
  );
}

// ── Histórico ───────────────────────────────────────────────────────────────

function Historico({ versao, filtroPedido, onDesfazer }: { versao: number; filtroPedido: FiltroPedido | null; onDesfazer: (l: Linha) => Promise<void> }) {
  const [tipo, setTipo] = useState<string>(filtroPedido?.tipo || "");
  const [periodo, setPeriodo] = useState<string>(filtroPedido?.periodo || "");
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const [canal, setCanal] = useState("");
  const [comDesfeitos, setComDesfeitos] = useState(true);
  const [texto, setTexto] = useState("");
  const [busca, setBusca] = useState("");
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [proximo, setProximo] = useState<string | null>(null);
  const [hoje, setHoje] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const pedido = useRef(0);

  // Veio de um número da Visão geral: aplica o filtro dele.
  useEffect(() => {
    if (!filtroPedido) return;
    setTipo(filtroPedido.tipo || "");
    setPeriodo(filtroPedido.periodo || "");
    setCanal("");
    setTexto("");
    setBusca("");
  }, [filtroPedido]);

  // Busca enquanto digita, sem um pedido por tecla.
  useEffect(() => {
    const t = setTimeout(() => setBusca(texto.trim()), 350);
    return () => clearTimeout(t);
  }, [texto]);

  const parametros = useCallback((cursor?: string | null) => {
    const sp = new URLSearchParams();
    if (tipo) sp.set("tipo", tipo);
    if (canal) sp.set("canal", canal);
    if (periodo === "custom") { if (de) sp.set("de", de); if (ate) sp.set("ate", ate); }
    else if (periodo) sp.set("periodo", periodo);
    if (busca) sp.set("q", busca);
    if (!comDesfeitos) sp.set("desfeitos", "nao");
    if (cursor) sp.set("cursor", cursor);
    return sp.toString();
  }, [tipo, canal, periodo, de, ate, busca, comDesfeitos]);

  const carregar = useCallback(async (cursor?: string | null) => {
    const n = ++pedido.current;
    setCarregando(true);
    setErro(null);
    try {
      const r = await fetch(`/api/store/assessor/registros?${parametros(cursor)}`, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Não consegui carregar o histórico.");
      if (n !== pedido.current) return;
      setHoje(j.hoje || null);
      setLinhas((atual) => (cursor ? [...atual, ...j.registros.filter((x: Linha) => !atual.some((a) => a.id === x.id))] : j.registros));
      setProximo(j.proximo || null);
    } catch (e: any) {
      if (n === pedido.current) setErro(e.message);
    } finally {
      if (n === pedido.current) setCarregando(false);
    }
  }, [parametros]);

  useEffect(() => { carregar(null); }, [carregar, versao]);

  const temFiltro = Boolean(tipo || canal || periodo || busca || !comDesfeitos);
  // Agrupa por dia de operação da loja.
  const grupos: { dia: string; itens: Linha[] }[] = [];
  for (const l of linhas) {
    const g = grupos[grupos.length - 1];
    if (g && g.dia === l.dia) g.itens.push(l);
    else grupos.push({ dia: l.dia, itens: [l] });
  }

  return (
    <div className="pb-historico">
      <div className="pb-filtros">
        <label className="pb-busca">
          <Search size={16} />
          <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar: coca, Enel, esfirra…" aria-label="Buscar no histórico" />
        </label>
        <select value={tipo} onChange={(e) => setTipo(e.target.value)} aria-label="Tipo">
          <option value="">Todos os tipos</option>
          {TIPOS_DO_REGISTRO.map((t) => <option key={t} value={t}>{ROTULO_DO_REGISTRO[t as TipoDoRegistro].texto}</option>)}
        </select>
        <select value={periodo} onChange={(e) => setPeriodo(e.target.value)} aria-label="Período">
          {PERIODOS_DO_HISTORICO.map((p) => <option key={p.chave} value={p.chave}>{p.rotulo}</option>)}
          <option value="custom">Escolher datas…</option>
        </select>
        <select value={canal} onChange={(e) => setCanal(e.target.value)} aria-label="Por onde">
          <option value="">WhatsApp e painel</option>
          <option value="WHATSAPP">Só WhatsApp</option>
          <option value="PAINEL">Só painel</option>
        </select>
        {periodo === "custom" && (
          <div className="pb-datas">
            <label><CalendarClock size={14} /> de <input type="date" value={de} onChange={(e) => setDe(e.target.value)} /></label>
            <label>até <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} /></label>
          </div>
        )}
        <label className="pb-check">
          <input type="checkbox" checked={comDesfeitos} onChange={(e) => setComDesfeitos(e.target.checked)} /> Mostrar desfeitos
        </label>
        {temFiltro && (
          <button className="pb-link" onClick={() => { setTipo(""); setPeriodo(""); setCanal(""); setTexto(""); setBusca(""); setComDesfeitos(true); setDe(""); setAte(""); }}>
            Limpar filtros
          </button>
        )}
      </div>

      <div className="pb-regra">
        <Undo2 size={16} />
        <span>
          <b>Desfazer</b> vale para o lançamento mais novo do Bill — a mesma regra do “desfaz” no WhatsApp. Os anteriores se corrigem na tela de cada um (o link ao lado de cada linha leva até lá).
        </span>
      </div>

      {erro && <div className="pb-erro">{erro} <button className="pb-link" onClick={() => carregar(null)}><RefreshCw size={13} /> Tentar de novo</button></div>}

      {!erro && linhas.length === 0 && !carregando && (
        <div className="pb-vazio">{temFiltro ? "Nada com esses filtros." : "Nada lançado ainda. O que o Bill gravar aparece aqui."}</div>
      )}

      {grupos.map((g) => (
        <section key={g.dia} className="pb-dia">
          <h3>{rotuloDoDia(g.dia, hoje)}</h3>
          <ul className="pb-lista">
            {g.itens.map((l) => <LinhaDoRegistro key={l.id} l={l} hoje={hoje} onDesfazer={onDesfazer} comDia={false} />)}
          </ul>
        </section>
      ))}

      {carregando && <div className="pb-carregando"><LoaderCircle size={16} className="pb-gira" /> Carregando…</div>}
      {proximo && !carregando && (
        <button className="pb-botao pb-botao-claro pb-mais" onClick={() => carregar(proximo)}>Carregar mais</button>
      )}
      {!proximo && linhas.length > 0 && !carregando && <div className="pb-fim">{linhas.length} lançamento{linhas.length === 1 ? "" : "s"} · fim da lista</div>}
    </div>
  );
}

// ── Configuração ────────────────────────────────────────────────────────────

function Configuracao({ dados, salvando, onDesligar, onContinuar }: { dados: DadosDoBill; salvando: boolean; onDesligar: () => void; onContinuar: () => void }) {
  const { estado } = dados;
  const extras = dados.numerosDoDono.filter((n) => !dados.numeroPrincipal || n.slice(-10) !== dados.numeroPrincipal.slice(-10));
  return (
    <div className="pb-grade">
      <section className="pb-card">
        <div className="pb-card-topo"><div><h2><Phone size={17} /> Quem fala com o Bill</h2><small>Só estes números; cliente continua com o robô de atendimento.</small></div></div>
        <ul className="pb-numeros">
          {dados.numeroPrincipal ? (
            <li><b>{fone(dados.numeroPrincipal)}</b><small>principal · WhatsApp do proprietário</small><a href="/store/minha-loja">Trocar</a></li>
          ) : (
            <li className="falta"><b>Sem número principal</b><small>WhatsApp do proprietário em Minha Loja</small><a href="/store/minha-loja"><Plus size={13} /> Cadastrar</a></li>
          )}
          {extras.map((n) => (
            <li key={n}><b>{fone(n)}</b><small>outro número do dono</small><a href="/store/chatbot">Editar</a></li>
          ))}
        </ul>
        <a className="pb-botao pb-botao-claro" href="/store/chatbot"><Plus size={14} /> Adicionar sócio ou gerente</a>
        <p className="pb-nota">Sócio e gerente entram em Chatbot IA › aba Notificações (até 4 números além do principal). Eles também recebem os avisos da loja.</p>
      </section>

      <section className="pb-card">
        <div className="pb-card-topo"><div><h2><MessageCircle size={17} /> Para onde mandar</h2><small>O WhatsApp da loja conectado no FireHub</small></div></div>
        {dados.numeroDoRobo ? (
          <div className="pb-numero-loja">{fone(dados.numeroDoRobo)}</div>
        ) : (
          <div className="pb-vazio-curto">O WhatsApp da loja não está conectado. <a href="/store/chatbot">Conectar em Chatbot IA</a>.</div>
        )}
        <ol className="pb-passos">
          <li>Do seu WhatsApp, mande para o número da loja.</li>
          <li>Áudio, texto ou foto da nota/boleto.</li>
          <li>Errou? Mande <b>desfaz</b> — ou use o Histórico aqui.</li>
        </ol>
      </section>

      <section className="pb-card pb-largo">
        <div className="pb-card-topo"><div><h2>Assinatura</h2><small>{estado.isento ? "Conta isenta: o Bill fica sempre ligado" : "No boleto da mensalidade do FireHub"}</small></div></div>
        <StatusDaAssinatura dados={dados} />
        {dados.aceiteAtual && (
          <p className="pb-nota">Termo aceito em {dataBr(dados.aceiteAtual.em)} (versão de {dados.aceiteAtual.versao.slice(0, 10).split("-").reverse().join("/")}).</p>
        )}
        {/* O liga/desliga com a regra da cobrança escrita (components/modulos/InterruptorDoModulo). */}
        <InterruptorDoModulo nome="o Bill" preco={dados.preco} salvando={salvando}
          estado={{ ativo: estado.ativo, emTeste: estado.emTeste, testeAte: estado.testeAte, isento: Boolean(estado.isento), jaTestou: estado.jaTestou, desligaEm: estado.desligaEm ?? null, fimDoMes: estado.fimDoMes ?? null }}
          onLigar={() => {}} onDesligar={onDesligar} onContinuar={onContinuar} />
      </section>
    </div>
  );
}

// ── Estilo ──────────────────────────────────────────────────────────────────

const CSS_DO_PAINEL = `
.painel-bill { color: #0F172A; display: grid; gap: 16px; min-width: 0; }
.painel-bill * { box-sizing: border-box; }
.pb-topo { display: flex; align-items: center; gap: 14px; background: radial-gradient(120% 160% at 0% 0%, #0E7490 0%, #0B1220 60%); color: white; border-radius: 18px; padding: 14px 18px; }
.pb-topo-texto { min-width: 0; flex: 1; }
.pb-topo-linha { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.pb-topo h1 { font-size: 22px; font-weight: 900; margin: 0; letter-spacing: -.01em; }
.pb-topo p { margin: 3px 0 0; font-size: 14px; color: #CFFAFE; min-height: 1.4em; }
.pb-selo { font-size: 11.5px; font-weight: 800; color: #052E16; background: #4ADE80; padding: 3px 9px; border-radius: 999px; white-space: nowrap; }
.pb-alerta { display: flex; gap: 10px; align-items: flex-start; background: #FFFBEB; border: 1px solid #FCD34D; color: #92400E; border-radius: 12px; padding: 12px 14px; font-size: 14px; }
.pb-alerta svg { flex: none; margin-top: 1px; }
.pb-alerta a { color: #B45309; font-weight: 800; }

.pb-abas { display: flex; gap: 4px; overflow-x: auto; background: #F1F5F9; border-radius: 12px; padding: 4px; scrollbar-width: none; }
.pb-abas::-webkit-scrollbar { display: none; }
.pb-abas button { flex: 1 0 auto; display: inline-flex; align-items: center; justify-content: center; gap: 6px; border: 0; background: transparent; color: #475569; font: inherit; font-weight: 800; font-size: 14px; padding: 9px 12px; border-radius: 9px; cursor: pointer; white-space: nowrap; }
.pb-abas button.on { background: white; color: #0E7490; box-shadow: 0 1px 3px rgba(15,23,42,.12); }
.pb-abas button:focus-visible, .pb-pilulas button:focus-visible, .pb-kpi:focus-visible, .pb-exemplo-lista button:focus-visible { outline: 2px solid #0E7490; outline-offset: 2px; }

.pb-grade { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.pb-largo { grid-column: 1 / -1; }
.pb-card { background: white; border: 1px solid #E2E8F0; border-radius: 14px; padding: 16px; min-width: 0; display: flex; flex-direction: column; gap: 10px; }
.pb-card-topo { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; flex-wrap: wrap; }
.pb-card h2 { font-size: 16px; font-weight: 900; margin: 0; display: flex; align-items: center; gap: 6px; }
.pb-card-topo small { color: #64748B; font-size: 12.5px; }
.pb-pilulas { display: inline-flex; background: #F1F5F9; border-radius: 999px; padding: 3px; }
.pb-pilulas button { border: 0; background: transparent; font: inherit; font-size: 13px; font-weight: 800; color: #475569; padding: 6px 12px; border-radius: 999px; cursor: pointer; }
.pb-pilulas button.on { background: #0B1220; color: white; }

.pb-kpis { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 10px; }
.pb-kpi { --cor: #0E7490; text-align: left; font: inherit; color: inherit; background: #F8FAFC; border: 1px solid #E2E8F0; border-left: 4px solid var(--cor); border-radius: 12px; padding: 12px; display: grid; gap: 2px; cursor: pointer; transition: border-color .15s ease, background .15s ease; }
.pb-kpi:hover { background: white; border-color: #CBD5E1; border-left-color: var(--cor); }
.pb-kpi span { font-size: 12.5px; color: #475569; font-weight: 700; }
.pb-kpi b { font-size: 21px; font-weight: 900; letter-spacing: -.01em; font-variant-numeric: tabular-nums; }
.pb-kpi small { font-size: 12px; color: #64748B; }
.pb-tipos { display: flex; flex-wrap: wrap; gap: 6px; }
.pb-tipo { --cor: #475569; display: inline-flex; align-items: center; gap: 6px; border: 1px solid #E2E8F0; background: white; border-radius: 999px; padding: 5px 10px; font: inherit; font-size: 12.5px; color: #334155; cursor: pointer; }
.pb-tipo i { width: 8px; height: 8px; border-radius: 999px; background: var(--cor); display: block; }
.pb-tipo b { font-variant-numeric: tabular-nums; }
.pb-tipo:disabled { opacity: .5; cursor: default; }
.pb-nota { margin: 0; font-size: 12.5px; color: #64748B; line-height: 1.45; }
.pb-vazio { background: #F8FAFC; border: 1px dashed #CBD5E1; border-radius: 12px; padding: 14px; font-size: 14px; color: #475569; line-height: 1.5; }
.pb-vazio-curto { font-size: 14px; color: #64748B; }
.pb-vazio-curto a { color: #0E7490; font-weight: 700; }
.pb-erro { background: #FEF2F2; color: #B91C1C; border-radius: 10px; padding: 10px 12px; font-size: 14px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.pb-carregando { display: flex; gap: 8px; align-items: center; color: #64748B; font-size: 14px; padding: 6px 0; }
.pb-gira { animation: pb-gira 1s linear infinite; }
@keyframes pb-gira { to { transform: rotate(360deg); } }

.pb-link { background: none; border: 0; padding: 0; font: inherit; color: #0E7490; font-weight: 800; cursor: pointer; text-align: left; display: inline-flex; align-items: center; gap: 4px; }
.pb-botao { display: inline-flex; align-items: center; justify-content: center; gap: 6px; background: #0B1220; color: white; border: 1px solid #0B1220; border-radius: 10px; padding: 8px 12px; font: inherit; font-weight: 800; font-size: 13.5px; cursor: pointer; text-decoration: none; white-space: nowrap; }
.pb-botao:disabled { opacity: .6; cursor: wait; }
.pb-botao-claro { background: white; color: #0F172A; border-color: #CBD5E1; }
.pb-perigo { background: #DC2626; border-color: #DC2626; color: white; }

.pb-pausados { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.pb-pausados li { display: flex; align-items: center; justify-content: space-between; gap: 10px; border: 1px solid #FDE68A; background: #FFFBEB; border-radius: 10px; padding: 9px 10px; }
.pb-pausados li > div { min-width: 0; }
.pb-pausados b { display: block; font-size: 14px; overflow-wrap: anywhere; }
.pb-pausados small { font-size: 12px; color: #92400E; }

.pb-dl { margin: 0; display: grid; gap: 6px; }
.pb-dl > div { display: flex; justify-content: space-between; gap: 10px; font-size: 14px; border-bottom: 1px dashed #E2E8F0; padding-bottom: 6px; }
.pb-dl dt { color: #64748B; }
.pb-dl dd { margin: 0; font-weight: 800; text-align: right; }

.pb-lista { list-style: none; margin: 0; padding: 0; border: 1px solid #E2E8F0; border-radius: 12px; overflow: hidden; background: white; }
.pb-linha { display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border-bottom: 1px solid #F1F5F9; }
.pb-linha:last-child { border-bottom: 0; }
.pb-linha.desfeita { background: #F8FAFC; }
.pb-linha.desfeita .pb-linha-resumo { text-decoration: line-through; color: #94A3B8; }
.pb-etiqueta { --cor: #475569; font-size: 11px; font-weight: 800; color: var(--cor); background: color-mix(in srgb, var(--cor) 10%, white); padding: 3px 8px; border-radius: 999px; white-space: nowrap; flex: none; margin-top: 1px; }
.pb-linha-corpo { flex: 1; min-width: 0; }
.pb-linha-resumo { font-size: 14px; line-height: 1.4; overflow-wrap: anywhere; }
.pb-linha-meta { font-size: 12px; color: #64748B; margin-top: 2px; }
.pb-linha-meta a { color: #0E7490; font-weight: 700; text-decoration: none; display: inline-flex; align-items: center; gap: 2px; }
.pb-quem, .pb-linha-meta a, .pb-desfeito { white-space: nowrap; }
.pb-desfeito { display: inline-flex; align-items: center; gap: 3px; color: #B45309; font-weight: 700; }
.pb-desfazer { padding: 6px 10px; font-size: 12.5px; background: white; color: #B45309; border-color: #FCD34D; flex: none; }
.pb-desfazer.confirma { background: #B45309; color: white; border-color: #B45309; }

.pb-conversa { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr); gap: 14px; align-items: start; }
.pb-conversa-caixa { border: 1px solid #E2E8F0; border-radius: 14px; overflow: hidden; min-width: 0; position: sticky; top: 12px; }
.pb-conversa-topo { background: #0B1220; color: white; padding: 10px 14px; display: flex; align-items: center; gap: 10px; }
.pb-conversa-topo b { display: block; font-size: 14px; }
.pb-conversa-topo small { font-size: 12px; color: #94A3B8; }
.pb-exemplo-grupo { display: grid; gap: 6px; }
.pb-exemplo-titulo { display: flex; align-items: center; gap: 6px; font-weight: 900; font-size: 13px; }
.pb-exemplo-lista { display: flex; flex-wrap: wrap; gap: 6px; }
.pb-exemplo-lista button { text-align: left; font: inherit; font-size: 13px; color: #0F172A; background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 10px; padding: 7px 10px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; transition: border-color .15s ease, background .15s ease; }
.pb-exemplo-lista button:hover { border-color: #67E8F9; background: #ECFEFF; }
.pb-exemplo-lista em { font-style: normal; font-size: 10.5px; font-weight: 800; color: #0E7490; background: #CFFAFE; border-radius: 999px; padding: 1px 6px; white-space: nowrap; }

.pb-historico { display: grid; gap: 12px; }
.pb-filtros { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.pb-filtros select, .pb-busca, .pb-datas input { font: inherit; font-size: 14px; border: 1px solid #CBD5E1; border-radius: 10px; background: white; color: #0F172A; padding: 8px 10px; min-height: 40px; }
.pb-busca { display: flex; align-items: center; gap: 6px; flex: 1 1 220px; min-width: 0; color: #64748B; }
.pb-busca input { border: 0; outline: 0; font: inherit; flex: 1; min-width: 0; color: #0F172A; background: transparent; }
.pb-datas { display: flex; gap: 8px; flex-wrap: wrap; font-size: 13px; color: #475569; }
.pb-datas label { display: inline-flex; align-items: center; gap: 6px; }
.pb-check { display: inline-flex; align-items: center; gap: 6px; font-size: 13.5px; color: #475569; cursor: pointer; }
.pb-regra { display: flex; gap: 8px; align-items: flex-start; background: #FFFBEB; border: 1px solid #FDE68A; color: #78350F; border-radius: 10px; padding: 10px 12px; font-size: 13px; line-height: 1.45; }
.pb-regra svg { flex: none; margin-top: 1px; }
.pb-dia h3 { font-size: 13px; font-weight: 900; color: #475569; margin: 0 0 6px; text-transform: capitalize; }
.pb-mais { justify-self: center; }
.pb-fim { text-align: center; font-size: 12.5px; color: #94A3B8; }

.pb-numeros { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.pb-numeros li { display: grid; grid-template-columns: 1fr auto; column-gap: 10px; align-items: center; border: 1px solid #E2E8F0; border-radius: 10px; padding: 8px 10px; }
.pb-numeros li.falta { border-color: #FCD34D; background: #FFFBEB; }
.pb-numeros b { font-size: 14.5px; font-variant-numeric: tabular-nums; }
.pb-numeros small { grid-column: 1; font-size: 12px; color: #64748B; }
.pb-numeros a { grid-column: 2; grid-row: 1 / span 2; color: #0E7490; font-weight: 800; font-size: 13px; text-decoration: none; display: inline-flex; align-items: center; gap: 3px; }
.pb-numero-loja { font-size: 22px; font-weight: 900; font-variant-numeric: tabular-nums; }
.pb-passos { margin: 0; padding-left: 20px; display: grid; gap: 4px; font-size: 14px; color: #334155; }
.pb-desligar { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; border-top: 1px solid #F1F5F9; padding-top: 12px; }
.pb-desligar p { margin: 0; font-size: 13px; color: #475569; flex: 1 1 260px; }

@media (prefers-reduced-motion: reduce) {
  .pb-gira { animation: none; }
  .pb-kpi, .pb-exemplo-lista button { transition: none; }
}
@media (max-width: 760px) {
  .pb-grade, .pb-conversa { grid-template-columns: 1fr; }
  .pb-conversa-caixa { position: static; }
  .pb-topo { padding: 12px 14px; gap: 10px; }
  .pb-topo h1 { font-size: 19px; }
  .pb-abas button { font-size: 13px; padding: 8px 10px; }
  .pb-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .pb-kpi b { font-size: 18px; }
  .pb-filtros select { flex: 1 1 140px; min-width: 0; }
  .pb-linha { flex-wrap: wrap; row-gap: 4px; }
  .pb-linha-corpo { flex: 1 1 100%; order: 2; }
  .pb-desfazer { padding: 4px 9px; }
  .pb-desfazer { margin-left: auto; }
}
`;
