// A tarefa do GPS e o tratamento dos avisos têm de existir antes de qualquer
// tela: o sistema pode acordar o app só para entregar uma posição.
import "@/lib/gps";
import "@/lib/notificacoes";

import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AvisoProvider } from "@/components/Aviso";
import { SessaoProvider } from "@/lib/sessao";

export default function Raiz() {
  return (
    <SafeAreaProvider>
      <SessaoProvider>
        <AvisoProvider>
          <StatusBar style="light" />
          <Stack screenOptions={{ headerShown: false }} />
        </AvisoProvider>
      </SessaoProvider>
    </SafeAreaProvider>
  );
}
