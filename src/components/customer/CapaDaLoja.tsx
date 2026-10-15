"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";

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
 *
 * VÍDEO EM FAIXA NO CELULAR. A capa do PC é 1200×220 (5,5:1) e a do celular
 * ~390×160 (2,4:1). Uma faixa feita para o PC — a da Map Grill é 1920×352,
 * cinco cortes lado a lado — no celular mostrava só os 2 ou 3 do meio (o
 * Douglas, 15/10/2026: "podia aparecer mais do vídeo, igual no PC"). Quando o
 * vídeo, na altura da capa, passa de 1,3× a largura dela, ele fica inteiro na
 * altura e anda devagar de um lado ao outro, parando um pouco em cada ponta:
 * todos os cortes passam pela tela. Vídeo comum (16:9, em pé) não chega nessa
 * conta e continua como sempre.
 */
export default function CapaDaLoja({ imagem, video, nome }: { imagem: string | null; video: string | null; nome: string }) {
  const [tocar, setTocar] = useState(false);
  const [tocando, setTocando] = useState(false);
  /** Quanto o vídeo em faixa anda (px, negativo) e em quantos segundos; null = parado. */
  const [passeio, setPasseio] = useState<{ px: number; s: number } | null>(null);
  const el = useRef<HTMLVideoElement>(null);
  const caixa = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    const v = el.current;
    const c = caixa.current;
    if (!tocar || !v || !c) return;
    const medir = () => {
      if (!v.videoWidth || !v.videoHeight || !c.clientHeight) return;
      const larguraNaAltura = (c.clientHeight * v.videoWidth) / v.videoHeight;
      const sobra = larguraNaAltura - c.clientWidth;
      if (larguraNaAltura < c.clientWidth * 1.3) return setPasseio(null);
      // ~30 px por segundo: devagar o bastante para ver cada corte.
      setPasseio({ px: -Math.round(sobra), s: Math.max(8, Math.round(sobra / 30)) });
    };
    medir();
    v.addEventListener("loadedmetadata", medir);
    const obs = typeof ResizeObserver !== "undefined" ? new ResizeObserver(medir) : null;
    obs?.observe(c);
    return () => {
      v.removeEventListener("loadedmetadata", medir);
      obs?.disconnect();
    };
  }, [tocar]);

  return (
    <div className="store-banner" ref={caixa}>
      {imagem && <img src={imagem} alt={nome} fetchPriority="high" decoding="async" />}
      {video && tocar && (
        <video
          ref={el}
          className={`store-banner-video${tocando || !imagem ? " tocando" : ""}${passeio ? " passeando" : ""}`}
          style={passeio ? ({ "--passeio": `${passeio.px}px`, "--passeio-s": `${passeio.s}s` } as CSSProperties) : undefined}
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
