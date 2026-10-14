"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CHAVE_DO_CODIGO } from "@/lib/painel-de-senhas";

/**
 * A TV do Painel de senhas (lib/painel-de-senhas.ts): marca da loja no topo,
 * Preparando à esquerda, Pronto à direita, e a chamada em tela cheia quando
 * um número fica pronto. O FireHub assina no canto do rodapé.
 *
 * `previa` é a miniatura na tela de configuração (/store/painel-de-senhas):
 * desenhada DENTRO da página, porque o site não deixa ser posto em iframe
 * (frame-ancestors 'none'). Sem som, sem guardar o código, com números de
 * exemplo quando a loja não tem pedido agora. Por isso toda medida é em
 * `--u`: 1vh na TV, 1% da altura da moldura na prévia.
 */

type Senha = { id: string; numero: number; nome: string; desde: string };
type Dados = {
  loja: { nome: string; logo: string | null; cardapio: string | null };
  config: { mostrarNome: boolean; som: boolean; voz: boolean; mensagem: string; cor: string };
  preparando: Senha[];
  prontos: Senha[];
};

const INTERVALO_MS = 4000;
const CHAMADA_MS = 7000;
const MAX_PREPARANDO = 15;
const MAX_PRONTOS = 9;

const EXEMPLO_PREPARANDO: Senha[] = [418, 233, 871, 129, 560].map((n, i) => ({ id: `p${i}`, numero: n, nome: ["Ana", "Lucas", "", "Bruna", ""][i], desde: "" }));
const EXEMPLO_PRONTOS: Senha[] = [347, 812, 95].map((n, i) => ({ id: `r${i}`, numero: n, nome: ["Maria", "", "João"][i], desde: "" }));

/** Texto escuro sobre cor clara (âmbar, verde-claro); branco sobre o resto. */
function textoSobre(hex: string): string {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.35 ? "#0B0F17" : "#FFFFFF";
}

/** "Plim-plom" de aeroporto, sem arquivo de áudio: duas notas no WebAudio. */
function tocarChamada(ctx: AudioContext) {
  const agora = ctx.currentTime;
  [
    { f: 880, t: 0 },
    { f: 660, t: 0.32 },
  ].forEach(({ f, t }) => {
    const osc = ctx.createOscillator();
    const ganho = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = f;
    ganho.gain.setValueAtTime(0.0001, agora + t);
    ganho.gain.exponentialRampToValueAtTime(0.5, agora + t + 0.02);
    ganho.gain.exponentialRampToValueAtTime(0.0001, agora + t + 1.1);
    osc.connect(ganho).connect(ctx.destination);
    osc.start(agora + t);
    osc.stop(agora + t + 1.2);
  });
}

function falar(texto: string) {
  try {
    const synth = window.speechSynthesis;
    if (!synth) return;
    const fala = new SpeechSynthesisUtterance(texto);
    fala.lang = "pt-BR";
    fala.rate = 0.95;
    const voz = synth.getVoices().find((v) => v.lang?.toLowerCase().startsWith("pt"));
    if (voz) fala.voice = voz;
    synth.cancel();
    synth.speak(fala);
  } catch {}
}

