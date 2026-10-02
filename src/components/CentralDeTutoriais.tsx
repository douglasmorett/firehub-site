"use client";

/**
 * CentralDeTutoriais — a tela de orientação que abre depois do login.
 *
 * Pedido do Douglas em 02/10/2026: a loja que acabou de entrar no FireHub tem
 * que dar de cara com o passo a passo, sem precisar chamar o suporte. É a
 * mesma janela do vídeo de cada tela (TutorialDaTela), com todos os vídeos na
 * lista ao lado: assiste um, o próximo começa sozinho. O texto do topo ensina
 * onde o tutorial mora depois — o botão "Tutorial" no alto de cada aba.
 *
 * ── Quando abre ─────────────────────────────────────────────────────────────
 * - Sozinha, na primeira tela do painel depois do login.
 * - "Fechar" (ou X, ou Esc): some até o próximo login. A marca é um cookie de
 *   sessão, e o login apaga a marca ao entrar (lib/tutoriais.ts).
 * - "Já vi, não mostrar mais": não abre sozinha nunca mais neste aparelho,
 *   para este usuário (localStorage, como o "não ver mais" dos avisos).
 * - A qualquer hora pelo "Todos os tutoriais" da janela de cada tela.
 *
 * Ao fechar a que abriu sozinha, uma seta aponta o botão "Tutorial" da barra
 * do topo e o destaca: a pessoa sai sabendo onde a ajuda fica.
 *
 * Não abre sozinha no Totem (quem está na frente é o cliente da loja) nem na
 * tela cheia da cozinha (tablet de parede, ninguém ali está aprendendo o painel).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { Check, PlayCircle, X } from "lucide-react";
import { useTutoriaisEnviados } from "@/components/TutoriaisEnviados";
import { ABRIR_CENTRAL, CHAVE_VISTO, ESTILO, VELOCIDADES } from "@/components/TutorialDaTela";
import {
  arquivosDoTutorial, CHAVE_CENTRAL_NAO_MOSTRAR, duracaoEmMinutos, MARCA_CENTRAL_FECHADA, relogio, todosOsTutoriais,
} from "@/lib/tutoriais";

const SEM_ABRIR_SOZINHA = ["/store/totem", "/store/kds/tela"];

const ESTILO_CENTRAL = `
.fh-central-janela{width:min(1180px,100%)}
.fh-central-boas{margin:0;padding:0 20px 14px;color:#475569;font-size:.9rem;line-height:1.55;max-width:880px}
.fh-central-boas strong{color:#0F172A}
.fh-central-chave{display:inline-flex;align-items:center;gap:4px;background:#C92E09;color:#fff;border-radius:7px;padding:1px 8px;font-weight:700;font-size:.78rem;vertical-align:1px;white-space:nowrap}
.fh-central-corpo{grid-template-columns:minmax(0,1fr) 300px}
.fh-central-lista{max-height:min(480px,calc(100vh - 330px));overflow:auto;padding-right:4px}
.fh-central-grupo{font-size:.66rem;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#94A3B8;margin:12px 0 4px 8px}
.fh-central-grupo:first-child{margin-top:0}
.fh-central-item{display:flex;gap:9px;align-items:center;width:100%;text-align:left;border:0;background:none;padding:7px 8px;border-radius:9px;cursor:pointer;font-size:.82rem;color:#334155;font-family:inherit;line-height:1.3}
.fh-central-item:hover{background:#F1F5F9}
.fh-central-item[aria-current="true"]{background:#FFF1EC;color:#9A2A0A;font-weight:700}
.fh-central-marca{flex:none;width:20px;height:20px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;border:1.5px solid #CBD5E1;color:#fff}
.fh-central-marca.visto{background:#16A34A;border-color:#16A34A}
.fh-central-dur{margin-left:auto;padding-left:6px;font-size:.7rem;color:#94A3B8;font-variant-numeric:tabular-nums;white-space:nowrap}
.fh-central-capitulos{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}
.fh-central-capitulos button{border:1px solid #E2E8F0;background:#fff;border-radius:999px;padding:4px 10px;font-size:.74rem;cursor:pointer;color:#334155;font-family:inherit}
.fh-central-capitulos button[aria-current="true"]{background:#FFF1EC;border-color:#FDBA9A;color:#9A2A0A;font-weight:700}
.fh-central-capitulos time{color:#94A3B8;margin-right:4px;font-variant-numeric:tabular-nums}
.fh-central-rodape{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:12px 20px 16px;border-top:1px solid #F1F5F9}
.fh-central-progresso{display:inline-flex;align-items:center;gap:6px;font-size:.8rem;color:#64748B;margin-right:auto}
.fh-central-rodape button{height:38px;padding:0 16px;border-radius:10px;font-weight:700;font-size:.84rem;cursor:pointer;font-family:inherit}
.fh-central-btn-fechar{border:1px solid #E2E8F0;background:#fff;color:#334155}
.fh-central-btn-fechar:hover{background:#F8FAFC}
.fh-central-btn-nao{border:1px solid #0F172A;background:#0F172A;color:#fff}
.fh-seta-anel{position:fixed;z-index:100001;border-radius:12px;pointer-events:none;
  box-shadow:0 0 0 3px #FDE047,0 0 0 9999px rgba(15,23,42,.38);animation:fh-anel 1.4s ease-in-out infinite}
@keyframes fh-anel{50%{box-shadow:0 0 0 7px #FDE047,0 0 0 9999px rgba(15,23,42,.38)}}
.fh-seta-balao{position:fixed;z-index:100002;width:290px;max-width:calc(100vw - 24px);background:#fff;color:#0F172A;border-radius:12px;
  padding:14px 16px;font-size:.86rem;line-height:1.45;box-shadow:0 14px 34px rgba(0,0,0,.3)}
.fh-seta-balao:before{content:"";position:absolute;top:-7px;left:var(--x,24px);width:14px;height:14px;background:#fff;transform:rotate(45deg);border-radius:2px}
.fh-seta-balao strong{display:block;margin-bottom:3px;font-size:.92rem}
.fh-seta-balao button{margin-top:10px;border:0;background:#0F172A;color:#fff;border-radius:8px;padding:6px 14px;font-weight:700;font-size:.8rem;cursor:pointer;font-family:inherit}
@media (max-width:860px){.fh-central-corpo{grid-template-columns:1fr}.fh-central-lista{max-height:none}.fh-central-boas{padding:0 12px 12px;font-size:.84rem}
  .fh-central-rodape{padding:10px 12px 14px}.fh-central-progresso{width:100%}.fh-central-rodape button{flex:1}}
@media (prefers-reduced-motion:reduce){.fh-seta-anel{animation:none}}
`;

type Seta = { anel: { top: number; left: number; width: number; height: number }; balao: { top: number; left: number; x: number } };

/** O botão "Tutorial" que está à vista (a Roteirização monta o dela escondido dentro de Pedidos). */
function botaoAVista(): HTMLElement | null {
  const botoes = Array.from(document.querySelectorAll<HTMLElement>(".fh-tutorial-botao"));
  return botoes.find((b) => {
    const r = b.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight;
  }) || null;
}

