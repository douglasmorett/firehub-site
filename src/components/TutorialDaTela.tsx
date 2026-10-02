"use client";

/**
 * TutorialDaTela — o botão "Tutorial" da barra do topo e a janela do vídeo.
 *
 * Mora na barra do topo (StoreTopNav), uma vez só: descobre pela rota qual
 * vídeo é o da tela aberta (lib/tutoriais.ts) e, se não houver, não desenha
 * nada. Sutil de propósito — é ajuda para quem procura, não propaganda: sem
 * abrir sozinho, sem balão, sem piscar. O único chamariz é uma bolinha até a
 * pessoa assistir uma vez. O rótulo diz de qual tela é o vídeo ("Tutorial
 * Pedidos", lib/tutoriais.ts › NOMES). Só quando cabe: a barra do topo quebra
 * linha quando falta espaço, e o espaço livre depende do nome da loja, do menu
 * recolhido, dos botões do iFood. O botão mede — se o nome faz a barra quebrar,
 * fica só "Tutorial"; se volta a sobrar espaço, o nome volta. Barra em duas
 * linhas empurra a tela inteira para baixo (foi o que a gravação de 1366 px
 * mostrou com "Tutorial Início").
 *
 * Todos os vídeos juntos, um depois do outro, ficam na central de tutoriais
 * (CentralDeTutoriais), que abre depois do login; o link "Todos os tutoriais"
 * da janela leva até ela.
 *
 * A janela abre por cima da tela, sem trocar de página: o lojista assiste,
 * fecha e continua de onde estava. Capítulos ao lado levam direto ao ponto
 * ("só quero ver como cancela"), e a legenda vem ligada porque cozinha e
 * balcão são barulhentos.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { Play, PlayCircle, X } from "lucide-react";
import { useTutoriaisEnviados } from "@/components/TutoriaisEnviados";
import { arquivosDoTutorial, duracaoEmMinutos, indiceInicial, nomeDaTela, relogio, tutoriaisDaTela, type Tutorial } from "@/lib/tutoriais";

export const CHAVE_VISTO = "firehub_tutorial_visto:";
export const VELOCIDADES = [1, 1.25, 1.5];

/**
 * Encaixa a janela por cima na parte da tela que a pessoa VÊ.
 *
 * No celular, tela com conteúdo mais largo que o aparelho (o Início tinha
 * cartões de 400 px numa tela de 390) faz o navegador alargar a página
 * inteira: `position: fixed; inset: 0` passa a cobrir 482 × 1044 enquanto a
 * pessoa enxerga 390 × 844, e a janela do vídeo sai cortada, com o rodapé fora
 * de alcance. O `visualViewport` diz a área visível; quando ela difere da
 * página, o fundo é posto exatamente sobre ela.
 */
export function useNaAreaVisivel(ativo: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    const el = ref.current;
    if (!ativo || !vv || !el) return;
    const ajustar = () => {
      const igual = Math.abs(window.innerWidth - vv.width) < 2 && Math.abs(window.innerHeight - vv.height) < 2;
      el.style.left = igual ? "" : `${vv.offsetLeft}px`;
      el.style.top = igual ? "" : `${vv.offsetTop}px`;
      el.style.width = igual ? "" : `${vv.width}px`;
      el.style.height = igual ? "" : `${vv.height}px`;
      el.style.right = igual ? "" : "auto";
      el.style.bottom = igual ? "" : "auto";
    };
    ajustar();
    vv.addEventListener("resize", ajustar);
    vv.addEventListener("scroll", ajustar);
    return () => {
      vv.removeEventListener("resize", ajustar);
      vv.removeEventListener("scroll", ajustar);
    };
  }, [ativo]);
  return ref;
}

/** Evento que abre a central com todos os vídeos (quem escuta: CentralDeTutoriais). */
export const ABRIR_CENTRAL = "firehub:abrir-central-de-tutoriais";

