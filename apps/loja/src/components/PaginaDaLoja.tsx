/**
 * A página da loja (cardápio, carrinho, pagamento, acompanhamento) dentro do
 * app. É a MESMA página do site: preço, produto e horário mudam no painel e
 * aparecem aqui na hora, sem atualizar o app.
 *
 * O que o app acrescenta:
 * - links de fora (WhatsApp, Instagram, mapa, telefone) abrem no app certo,
 *   não dentro do cardápio;
 * - "pedido feito" (src/lib/app-da-loja/ponte.ts no site) guarda o pedido na
 *   aba Pedidos e liga o aviso de andamento neste celular;
 * - o botão Voltar do Android volta a página, não fecha o app.
 */
import * as Linking from "expo-linking";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, Pressable, StyleSheet, Text, View } from "react-native";
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from "react-native-webview";
import type { ShouldStartLoadRequest } from "react-native-webview/lib/WebViewTypes";

import { registrarNoPedido } from "@/lib/avisos";
import { marca } from "@/lib/marca";
import { guardarPedido } from "@/lib/pedidos-guardados";

/** Páginas de pagamento que precisam abrir aqui dentro para o cliente voltar ao pedido. */
const HOSTS_DE_PAGAMENTO = ["asaas.com", "mercadopago.com.br", "mercadopago.com", "mercadolivre.com", "mercadolibre.com"];

function hostDe(url: string): string {
  const m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#:]+)/i.exec(url);
  return m ? m[1].toLowerCase() : "";
}

function abreAquiDentro(url: string): boolean {
  if (url.startsWith("about:") || url.startsWith("data:") || url.startsWith("blob:")) return true;
  if (!/^https?:\/\//i.test(url)) return false;
  const host = hostDe(url);
  if (marca.dominiosDaLoja.some((d) => host === d.toLowerCase())) return true;
  return HOSTS_DE_PAGAMENTO.some((d) => host === d || host.endsWith(`.${d}`));
}

export function PaginaDaLoja({ url, aoFazerPedido }: { url: string; aoFazerPedido?: (pedidoId: string) => void }) {
  const web = useRef<WebView>(null);
  const [podeVoltar, setPodeVoltar] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [semInternet, setSemInternet] = useState(false);

  // Android: Voltar volta a página enquanto houver para onde voltar.
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (podeVoltar) {
        web.current?.goBack();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [podeVoltar]);

  const aoNavegar = useCallback((nav: WebViewNavigation) => setPodeVoltar(nav.canGoBack), []);

  const antesDeAbrir = useCallback((req: ShouldStartLoadRequest) => {
    // iframe (mapa, 3-D Secure do cartão) segue o que a própria página decidiu.
    if (req.isTopFrame === false) return true;
    if (abreAquiDentro(req.url)) return true;
    Linking.openURL(req.url).catch(() => {});
    return false;
  }, []);

  const aoReceber = useCallback(
    async (e: WebViewMessageEvent) => {
      let msg: any = null;
      try {
        msg = JSON.parse(e.nativeEvent.data);
      } catch {
        return;
      }
      if (msg?.tipo !== "PEDIDO_FEITO" || typeof msg.pedidoId !== "string") return;
      const novo = await guardarPedido({ id: msg.pedidoId, slug: String(msg.slug || "") });
      // A página de acompanhamento repete a mensagem a cada visita: liga o aviso só uma vez.
      if (novo) registrarNoPedido(msg.pedidoId).catch(() => {});
      aoFazerPedido?.(msg.pedidoId);
    },
    [aoFazerPedido],
  );

  if (semInternet) {
    return (
      <View style={estilos.centro}>
        <Text style={estilos.titulo}>Sem conexão</Text>
        <Text style={estilos.texto}>Confira a internet do celular e tente de novo.</Text>
        <Pressable
          style={[estilos.botao, { backgroundColor: marca.cor }]}
          onPress={() => {
            setSemInternet(false);
            setCarregando(true);
          }}
        >
          <Text style={[estilos.textoDoBotao, { color: marca.corDoTexto }]}>Tentar de novo</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <WebView
        ref={web}
        source={{ uri: url }}
        applicationNameForUserAgent={`FireHubApp/1 (${marca.id})`}
        onNavigationStateChange={aoNavegar}
        onShouldStartLoadWithRequest={antesDeAbrir}
        onMessage={aoReceber}
        onLoadEnd={() => setCarregando(false)}
        onError={() => setSemInternet(true)}
        // Link com target=_blank: o Android abriria janela nova; aqui ele passa pelo antesDeAbrir.
        setSupportMultipleWindows={false}
        geolocationEnabled
        pullToRefreshEnabled
        allowsBackForwardNavigationGestures
        sharedCookiesEnabled
        domStorageEnabled
        javaScriptEnabled
        mediaPlaybackRequiresUserAction
        allowsInlineMediaPlayback
        style={{ flex: 1, backgroundColor: "#fff" }}
      />
      {carregando && (
        <View style={estilos.carregando} pointerEvents="none">
          <ActivityIndicator size="large" color={marca.cor} />
        </View>
      )}
    </View>
  );
}

const estilos = StyleSheet.create({
  centro: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, backgroundColor: "#fff" },
  titulo: { fontSize: 20, fontWeight: "700", color: "#111", marginBottom: 8 },
  texto: { fontSize: 15, color: "#555", textAlign: "center", marginBottom: 20 },
  botao: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 },
  textoDoBotao: { fontSize: 16, fontWeight: "700" },
  carregando: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", backgroundColor: "#fff" },
});
