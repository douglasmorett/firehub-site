"use client";
/**
 * O TOPO DA INÍCIO: quem está no site agora, as visitas do período e o funil
 * do cardápio (lib/funil-do-site.ts; as contas em lib/funil-do-site-regras.ts).
 *
 * O "agora" pergunta de 20 em 20 s; o funil acompanha o filtro da Início
 * (Hoje, Ontem, 7 dias, Mês, Período) e compara com o período anterior.
 * `FunilDoSiteVisual` só desenha — recebe os números prontos (a prévia usa).
 */
import { useEffect, useMemo, useState } from "react";
import {
  conversao, degrausDoFunil, maiorPerda, NOME_DA_ETAPA, NOME_DA_ORIGEM,
  type ContagemDoFunil, type OrigemDaVisita,
} from "@/lib/funil-do-site-regras";

export type DadosDoFunil = {
  online: { agora: number; comCarrinho: number; finalizando: number };
  periodo?: { funil: ContagemDoFunil; origens: { origem: OrigemDaVisita; visitas: number; pedidos: number }[]; dispositivos: { celular: number; computador: number } };
  anterior?: { funil: ContagemDoFunil } | null;
  desde?: string | null;
};

type Janela = { inicio: Date; fim: Date };

const fmt = (n: number) => Math.round(n).toLocaleString("pt-BR");
const fmtPct = (n: number) => `${n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

export default function FunilDoSite({ janela, anterior, loja, rotulo }: { janela: Janela; anterior: Janela | null; loja: string | null; rotulo: string }) {
  const [dados, setDados] = useState<DadosDoFunil | null>(null);
  const [erro, setErro] = useState("");

  const qsPeriodo = useMemo(() => {
    const qs = new URLSearchParams({ de: janela.inicio.toISOString(), ate: janela.fim.toISOString() });
    if (anterior) { qs.set("antesDe", anterior.inicio.toISOString()); qs.set("antesAte", anterior.fim.toISOString()); }
    if (loja) qs.set("loja", loja);
    return qs.toString();
  }, [janela, anterior, loja]);

  // O período: na troca do filtro e, a cada minuto, para o "Hoje" andar.
  useEffect(() => {
    let vivo = true;
    const ler = () =>
      fetch(`/api/store/funil?${qsPeriodo}`, { cache: "no-store" })
        .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
        .then(({ ok, j }) => { if (!vivo) return; if (!ok) throw new Error(j?.error); setDados(j); setErro(""); })
        .catch((e) => { if (vivo) setErro(e?.message || "Não deu para carregar as visitas agora."); });
    ler();
    const t = window.setInterval(ler, 60_000);
    return () => { vivo = false; window.clearInterval(t); };
  }, [qsPeriodo]);

  // O "agora", mais rápido e só ele.
  useEffect(() => {
    let vivo = true;
    const qs = loja ? `?loja=${encodeURIComponent(loja)}` : "";
    const t = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      fetch(`/api/store/funil${qs}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => { if (vivo && j?.online) setDados((d) => (d ? { ...d, online: j.online } : d)); })
        .catch(() => {});
    }, 20_000);
    return () => { vivo = false; window.clearInterval(t); };
  }, [loja]);

  if (!dados) {
    return (
      <section style={caixa}>
        <div style={{ color: "#64748B", fontSize: "0.85rem" }}>{erro || "Carregando as visitas do seu site…"}</div>
      </section>
    );
  }
  return <FunilDoSiteVisual dados={dados} rotulo={rotulo} inicioDoPeriodo={janela.inicio} />;
}

