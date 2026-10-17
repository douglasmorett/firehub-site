"use client";
/**
 * Fila de botões que quebra linha sem deixar um botão sozinho embaixo
 * (lib/linhas-equilibradas.ts). Mede a largura natural de cada filho, escolhe
 * quantos vão por linha e grava a base comum em `--bp-base` (+ `data-por-linha`)
 * no próprio elemento — o CSS (.bp-equilibra no StoreOrdersDashboard) faz o
 * resto. Sem React state: medir e gravar no DOM não redesenha o painel.
 *
 * `chave` muda quando o texto dos botões muda (Alta Demanda ligada, número de
 * agendamentos, botões ligados na engrenagem); a largura vem pelo
 * ResizeObserver e botão que entra ou sai (Wabiz) pelo MutationObserver.
 *
 * `quando`: os atalhos são arrumados FORA do celular (lá viram uma faixa que
 * corre para o lado); os filtros, SÓ no celular — fora dele a largura da
 * caixa do filtro depende dos próprios botões, e mexer na base deles a faria
 * crescer e descer de linha sem voltar.
 */
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { distribuirEmLinhas } from "@/lib/linhas-equilibradas";

const CELULAR = "(max-width: 640px)";

export function useLinhasEquilibradas<T extends HTMLElement>(
  vao: number,
  chave: string,
  quando: "fora-do-celular" | "so-no-celular" = "fora-do-celular",
) {
  const elRef = useRef<T | null>(null);
  const desligar = useRef<(() => void) | null>(null);
  const arrumar = useRef<() => void>(() => {});
  arrumar.current = () => {
    const el = elRef.current;
    if (!el) return;
    const soltar = () => {
      el.removeAttribute("data-por-linha");
      el.style.removeProperty("--bp-base");
    };
    const noCelular = window.matchMedia(CELULAR).matches;
    if (noCelular !== (quando === "so-no-celular")) return soltar();
    el.setAttribute("data-medindo", "");
    const larguras = Array.from(el.children).map((f) => (f as HTMLElement).getBoundingClientRect().width);
    el.removeAttribute("data-medindo");
    const cs = getComputedStyle(el);
    const disponivel = el.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
    const d = distribuirEmLinhas(larguras, disponivel, vao);
    if (!d) return soltar();
    el.style.setProperty("--bp-base", `${d.base.toFixed(2)}px`);
    el.setAttribute("data-por-linha", String(d.porLinha));
  };

  // Ref por função: a fila pode nascer depois (ligada na engrenagem) e ainda
  // assim ganha os observadores.
  const ref = useCallback((el: T | null) => {
    desligar.current?.();
    desligar.current = null;
    elRef.current = el;
    if (!el) return;
    let largura = el.clientWidth;
    const ro = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(() => {
          if (el.clientWidth === largura) return;
          largura = el.clientWidth;
          arrumar.current();
        })
      : null;
    ro?.observe(el);
    const mo = typeof MutationObserver !== "undefined" ? new MutationObserver(() => arrumar.current()) : null;
    mo?.observe(el, { childList: true });
    arrumar.current();
    desligar.current = () => { ro?.disconnect(); mo?.disconnect(); };
  }, []);

  useLayoutEffect(() => { arrumar.current(); }, [chave]);

  useEffect(() => {
    // A fonte do painel chega depois do primeiro desenho e muda a largura dos textos.
    document.fonts?.ready.then(() => arrumar.current()).catch(() => {});
    return () => { desligar.current?.(); };
  }, []);

  return ref;
}
