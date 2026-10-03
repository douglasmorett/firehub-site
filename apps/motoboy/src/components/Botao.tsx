import * as Haptics from "expo-haptics";
import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { cor, raio } from "./tema";

type Variante = "azul" | "verde" | "roxo" | "escuro" | "claro" | "perigo" | "contorno";

const estilos: Record<Variante, { fundo: string; texto: string; borda?: string }> = {
  azul: { fundo: cor.azul, texto: "#FFFFFF" },
  verde: { fundo: cor.verde, texto: "#FFFFFF" },
  roxo: { fundo: cor.roxo, texto: "#FFFFFF" },
  escuro: { fundo: cor.topo, texto: "#FFFFFF" },
  claro: { fundo: "#F1F5F9", texto: cor.textoSuave },
  perigo: { fundo: cor.vermelhoClaro, texto: cor.vermelho, borda: "#FCA5A5" },
  contorno: { fundo: "#FFFFFF", texto: cor.texto, borda: cor.bordaForte },
};

/**
 * Botão de toque grande: o entregador usa com luva, em pé, com a sacola na
 * outra mão. Altura mínima de 52 e vibração curta no toque.
 */
export function Botao({
  titulo,
  aoTocar,
  variante = "azul",
  icone,
  carregando = false,
  desabilitado = false,
  pequeno = false,
  estilo,
}: {
  titulo: string;
  aoTocar: () => void;
  variante?: Variante;
  icone?: ReactNode;
  carregando?: boolean;
  desabilitado?: boolean;
  pequeno?: boolean;
  estilo?: StyleProp<ViewStyle>;
}) {
  const v = estilos[variante];
  const inativo = desabilitado || carregando;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inativo, busy: carregando }}
      disabled={inativo}
      onPress={() => {
        Haptics.selectionAsync().catch(() => {});
        aoTocar();
      }}
      style={({ pressed }) => [
        s.base,
        pequeno && s.pequeno,
        { backgroundColor: v.fundo, borderColor: v.borda ?? v.fundo, opacity: desabilitado ? 0.5 : pressed ? 0.85 : 1 },
        pressed && !inativo && { transform: [{ scale: 0.98 }] },
        estilo,
      ]}
    >
      <View style={s.conteudo}>
        {carregando ? <ActivityIndicator color={v.texto} /> : icone}
        <Text style={[s.texto, pequeno && s.textoPequeno, { color: v.texto }]} numberOfLines={1}>
          {titulo}
        </Text>
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  base: {
    minHeight: 52,
    borderRadius: raio.medio,
    borderWidth: 1.5,
    paddingHorizontal: 14,
    justifyContent: "center",
  },
  pequeno: { minHeight: 44, borderRadius: raio.pequeno },
  conteudo: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  texto: { fontSize: 16, fontWeight: "900" },
  textoPequeno: { fontSize: 14, fontWeight: "800" },
});
