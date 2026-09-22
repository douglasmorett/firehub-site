"use client";

/**
 * /src/lib/useArrastavel.ts
 *
 * Regra única de "esse botão flutuante pode ser arrastado para fora do caminho".
 *
 * Por que existe: na tela de pedidos as bolinhas de conversa ficam no canto
 * inferior direito, exatamente onde ficam os botões de "ver comanda" e "editar"
 * do último pedido da coluna. Esconder o widget não serve — a bolinha de
 * suporte humano é o ÚNICO lugar do sistema onde o lojista vê a conversa que o
 * robô passou para uma pessoa. Então em vez de sumir, ela sai do caminho.
 *
 * A posição NÃO é guardada. Foi decisão do dono: arrasta para destravar o
 * clique agora, e ao recarregar a tela tudo volta para o mesmo canto. Duas
 * máquinas da mesma loja nunca ficam com o painel diferente uma da outra, e
 * ninguém precisa "arrumar" um botão que alguém largou no meio da tela ontem.
 *
 * Por isso o deslocamento mora em estado de React e mais nada: sem
 * localStorage, sem banco, sem cookie.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as EventoDePonteiro,
} from "react";

/**
 * Quantos pixels o dedo/mouse precisa andar antes de virar arraste.
 *
 * Sem isso, o tremor da mão ao clicar já contaria como arraste e o chat nunca
 * abriria. Com isso, um clique continua sendo um clique.
 */
const LIMIAR_ARRASTE = 5;

/** Folga mínima entre o botão e a borda da tela, para ele nunca sumir. */
const MARGEM_DA_BORDA = 8;

export function useArrastavel() {
  const [desloc, setDesloc] = useState({ x: 0, y: 0 });

  const gesto = useRef({
    ativo: false,
    /** Onde o ponteiro estava quando o gesto começou. */
    px: 0,
    py: 0,
    /** Qual era o deslocamento quando o gesto começou. */
    dx: 0,
    dy: 0,
    /** O quanto ainda dá para andar em cada direção sem sair da tela. */
    limites: { minX: 0, maxX: 0, minY: 0, maxY: 0 },
    /** Passou do limiar: foi arraste, não clique. */
    moveu: false,
  });

  // A janela mudou de tamanho (redimensionou, girou o tablet, deu zoom): o
  // deslocamento foi calculado contra a tela ANTIGA, então o botão pode ter
  // acabado fora da nova. Volta para o canto de origem, que é sempre válido.
  useEffect(() => {
    const aoRedimensionar = () => setDesloc({ x: 0, y: 0 });
    window.addEventListener("resize", aoRedimensionar);
    return () => window.removeEventListener("resize", aoRedimensionar);
  }, []);

  const onPointerDown = useCallback(
    (e: EventoDePonteiro<HTMLElement>) => {
      // Só botão principal do mouse. O botão direito abre o menu do navegador e
      // nunca solta um pointerup aqui — o gesto ficaria preso em "ativo".
      if (e.pointerType === "mouse" && e.button !== 0) return;

      const alca = e.currentTarget;
      const r = alca.getBoundingClientRect();
      const g = gesto.current;

      g.ativo = true;
      g.moveu = false;
      g.px = e.clientX;
      g.py = e.clientY;
      g.dx = desloc.x;
      g.dy = desloc.y;

      // Os limites são medidos na ALÇA (a bolinha), não na janela do chat: o
      // que precisa continuar alcançável é o botão.
      g.limites = {
        minX: desloc.x - (r.left - MARGEM_DA_BORDA),
        maxX: desloc.x + (window.innerWidth - MARGEM_DA_BORDA - r.right),
        minY: desloc.y - (r.top - MARGEM_DA_BORDA),
        maxY: desloc.y + (window.innerHeight - MARGEM_DA_BORDA - r.bottom),
      };

      // Sem a captura, arrastar rápido tira o ponteiro de cima da bolinha e o
      // gesto morre no meio, largando o botão onde não se quis.
      try {
        alca.setPointerCapture(e.pointerId);
      } catch {}
    },
    [desloc],
  );

  const onPointerMove = useCallback((e: EventoDePonteiro<HTMLElement>) => {
    const g = gesto.current;
    if (!g.ativo) return;

    const dx = e.clientX - g.px;
    const dy = e.clientY - g.py;

    if (!g.moveu && Math.hypot(dx, dy) < LIMIAR_ARRASTE) return;
    g.moveu = true;

    setDesloc({
      x: Math.min(g.limites.maxX, Math.max(g.limites.minX, g.dx + dx)),
      y: Math.min(g.limites.maxY, Math.max(g.limites.minY, g.dy + dy)),
    });
  }, []);

  const encerrar = useCallback((e: EventoDePonteiro<HTMLElement>) => {
    const g = gesto.current;
    if (!g.ativo) return;
    g.ativo = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}

    // O `click` que o navegador dispara depois deste pointerup ainda precisa
    // enxergar `moveu` como true — é ele que o onClick engole para não abrir o
    // chat no fim do arraste. Só que a marca não pode ficar ligada para sempre:
    // quem depois chegasse no botão pelo teclado e apertasse Enter dispararia um
    // click SEM pointerdown antes, o `moveu` continuaria true e o botão ficaria
    // morto. O timeout roda na tarefa seguinte — depois do click, antes de
    // qualquer coisa que o usuário faça em seguida.
    setTimeout(() => {
      g.moveu = false;
    }, 0);
  }, []);

  /**
   * O gesto que acabou de terminar foi arraste?
   *
   * O onClick do botão pergunta isso antes de abrir o chat: quem larga a
   * bolinha em outro canto não quer a janela aberta na cara.
   */
  const arrastou = useCallback(() => gesto.current.moveu, []);

  return {
    /** Vai no CONTÊINER do widget (o que tem o position: fixed). */
    estiloDoContainer: {
      transform: `translate(${desloc.x}px, ${desloc.y}px)`,
    } as CSSProperties,

    /**
     * Vai na ALÇA — a bolinha. Só handlers: o estilo de cada botão é dele, e
     * sobrescrever daqui apagaria o gradiente e a sombra que já existem.
     *
     * A alça também precisa de `touch-action: none` no estilo dela, senão no
     * tablet o navegador entende o arraste como rolagem da página e o botão
     * não sai do lugar.
     */
    alca: {
      onPointerDown,
      onPointerMove,
      onPointerUp: encerrar,
      onPointerCancel: encerrar,
    },

    arrastou,
  };
}