export function FunilDoSiteVisual({ dados, rotulo, inicioDoPeriodo }: { dados: DadosDoFunil; rotulo: string; inicioDoPeriodo?: Date }) {
  const funil = dados.periodo?.funil;
  const degraus = useMemo(() => (funil ? degrausDoFunil(funil) : []), [funil]);
  const perda = useMemo(() => maiorPerda(degraus), [degraus]);
  const taxa = funil ? conversao(funil) : 0;
  const antes = dados.anterior?.funil || null;
  // Sem visitas no período anterior (a contagem ainda não existia), não há o que comparar.
  const taxaAntes = antes && antes.visita > 0 ? conversao(antes) : null;
  const abandonados = funil ? Math.max(0, funil.carrinho - funil.pedido) : 0;
  const desde = dados.desde ? new Date(dados.desde) : null;
  const contandoNoMeio = desde && inicioDoPeriodo && desde > inicioDoPeriodo;
  const totalDisp = (dados.periodo?.dispositivos.celular || 0) + (dados.periodo?.dispositivos.computador || 0);
  const pctCelular = totalDisp ? Math.round(((dados.periodo?.dispositivos.celular || 0) / totalDisp) * 100) : 0;
  const maiorOrigem = Math.max(1, ...(dados.periodo?.origens || []).map((o) => o.visitas));

  return (
    <section style={caixa} aria-label="Visitas e funil do seu site">
      <style>{`
        @keyframes fh-online { 0% { box-shadow: 0 0 0 0 rgba(22,163,74,.55); } 70% { box-shadow: 0 0 0 9px rgba(22,163,74,0); } 100% { box-shadow: 0 0 0 0 rgba(22,163,74,0); } }
        @media (prefers-reduced-motion: reduce) { .fh-online-ponto { animation: none !important; } }
        .fh-funil-grade { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); gap: 1.25rem; align-items: start; }
        @media (max-width: 860px) { .fh-funil-grade { grid-template-columns: minmax(0, 1fr); } }
      `}</style>

      {/* O CABEÇALHO: o título e quem está no site agora */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap", marginBottom: "1rem" }}>
        <div style={{ minWidth: 0 }}>
          <h2 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 800, color: "#0F172A" }}>🌐 Seu site — {rotulo}</h2>
          <p style={{ margin: "3px 0 0", fontSize: "0.76rem", color: "#64748B" }}>
            Quem abriu o seu cardápio (link, Instagram, Google, QR da loja). Mesa e garçom não entram.
            {contandoNoMeio && <> Contando desde {desde!.toLocaleDateString("pt-BR")} às {desde!.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}.</>}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#F0FDF4", border: "1.5px solid #BBF7D0", borderRadius: 14, padding: "8px 14px" }} role="status" aria-live="polite">
          <span className="fh-online-ponto" aria-hidden style={{ width: 11, height: 11, borderRadius: 999, background: "#16A34A", animation: "fh-online 1.8s ease-out infinite", flex: "0 0 auto" }} />
          <div>
            <div style={{ fontWeight: 900, color: "#14532D", fontSize: "1.05rem", lineHeight: 1.1 }}>
              {fmt(dados.online.agora)} {dados.online.agora === 1 ? "pessoa" : "pessoas"} no site agora
            </div>
            <div style={{ fontSize: "0.74rem", color: "#166534", marginTop: 2 }}>
              {dados.online.comCarrinho > 0
                ? <>🛒 {fmt(dados.online.comCarrinho)} com carrinho{dados.online.finalizando > 0 ? ` · ${fmt(dados.online.finalizando)} finalizando` : ""}</>
                : "Atualiza sozinho a cada 20 s"}
            </div>
          </div>
        </div>
      </div>

      {!funil || funil.visita === 0 ? (
        <div style={{ background: "#F8FAFC", border: "1px dashed #CBD5E1", borderRadius: 12, padding: "1.1rem", color: "#475569", fontSize: "0.88rem", lineHeight: 1.5 }}>
          {desde
            ? "Ninguém abriu o seu cardápio neste período."
            : "A contagem começou agora: as visitas aparecem aqui conforme os clientes abrem o seu cardápio. Divulgue o link no Instagram e no WhatsApp."}
        </div>
      ) : (
        <div className="fh-funil-grade">
          {/* O FUNIL */}
          <div>
            <DesenhoDoFunil degraus={degraus} />
          </div>

          {/* OS NÚMEROS QUE IMPORTAM */}
          <div style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
              <Numero titulo="Visitas" valor={fmt(funil.visita)} comparado={antes && antes.visita > 0 ? variacaoEmTexto(funil.visita, antes.visita) : null} />
              <Numero titulo="Conversão" valor={fmtPct(taxa)} dica="pedidos ÷ visitas" comparado={taxaAntes !== null ? pontosEmTexto(taxa, taxaAntes) : null} />
              <Numero titulo="Carrinhos largados" valor={fmt(abandonados)} dica="puseram e não pediram" cor={abandonados > 0 ? "#B45309" : "#0F172A"} />
            </div>

            {perda && (
              <div style={{ background: "#FFF7ED", border: "1.5px solid #FED7AA", borderRadius: 12, padding: "0.75rem 0.9rem" }}>
                <div style={{ fontSize: "0.72rem", fontWeight: 800, color: "#9A3412", textTransform: "uppercase", letterSpacing: 0.3 }}>Onde você mais perde clientes</div>
                <div style={{ fontWeight: 800, color: "#7C2D12", fontSize: "0.92rem", marginTop: 3 }}>
                  {nomeDoPasso(perda.etapa)}: só {fmtPct(perda.daAnterior)} seguiram ({fmt(perda.perdidos)} {perda.perdidos === 1 ? "pessoa parou" : "pessoas pararam"} aqui)
                </div>
                <div style={{ fontSize: "0.82rem", color: "#9A3412", marginTop: 4, lineHeight: 1.45 }}>{perda.dica}</div>
              </div>
            )}

            {(dados.periodo?.origens.length || 0) > 0 && (
              <div style={{ border: "1px solid #E2E8F0", borderRadius: 12, padding: "0.75rem 0.9rem" }}>
                <div style={{ fontSize: "0.72rem", fontWeight: 800, color: "#64748B", textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 6 }}>De onde vieram</div>
                <div style={{ display: "grid", gap: 6 }}>
                  {dados.periodo!.origens.slice(0, 6).map((o) => (
                    <div key={o.origem} style={{ display: "grid", gridTemplateColumns: "minmax(0, 7.5rem) minmax(0, 1fr) auto", gap: 8, alignItems: "center", fontSize: "0.8rem" }}>
                      <span style={{ fontWeight: 700, color: "#0F172A", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{NOME_DA_ORIGEM[o.origem]}</span>
                      <span aria-hidden style={{ height: 8, borderRadius: 999, background: "#F1F5F9", overflow: "hidden" }}>
                        <span style={{ display: "block", height: "100%", width: `${Math.max(4, (o.visitas / maiorOrigem) * 100)}%`, background: "#C92E09", borderRadius: 999 }} />
                      </span>
                      <span style={{ color: "#475569", whiteSpace: "nowrap" }}>
                        {fmt(o.visitas)} · <strong style={{ color: o.pedidos > 0 ? "#047857" : "#94A3B8" }}>{fmt(o.pedidos)} pedido{o.pedidos === 1 ? "" : "s"}</strong>
                      </span>
                    </div>
                  ))}
                </div>
                {totalDisp > 0 && (
                  <div style={{ fontSize: "0.76rem", color: "#64748B", marginTop: 8 }}>📱 {pctCelular}% pelo celular · 💻 {100 - pctCelular}% pelo computador</div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

// ── O desenho do funil (SVG) ─────────────────────────────────────────────────

const CORES = ["#9A1B05", "#C92E09", "#E2550F", "#F07A12", "#F59E0B"];

function DesenhoDoFunil({ degraus }: { degraus: ReturnType<typeof degrausDoFunil> }) {
  const W = 600, ALTURA = 56, VAO = 26, MIN = 0.36;
  const total = Math.max(1, degraus[0]?.pessoas || 0);
  const largura = (n: number) => W * (MIN + (1 - MIN) * (n / total));
  const H = degraus.length * ALTURA + (degraus.length - 1) * VAO;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={degraus.map((d) => `${d.nome}: ${d.pessoas}`).join("; ")} style={{ display: "block", maxHeight: 420 }}>
      {degraus.map((d, i) => {
        const y = i * (ALTURA + VAO);
        const topo = largura(d.pessoas);
        const proximo = degraus[i + 1];
        const base = proximo ? largura(proximo.pessoas) + (topo - largura(proximo.pessoas)) * 0.35 : topo * 0.92;
        const xT = (W - topo) / 2, xB = (W - base) / 2;
        return (
          <g key={d.etapa}>
            <polygon points={`${xT},${y} ${xT + topo},${y} ${xB + base},${y + ALTURA} ${xB},${y + ALTURA}`} fill={CORES[i % CORES.length]} />
            <text x={W / 2} y={y + 25} textAnchor="middle" fill="#fff" style={{ fontSize: 22, fontWeight: 900 }}>{fmt(d.pessoas)}</text>
            <text x={W / 2} y={y + 44} textAnchor="middle" fill="#FFF7ED" style={{ fontSize: 13, fontWeight: 700 }}>
              {d.nome}{i > 0 ? ` · ${fmtPct(d.doTotal)}` : ""}
            </text>
            {proximo && (
              <text x={W / 2} y={y + ALTURA + 17} textAnchor="middle" fill="#64748B" style={{ fontSize: 12, fontWeight: 700 }}>
                ↓ {fmtPct(proximo.daAnterior)} seguiram{proximo.perdidos > 0 ? ` · ${fmt(proximo.perdidos)} ${proximo.perdidos === 1 ? "parou" : "pararam"}` : ""}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ── Peças ────────────────────────────────────────────────────────────────────

function nomeDoPasso(etapa: keyof typeof NOME_DA_ETAPA): string {
  const ordem = ["visita", "produto", "carrinho", "checkout", "pedido"] as const;
  const i = ordem.indexOf(etapa as any);
  return i > 0 ? `${NOME_DA_ETAPA[ordem[i - 1]]} → ${NOME_DA_ETAPA[etapa].toLowerCase()}` : NOME_DA_ETAPA[etapa];
}

function variacaoEmTexto(agora: number, antes: number): { texto: string; bom: boolean } | null {
  if (antes <= 0) return agora > 0 ? { texto: "novo no período", bom: true } : null;
  const v = ((agora - antes) / antes) * 100;
  return { texto: `${v >= 0 ? "↗" : "↘"} ${fmtPct(Math.abs(Math.round(v * 10) / 10))} vs. anterior`, bom: v >= 0 };
}

function pontosEmTexto(agora: number, antes: number): { texto: string; bom: boolean } {
  const v = Math.round((agora - antes) * 10) / 10;
  return { texto: `${v >= 0 ? "↗" : "↘"} ${Math.abs(v).toLocaleString("pt-BR")} p.p. vs. anterior`, bom: v >= 0 };
}

function Numero({ titulo, valor, dica, cor = "#0F172A", comparado }: { titulo: string; valor: string; dica?: string; cor?: string; comparado?: { texto: string; bom: boolean } | null }) {
  return (
    <div style={{ border: "1px solid #E2E8F0", borderRadius: 12, padding: "0.6rem 0.7rem", minWidth: 0 }}>
      <div style={{ fontSize: "0.66rem", fontWeight: 800, color: "#64748B", textTransform: "uppercase", letterSpacing: 0.3 }}>{titulo}</div>
      <div style={{ fontWeight: 900, fontSize: "1.25rem", color: cor, marginTop: 2 }}>{valor}</div>
      {dica && <div style={{ fontSize: "0.68rem", color: "#94A3B8" }}>{dica}</div>}
      {comparado && <div style={{ fontSize: "0.68rem", fontWeight: 700, color: comparado.bom ? "#047857" : "#B91C1C", marginTop: 2 }}>{comparado.texto}</div>}
    </div>
  );
}

const caixa: React.CSSProperties = {
  background: "#fff", border: "1.5px solid #E2E8F0", borderRadius: 16, padding: "1.1rem 1.2rem", marginBottom: "1.25rem",
  boxShadow: "0 2px 8px rgba(15,23,42,0.04)",
};
