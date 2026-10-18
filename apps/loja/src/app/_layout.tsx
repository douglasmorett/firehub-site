// O tratamento dos avisos tem de existir antes de qualquer tela: o sistema
// pode abrir o app direto pelo toque no "saiu para entrega".
import "@/lib/avisos";

import * as Notifications from "expo-notifications";
import { Stack, router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { PerguntaDasPromocoes } from "@/components/PerguntaDasPromocoes";
import { abrirNoCardapio } from "@/lib/abrir-no-cardapio";
import { prepararCanais } from "@/lib/avisos";
import { BATIDA_MS, avisarAbertura, avisarToque } from "@/lib/presenca";

function abrirPeloAviso(resposta: Notifications.NotificationResponse | null) {
  const dados: any = resposta?.notification.request.content.data;
  if (dados?.tipo === "STATUS_DO_PEDIDO" && typeof dados.pedidoId === "string") {
    router.push({ pathname: "/pedido/[id]", params: { id: dados.pedidoId, slug: String(dados.slug || "") } });
  }
  // Promoção da loja (painel › Meu aplicativo): abre o cardápio ou o produto, dentro do app.
  if (dados?.tipo === "PROMOCAO") {
    // Conta como "aberta" no painel da loja (resultado de cada envio).
    avisarToque(dados.envioId);
    abrirNoCardapio(dados.caminho);
    router.navigate("/");
  }
}

/**
 * Conta ao painel da loja que o app está aberto (lib/presenca.ts): ao abrir,
 * ao voltar para a frente e de 4 em 4 minutos enquanto está na tela.
 */
function usePresenca() {
  const ultima = useRef(0);
  useEffect(() => {
    const abriu = () => {
      // Abrir e voltar para a frente no mesmo instante conta uma vez só.
      if (Date.now() - ultima.current < 20_000) return;
      ultima.current = Date.now();
      avisarAbertura(false);
    };
    prepararCanais();
    abriu();
    const sub = AppState.addEventListener("change", (estado) => {
      if (estado === "active") abriu();
    });
    const batida = setInterval(() => {
      if (AppState.currentState === "active") {
        ultima.current = Date.now();
        avisarAbertura(true);
      }
    }, BATIDA_MS);
    return () => {
      sub.remove();
      clearInterval(batida);
    };
  }, []);
}

export default function Raiz() {
  usePresenca();

  useEffect(() => {
    // App fechado: o toque no aviso abriu o app.
    Notifications.getLastNotificationResponseAsync().then(abrirPeloAviso).catch(() => {});
    // App aberto ou em segundo plano.
    const sub = Notifications.addNotificationResponseReceivedListener(abrirPeloAviso);
    return () => sub.remove();
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(abas)" />
        <Stack.Screen name="pedido/[id]" options={{ presentation: "card" }} />
      </Stack>
      <PerguntaDasPromocoes />
    </SafeAreaProvider>
  );
}