function medirSeta(): Seta | null {
  const b = botaoAVista();
  if (!b) return null;
  const r = b.getBoundingClientRect();
  const largura = Math.min(290, window.innerWidth - 24);
  const meio = r.left + r.width / 2;
  const left = Math.max(12, Math.min(meio - largura / 2, window.innerWidth - largura - 12));
  return {
    anel: { top: r.top - 4, left: r.left - 4, width: r.width + 8, height: r.height + 8 },
    balao: { top: r.bottom + 14, left, x: Math.max(14, Math.min(meio - left - 7, largura - 28)) },
  };
}

export default function CentralDeTutoriais({
  usuarioId,
  primeiroNome,
  contaNova,
}: {
  usuarioId: string;
  primeiroNome?: string;
  /** Conta criada há pouco: o título dá as boas-vindas. Loja antiga vê "Tutoriais do FireHub". */
  contaNova: boolean;
}) {
  const pathname = usePathname();
  const enviados = useTutoriaisEnviados();
  const grupos = useMemo(() => todosOsTutoriais(enviados), [enviados]);
  const lista = useMemo(() => grupos.flatMap((g) => g.tutoriais), [grupos]);

  const [aberto, setAberto] = useState(false);
  const [qual, setQual] = useState(0);
  // O navegador não deixa vídeo com som começar sem um clique na página: o
  // primeiro espera o play; depois que a pessoa escolheu, o próximo emenda.
  const [tocar, setTocar] = useState(false);
  const [segundo, setSegundo] = useState(0);
  const [velocidade, setVelocidade] = useState(1);
  const [vistos, setVistos] = useState<Set<string>>(() => new Set());
  const [seta, setSeta] = useState<Seta | null>(null);
  const abriuSozinha = useRef(false);
  const video = useRef<HTMLVideoElement>(null);
  const fecharRef = useRef<HTMLButtonElement>(null);

  const abrir = useCallback((sozinha: boolean) => {
    const v = new Set<string>();
    try {
      for (const t of lista) if (localStorage.getItem(CHAVE_VISTO + t.id) === "1") v.add(t.id);
    } catch {}
    setVistos(v);
    // Começa no primeiro que a pessoa ainda não viu.
    setQual(Math.max(0, lista.findIndex((t) => !v.has(t.id))));
    setSegundo(0);
    setTocar(false);
    setSeta(null);
    abriuSozinha.current = sozinha;
    setAberto(true);
  }, [lista]);

  // Abre sozinha uma vez, quando o painel monta depois do login.
  useEffect(() => {
    if (!lista.length || !usuarioId) return;
    if (SEM_ABRIR_SOZINHA.some((r) => (pathname || "").startsWith(r))) return;
    let calada = false;
    try {
      calada = localStorage.getItem(CHAVE_CENTRAL_NAO_MOSTRAR + usuarioId) === "1";
    } catch {}
    const fechada = document.cookie.split(/;\s*/).includes(`${MARCA_CENTRAL_FECHADA}=${usuarioId}`);
    if (!calada && !fechada) abrir(true);
    // Só na montagem: trocar de tela não reabre.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const pedir = () => abrir(false);
    window.addEventListener(ABRIR_CENTRAL, pedir);
    return () => window.removeEventListener(ABRIR_CENTRAL, pedir);
  }, [abrir]);

  const fechar = useCallback((naoMostrarMais: boolean) => {
    video.current?.pause();
    try {
      if (naoMostrarMais) localStorage.setItem(CHAVE_CENTRAL_NAO_MOSTRAR + usuarioId, "1");
    } catch {}
    document.cookie = `${MARCA_CENTRAL_FECHADA}=${usuarioId}; path=/; SameSite=Lax`;
    setAberto(false);
    if (abriuSozinha.current) requestAnimationFrame(() => setSeta(medirSeta()));
  }, [usuarioId]);

  useEffect(() => {
    if (!aberto) return;
    fecharRef.current?.focus();
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") fechar(false); };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [aberto, fechar]);

  // A seta acompanha a tela (girar o tablet, rolar) e some no primeiro toque ou em 12 s.
  useEffect(() => {
    if (!seta) return;
    const medir = () => setSeta(medirSeta());
    const sumir = () => setSeta(null);
    const tempo = window.setTimeout(sumir, 12_000);
    window.addEventListener("resize", medir);
    window.addEventListener("scroll", medir, true);
    window.addEventListener("pointerdown", sumir, true);
    return () => {
      window.clearTimeout(tempo);
      window.removeEventListener("resize", medir);
      window.removeEventListener("scroll", medir, true);
      window.removeEventListener("pointerdown", sumir, true);
    };
  }, [seta !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!lista.length) return null;
  const tutorial = lista[Math.min(qual, lista.length - 1)];
  const arquivos = arquivosDoTutorial(tutorial);
  const capituloAtual = tutorial.capitulos.reduce((achado, c, i) => (segundo + 0.25 >= c.em ? i : achado), 0);

  const escolher = (i: number) => {
    setQual(i);
    setSegundo(0);
    setTocar(true);
  };

  const marcarVisto = () => {
    try {
      localStorage.setItem(CHAVE_VISTO + tutorial.id, "1");
    } catch {}
    setVistos((v) => (v.has(tutorial.id) ? v : new Set(v).add(tutorial.id)));
  };

  const irPara = (em: number) => {
    const v = video.current;
    if (!v) return;
    v.currentTime = em;
    v.play().catch(() => {});
  };

  const titulo = contaNova
    ? `Boas-vindas ao FireHub${primeiroNome ? `, ${primeiroNome}` : ""}!`
    : "Tutoriais do FireHub";

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: ESTILO + ESTILO_CENTRAL }} />

      {aberto && createPortal(
        <div className="fh-tutorial-fundo">
          <div className="fh-tutorial-janela fh-central-janela" role="dialog" aria-modal="true" aria-labelledby="fh-central-titulo">
            <div className="fh-tutorial-topo">
              <h2 id="fh-central-titulo">{titulo}</h2>
              <button ref={fecharRef} type="button" className="fh-tutorial-fechar" onClick={() => fechar(false)} aria-label="Fechar">
                <X size={17} />
              </button>
            </div>
            <p className="fh-central-boas">
              {contaNova && <>É um prazer ter você com o nosso time. </>}
              Esta é a <strong>tela de orientação</strong> do sistema: aqui está o passo a passo do que você precisa
              saber, em vídeos curtos, um depois do outro. Sempre que quiser consultar alguma coisa, clique em{" "}
              <span className="fh-central-chave"><PlayCircle size={12} /> Tutorial</span> no topo de cada aba: ele abre
              o vídeo exatamente daquela tela.
            </p>

            <div className="fh-tutorial-corpo fh-central-corpo">
              <div>
                <video
                  key={tutorial.id}
                  ref={video}
                  className="fh-tutorial-video"
                  src={arquivos.video}
                  poster={arquivos.capa}
                  controls
                  autoPlay={tocar}
                  playsInline
                  preload="metadata"
                  onLoadedMetadata={(e) => {
                    const faixa = e.currentTarget.textTracks?.[0];
                    if (faixa && faixa.mode === "disabled") faixa.mode = "showing";
                    e.currentTarget.playbackRate = velocidade;
                  }}
                  onPlay={() => { setTocar(true); marcarVisto(); }}
                  onTimeUpdate={(e) => setSegundo(e.currentTarget.currentTime)}
                  onEnded={() => { if (qual < lista.length - 1) escolher(qual + 1); }}
                >
                  <track kind="captions" src={arquivos.legendas} srcLang="pt-BR" label="Português" default />
                </video>
                <div className="fh-tutorial-barra">
                  <span style={{ marginRight: "auto", fontWeight: 700, color: "#0F172A" }}>
                    {qual + 1}. {tutorial.titulo}
                  </span>
                  Velocidade
                  {VELOCIDADES.map((v) => (
                    <button
                      key={v}
                      type="button"
                      aria-pressed={velocidade === v}
                      onClick={() => { setVelocidade(v); if (video.current) video.current.playbackRate = v; }}
                    >
                      {String(v).replace(".", ",")}x
                    </button>
                  ))}
                </div>
                <div className="fh-central-capitulos">
                  {tutorial.capitulos.map((c, i) => (
                    <button key={c.em} type="button" aria-current={i === capituloAtual} onClick={() => irPara(c.em)}>
                      <time>{relogio(c.em)}</time>{c.titulo}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="fh-tutorial-lista-titulo">Passo a passo</div>
                <div className="fh-central-lista">
                  {grupos.map((g) => (
                    <div key={g.titulo}>
                      <div className="fh-central-grupo">{g.titulo}</div>
                      {g.tutoriais.map((t) => {
                        const i = lista.indexOf(t);
                        return (
                          <button key={t.id} type="button" className="fh-central-item" aria-current={i === qual} onClick={() => escolher(i)}>
                            <span className={vistos.has(t.id) ? "fh-central-marca visto" : "fh-central-marca"} aria-label={vistos.has(t.id) ? "assistido" : undefined}>
                              {vistos.has(t.id) && <Check size={12} strokeWidth={3} />}
                            </span>
                            {t.titulo}
                            <span className="fh-central-dur">{duracaoEmMinutos(t.duracao)}</span>
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="fh-central-rodape">
              <span className="fh-central-progresso">
                <Check size={14} /> {vistos.size} de {lista.length} vídeos assistidos
              </span>
              <button type="button" className="fh-central-btn-fechar" onClick={() => fechar(false)}>Fechar</button>
              <button type="button" className="fh-central-btn-nao" onClick={() => fechar(true)}>Já vi, não mostrar mais</button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {seta && createPortal(
        <>
          <div className="fh-seta-anel" style={seta.anel} />
          <div
            className="fh-seta-balao"
            role="status"
            style={{ top: seta.balao.top, left: seta.balao.left, ["--x" as string]: `${seta.balao.x}px` }}
          >
            <strong>O tutorial fica sempre aqui</strong>
            Em cada aba, este botão abre o vídeo daquela tela. E a lista completa continua em “Todos os tutoriais”.
            <div><button type="button" onClick={() => setSeta(null)}>Entendi</button></div>
          </div>
        </>,
        document.body,
      )}
    </>
  );
}