export default function PainelDeSenhasTV({ lojaId, codigo, previa }: { lojaId: string; codigo: string; previa: boolean }) {
  const router = useRouter();

  const [dados, setDados] = useState<Dados | null>(null);
  const [semConexao, setSemConexao] = useState(false);
  const [hora, setHora] = useState("");
  const [qr, setQr] = useState<string | null>(null);
  const [ativado, setAtivado] = useState(false);
  const [chamada, setChamada] = useState<Senha | null>(null);
  const [recentes, setRecentes] = useState<Set<string>>(new Set());

  const vistos = useRef<Set<string> | null>(null);
  const fila = useRef<Senha[]>([]);
  const chamando = useRef(false);
  const audio = useRef<AudioContext | null>(null);
  const ultimoOk = useRef(Date.now());
  const configRef = useRef<Dados["config"] | null>(null);

  // ── Chamada em tela cheia, uma de cada vez ──────────────────────────────
  const proximaChamada = useCallback(() => {
    if (chamando.current) return;
    const s = fila.current.shift();
    if (!s) return;
    chamando.current = true;
    setChamada(s);
    const cfg = configRef.current;
    if (cfg?.som && audio.current) {
      try { void audio.current.resume(); tocarChamada(audio.current); } catch {}
    }
    if (cfg?.voz) setTimeout(() => falar(`Senha ${s.numero}${s.nome ? `, ${s.nome}` : ""}`), 900);
    setTimeout(() => {
      setChamada(null);
      chamando.current = false;
      setTimeout(proximaChamada, 400);
    }, CHAMADA_MS);
  }, []);

  // ── Pergunta ao servidor a cada 4 s ─────────────────────────────────────
  useEffect(() => {
    let vivo = true;
    async function buscar() {
      try {
        const r = await fetch(`/api/painel-de-senhas?loja=${encodeURIComponent(lojaId)}&codigo=${codigo}`, { cache: "no-store" });
        if (r.status === 410 || r.status === 400) {
          if (!previa) {
            try { localStorage.removeItem(CHAVE_DO_CODIGO); } catch {}
            router.replace("/tv?erro=codigo");
          }
          return;
        }
        if (!r.ok) throw new Error(String(r.status));
        const d: Dados = await r.json();
        if (!vivo) return;
        ultimoOk.current = Date.now();
        setSemConexao(false);
        configRef.current = d.config;
        if (!previa) { try { localStorage.setItem(CHAVE_DO_CODIGO, codigo); } catch {} }

        // Número que ENTROU em Pronto agora é chamado. Na primeira resposta
        // nada é chamado: a TV que liga às 20h não grita 9 senhas de uma vez.
        const ids = new Set(d.prontos.map((s) => s.id));
        if (vistos.current) {
          const novos = d.prontos.filter((s) => !vistos.current!.has(s.id)).reverse();
          if (novos.length && !previa) {
            fila.current.push(...novos);
            setRecentes((ant) => {
              const prox = new Set(ant);
              novos.forEach((s) => prox.add(s.id));
              return prox;
            });
            novos.forEach((s) => setTimeout(() => setRecentes((ant) => { const p = new Set(ant); p.delete(s.id); return p; }), 45_000));
            proximaChamada();
          }
        }
        vistos.current = ids;
        setDados(d);
      } catch {
        if (Date.now() - ultimoOk.current > 20_000) setSemConexao(true);
      }
    }
    buscar();
    const t = setInterval(buscar, INTERVALO_MS);
    return () => { vivo = false; clearInterval(t); };
  }, [lojaId, codigo, previa, router, proximaChamada]);

  // ── Relógio ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const tic = () => setHora(new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }));
    tic();
    const t = setInterval(tic, 10_000);
    return () => clearInterval(t);
  }, []);

  // ── QR do cardápio ──────────────────────────────────────────────────────
  const cardapio = dados?.loja.cardapio || null;
  useEffect(() => {
    if (!cardapio) { setQr(null); return; }
    let vivo = true;
    import("qrcode").then((QR) => QR.toDataURL(cardapio, { margin: 1, width: 320, color: { dark: "#0B0F17", light: "#FFFFFF" } }))
      .then((url) => { if (vivo) setQr(url); })
      .catch(() => {});
    return () => { vivo = false; };
  }, [cardapio]);

  // ── Tela sempre acesa (navegador que deixa) ─────────────────────────────
  useEffect(() => {
    if (previa) return;
    let trava: any = null;
    const pedir = async () => { try { trava = await (navigator as any).wakeLock?.request("screen"); } catch {} };
    pedir();
    const voltar = () => { if (document.visibilityState === "visible") pedir(); };
    document.addEventListener("visibilitychange", voltar);
    return () => { document.removeEventListener("visibilitychange", voltar); try { trava?.release(); } catch {} };
  }, [previa]);

  // O navegador só deixa tocar som depois de um toque na tela (ou o OK do controle).
  const ativar = () => {
    try {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      if (AC && !audio.current) audio.current = new AC();
      void audio.current?.resume();
      window.speechSynthesis?.getVoices();
    } catch {}
    try { if (!document.fullscreenElement) void document.documentElement.requestFullscreen?.(); } catch {}
    setAtivado(true);
  };

  if (!dados) {
    return (
      <div style={{ ...S.tela, ...(previa ? { position: "absolute", ["--u" as any]: "1cqh" } : { ["--u" as any]: "1vh" }), alignItems: "center", justifyContent: "center", fontSize: "calc(var(--u) * 3)", color: "rgba(255,255,255,0.5)" }}>
        Carregando o painel…
      </div>
    );
  }

  const cor = dados.config.cor;
  const corTexto = textoSobre(cor);
  const vazio = dados.preparando.length === 0 && dados.prontos.length === 0;
  const exemplo = previa && vazio;
  const preparando = exemplo ? EXEMPLO_PREPARANDO : dados.preparando;
  const prontos = exemplo ? EXEMPLO_PRONTOS : dados.prontos;
  const prepVisiveis = preparando.slice(0, MAX_PREPARANDO);
  const sobra = preparando.length - prepVisiveis.length;
  const prontosVisiveis = prontos.slice(0, MAX_PRONTOS);
  const mostrarNome = dados.config.mostrarNome || exemplo;
  const nomeDaLoja = dados.loja.nome || "Painel de senhas";

  return (
    <div
      style={{ ...S.tela, ...(previa ? { position: "absolute", ["--u" as any]: "1cqh" } : { ["--u" as any]: "1vh" }) }}
      onClick={ativado || previa ? undefined : ativar}
    >
      <style>{CSS}</style>
      {!previa && <style>{CSS_DA_TV}</style>}

      {/* ── Topo: a marca da loja é a estrela ── */}
      <header style={S.topo}>
        <div style={{ display: "flex", alignItems: "center", gap: "calc(var(--u) * 2.2)", minWidth: 0 }}>
          {dados.loja.logo ? (
            <img src={dados.loja.logo} alt="" style={S.logo} />
          ) : (
            <div style={{ ...S.logo, background: cor, color: corTexto, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "calc(var(--u) * 6)", fontWeight: 900 }}>
              {nomeDaLoja.trim().charAt(0).toUpperCase()}
            </div>
          )}
          <div style={{ minWidth: 0 }}>
            <div style={S.nomeDaLoja}>{nomeDaLoja}</div>
            <div style={{ fontSize: "calc(var(--u) * 2.2)", color: "rgba(255,255,255,0.55)", fontWeight: 600, letterSpacing: "calc(var(--u) * 0.3)", textTransform: "uppercase" }}>
              Acompanhe sua senha
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "calc(var(--u) * 2)" }}>
          {semConexao && <span style={S.semConexao}>● sem conexão</span>}
          {exemplo && <span style={{ ...S.semConexao, color: "#FDE68A", borderColor: "rgba(253,230,138,0.4)" }}>exemplo</span>}
          <div style={S.relogio}>{hora}</div>
        </div>
      </header>

      {/* ── Colunas ── */}
      <main style={S.colunas}>
        <section style={S.colunaPreparando}>
          <h2 style={S.tituloColuna}>
            <span className="fh-pulso" style={{ ...S.bolinha, background: "#F59E0B" }} />
            Preparando
          </h2>
          {prepVisiveis.length === 0 ? (
            <p style={S.vazio}>Sua senha aparece aqui assim que o pedido for feito.</p>
          ) : (
            <div style={S.gradePreparando}>
              {prepVisiveis.map((s) => (
                <div key={s.id} className="fh-entra" style={S.senhaPreparando}>
                  <span style={S.numeroPreparando}>{s.numero}</span>
                  {/* Sem nome, a linha fica vazia: os números da grade não desalinham. */}
                  {mostrarNome && <span style={S.nomePreparando}>{s.nome || " "}</span>}
                </div>
              ))}
            </div>
          )}
          {sobra > 0 && <div style={{ fontSize: "calc(var(--u) * 2.4)", color: "rgba(255,255,255,0.45)", marginTop: "calc(var(--u) * 1.5)" }}>+ {sobra} {sobra === 1 ? "pedido" : "pedidos"}</div>}
        </section>

        <section style={{ ...S.colunaPronto, background: `linear-gradient(160deg, ${cor}26 0%, ${cor}0D 60%)`, borderColor: `${cor}55` }}>
          <h2 style={{ ...S.tituloColuna, color: cor }}>
            <span style={{ ...S.check, background: cor, color: corTexto }}>✓</span>
            Pronto · retire seu pedido
          </h2>
          {prontosVisiveis.length === 0 ? (
            <p style={S.vazio}>Nenhum pedido esperando retirada.</p>
          ) : (
            <div style={S.gradePronto}>
              {prontosVisiveis.map((s, i) => {
                const destaque = recentes.has(s.id) || (exemplo && i === 0);
                return (
                  <div
                    key={s.id}
                    className={destaque ? "fh-entra fh-brilha" : "fh-entra"}
                    style={{
                      ...S.senhaPronto,
                      background: destaque ? cor : "rgba(255,255,255,0.06)",
                      color: destaque ? corTexto : "#fff",
                      borderColor: destaque ? cor : `${cor}66`,
                      ["--fh-cor" as any]: cor,
                    }}
                  >
                    <span style={S.numeroPronto}>{s.numero}</span>
                    {mostrarNome && <span style={{ ...S.nomePronto, color: destaque ? corTexto : "rgba(255,255,255,0.75)" }}>{s.nome || " "}</span>}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>

      {/* ── Rodapé: recado da loja, QR do cardápio e a assinatura do FireHub ── */}
      <footer style={S.rodape}>
        <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: "calc(var(--u) * 2)" }}>
          {dados.config.mensagem && <div style={S.mensagem}>{dados.config.mensagem}</div>}
        </div>
        {qr && (
          <div style={S.qrCaixa}>
            <img src={qr} alt="" style={S.qr} />
            <div style={{ lineHeight: 1.15 }}>
              <div style={{ fontSize: "calc(var(--u) * 2.2)", fontWeight: 800 }}>Peça pelo celular</div>
              <div style={{ fontSize: "calc(var(--u) * 1.7)", color: "rgba(255,255,255,0.6)" }}>aponte a câmera</div>
            </div>
          </div>
        )}
        <div style={S.assinatura}>
          <img src="/firehub-flame.png" alt="" style={{ width: "calc(var(--u) * 3.6)", height: "calc(var(--u) * 3.6)" }} />
          <div style={{ lineHeight: 1.1 }}>
            <div style={{ fontSize: "calc(var(--u) * 2)", fontWeight: 800, color: "rgba(255,255,255,0.85)" }}>FireHub</div>
            <div style={{ fontSize: "calc(var(--u) * 1.45)", color: "rgba(255,255,255,0.45)" }}>sistema para restaurantes · firehubfood.com.br</div>
          </div>
        </div>
      </footer>

      {/* ── A chamada ── */}
      {chamada && (
        <div className="fh-chamada" style={{ ...S.chamada, position: previa ? "absolute" : "fixed", background: cor, color: corTexto }}>
          <div style={{ fontSize: "calc(var(--u) * 6)", fontWeight: 800, letterSpacing: "calc(var(--u) * 1.2)", textTransform: "uppercase", opacity: 0.85 }}>Senha</div>
          <div className="fh-numero-chamada" style={{ fontSize: "calc(var(--u) * 34)", fontWeight: 900, lineHeight: 0.95, fontVariantNumeric: "tabular-nums" }}>{chamada.numero}</div>
          {dados.config.mostrarNome && chamada.nome && <div style={{ fontSize: "calc(var(--u) * 8)", fontWeight: 800 }}>{chamada.nome}</div>}
          <div style={{ fontSize: "calc(var(--u) * 4.5)", fontWeight: 700, marginTop: "calc(var(--u) * 2)", opacity: 0.9 }}>Seu pedido está pronto!</div>
          <div style={{ position: "absolute", top: "calc(var(--u) * 4)", left: "calc(var(--u) * 4)", display: "flex", alignItems: "center", gap: "calc(var(--u) * 1.6)", opacity: 0.9 }}>
            {dados.loja.logo && <img src={dados.loja.logo} alt="" style={{ width: "calc(var(--u) * 8)", height: "calc(var(--u) * 8)", borderRadius: "calc(var(--u) * 2)", objectFit: "cover", background: "#fff" }} />}
            <span style={{ fontSize: "calc(var(--u) * 3.4)", fontWeight: 800 }}>{nomeDaLoja}</span>
          </div>
        </div>
      )}

      {/* ── Ativar som e tela cheia (o navegador exige um toque) ── */}
      {!ativado && !previa && (
        <button autoFocus onClick={(e) => { e.stopPropagation(); ativar(); }} style={S.ativar}>
          {dados.config.som || dados.config.voz
            ? "🔊 Toque aqui (ou aperte OK no controle) para ativar o som e a tela cheia"
            : "Toque aqui (ou aperte OK no controle) para a tela cheia"}
        </button>
      )}
    </div>
  );
}

const CSS = `
@keyframes fh-entra { from { opacity: 0; transform: scale(.85); } to { opacity: 1; transform: scale(1); } }
.fh-entra { animation: fh-entra .45s cubic-bezier(.2,.9,.3,1.2) both; }
@keyframes fh-brilha { 0%,100% { box-shadow: 0 0 0 0 var(--fh-cor); } 50% { box-shadow: 0 0 calc(var(--u) * 4) calc(var(--u) * .6) var(--fh-cor); } }
.fh-brilha { animation: fh-entra .45s cubic-bezier(.2,.9,.3,1.2) both, fh-brilha 1.6s ease-in-out infinite; }
@keyframes fh-pulso { 0%,100% { opacity: 1; } 50% { opacity: .35; } }
.fh-pulso { animation: fh-pulso 1.4s ease-in-out infinite; }
@keyframes fh-chamada { from { opacity: 0; transform: scale(1.04); } to { opacity: 1; transform: scale(1); } }
.fh-chamada { animation: fh-chamada .35s ease-out both; }
@keyframes fh-numero { 0% { transform: scale(.6); } 60% { transform: scale(1.08); } 100% { transform: scale(1); } }
.fh-numero-chamada { animation: fh-numero .7s cubic-bezier(.2,.9,.3,1.2) both; }
@media (prefers-reduced-motion: reduce) { .fh-entra, .fh-brilha, .fh-pulso, .fh-chamada, .fh-numero-chamada { animation: none !important; } }
`;

/** Só na TV: na prévia isto mexeria na página do painel inteira. */
const CSS_DA_TV = `html, body { margin: 0; background: #0B0F17; overflow: hidden; }`;

const S: Record<string, React.CSSProperties> = {
  tela: {
    position: "fixed", inset: 0, display: "flex", flexDirection: "column", background: "radial-gradient(ellipse at 30% 0%, #1a2233 0%, #0B0F17 60%)",
    color: "#fff", fontFamily: "Inter, system-ui, sans-serif", overflow: "hidden", cursor: "default", userSelect: "none",
  },
  topo: { height: "calc(var(--u) * 15)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 calc(var(--u) * 4)", borderBottom: "1px solid rgba(255,255,255,0.07)" },
  logo: { width: "calc(var(--u) * 10)", height: "calc(var(--u) * 10)", borderRadius: "calc(var(--u) * 2.4)", objectFit: "cover", background: "#fff", flexShrink: 0, boxShadow: "0 calc(var(--u) * 1) calc(var(--u) * 3) rgba(0,0,0,0.4)" },
  nomeDaLoja: { fontSize: "calc(var(--u) * 5.4)", fontWeight: 900, lineHeight: 1.05, letterSpacing: "calc(var(--u) * -0.1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "calc(var(--u) * 110)" },
  relogio: { fontSize: "calc(var(--u) * 5)", fontWeight: 800, fontVariantNumeric: "tabular-nums", color: "rgba(255,255,255,0.9)" },
  semConexao: { fontSize: "calc(var(--u) * 1.9)", fontWeight: 700, color: "#FCA5A5", border: "1px solid rgba(252,165,165,0.4)", padding: "calc(var(--u) * 0.6) calc(var(--u) * 1.4)", borderRadius: "calc(var(--u) * 99)" },
  colunas: { flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "38fr 62fr", gap: "calc(var(--u) * 3)", padding: "calc(var(--u) * 3) calc(var(--u) * 4)" },
  colunaPreparando: { minHeight: 0, display: "flex", flexDirection: "column", padding: "calc(var(--u) * 3)", borderRadius: "calc(var(--u) * 3)", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" },
  colunaPronto: { minHeight: 0, display: "flex", flexDirection: "column", padding: "calc(var(--u) * 3)", borderRadius: "calc(var(--u) * 3)", border: "1px solid" },
  tituloColuna: { margin: "0 0 calc(var(--u) * 3)", fontSize: "calc(var(--u) * 3.6)", fontWeight: 900, textTransform: "uppercase", letterSpacing: "calc(var(--u) * 0.4)", display: "flex", alignItems: "center", gap: "calc(var(--u) * 1.6)" },
  bolinha: { width: "calc(var(--u) * 2)", height: "calc(var(--u) * 2)", borderRadius: "50%", display: "inline-block" },
  check: { width: "calc(var(--u) * 4.6)", height: "calc(var(--u) * 4.6)", borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: "calc(var(--u) * 3)", fontWeight: 900 },
  vazio: { margin: "auto 0", fontSize: "calc(var(--u) * 2.8)", color: "rgba(255,255,255,0.4)", textAlign: "center", lineHeight: 1.4 },
  gradePreparando: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "calc(var(--u) * 1.8)", alignContent: "start" },
  senhaPreparando: { display: "flex", flexDirection: "column", alignItems: "center", padding: "calc(var(--u) * 1.4) 0", borderRadius: "calc(var(--u) * 1.8)", background: "rgba(255,255,255,0.05)" },
  numeroPreparando: { fontSize: "calc(var(--u) * 6.4)", fontWeight: 800, color: "rgba(255,255,255,0.82)", fontVariantNumeric: "tabular-nums", lineHeight: 1 },
  nomePreparando: { fontSize: "calc(var(--u) * 2)", color: "rgba(255,255,255,0.5)", fontWeight: 600, marginTop: "calc(var(--u) * 0.6)", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  gradePronto: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "calc(var(--u) * 2.4)", alignContent: "start" },
  senhaPronto: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "calc(var(--u) * 2.2) 0", borderRadius: "calc(var(--u) * 2.6)", border: "2px solid" },
  numeroPronto: { fontSize: "calc(var(--u) * 11)", fontWeight: 900, fontVariantNumeric: "tabular-nums", lineHeight: 1 },
  nomePronto: { fontSize: "calc(var(--u) * 3)", fontWeight: 700, marginTop: "calc(var(--u) * 0.8)", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  rodape: { height: "calc(var(--u) * 9)", flexShrink: 0, display: "flex", alignItems: "center", gap: "calc(var(--u) * 3)", padding: "0 calc(var(--u) * 4)", borderTop: "1px solid rgba(255,255,255,0.07)", background: "rgba(0,0,0,0.25)" },
  mensagem: { fontSize: "calc(var(--u) * 2.8)", fontWeight: 700, color: "rgba(255,255,255,0.88)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  qrCaixa: { display: "flex", alignItems: "center", gap: "calc(var(--u) * 1.4)", padding: "0 calc(var(--u) * 1)" },
  qr: { width: "calc(var(--u) * 7.2)", height: "calc(var(--u) * 7.2)", borderRadius: "calc(var(--u) * 0.8)", background: "#fff" },
  assinatura: { display: "flex", alignItems: "center", gap: "calc(var(--u) * 1.2)", paddingLeft: "calc(var(--u) * 3)", borderLeft: "1px solid rgba(255,255,255,0.1)", height: "calc(var(--u) * 5.4)" },
  chamada: { position: "fixed", inset: 0, zIndex: 20, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center" },
  ativar: {
    position: "fixed", left: "50%", bottom: "calc(var(--u) * 12)", transform: "translateX(-50%)", zIndex: 30, fontSize: "calc(var(--u) * 2.6)", fontWeight: 700,
    padding: "calc(var(--u) * 1.8) calc(var(--u) * 3.4)", borderRadius: "calc(var(--u) * 99)", whiteSpace: "nowrap", border: "2px solid rgba(255,255,255,0.35)", background: "rgba(11,15,23,0.92)", color: "#fff", cursor: "pointer",
  },
};
