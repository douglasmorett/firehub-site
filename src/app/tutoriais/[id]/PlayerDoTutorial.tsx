"use client";

import { useEffect, useRef, useState } from "react";
import { relogio, type Tutorial } from "@/lib/tutoriais";
import css from "../tutoriais.module.css";

type Arquivos = { video: string; capa: string; legendas: string };

/**
 * O vídeo e os capítulos da página pública. Tocar num capítulo pula o vídeo
 * para ele e põe `?t=` no endereço (copiar o link manda a pessoa para o mesmo
 * ponto). A legenda já vem ligada: quem abre pelo WhatsApp costuma estar com o
 * som desligado, na loja.
 */
export default function PlayerDoTutorial({ tutorial, arquivos, comecaEm }: { tutorial: Tutorial; arquivos: Arquivos; comecaEm: number }) {
  const video = useRef<HTMLVideoElement>(null);
  const [agora, setAgora] = useState(comecaEm);

  // O link com ?t= abre o vídeo parado no capítulo (tocar sozinho o navegador não deixa).
  useEffect(() => {
    const v = video.current;
    if (!v || comecaEm <= 0) return;
    const pular = () => {
      v.currentTime = comecaEm;
    };
    if (v.readyState >= 1) pular();
    else v.addEventListener("loadedmetadata", pular, { once: true });
    return () => v.removeEventListener("loadedmetadata", pular);
  }, [comecaEm]);

  const irPara = (em: number) => {
    const v = video.current;
    if (!v) return;
    v.currentTime = em;
    setAgora(em);
    void v.play().catch(() => {});
    window.history.replaceState(null, "", em > 0 ? `?t=${Math.floor(em)}` : window.location.pathname);
    v.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };

  const atual = tutorial.capitulos.reduce((achado, c, i) => (c.em <= agora + 0.25 ? i : achado), 0);

  return (
    <>
      <div className={tutorial.emPe ? `${css.tela} ${css.emPe}` : css.tela}>
        <video
          ref={video}
          controls
          playsInline
          preload="metadata"
          poster={arquivos.capa}
          onTimeUpdate={(e) => setAgora(e.currentTarget.currentTime)}
          aria-label={`Vídeo: ${tutorial.titulo}`}
        >
          <source src={arquivos.video} type="video/mp4" />
          <track kind="captions" src={arquivos.legendas} srcLang="pt-BR" label="Português" default />
        </video>
      </div>

      <section className={css.secao} aria-labelledby="capitulos">
        <h2 id="capitulos" className={css.secaoTitulo}>
          Capítulos
        </h2>
        <ol className={css.capitulos}>
          {tutorial.capitulos.map((c, i) => (
            <li key={`${c.em}-${c.titulo}`}>
              <button type="button" className={css.capitulo} onClick={() => irPara(c.em)} aria-current={i === atual ? "step" : undefined}>
                <span className={css.tempo}>{relogio(c.em)}</span>
                <span>{c.titulo}</span>
              </button>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
