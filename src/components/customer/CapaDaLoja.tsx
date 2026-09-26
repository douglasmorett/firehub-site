"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A CAPA DO CARDÁPIO: a imagem da loja e, quando ela tem, o vídeo por cima.
 *
 * A imagem sai no HTML do servidor e é o primeiro paint (e o pôster). O vídeo
 * só entra depois de o React assumir a página, por três motivos:
 *
 *  - `muted` no JSX não vira atributo no HTML do servidor (o React só liga a
 *    propriedade depois), e o navegador recusa autoplay de vídeo que nasce com
 *    som — a capa ficaria parada. Montado no cliente, o `muted` vai antes do
 *    `play()`.
 *  - Quem pediu menos animação ou economia de dados fica só com a imagem: é o
 *    vídeo que custaria alguns MB de internet a cada visita.
 *  - O vídeo que não toca (codec que o aparelho não tem, rede caiu) some, e a
 *    imagem continua ali — nunca um retângulo preto.
 */
export default function CapaDaLoja({ imagem, video, nome }: { imagem: string | null; video: string | null; nome: string }) {
  const [tocar, setTocar] = useState(false);
  const [tocando, setTocando] = useState(false);
  const el = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!video) return;
    const menosMovimento = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const economia = typeof navigator !== "undefined" && (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
    // Sem imagem não há o que mostrar no lugar: aí o vídeo aparece mesmo assim, parado.
    setTocar(!(menosMovimento || economia) || !imagem);
  }, [video, imagem]);

  useEffect(() => {
    const v = el.current;
    if (!tocar || !v) return;
    v.muted = true;
    v.play().catch(() => {
      // Autoplay recusado (modo economia de energia do iPhone): fica a imagem.
    });
  }, [tocar]);

  return (
    <div className="store-banner">
      {imagem && <img src={imagem} alt={nome} fetchPriority="high" decoding="async" />}
      {video && tocar && (
        <video
          ref={el}
          className={`store-banner-video${tocando || !imagem ? " tocando" : ""}`}
          src={video}
          poster={imagem || undefined}
          muted
          loop
          playsInline
          autoPlay
          preload="auto"
          aria-hidden
          onPlaying={() => setTocando(true)}
          onError={() => setTocar(false)}
        />
      )}
      <div className="store-banner-overlay" />
    </div>
  );
}
