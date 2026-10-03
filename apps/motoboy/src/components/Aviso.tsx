/**
 * O aviso que desce do topo e some sozinho, como o AvisoNoTopo do painel —
 * nunca alert() para dar notícia. Alert fica só para pergunta que exige
 * resposta ("devolver este pedido?").
 */
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { Animated, StyleSheet, Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { cor } from "./tema";

type Tom = "ok" | "erro" | "alerta";
type Contexto = { avisar: (texto: string, tom?: Tom, ms?: number) => void };

const AvisoContext = createContext<Contexto>({ avisar: () => {} });

const tons: Record<Tom, { fundo: string; texto: string; borda: string }> = {
  ok: { fundo: cor.verdeClaro, texto: cor.verdeEscuro, borda: cor.verdeBorda },
  erro: { fundo: cor.vermelhoClaro, texto: cor.vermelho, borda: cor.vermelhoBorda },
  alerta: { fundo: cor.ambarClaro, texto: cor.ambar, borda: cor.ambarBorda },
};

export function AvisoProvider({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const [aviso, setAviso] = useState<{ texto: string; tom: Tom } | null>(null);
  const [posicao] = useState(() => new Animated.Value(-120));
  const relogio = useRef<ReturnType<typeof setTimeout> | null>(null);

  const avisar = useCallback(
    (texto: string, tom: Tom = "ok", ms = 3500) => {
      if (relogio.current) clearTimeout(relogio.current);
      setAviso({ texto, tom });
      Animated.spring(posicao, { toValue: 0, useNativeDriver: true, damping: 18, stiffness: 220 }).start();
      relogio.current = setTimeout(() => {
        Animated.timing(posicao, { toValue: -120, duration: 220, useNativeDriver: true }).start(() => setAviso(null));
      }, ms);
    },
    [posicao],
  );

  const t = aviso ? tons[aviso.tom] : null;
  return (
    <AvisoContext.Provider value={{ avisar }}>
      {children}
      {aviso && t && (
        <Animated.View
          pointerEvents="none"
          accessibilityLiveRegion="polite"
          style={[
            s.caixa,
            { top: insets.top + 8, backgroundColor: t.fundo, borderColor: t.borda, transform: [{ translateY: posicao }] },
          ]}
        >
          <Text style={[s.texto, { color: t.texto }]}>{aviso.texto}</Text>
        </Animated.View>
      )}
    </AvisoContext.Provider>
  );
}

export const useAviso = () => useContext(AvisoContext);

const s = StyleSheet.create({
  caixa: {
    position: "absolute",
    left: 12,
    right: 12,
    borderWidth: 1.5,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  texto: { fontSize: 15, fontWeight: "800", lineHeight: 20 },
});
