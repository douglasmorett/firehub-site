/**
 * A folha que sobe de baixo, para as perguntas da entrega (bebida, cobrança,
 * código). Tocar fora fecha SEM dar baixa: o toque fora é o gesto de quem
 * abriu sem querer, e a única coisa que nunca pode acontecer é fechar e
 * confirmar a entrega junto.
 */
import type { ReactNode } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { cor } from "./tema";

export function Folha({ aberta, aoFechar, children }: { aberta: boolean; aoFechar: () => void; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={aberta} transparent animationType="slide" onRequestClose={aoFechar} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={s.fundo}>
        <Pressable style={StyleSheet.absoluteFill} onPress={aoFechar} accessibilityLabel="Fechar" />
        <View style={[s.folha, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
          <View style={s.alca} />
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 12 }} bounces={false}>
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  fundo: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(15,23,42,0.6)" },
  folha: {
    backgroundColor: cor.cartao,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 18,
    paddingTop: 10,
    maxHeight: "90%",
  },
  alca: { alignSelf: "center", width: 44, height: 5, borderRadius: 3, backgroundColor: cor.bordaForte, marginBottom: 14 },
});
