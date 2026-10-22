/**
 * O site do FireHub dentro do app: o painel da loja, o módulo do garçom ou o
 * tablet da mesa. É a MESMA página do navegador: o que muda no site chega aqui
 * sem atualizar o app.
 *
 * O que o app acrescenta:
 * - no painel, a ponte que entrega ao app o token da loja (para o aviso de
 *   pedido novo e a impressora Bluetooth funcionarem com a página fechada);
 * - `window.FIREHUB_APP` na página, para o site saber que está no app;
 * - links de fora (WhatsApp, mapa, telefone) abrem no app certo;
 * - o Voltar do Android volta a página (no tablet da mesa, não faz nada).
 */
import * as Linking from "expo-linking";
import Constants from "expo-constants";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from "react-native-webview";
import type { ShouldStartLoadRequest } from "react-native-webview/lib/WebViewTypes";

import { API_URL, type Modo } from "@/lib/config";
import type { SessaoDaLoja } from "@/lib/guardado";

const HOST_DO_FIREHUB = (/^https?:\/\/([^/:]+)/i.exec(API_URL)?.[1] || "firehubfood.com.br").toLowerCase();
/** Pagamento da mensalidade e afins que precisam abrir aqui dentro. */
const HOSTS_DE_PAGAMENTO = ["asaas.com", "mercadopago.com.br", "mercadopago.com"];

function hostDe(url: string): string {
  const m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#:]+)/i.exec(url);
  return m ? m[1].toLowerCase() : "";
}

function abreAquiDentro(url: string): boolean {
  if (/^(about|data|blob):/i.test(url)) return true;
  if (!/^https?:\/\//i.test(url)) return false;
  const host = hostDe(url);
  if (host === HOST_DO_FIREHUB || host === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return true;
  return HOSTS_DE_PAGAMENTO.some((d) => host === d || host.endsWith(`.${d}`));
}

/** Antes da página: o site fica sabendo que está no app. */
const antesDaPagina = (modo: Modo) => `
  window.FIREHUB_APP = { versao: ${JSON.stringify(Constants.expoConfig?.version ?? "")}, plataforma: ${JSON.stringify(Platform.OS)}, modo: ${JSON.stringify(modo)} };
  true;`;

/**
 * No painel: pede o token do app com o cookie do login e manda para o app.
 * Só nas telas /store (fora delas não há loja logada).
 */
const PONTE_DO_PAINEL = `
  (function () {
    if (!/^\\/store/.test(location.pathname) || window.__firehubSessaoPedida) return;
    window.__firehubSessaoPedida = true;
    fetch('/api/app-firehub/sessao', { method: 'POST', credentials: 'include' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d && d.token) window.ReactNativeWebView.postMessage(JSON.stringify({ tipo: 'SESSAO_DO_APP', sessao: d })); })
      .catch(function () {});
  })();
  true;`;

export type PainelRef = { abrir: (caminho: string) => void; recarregar: () => void };

export const Painel = forwardRef<PainelRef, {
  caminho: string;
  modo: Modo;
  aoEntrarNaLoja?: (s: SessaoDaLoja) => void;
}>(function Painel({ caminho, modo, aoEntrarNaLoja }, ref) {
  const web = useRef<WebView>(null);
  const [uri, setUri] = useState(`${API_URL}${caminho}`);
  const [podeVoltar, setPodeVoltar] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [semInternet, setSemInternet] = useState(false);

  useImperativeHandle(ref, () => ({
    abrir: (c: string) => {
      const destino = `${API_URL}${c}`;
      web.current?.injectJavaScript(`location.href = ${JSON.stringify(destino)}; true;`);
    },
    recarregar: () => web.current?.reload(),
  }), []);

  useEffect(() => setUri(`${API_URL}${caminho}`), [caminho]);

  // Android: Voltar volta a página. No tablet da mesa, o cliente não sai do cardápio.
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (modo === "mesa") return true;
      if (podeVoltar) {
        web.current?.goBack();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [podeVoltar, modo]);

  const aoNavegar = useCallback((nav: WebViewNavigation) => setPodeVoltar(nav.canGoBack), []);

  const antesDeAbrir = useCallback((req: ShouldStartLoadRequest) => {
    if (req.isTopFrame === false) return true;
    if (abreAquiDentro(req.url)) return true;
    if (modo !== "mesa") Linking.openURL(req.url).catch(() => {});
    return false;
  }, [modo]);

  const aoReceber = useCallback((e: WebViewMessageEvent) => {
    let msg: any = null;
    try { msg = JSON.parse(e.nativeEvent.data); } catch { return; }
    if (msg?.tipo === "SESSAO_DO_APP" && msg.sessao?.token && aoEntrarNaLoja) {
      aoEntrarNaLoja({ token: msg.sessao.token, lojaId: msg.sessao.lojaId, nomeDaLoja: msg.sessao.nomeDaLoja, slug: msg.sessao.slug ?? null });
    }
  }, [aoEntrarNaLoja]);

  if (semInternet) {
    return (
      <View style={estilos.centro}>
        <Text style={estilos.titulo}>Sem conexão</Text>
        <Text style={estilos.texto}>Confira a internet do aparelho e tente de novo.</Text>
        <Pressable style={estilos.botao} onPress={() => { setSemInternet(false); setCarregando(true); }}>
          <Text style={estilos.textoDoBotao}>Tentar de novo</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <WebView
        ref={web}
        source={{ uri }}
        applicationNameForUserAgent={`FireHubApp/${Constants.expoConfig?.version ?? "1"} (${modo})`}
        injectedJavaScriptBeforeContentLoaded={antesDaPagina(modo)}
        injectedJavaScript={modo === "loja" ? PONTE_DO_PAINEL : "true;"}
        onNavigationStateChange={aoNavegar}
        onShouldStartLoadWithRequest={antesDeAbrir}
        onMessage={aoReceber}
        onLoadEnd={() => setCarregando(false)}
        onError={() => setSemInternet(true)}
        setSupportMultipleWindows={false}
        pullToRefreshEnabled={modo !== "mesa"}
        allowsBackForwardNavigationGestures={modo !== "mesa"}
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        domStorageEnabled
        javaScriptEnabled
        mediaPlaybackRequiresUserAction={false}
        allowsInlineMediaPlayback
        style={{ flex: 1, backgroundColor: "#fff" }}
      />
      {carregando && (
        <View style={estilos.carregando} pointerEvents="none">
          <ActivityIndicator size="large" color="#FF4D00" />
        </View>
      )}
    </View>
  );
});

const estilos = StyleSheet.create({
  centro: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: "#fff" },
  titulo: { fontSize: 20, fontWeight: "800", color: "#0F172A", marginBottom: 6 },
  texto: { fontSize: 15, color: "#475569", textAlign: "center", marginBottom: 16 },
  botao: { backgroundColor: "#FF4D00", paddingHorizontal: 22, paddingVertical: 12, borderRadius: 12 },
  textoDoBotao: { color: "#fff", fontWeight: "800", fontSize: 15 },
  carregando: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.6)" },
});
