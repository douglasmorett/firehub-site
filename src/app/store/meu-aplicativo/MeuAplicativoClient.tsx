"use client";

/**
 * Meu aplicativo — o painel do app próprio da loja (Play Store/App Store),
 * depois que o admin ativou o plano.
 *
 * Douglas, 17/10/2026: "é um produto de mensalidade alta, ele tem que ver
 * valor nas informações, na estrutura, em como ele pode usar". Três abas:
 * - Visão geral: quem está no app agora, quanto o app vendeu, se já se pagou;
 * - Resultados: o app contra os outros canais, antes × depois de instalar,
 *   horários;
 * - Notificações: mandar direcionado (segmento + assistente + IA) e o
 *   resultado de cada envio.
 * - Clube: o clube de assinatura do app (lib/clube, Douglas 18/10/2026) —
 *   preço, %, Cakto, assinantes e se as mensalidades cobrem o desconto.
 * Promoções exclusivas do app entram em ABAS quando existirem — aba que não
 * funciona não aparece.
 *
 * Os números vêm prontos de GET /api/store/meu-aplicativo
 * (lib/app-da-loja/painel.ts): régua dos Relatórios, dia que vira às 5h.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, Crown, LineChart, Smartphone, TrendingUp } from "lucide-react";
import { CSS } from "./estilo";
import { ROTULO_DO_PERIODO, data, reais, type Dados, type Periodo } from "./tipos";
import AbaVisaoGeral from "./AbaVisaoGeral";
import AbaResultados from "./AbaResultados";
import AbaNotificacoes from "./AbaNotificacoes";
import AbaClube from "./AbaClube";

export type Aviso = { tipo: "ok" | "erro" | "atencao" | "info"; titulo: string; detalhe?: string };
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

const ABAS = [
  { id: "visao", rotulo: "Visão geral", icone: TrendingUp, periodo: true },
  { id: "resultados", rotulo: "Resultados", icone: LineChart, periodo: true },
  { id: "notificacoes", rotulo: "Notificações", icone: Bell, periodo: false },
  { id: "clube", rotulo: "Clube", icone: Crown, periodo: false },
] as const;
type IdDaAba = (typeof ABAS)[number]["id"];
const PERIODOS: Periodo[] = ["7d", "30d", "90d", "mes", "mesAnterior"];

export default function MeuAplicativoClient() {
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aba, setAba] = useState<IdDaAba>("visao");
  const [periodo, setPeriodo] = useState<Periodo>("30d");
  const [carregando, setCarregando] = useState(false);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const fecharAviso = useCallback(() => setAviso(null), []);
  const pedidoAtual = useRef(0);

  const carregar = useCallback(async (p: Periodo, silencioso = false) => {
    const meu = ++pedidoAtual.current;
    if (!silencioso) setCarregando(true);
    try {
      const r = await fetch(`/api/store/meu-aplicativo?periodo=${p}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) {
        if (j.irPara) { window.location.href = j.irPara; return; }
        throw new Error(j.error || "Erro ao carregar");
      }
      if (meu === pedidoAtual.current) { setDados(j); setErro(null); }
    } catch (e: any) {
      if (meu === pedidoAtual.current) setErro(e.message);
    } finally {
      if (meu === pedidoAtual.current) setCarregando(false);
    }
  }, []);
  useEffect(() => { carregar(periodo); }, [carregar, periodo]);
  // "Ativos agora" muda sozinho: atualiza a cada minuto com a tela aberta.
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible") carregar(periodo, true); }, 60_000);
    return () => clearInterval(t);
  }, [carregar, periodo]);
  useEffect(() => {
    try {
      const h = window.location.hash.replace("#", "");
      if (h === "notificacoes" || h === "resultados" || h === "clube") setAba(h);
    } catch {}
  }, []);

  const irPara = (id: IdDaAba) => {
    setAba(id);
    requestAnimationFrame(() => document.querySelector(".ma-barra")?.scrollIntoView({ block: "start", behavior: "smooth" }));
  };

  if (erro && !dados) return <div style={{ padding: 24, color: "#B91C1C", fontWeight: 600 }}>{erro}</div>;

  const def = ABAS.find((a) => a.id === aba)!;
  return (
    <div className="ma">
      <style>{CSS}</style>
      <AvisoNoTopo aviso={aviso} onFechar={fecharAviso} />

      <div className="ma-topo">
        <span className="ma-topo-icone"><Smartphone size={24} color="#FACC15" /></span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h1>Meu aplicativo{dados && <span className="ma-selo-ativo">● ATIVO</span>}</h1>
          <div className="ma-topo-sub">
            {dados
              ? <>{dados.plano.rotulo ? `${dados.plano.rotulo} · ` : ""}desde {data(dados.plano.ativoDesde)}{dados.plano.valor ? ` · ${reais(dados.plano.valor)}/mês no boleto` : ""}</>
              : "Carregando…"}
          </div>
        </div>
      </div>
      {dados && dados.unidades.length > 1 && (
        <div className="ma-grupo">
          O app é da marca: a base de clientes e os resultados somam as {dados.unidades.length} unidades ({dados.unidades.join(", ")}). Os números de cada unidade estão em Resultados.
        </div>
      )}

      <div className="ma-barra">
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
        {def.periodo && (
          <div className="ma-periodos" role="group" aria-label="Período">
            {PERIODOS.map((p) => (
              <button key={p} className={`ma-periodo${periodo === p ? " ativo" : ""}`} onClick={() => setPeriodo(p)} aria-pressed={periodo === p}>{ROTULO_DO_PERIODO[p]}</button>
            ))}
          </div>
        )}
      </div>

      {!dados ? <Esqueleto /> : (
        <div style={{ opacity: carregando ? 0.55 : 1, transition: "opacity .2s" }}>
          {aba === "visao" && <AbaVisaoGeral dados={dados} irPara={irPara} />}
          {aba === "resultados" && <AbaResultados dados={dados} />}
          {aba === "notificacoes" && <AbaNotificacoes dados={dados} avisar={setAviso} recarregar={() => carregar(periodo, true)} />}
          {aba === "clube" && <AbaClube nomeDaLoja={dados.loja.nome} avisar={setAviso} />}
        </div>
      )}
    </div>
  );
}

function Esqueleto() {
  return (
    <div className="ma-pilha" aria-busy="true" aria-label="Carregando">
      <div className="ma-esqueleto" style={{ height: 120 }} />
      <div className="ma-grade">
        {[0, 1, 2, 3].map((i) => <div key={i} className="ma-esqueleto" style={{ height: 104 }} />)}
      </div>
      <div className="ma-esqueleto" style={{ height: 280 }} />
    </div>
  );
}
