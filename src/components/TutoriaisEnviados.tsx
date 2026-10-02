"use client";

/**
 * Leva para o navegador a lista dos tutoriais que já estão no servidor
 * (lib/tutoriais-no-servidor.ts, lida pelo layout do painel). O botão de cada
 * tela e a central só mostram vídeo que existe de verdade.
 */
import { createContext, useContext, useMemo } from "react";
import type { TutoriaisEnviados as Enviados } from "@/lib/tutoriais";

const Contexto = createContext<Enviados>(null);

export function TutoriaisEnviados({ ids, children }: { ids: string[] | null; children: React.ReactNode }) {
  const chave = ids ? ids.join(",") : "";
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const valor = useMemo<Enviados>(() => (ids ? new Set(ids) : null), [chave, ids === null]);
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useTutoriaisEnviados(): Enviados {
  return useContext(Contexto);
}
