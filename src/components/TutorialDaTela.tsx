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
 *
 * Tela com vários vídeos (Cardápio tem 4, Minha loja 5): eram pílulas de
 * texto no alto da janela, e o Douglas abriu, assistiu o primeiro e não
 * percebeu que havia outros três (02/10/2026). Agora é uma fileira de cartões
 * numerados com a capa de cada vídeo ("Esta tela tem 4 vídeos"), o título diz
 * "vídeo 1 de 4", e quando um acaba o próximo começa sozinho depois de uma
 * contagem — a não ser que a pessoa cancele ou feche a janela.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { Check, ListVideo, Play, PlayCircle, X } from "lucide-react";
import { useTutoriaisEnviados } from "@/components/TutoriaisEnviados";
import { arquivosDoTutorial, duracaoEmMinutos, indiceInicial, nomeDaTela, relogio, titulosCurtos, tutoriaisDaTela, type Tutorial } from "@/lib/tutoriais";

export const CHAVE_VISTO = "firehub_tutorial_visto:";
export const VELOCIDADES = [1, 1.25, 1.5];

/** Segundos de contagem antes de o próximo vídeo da tela começar sozinho. */
const ESPERA_DO_PROXIMO = 6;

const CHAMADA_PADRAO = "Tem um tutorial desta tela";

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

/**
 * "Não mostrar mais nesta tela" da faixa no alto das telas: vale só para a tela
 * em que foi clicado (pedido do Douglas em 02/10/2026), por aparelho. A chave
 * leva o primeiro vídeo da tela, que é o que identifica a tela em lib/tutoriais.ts.
 */
