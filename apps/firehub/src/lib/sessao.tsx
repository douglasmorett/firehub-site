/**
 * A loja logada neste celular. O login é o do site, dentro do painel; quando o
 * painel abre, a página pede o token do app (POST /api/app-firehub/sessao) e o
 * manda para cá pela ponte do WebView (components/Painel.tsx). Com o token, o
 * app liga o aviso de pedido novo e a impressora Bluetooth.
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

import { gravarSessaoDaLoja, lerSessaoDaLoja, type SessaoDaLoja } from "./guardado";
import { esquecerAvisos, registrarAvisos } from "./notificacoes";

type Estado = {
  sessao: SessaoDaLoja | null;
  carregada: boolean;
  /** O aviso de pedido novo: null = ainda não tentou. */
  avisos: { ok: boolean; mensagem?: string } | null;
  entrou: (s: SessaoDaLoja) => Promise<void>;
  sair: () => Promise<void>;
};

const Contexto = createContext<Estado | null>(null);

export function SessaoProvider({ children }: { children: ReactNode }) {
  const [sessao, setSessao] = useState<SessaoDaLoja | null>(null);
  const [carregada, setCarregada] = useState(false);
  const [avisos, setAvisos] = useState<Estado["avisos"]>(null);

  useEffect(() => {
    lerSessaoDaLoja().then((s) => {
      setSessao(s);
      setCarregada(true);
      // Reabriu o app: confirma o aparelho (o token de notificação pode ter mudado).
      if (s) registrarAvisos(s.token).then(setAvisos);
    });
  }, []);

  const entrou = useCallback(async (s: SessaoDaLoja) => {
    // O painel manda a sessão a cada vez que abre: só regrava quando mudou.
    if (sessao?.token === s.token) return;
    setSessao(s);
    await gravarSessaoDaLoja(s);
    setAvisos(await registrarAvisos(s.token));
  }, [sessao?.token]);

  const sair = useCallback(async () => {
    await esquecerAvisos();
    setSessao(null);
    setAvisos(null);
    await gravarSessaoDaLoja(null);
  }, []);

  return <Contexto.Provider value={{ sessao, carregada, avisos, entrou, sair }}>{children}</Contexto.Provider>;
}

export function useSessaoDaLoja(): Estado {
  const c = useContext(Contexto);
  if (!c) throw new Error("useSessaoDaLoja fora do SessaoProvider");
  return c;
}