/** "Não mostrar mais tutoriais" da faixa no alto das telas (por aparelho). */
const CHAVE_FAIXA_OCULTA = "firehub_faixa_tutorial_oculta";

export const ESTILO = `
.fh-tutorial-faixa{display:flex;align-items:center;gap:14px;background:#fff;border:1px solid #F1E4DA;border-radius:14px;padding:10px 14px;box-shadow:0 1px 2px rgba(15,23,42,.04)}
.fh-tutorial-miniatura{position:relative;flex:none;width:96px;height:54px;border-radius:9px;overflow:hidden;border:0;padding:0;cursor:pointer;background:#0F172A}
.fh-tutorial-miniatura img{width:100%;height:100%;object-fit:cover;display:block;opacity:.9}
.fh-tutorial-miniatura .fh-tutorial-play{position:absolute;inset:0;margin:auto;width:28px;height:28px;border-radius:50%;background:#fff;color:#C92E09;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,.35)}
.fh-tutorial-miniatura:hover img{opacity:1}
.fh-tutorial-faixa-texto{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.fh-tutorial-faixa-texto b{font-size:.88rem;color:#1C1917;font-weight:800}
.fh-tutorial-faixa-texto span{font-size:.78rem;color:#64748B;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fh-tutorial-acoes{display:flex;align-items:center;gap:12px;flex:none}
.fh-tutorial-assistir{display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 14px;border-radius:9px;border:0;background:#E8360C;color:#fff;font-weight:800;font-size:.8rem;cursor:pointer;font-family:inherit}
.fh-tutorial-assistir:hover{background:#C92E09}
.fh-tutorial-ocultar{border:0;background:none;color:#94A3B8;font-size:.72rem;text-decoration:underline;cursor:pointer;font-family:inherit;white-space:nowrap;padding:0}
.fh-tutorial-ocultar:hover{color:#475569}
@media (max-width:640px){.fh-tutorial-faixa{flex-wrap:wrap;gap:8px 10px;padding:10px}.fh-tutorial-miniatura{width:80px;height:45px}
  .fh-tutorial-faixa-texto b{font-size:.84rem}
  .fh-tutorial-faixa-texto span{white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
  .fh-tutorial-acoes{width:100%;justify-content:space-between}.fh-tutorial-assistir{height:32px}.fh-tutorial-ocultar{font-size:.7rem}}
.fh-tutorial-botao{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 10px;border-radius:9px;
  background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.25);color:#fff;font-weight:700;font-size:.72rem;
  cursor:pointer;white-space:nowrap;position:relative;font-family:inherit}
.fh-tutorial-botao:hover{background:rgba(255,255,255,.24)}
.fh-tutorial-botao.claro{background:#FAF6F2;border-color:#E7DDD3;color:#1C1917;height:36px;border-radius:8px;font-size:.85rem;font-weight:800}
.fh-tutorial-botao.claro:hover{background:#F3ECE4}
.fh-tutorial-botao.claro .fh-tutorial-novo{border-color:#fff;background:#E8360C}
.fh-tutorial-novo{position:absolute;top:-3px;right:-3px;width:9px;height:9px;border-radius:50%;background:#FDE047;border:2px solid #C92E09}
@media (max-width:1180px){.fh-tutorial-botao:not(.fixo) span{display:none}.fh-tutorial-botao:not(.fixo){padding:0;width:32px;justify-content:center}}
.fh-tutorial-video.em-pe{aspect-ratio:auto;height:min(70vh,660px);width:auto;max-width:100%;margin:0 auto;background:#0F172A}
.fh-tutorial-fundo{position:fixed;inset:0;z-index:100000;background:rgba(15,23,42,.62);display:flex;align-items:center;justify-content:center;padding:16px}
.fh-tutorial-janela{background:#fff;border-radius:16px;width:min(1080px,100%);max-height:100%;overflow:auto;
  box-shadow:0 24px 60px rgba(0,0,0,.35);color:#0F172A}
.fh-tutorial-topo{display:flex;align-items:center;gap:12px;padding:14px 16px 12px 20px}
.fh-tutorial-topo h2{margin:0;font-size:1.02rem;font-weight:800;flex:1;min-width:0}
.fh-tutorial-todos{border:1px solid #E2E8F0;background:#fff;border-radius:9px;height:34px;padding:0 12px;font-weight:700;font-size:.78rem;cursor:pointer;color:#334155;font-family:inherit;white-space:nowrap}
.fh-tutorial-todos:hover{background:#F8FAFC}
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

export default function TutorialDaTela({
  rota,
  tom = "escuro",
  rotulo,
  foraDoPainel = false,
  variante = "botao",
  chamada = "Tem um tutorial desta tela",
  ocultavel = true,
  estilo,
}: {
  /**
   * De qual tela é o vídeo, quando não é a da URL: a Roteirização também abre
   * como janela por cima de Pedidos, e ali o vídeo certo continua sendo o dela.
   */
  rota?: string;
  /** "claro" para cabeçalho de fundo claro (Roteirização); o padrão é a barra vermelha do topo. */
  tom?: "escuro" | "claro";
  /** Texto fixo do botão, que não some no celular (o app do motoboy: "Tutorial", "Como usar o aplicativo"). */
  rotulo?: string;
  /** Fora do painel (app do motoboy) não há a central: some o "Todos os tutoriais". */
  foraDoPainel?: boolean;
  /**
   * "faixa": o cartão no alto da tela (miniatura com ▶, "Tem um tutorial desta
   * tela", título e duração, Assistir). Pedido do Douglas em 02/10/2026, no
   * modelo do Avalyo: é um ACRÉSCIMO — o botão do topo e o do menu lateral continuam.
   */
  variante?: "botao" | "faixa";
  /** Primeira linha da faixa. */
  chamada?: string;
  /** Faixa com "Não mostrar mais tutoriais" (a das telas). A do App Motoboys não some. */
  ocultavel?: boolean;
  /** Margem da faixa onde ela é montada. */
  estilo?: React.CSSProperties;
} = {}) {
  const pathname = usePathname();
  const tutoriais = tutoriaisDaTela(rota || pathname, useTutoriaisEnviados());
  const nome = nomeDaTela(rota || pathname);
  const [aberto, setAberto] = useState(false);
  const [qual, setQual] = useState(0);
  const [jaViu, setJaViu] = useState(true); // começa "visto" para a bolinha não piscar antes de ler o navegador
  const [segundo, setSegundo] = useState(0);
  const [velocidade, setVelocidade] = useState(1);
  const video = useRef<HTMLVideoElement>(null);
  const fecharRef = useRef<HTMLButtonElement>(null);
  const botaoRef = useRef<HTMLButtonElement>(null);
  const fundoRef = useNaAreaVisivel(aberto);
  const [comNome, setComNome] = useState(true);
  // Começa escondida: quem já pediu "não mostrar mais" não vê a faixa piscar antes de ler o navegador.
  const [faixaOculta, setFaixaOculta] = useState(true);
  useEffect(() => {
    if (variante !== "faixa") return;
    let oculta = false;
    try {
      oculta = ocultavel && localStorage.getItem(CHAVE_FAIXA_OCULTA) === "1";
    } catch {}
    setFaixaOculta(oculta);
  }, [variante, ocultavel]);
  const larguraDoNome = useRef(0);

  // O nome no botão só fica se a barra do topo continua numa linha só.
  // Estrutura da StoreTopNav: barra (flex, quebra linha) > [grupo da esquerda, grupo com este botão].
  useLayoutEffect(() => {
    const botao = botaoRef.current;
    const grupo = botao?.parentElement;
    const barra = grupo?.parentElement;
    const esquerda = barra?.firstElementChild;
    if (!nome || !botao || !grupo || !barra || !esquerda || esquerda === grupo || typeof ResizeObserver === "undefined") return;
    const medir = () => {
      const n = botao.querySelector<HTMLElement>(".fh-tutorial-nome");
      if (n && n.offsetWidth) larguraDoNome.current = n.offsetWidth;
      const g = grupo.getBoundingClientRect();
      const e = esquerda.getBoundingClientRect();
      const quebrou = g.top > e.top + e.height / 2 || g.height > botao.offsetHeight * 1.6;
      setComNome((tinha) => (tinha ? !quebrou : !quebrou && g.left - e.right >= larguraDoNome.current + 12));
    };
    medir();
    const observador = new ResizeObserver(medir);
    observador.observe(barra);
    return () => observador.disconnect();
  }, [nome]);

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
    // Em tela com vários vídeos (Minha loja), abre o da seção em que a pessoa está.
    setQual(indiceInicial(tutoriais, typeof window !== "undefined" ? window.location.hash : ""));
    setSegundo(0);
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

  const ocultarFaixa = () => {
    try {
      localStorage.setItem(CHAVE_FAIXA_OCULTA, "1");
    } catch {}
    setFaixaOculta(true);
  };
  if (variante === "faixa" && faixaOculta) return null;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: ESTILO }} />
      {variante === "faixa" ? (
        <div className="fh-tutorial-faixa" style={estilo}>
          <button type="button" className="fh-tutorial-miniatura" onClick={abrir} aria-label={`Assistir: ${tutorial.titulo}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={arquivosDoTutorial(tutoriais[0]).capa} alt="" loading="lazy" />
            <span className="fh-tutorial-play"><Play size={14} fill="currentColor" /></span>
          </button>
          <div className="fh-tutorial-faixa-texto">
            <b>{chamada}</b>
            <span>
              {tutoriais[0].titulo} · {relogio(tutoriais[0].duracao)}
              {tutoriais.length > 1 && ` · e mais ${tutoriais.length - 1} ${tutoriais.length === 2 ? "vídeo" : "vídeos"} desta tela`}
            </span>
          </div>
          <div className="fh-tutorial-acoes">
            <button type="button" className="fh-tutorial-assistir" onClick={abrir}>
              <Play size={13} fill="currentColor" /> Assistir
            </button>
            {ocultavel && (
              <button type="button" className="fh-tutorial-ocultar" onClick={ocultarFaixa}>Não mostrar mais tutoriais</button>
            )}
          </div>
        </div>
      ) : (
      <button
        type="button"
        ref={botaoRef}
        className={`fh-tutorial-botao${tom === "claro" ? " claro" : ""}${rotulo ? " fixo" : ""}`}
        onClick={abrir}
        title={`Vídeo de ${duracaoEmMinutos(tutorial.duracao)}: ${tutorial.titulo}`}
        aria-label={nome ? `Tutorial da tela ${nome}` : "Tutorial: como usar esta tela"}
      >
        <PlayCircle size={15} />
        <span>{rotulo || <>Tutorial{nome && comNome && <b className="fh-tutorial-nome"> {nome}</b>}</>}</span>
        {!jaViu && <i className="fh-tutorial-novo" aria-hidden="true" />}
      </button>
      )}

      {aberto && typeof document !== "undefined" && createPortal(
        <div ref={fundoRef} className="fh-tutorial-fundo" onMouseDown={(e) => { if (e.target === e.currentTarget) fechar(); }}>
          <div className="fh-tutorial-janela" role="dialog" aria-modal="true" aria-label={tutorial.titulo}>
            <div className="fh-tutorial-topo">
              <h2>{tutorial.titulo}</h2>
              {!foraDoPainel && <button type="button" className="fh-tutorial-todos" onClick={() => { fechar(); window.dispatchEvent(new Event(ABRIR_CENTRAL)); }}>
                Todos os tutoriais
              </button>}
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
                  className={tutorial.emPe ? "fh-tutorial-video em-pe" : "fh-tutorial-video"}
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