const CHAVE_FAIXA_OCULTA = "firehub_faixa_tutorial_oculta:";

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
@media (max-width:860px){.fh-tutorial-corpo{grid-template-columns:1fr;padding:0 12px 14px}.fh-tutorial-topo{padding:12px}}
.fh-tutorial-miniatura.pilha{overflow:visible;background:none}
.fh-tutorial-miniatura.pilha::before,.fh-tutorial-miniatura.pilha::after{content:"";position:absolute;border-radius:9px;background:#F8B49A;z-index:0}
.fh-tutorial-miniatura.pilha::before{inset:-6px 10px auto 10px;height:10px;background:#FBD5C5}
.fh-tutorial-miniatura.pilha::after{inset:-3px 5px auto 5px;height:10px}
.fh-tutorial-miniatura.pilha img{position:relative;z-index:1;border-radius:9px;background:#0F172A}
.fh-tutorial-miniatura.pilha .fh-tutorial-play{z-index:2}
.fh-tutorial-qtd{position:absolute;z-index:2;right:4px;bottom:4px;background:rgba(15,23,42,.86);color:#fff;font-size:.62rem;font-weight:800;padding:1px 5px;border-radius:5px;line-height:1.5}
.fh-tutorial-cabeca{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
.fh-tutorial-sobre{font-size:.68rem;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#C2410C;white-space:nowrap}
@media (max-width:520px){.fh-tutorial-sobre-tela{display:none}}
.fh-tutorial-serie{margin:0 16px 14px 20px;padding:10px 12px 12px;border:1px solid #F5D0C0;background:#FFF8F4;border-radius:14px}
.fh-tutorial-serie-topo{display:flex;align-items:center;gap:4px 12px;flex-wrap:wrap;margin:0 2px 9px}
.fh-tutorial-serie-topo b{display:inline-flex;align-items:center;gap:6px;font-size:.9rem;font-weight:800;color:#9A2A0A}
.fh-tutorial-serie-topo span{font-size:.76rem;color:#7C5A4A}
.fh-tutorial-serie-topo em{margin-left:auto;font-style:normal;font-size:.72rem;font-weight:700;color:#64748B;display:inline-flex;align-items:center;gap:4px}
.fh-tutorial-cartoes{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(var(--n),minmax(0,1fr));gap:8px}
.fh-tutorial-cartoes li{min-width:0}
.fh-tutorial-cartao{display:flex;align-items:center;gap:10px;width:100%;height:100%;text-align:left;padding:6px 8px 6px 6px;border-radius:11px;border:1.5px solid #EADFD6;background:#fff;cursor:pointer;font-family:inherit;color:#1C1917}
.fh-tutorial-cartao:hover{border-color:#F0A584}
.fh-tutorial-cartao[aria-current="true"]{border-color:#E8360C;box-shadow:0 0 0 3px rgba(232,54,12,.14)}
.fh-tutorial-cartao-capa{position:relative;flex:none;width:84px;aspect-ratio:16/9;border-radius:7px;overflow:hidden;background:#0F172A}
.fh-tutorial-cartao-capa img{width:100%;height:100%;object-fit:cover;display:block}
.fh-tutorial-cartao-capa i{position:absolute;top:4px;left:4px;min-width:20px;height:20px;padding:0 5px;border-radius:999px;background:rgba(15,23,42,.86);color:#fff;font-style:normal;font-size:.72rem;font-weight:800;display:flex;align-items:center;justify-content:center}
.fh-tutorial-cartao[aria-current="true"] .fh-tutorial-cartao-capa i{background:#E8360C}
.fh-tutorial-cartao-texto{min-width:0;display:flex;flex-direction:column;gap:3px}
.fh-tutorial-cartao-texto b{font-size:.78rem;font-weight:800;line-height:1.25;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.fh-tutorial-cartao-texto small{font-size:.7rem;color:#64748B;font-weight:600;display:flex;align-items:center;gap:4px;white-space:nowrap}
.fh-tutorial-cartao-texto .agora{color:#C2410C;font-weight:800;display:inline-flex;align-items:center;gap:3px}
.fh-tutorial-cartao-texto .visto{color:#15803D;font-weight:800;display:inline-flex;align-items:center;gap:3px}
.fh-tutorial-serie.muitos .fh-tutorial-cartao-capa{width:64px}
.fh-tutorial-palco{position:relative}
.fh-tutorial-fim{position:absolute;inset:0;border-radius:12px;background:rgba(15,23,42,.9);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;color:#fff;text-align:center;padding:16px}
.fh-tutorial-fim-rotulo{font-size:.72rem;font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:#FDBA74}
.fh-tutorial-fim-proximo{display:flex;align-items:center;gap:12px;max-width:min(460px,100%);text-align:left}
.fh-tutorial-fim-proximo img{flex:none;width:120px;aspect-ratio:16/9;object-fit:cover;border-radius:8px;border:2px solid rgba(255,255,255,.25)}
.fh-tutorial-fim-proximo b,.fh-tutorial-fim-titulo{font-size:1.02rem;font-weight:800;line-height:1.3}
.fh-tutorial-fim-conta{font-size:.82rem;color:#CBD5E1;font-variant-numeric:tabular-nums}
.fh-tutorial-fim-barra{display:block;width:min(260px,70%);height:4px;border-radius:99px;background:rgba(255,255,255,.18);overflow:hidden;position:relative}
.fh-tutorial-fim-barra::after{content:"";position:absolute;inset:0;background:#FB923C;transform-origin:left;animation:fh-tutorial-encher var(--espera) linear forwards}
@keyframes fh-tutorial-encher{from{transform:scaleX(0)}to{transform:scaleX(1)}}
.fh-tutorial-fim-ok{width:44px;height:44px;border-radius:50%;background:#16A34A;display:flex;align-items:center;justify-content:center}
.fh-tutorial-fim-sub{font-size:.82rem;color:#CBD5E1;max-width:420px}
.fh-tutorial-fim-botoes{display:flex;gap:8px;flex-wrap:wrap;justify-content:center;margin-top:4px}
.fh-tutorial-fim-botoes button{display:inline-flex;align-items:center;gap:6px;height:38px;padding:0 16px;border-radius:10px;border:1px solid rgba(255,255,255,.35);background:transparent;color:#fff;font-weight:800;font-size:.84rem;cursor:pointer;font-family:inherit}
.fh-tutorial-fim-botoes button.sim{background:#E8360C;border-color:#E8360C}
.fh-tutorial-fim-botoes button.sim:hover{background:#C92E09}
.fh-tutorial-fim-botoes button:not(.sim):hover{background:rgba(255,255,255,.1)}
.fh-tutorial-barra .fh-tutorial-proximo{margin-left:auto;display:inline-flex;align-items:center;gap:6px;max-width:100%;border-color:#F5D0C0;background:#FFF8F4;color:#9A2A0A;padding:5px 11px}
.fh-tutorial-proximo span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
@media (max-width:860px){
  .fh-tutorial-serie{margin:0 12px 12px;padding:9px 10px 10px}
  .fh-tutorial-serie-topo em{margin-left:0}
  .fh-tutorial-cartoes{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;padding:2px 2px 6px;-webkit-overflow-scrolling:touch}
  .fh-tutorial-cartoes li{flex:0 0 min(250px,80%);scroll-snap-align:start}
  .fh-tutorial-fim-proximo img{width:84px}
  .fh-tutorial-fim-proximo b,.fh-tutorial-fim-titulo{font-size:.9rem}
  .fh-tutorial-fim{gap:7px;padding:10px}
  .fh-tutorial-fim-botoes button{height:34px;padding:0 12px;font-size:.78rem}
}
@media (prefers-reduced-motion:reduce){.fh-tutorial-fim-barra::after{animation:none;transform:scaleX(1)}}
`;

export default function TutorialDaTela({
  rota,
  tom = "escuro",
  rotulo,
  foraDoPainel = false,
  variante = "botao",
  chamada = CHAMADA_PADRAO,
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
  /** Faixa com "Não mostrar mais nesta tela" (a das telas). A do App Motoboys não some. */
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
  // A resposta guarda de qual tela ela é: ao trocar para uma tela escondida, a faixa não pisca.
  const [faixaLiberada, setFaixaLiberada] = useState<string | null>(null);
  const telaDaFaixa = tutoriais[0]?.id;
  // A faixa mora no layout e não remonta ao trocar de tela: relê a escolha a cada tela.
  useEffect(() => {
    if (variante !== "faixa" || !telaDaFaixa) return;
    let oculta = false;
    try {
      oculta = ocultavel && localStorage.getItem(CHAVE_FAIXA_OCULTA + telaDaFaixa) === "1";
    } catch {}
    setFaixaLiberada(oculta ? null : telaDaFaixa);
  }, [variante, ocultavel, telaDaFaixa]);
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
  const total = tutoriais.length;
  const serie = total > 1;
  // Quais vídeos desta tela a pessoa já começou a assistir (o ✓ do cartão).
  const [vistos, setVistos] = useState<ReadonlySet<string>>(() => new Set());
  // O vídeo acabou: "proximo" mostra a contagem para o seguinte; "ultimo", o fim da série.
  const [fim, setFim] = useState<null | "proximo" | "ultimo">(null);
  const [contagem, setContagem] = useState(ESPERA_DO_PROXIMO);
  const cartoesRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    setQual(0);
    setAberto(false);
    setFim(null);
    if (!primeiroId) return;
    try {
      setJaViu(localStorage.getItem(CHAVE_VISTO + primeiroId) === "1");
    } catch {}
  }, [primeiroId]);

  const fechar = useCallback(() => {
    video.current?.pause();
    setFim(null);
    setAberto(false);
  }, []);

  /** Troca para outro vídeo da tela (o elemento de vídeo é outro: o autoPlay o começa). */
  const trocar = useCallback((i: number) => {
    setFim(null);
    if (i === qual) {
      const v = video.current;
      if (v) {
        if (v.ended) v.currentTime = 0;
        v.play().catch(() => {});
      }
      return;
    }
    setQual(i);
    setSegundo(0);
  }, [qual]);

  // A contagem do próximo vídeo. Fechar a janela ou cancelar desmonta a contagem.
  useEffect(() => {
    if (!aberto || fim !== "proximo") return;
    setContagem(ESPERA_DO_PROXIMO);
    const inicio = Date.now();
    const relogioDaEspera = window.setInterval(() => {
      const falta = ESPERA_DO_PROXIMO - Math.floor((Date.now() - inicio) / 1000);
      if (falta <= 0) {
        window.clearInterval(relogioDaEspera);
        trocar(qual + 1);
      } else {
        setContagem(falta);
      }
    }, 250);
    return () => window.clearInterval(relogioDaEspera);
  }, [aberto, fim, qual, trocar]);

  // No celular os cartões rolam de lado: o do vídeo que está tocando fica à vista.
  useEffect(() => {
    const lista = cartoesRef.current;
    const cartao = lista?.children[qual] as HTMLElement | undefined;
    if (!aberto || !lista || !cartao || lista.scrollWidth <= lista.clientWidth) return;
    lista.scrollTo({ left: Math.max(0, cartao.offsetLeft - lista.offsetLeft - 8), behavior: "smooth" });
  }, [aberto, qual]);

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

  const curtos = titulosCurtos(tutoriais);
  const assistidos = tutoriais.filter((t) => vistos.has(t.id)).length;
  const faltando = tutoriais.findIndex((t) => !vistos.has(t.id));

  const abrir = () => {
    // Em tela com vários vídeos (Minha loja), abre o da seção em que a pessoa está.
    setQual(indiceInicial(tutoriais, typeof window !== "undefined" ? window.location.hash : ""));
    setSegundo(0);
    setFim(null);
    setAberto(true);
    setJaViu(true);
    const v = new Set<string>();
    try {
      for (const t of tutoriais) if (localStorage.getItem(CHAVE_VISTO + t.id) === "1") v.add(t.id);
    } catch {}
    setVistos(v);
  };

  const marcarVisto = (id: string) => {
    try {
      localStorage.setItem(CHAVE_VISTO + id, "1");
    } catch {}
    setVistos((v) => (v.has(id) ? v : new Set(v).add(id)));
  };

  const acabou = () => {
    if (!serie) return;
    // Em tela cheia a contagem ficaria escondida atrás do vídeo.
    if (typeof document !== "undefined" && document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    setFim(qual < total - 1 ? "proximo" : "ultimo");
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
      if (telaDaFaixa) localStorage.setItem(CHAVE_FAIXA_OCULTA + telaDaFaixa, "1");
    } catch {}
    setFaixaLiberada(null);
  };
  if (variante === "faixa" && faixaLiberada !== telaDaFaixa) return null;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: ESTILO }} />
      {variante === "faixa" ? (
        <div className="fh-tutorial-faixa" style={estilo}>
          <button
            type="button"
            className={serie ? "fh-tutorial-miniatura pilha" : "fh-tutorial-miniatura"}
            onClick={abrir}
            aria-label={serie ? `Assistir os ${total} vídeos desta tela` : `Assistir: ${tutorial.titulo}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={arquivosDoTutorial(tutoriais[0]).capa} alt="" loading="lazy" />
            <span className="fh-tutorial-play"><Play size={14} fill="currentColor" /></span>
            {serie && <span className="fh-tutorial-qtd">{total} vídeos</span>}
          </button>
          <div className="fh-tutorial-faixa-texto">
            <b>{serie && chamada === CHAMADA_PADRAO ? `Esta tela tem ${total} vídeos tutoriais` : chamada}</b>
            <span>
              {serie
                ? curtos.map((c, i) => `${i + 1}. ${c}`).join("  ·  ")
                : `${tutoriais[0].titulo} · ${relogio(tutoriais[0].duracao)}`}
            </span>
          </div>
          <div className="fh-tutorial-acoes">
            <button type="button" className="fh-tutorial-assistir" onClick={abrir}>
              <Play size={13} fill="currentColor" /> {serie ? `Assistir os ${total}` : "Assistir"}
            </button>
            {ocultavel && (
              <button type="button" className="fh-tutorial-ocultar" onClick={ocultarFaixa}>Não mostrar mais nesta tela</button>
            )}
          </div>
        </div>
      ) : (
      <button
        type="button"
        ref={botaoRef}
        className={`fh-tutorial-botao${tom === "claro" ? " claro" : ""}${rotulo ? " fixo" : ""}`}
        onClick={abrir}
        title={serie ? `${total} vídeos desta tela: ${curtos.join(" · ")}` : `Vídeo de ${duracaoEmMinutos(tutorial.duracao)}: ${tutorial.titulo}`}
        aria-label={nome ? `Tutorial da tela ${nome}${serie ? ` (${total} vídeos)` : ""}` : "Tutorial: como usar esta tela"}
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
              <div className="fh-tutorial-cabeca">
                {serie && <span className="fh-tutorial-sobre">{nome && <span className="fh-tutorial-sobre-tela">{nome} · </span>}vídeo {qual + 1} de {total}</span>}
                <h2>{tutorial.titulo}</h2>
              </div>
              {!foraDoPainel && <button type="button" className="fh-tutorial-todos" onClick={() => { fechar(); window.dispatchEvent(new Event(ABRIR_CENTRAL)); }}>
                Todos os tutoriais
              </button>}
              <button ref={fecharRef} type="button" className="fh-tutorial-fechar" onClick={fechar} aria-label="Fechar o vídeo">
                <X size={17} />
              </button>
            </div>

            {serie && (
              <section className={total > 4 ? "fh-tutorial-serie muitos" : "fh-tutorial-serie"} aria-label={`Os ${total} vídeos desta tela`}>
                <div className="fh-tutorial-serie-topo">
                  <b><ListVideo size={16} /> Esta tela tem {total} vídeos</b>
                  <span>Assista na ordem: quando um termina, o próximo começa sozinho.</span>
                  <em><Check size={13} strokeWidth={3} /> {assistidos} de {total} assistidos</em>
                </div>
                <ol className="fh-tutorial-cartoes" ref={cartoesRef} style={{ ["--n" as string]: total }}>
                  {tutoriais.map((t, i) => {
                    const atual = i === qual;
                    return (
                      <li key={t.id}>
                        <button type="button" className="fh-tutorial-cartao" aria-current={atual} title={t.titulo} onClick={() => trocar(i)}>
                          <span className="fh-tutorial-cartao-capa">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={arquivosDoTutorial(t).capa} alt="" loading="lazy" />
                            <i>{i + 1}</i>
                          </span>
                          <span className="fh-tutorial-cartao-texto">
                            <b>{curtos[i]}</b>
                            <small>
                              {duracaoEmMinutos(t.duracao)}
                              {atual
                                ? <span className="agora">· <Play size={9} fill="currentColor" /> Assistindo</span>
                                : vistos.has(t.id) && <span className="visto">· <Check size={11} strokeWidth={3} /> Assistido</span>}
                            </small>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ol>
              </section>
            )}

            <div className="fh-tutorial-corpo">
              <div>
                <div className="fh-tutorial-palco">
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
                    onPlay={() => { setFim(null); marcarVisto(tutorial.id); }}
                    onTimeUpdate={(e) => setSegundo(e.currentTarget.currentTime)}
                    onEnded={acabou}
                  >
                    <track kind="captions" src={arquivos.legendas} srcLang="pt-BR" label="Português" default />
                  </video>

                  {serie && fim === "proximo" && (
                    <div className="fh-tutorial-fim" role="status">
                      <span className="fh-tutorial-fim-rotulo">A seguir · vídeo {qual + 2} de {total}</span>
                      <div className="fh-tutorial-fim-proximo">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={arquivosDoTutorial(tutoriais[qual + 1]).capa} alt="" />
                        <b>{curtos[qual + 1]}</b>
                      </div>
                      <span className="fh-tutorial-fim-conta">Começa em {contagem} s</span>
                      <i className="fh-tutorial-fim-barra" style={{ ["--espera" as string]: `${ESPERA_DO_PROXIMO}s` }} />
                      <div className="fh-tutorial-fim-botoes">
                        <button type="button" className="sim" onClick={() => trocar(qual + 1)}>
                          <Play size={14} fill="currentColor" /> Assistir agora
                        </button>
                        <button type="button" onClick={() => setFim(null)}>Cancelar</button>
                      </div>
                    </div>
                  )}

                  {serie && fim === "ultimo" && (
                    <div className="fh-tutorial-fim" role="status">
                      <span className="fh-tutorial-fim-ok"><Check size={24} strokeWidth={3} /></span>
                      <b className="fh-tutorial-fim-titulo">Este foi o último dos {total} vídeos desta tela.</b>
                      {faltando >= 0 && (
                        <span className="fh-tutorial-fim-sub">
                          Ainda falta assistir o vídeo {faltando + 1}: {curtos[faltando]}.
                        </span>
                      )}
                      <div className="fh-tutorial-fim-botoes">
                        {faltando >= 0 ? (
                          <>
                            <button type="button" className="sim" onClick={() => trocar(faltando)}>
                              <Play size={14} fill="currentColor" /> Assistir o vídeo {faltando + 1}
                            </button>
                            <button type="button" onClick={fechar}>Fechar</button>
                          </>
                        ) : (
                          <>
                            <button type="button" className="sim" onClick={fechar}>Fechar</button>
                            <button type="button" onClick={() => trocar(0)}>Rever do início</button>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>
                <div className="fh-tutorial-barra">
                  Velocidade
                  {VELOCIDADES.map((v) => (
                    <button key={v} type="button" aria-pressed={velocidade === v} onClick={() => mudarVelocidade(v)}>
                      {String(v).replace(".", ",")}x
                    </button>
                  ))}
                  {serie && qual < total - 1 && (
                    <button type="button" className="fh-tutorial-proximo" onClick={() => trocar(qual + 1)} title={tutoriais[qual + 1].titulo}>
                      <span>Próximo: {qual + 2}. {curtos[qual + 1]}</span> ›
                    </button>
                  )}
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
