"use client";

/**
 * Liga uma camada da tela de mesas ao VOLTAR do navegador (gesto do Android,
 * botão do navegador). A conta de quem fecha fica em `lib/voltar-em-camadas.ts`;
 * aqui é só o que encosta em `window.history`.
 *
 *   useVoltarDoCelular(telaDoPedidoAberta, "pedido", () => fecharTelaDoPedido());
 *
 * `fechar` é chamado quando o navegador volta por cima da camada. Quando a tela
 * fecha a camada sozinha (o estado vira falso), a entrada do histórico é
 * consumida aqui — quem usa não precisa chamar `history.back()`.
 *
 * O Next (app router) intercepta `pushState` e copia o estado interno dele para
 * a entrada nova, então voltar para ela não recarrega a página
 * (node_modules/next/dist/client/components/app-router.js, copyNextJsInternalHistoryState).
 */
import { useEffect, useRef } from "react";
import {
  SEM_CAMADAS,
  abrirCamada,
  aoFecharPelaTela,
  aoVoltarNoNavegador,
  type EstadoDasCamadas,
} from "@/lib/voltar-em-camadas";

// Uma pilha por página: as camadas da tela de mesas se empilham numa só.
let estado: EstadoDasCamadas = SEM_CAMADAS;
let proximoId = 1;
const fechadores = new Map<number, () => void>();
/**
 * `back()` que a tela pediu e o navegador ainda não fez. Se outra camada abre
 * no mesmo toque, ela reaproveita a entrada em vez de empilhar: voltar e
 * empurrar são assíncronos, e o navegador pode aplicar os dois fora de ordem.
 */
let voltaPendente: number | null = null;
let ouvindo = false;

function idNoHistorico(): number | null {
  const v = window.history.state?.firehubCamada;
  return typeof v === "number" ? v : null;
}

function ouvirONavegador() {
  if (ouvindo) return;
  ouvindo = true;
  window.addEventListener("popstate", () => {
    voltaPendente = null;
    const r = aoVoltarNoNavegador(estado, idNoHistorico());
    estado = r.estado;
    for (const camada of r.fechar) {
      const fechar = fechadores.get(camada.id);
      fechadores.delete(camada.id);
      fechar?.();
    }
    if (r.pularOutraVez) window.history.back();
  });
}

export function useVoltarDoCelular(aberta: boolean, nome: string, fechar: () => void) {
  const fecharRef = useRef(fechar);
  fecharRef.current = fechar;

  useEffect(() => {
    if (!aberta || typeof window === "undefined") return;
    ouvirONavegador();

    const id = proximoId++;
    fechadores.set(id, () => fecharRef.current());
    estado = abrirCamada(estado, { id, nome });

    if (voltaPendente !== null && idNoHistorico() === voltaPendente) {
      voltaPendente = null;
      window.history.replaceState({ ...(window.history.state || {}), firehubCamada: id }, "");
    } else {
      window.history.pushState({ firehubCamada: id }, "");
    }

    return () => {
      // Sem fechador é porque o navegador já voltou por cima desta camada.
      if (!fechadores.has(id)) return;
      fechadores.delete(id);
      const r = aoFecharPelaTela(estado, id, idNoHistorico());
      estado = r.estado;
      if (!r.voltarNoNavegador) return;
      voltaPendente = id;
      queueMicrotask(() => {
        if (voltaPendente !== id) return; // outra camada reaproveitou a entrada
        voltaPendente = null;
        window.history.back();
      });
    };
  }, [aberta, nome]);
}
