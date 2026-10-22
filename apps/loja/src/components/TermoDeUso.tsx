/**
 * O TERMO DE USO da primeira abertura (lib/termo.ts): o cardápio só abre
 * depois do "Aceito". Termo de versão nova pede o aceite de novo.
 *
 * Logo depois do "Aceito", o app abre o pedido de permissão de notificação do
 * SISTEMA — sem tela de promoção no meio. O termo avisou, em destaque, que as
 * notificações incluem promoções e como desligá-las; tocar em "Permitir" ali é
 * o aceite explícito da Apple 4.5.4.
 *
 * Quem nega: components/PortaDaNotificacao.tsx. No Android o app não abre sem
 * a permissão; no iPhone (4.5.4: "Push Notifications must not be required for
 * the app to function") a porta volta a cada abertura, com "Continuar sem avisos".
 */
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { tokenDoAparelho } from "@/lib/avisos";
import { termoRespondido } from "@/components/PortaDaNotificacao";
import { logoDaMarca } from "@/lib/logo-da-marca";
import { marca } from "@/lib/marca";
import { avisarAbertura } from "@/lib/presenca";
import { VERSAO_DO_TERMO, aceitouOTermoAtual, guardarAceite, textoDoTermo } from "@/lib/termo";

export function TermoDeUso() {
  const [estado, setEstado] = useState<"verificando" | "pendente" | "aceito">("verificando");
  const { top, bottom } = useSafeAreaInsets();

  useEffect(() => {
    let vivo = true;
    aceitouOTermoAtual().then((ok) => vivo && setEstado(ok ? "aceito" : "pendente"));
    return () => {
      vivo = false;
    };
  }, []);

  const aceitar = async () => {
    await guardarAceite();
    setEstado("aceito");
    // O pedido do sistema, direto. Negou? A PortaDaNotificacao cobre o app (no iPhone dá para pular).
    await tokenDoAparelho(true);
    termoRespondido();
    avisarAbertura(true);
  };

  const [d, m, a] = [VERSAO_DO_TERMO.slice(8, 10), VERSAO_DO_TERMO.slice(5, 7), VERSAO_DO_TERMO.slice(0, 4)];
  return (
    // Sem onRequestClose que feche: o Voltar do Android não pula o termo.
    <Modal visible={estado !== "aceito"} animationType="fade" onRequestClose={() => {}} statusBarTranslucent>
      <View style={[estilos.tela, { backgroundColor: marca.cor, paddingTop: top + 12 }]}>
        {estado === "verificando" ? (
          <ActivityIndicator color={marca.corDoTexto} size="large" style={{ flex: 1 }} />
        ) : (
          <>
            <View style={estilos.topo}>
              {!!logoDaMarca && <Image source={logoDaMarca} style={estilos.logo} contentFit="cover" />}
              <Text style={[estilos.bemVindo, { color: marca.corDoTexto }]}>Bem-vindo ao app da {marca.nome}</Text>
            </View>
            <View style={[estilos.cartao, { paddingBottom: bottom + 16 }]}>
              <Text style={estilos.titulo}>Termo de uso</Text>
              <ScrollView style={{ flexGrow: 0, maxHeight: 360 }} contentContainerStyle={{ gap: 12, paddingBottom: 4 }}>
                {textoDoTermo().map((t) => (
                  <View key={t.titulo} style={t.destaque ? [estilos.destaque, { borderColor: marca.cor, backgroundColor: `${marca.cor}10` }] : undefined}>
                    <View style={estilos.linhaDoTitulo}>
                      {t.destaque && <Ionicons name="notifications" size={18} color={marca.cor} />}
                      <Text style={estilos.trechoTitulo}>{t.titulo}</Text>
                    </View>
                    <Text style={estilos.trecho}>{t.texto}</Text>
                  </View>
                ))}
                <Pressable onPress={() => WebBrowser.openBrowserAsync(marca.privacidade)} accessibilityRole="link" hitSlop={8}>
                  <Text style={[estilos.link, { color: marca.cor }]}>Ler a Política de Privacidade</Text>
                </Pressable>
              </ScrollView>
              <Pressable style={[estilos.botao, { backgroundColor: marca.cor }]} onPress={aceitar} accessibilityRole="button">
                <Text style={[estilos.textoDoBotao, { color: marca.corDoTexto }]}>Aceito</Text>
              </Pressable>
              <Text style={estilos.rodape}>Ao tocar em “Aceito” você concorda com este termo (versão de {d}/{m}/{a}).</Text>
            </View>
          </>
        )}
      </View>
    </Modal>
  );
}

const estilos = StyleSheet.create({
  tela: { flex: 1, justifyContent: "flex-end" },
  topo: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14, paddingHorizontal: 24 },
  logo: { width: 96, height: 96, borderRadius: 24, borderWidth: 3, borderColor: "rgba(255,255,255,0.9)" },
  bemVindo: { fontSize: 20, fontWeight: "800", textAlign: "center" },
  cartao: { backgroundColor: "#fff", borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingHorizontal: 22, paddingTop: 22, gap: 14 },
  titulo: { fontSize: 21, fontWeight: "800", color: "#111" },
  linhaDoTitulo: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 3 },
  trechoTitulo: { fontSize: 15, fontWeight: "800", color: "#111" },
  trecho: { fontSize: 14, color: "#444", lineHeight: 20 },
  destaque: { borderWidth: 1.5, borderRadius: 14, padding: 12 },
  link: { fontSize: 14, fontWeight: "700", textDecorationLine: "underline" },
  botao: { paddingVertical: 16, borderRadius: 14, alignItems: "center" },
  textoDoBotao: { fontSize: 17, fontWeight: "800" },
  rodape: { fontSize: 12, color: "#8A8A8A", textAlign: "center" },
});
