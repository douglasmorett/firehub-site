/**
 * Quem está logado neste celular. Uma sessão por aparelho: entrar com outro
 * entregador (troca de turno no celular da loja) apaga tudo do anterior —
 * a página web já mostrou o que acontece sem isso (o próximo via nome,
 * telefone e endereço dos clientes do anterior).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { chamar } from "./api";
import { gravarGpsPausado, gravarSessao, gravarUltimaLoja, lerSessao, type Sessao } from "./guardado";
import { desligarGps } from "./gps";
import { esquecerAvisos } from "./notificacoes";
import { lojaParaOLogin } from "./loja";

type Contexto = {
  sessao: Sessao | null;
  /** Ainda lendo o Keychain na abertura do app. */
  carregando: boolean;
  entrar: (dados: { loja: string; acesso: string; senha: string }) => Promise<Sessao>;
  sair: (motivo?: string) => Promise<void>;
  trocarToken: (token: string) => Promise<void>;
  /** Por que a sessão caiu sozinha (aparece na tela de entrar). */
  avisoDeSaida: string | null;
};

const SessaoContext = createContext<Contexto | null>(null);

export function SessaoProvider({ children }: { children: ReactNode }) {
  const [sessao, setSessao] = useState<Sessao | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [avisoDeSaida, setAvisoDeSaida] = useState<string | null>(null);

  useEffect(() => {
    lerSessao()
      .then((s) => setSessao(s))
      .finally(() => setCarregando(false));
  }, []);

  const entrar = useCallback(async ({ loja, acesso, senha }: { loja: string; acesso: string; senha: string }) => {
    const storeSlug = lojaParaOLogin(loja);
    const r = await chamar<any>("/api/motoboys/login", {
      metodo: "POST",
      corpo: { storeSlug, phone: acesso.trim(), password: senha },
    });
    if (!r?.token || !r?.motoboyId || !r?.storeId) {
      throw new Error(r?.error || "A loja não devolveu a sessão. Tente de novo.");
    }
    // Entregador anterior neste celular: GPS e avisos dele param aqui.
    const anterior = await lerSessao();
    if (anterior && anterior.motoboyId !== r.motoboyId) {
      await desligarGps();
      await esquecerAvisos(anterior.token);
    }
    const nova: Sessao = {
      token: r.token,
      motoboyId: r.motoboyId,
      motoboyNome: r.motoboyName || r.motoboy?.name || "Entregador",
      lojaId: r.storeId,
      lojaNome: r.storeName || r.store?.name || storeSlug,
      lojaSlug: storeSlug,
      trocarSenha: Boolean(r.mustChangePassword),
    };
    await gravarSessao(nova);
    await gravarUltimaLoja(loja.trim());
    await gravarGpsPausado(false);
    setAvisoDeSaida(null);
    setSessao(nova);
    return nova;
  }, []);

  const sair = useCallback(async (motivo?: string) => {
    const atual = await lerSessao();
    await desligarGps();
    if (atual) await esquecerAvisos(atual.token);
    await gravarSessao(null);
    setAvisoDeSaida(motivo ?? null);
    setSessao(null);
  }, []);

  const trocarToken = useCallback(async (token: string) => {
    const atual = await lerSessao();
    if (!atual) return;
    const nova = { ...atual, token, trocarSenha: false };
    await gravarSessao(nova);
    setSessao(nova);
  }, []);

  const valor = useMemo(
    () => ({ sessao, carregando, entrar, sair, trocarToken, avisoDeSaida }),
    [sessao, carregando, entrar, sair, trocarToken, avisoDeSaida],
  );
  return <SessaoContext.Provider value={valor}>{children}</SessaoContext.Provider>;
}

export function useSessao(): Contexto {
  const ctx = useContext(SessaoContext);
  if (!ctx) throw new Error("useSessao fora do SessaoProvider");
  return ctx;
}
