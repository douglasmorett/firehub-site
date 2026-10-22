// O tratamento dos avisos tem de existir antes de qualquer tela.
import "@/lib/notificacoes";

import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { useAtualizacaoAutomatica } from "@/lib/atualizacao";
import { ImpressaoProvider } from "@/lib/impressao";
import { SessaoProvider } from "@/lib/sessao";

export default function Raiz() {
  useAtualizacaoAutomatica();
  return (
    <SafeAreaProvider>
      <SessaoProvider>
        <ImpressaoProvider>
          <StatusBar style="light" />
          <Stack screenOptions={{ headerShown: false }} />
        </ImpressaoProvider>
      </SessaoProvider>
    </SafeAreaProvider>
  );
}
