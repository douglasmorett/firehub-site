// O tratamento dos avisos tem de existir antes de qualquer tela: o sistema
// pode abrir o app direto pelo toque no "saiu para entrega".
import "@/lib/avisos";

import * as Notifications from "expo-notifications";
import { Stack, router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

function abrirPeloAviso(resposta: Notifications.NotificationResponse | null) {
  const dados: any = resposta?.notification.request.content.data;
  if (dados?.tipo === "STATUS_DO_PEDIDO" && typeof dados.pedidoId === "string") {
    router.push({ pathname: "/pedido/[id]", params: { id: dados.pedidoId, slug: String(dados.slug || "") } });
  }
}

export default function Raiz() {
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
    </SafeAreaProvider>
  );
}
