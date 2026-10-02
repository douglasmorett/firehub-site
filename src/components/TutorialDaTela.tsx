"use client";

/**
 * TutorialDaTela — o botão "Tutorial" da barra do topo e a janela do vídeo.
 *
 * Mora na barra do topo (StoreTopNav), uma vez só: descobre pela rota qual
 * vídeo é o da tela aberta (lib/tutoriais.ts) e, se não houver, não desenha
 * nada. Sutil de propósito — é ajuda para quem procura, não propaganda: sem
 * abrir sozinho, sem balão, sem piscar. O único chamariz é uma bolinha até a
 * pessoa assistir uma vez. O rótulo é curto ("Tutorial") porque a barra do
 * topo já anda cheia: com "Como usar esta tela" ela quebrava em duas linhas
 * em tela de 1366 px, e uma barra mais alta empurra a tela inteira para baixo.
 *
 * A janela abre por cima da tela, sem trocar de página: o lojista assiste,
 * fecha e continua de onde estava. Capítulos ao lado levam direto ao ponto
 * ("só quero ver como cancela"), e a legenda vem ligada porque cozinha e
 * balcão são barulhentos.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { PlayCircle, X } from "lucide-react";
import { arquivosDoTutorial, duracaoEmMinutos, relogio, tutoriaisDaTela, type Tutorial } from "@/lib/tutoriais";

const CHAVE_VISTO = "firehub_tutorial_visto:";
const VELOCIDADES = [1, 1.25, 1.5];

const ESTILO = `
.fh-tutorial-botao{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 10px;border-radius:9px;
  background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.25);color:#fff;font-weight:700;font-size:.72rem;
  cursor:pointer;white-space:nowrap;position:relative;font-family:inherit}
.fh-tutorial-botao:hover{background:rgba(255,255,255,.24)}
.fh-tutorial-novo{position:absolute;top:-3px;right:-3px;width:9px;height:9px;border-radius:50%;background:#FDE047;border:2px solid #C92E09}
@media (max-width:1180px){.fh-tutorial-botao span{display:none}.fh-tutorial-botao{padding:0;width:32px;justify-content:center}}
.fh-tutorial-fundo{position:fixed;inset:0;z-index:100000;background:rgba(15,23,42,.62);display:flex;align-items:center;justify-content:center;padding:16px}
.fh-tutorial-janela{background:#fff;border-radius:16px;width:min(1080px,100%);max-height:calc(100vh - 32px);overflow:auto;
  box-shadow:0 24px 60px rgba(0,0,0,.35);color:#0F172A}
.fh-tutorial-topo{display:flex;align-items:center;gap:12px;padding:14px 16px 12px 20px}
.fh-tutorial-topo h2{margin:0;font-size:1.02rem;font-weight:800;flex:1;min-width:0}
.fh-tutorial-fechar{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:9px;border:1px solid #E2E8F0;background:#F8FAFC;cursor:pointer;color:#334155}
.fh-tutorial-corpo{display:grid;grid-template-columns:minmax(0,1fr) 264px;gap:16px;padding:0 16px 16px 20px}
.fh-tutorial-video{width:100%;aspect-ratio:16/9;background:#0F172A;border-radius:12px;display:block}
.fh-tutorial-barra{display:flex;align-items:center;gap:6px;margin-top:10px;font-size:.76rem;color:#64748B;flex-wrap:wrap}
.fh-tutorial-barra button{border:1px solid #E2E8F0;background:#fff;border-radius:8px;padding:4px 9px;font-weight:700;font-size:.74rem;cursor:pointer;color:#334155;font-family:inherit}
.fh-tutorial-barra button[aria-pressed="true"]{background:#0F172A;border-color:#0F172A;color:#fff}
.fh-tutorial-lista{display:flex;flex-direction:column;gap:2px;margin:0;padding:0;list-style:none}
.fh-tutorial-lista-titulo{font-size:.68rem;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#94A3B8;margin:2px 0 8px 8px}
.fh-tutorial-capitulo{display:flex;gap:10px;align-items:baseline;width:100%;text-align:left;border:0;background:none;padding:8px;border-radius:9px;cursor:pointer;font-size:.82rem;color:#334155;font-family:inherit;line-height:1.35}
.fh-tutorial-capitulo:hover{background:#F1F5F9}
.fh-tutorial-capitulo[aria-current="true"]{background:#FFF1EC;color:#9A2A0A;font-weight:700}
.fh-tutorial-capitulo time{font-variant-numeric:tabular-nums;font-size:.72rem;color:#94A3B8;min-width:30px}
.fh-tutorial-capitulo[aria-current="true"] time{color:#C2410C}
.fh-tutorial-outros{display:flex;gap:6px;flex-wrap:wrap;padding:0 20px 12px}
.fh-tutorial-outros button{border:1px solid #E2E8F0;background:#fff;border-radius:999px;padding:5px 12px;font-size:.76rem;font-weight:700;cursor:pointer;color:#334155;font-family:inherit}
.fh-tutorial-outros button[aria-pressed="true"]{background:#E8360C;border-color:#E8360C;color:#fff}
@media (max-width:860px){.fh-tutorial-corpo{grid-template-columns:1fr;padding:0 12px 14px}.fh-tutorial-topo{padding:12px}.fh-tutorial-outros{padding:0 12px 10px}}
`;

export default function TutorialDaTela() {
  const pathname = usePathname();
  const tutoriais = tutoriaisDaTela(pathname);
  const [aberto, setAberto] = useState(false);
  const [qual, setQual] = useState(0);
  const [jaViu, setJaViu] = useState(true); // começa "visto" para a bolinha não piscar antes de ler o navegador
  const [segundo, setSegundo] = useState(0);
  const [velocidade, setVelocidade] = useState(1);
  const video = useRef<HTMLVideoElement>(null);
  const fecharRef = useRef<HTMLButtonElement>(null);

  const tutorial: Tutorial | undefined = tutoriais[Math.min(qual, tutoriais.length - 1)];
  const primeiroId = tutoriais[0]?.id;

  useEffect(() => {
    setQual(0);
    setAberto(false);
    if (!primeiroId) return;
    try {
      setJaViu(localStorage.getItem(CHAVE_VISTO + primeiroId) === "1");
    } catch {}
  }, [primeiroId]);

  const fechar = useCallback(() => {
    video.current?.pause();
    setAberto(false);
  }, []);

  useEffect(() => {
    if (!aberto) return;
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") fechar(); };
    window.addEventListener("keydown", tecla);
    fecharRef.current?.focus();
    return () => window.removeEventListener("keydown", tecla);
  }, [aberto, fechar]);

  // Legenda ligada de saída: o atributo `default` do <track> não basta em todo navegador.
  const ligarLegenda = () => {
    const faixa = video.current?.textTracks?.[0];
    if (faixa && faixa.mode === "disabled") faixa.mode = "showing";
  };

  if (!tutorial) return null;
  const arquivos = arquivosDoTutorial(tutorial);
  const capituloAtual = tutorial.capitulos.reduce((achado, c, i) => (segundo + 0.25 >= c.em ? i : achado), 0);

  const abrir = () => {
    setAberto(true);
    setJaViu(true);
    try {
      localStorage.setItem(CHAVE_VISTO + tutorial.id, "1");
    } catch {}
  };

  const irPara = (em: number) => {
    const v = video.current;
    if (!v) return;
    v.currentTime = em;
    v.play().catch(() => {});
  };

  const mudarVelocidade = (v: number) => {
    setVelocidade(v);
    if (video.current) video.current.playbackRate = v;
  };

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: ESTILO }} />
      <button
        type="button"
        className="fh-tutorial-botao"
        onClick={abrir}
        title={`Vídeo de ${duracaoEmMinutos(tutorial.duracao)}: ${tutorial.titulo}`}
        aria-label="Tutorial: como usar esta tela"
      >
        <PlayCircle size={15} />
        <span>Tutorial</span>
        {!jaViu && <i className="fh-tutorial-novo" aria-hidden="true" />}
      </button>

      {aberto && typeof document !== "undefined" && createPortal(
        <div className="fh-tutorial-fundo" onMouseDown={(e) => { if (e.target === e.currentTarget) fechar(); }}>
          <div className="fh-tutorial-janela" role="dialog" aria-modal="true" aria-label={tutorial.titulo}>
            <div className="fh-tutorial-topo">
              <h2>{tutorial.titulo}</h2>
              <button ref={fecharRef} type="button" className="fh-tutorial-fechar" onClick={fechar} aria-label="Fechar o vídeo">
                <X size={17} />
              </button>
            </div>

            {tutoriais.length > 1 && (
              <div className="fh-tutorial-outros">
                {tutoriais.map((t, i) => (
                  <button key={t.id} type="button" aria-pressed={i === qual} onClick={() => { setQual(i); setSegundo(0); }}>
                    {t.titulo} · {duracaoEmMinutos(t.duracao)}
                  </button>
                ))}
              </div>
            )}

            <div className="fh-tutorial-corpo">
              <div>
                <video
                  key={tutorial.id}
                  ref={video}
                  className="fh-tutorial-video"
                  src={arquivos.video}
                  poster={arquivos.capa}
                  controls
                  autoPlay
                  playsInline
                  preload="metadata"
                  onLoadedMetadata={() => { ligarLegenda(); if (video.current) video.current.playbackRate = velocidade; }}
                  onTimeUpdate={(e) => setSegundo(e.currentTarget.currentTime)}
                >
                  <track kind="captions" src={arquivos.legendas} srcLang="pt-BR" label="Português" default />
                </video>
                <div className="fh-tutorial-barra">
                  Velocidade
                  {VELOCIDADES.map((v) => (
                    <button key={v} type="button" aria-pressed={velocidade === v} onClick={() => mudarVelocidade(v)}>
                      {String(v).replace(".", ",")}x
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="fh-tutorial-lista-titulo">Neste vídeo</div>
                <ol className="fh-tutorial-lista">
                  {tutorial.capitulos.map((c, i) => (
                    <li key={c.em}>
                      <button type="button" className="fh-tutorial-capitulo" aria-current={i === capituloAtual} onClick={() => irPara(c.em)}>
                        <time>{relogio(c.em)}</time>
                        {c.titulo}
                      </button>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
