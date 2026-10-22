/**
 * A porta do app: o modo escolhido da última vez abre direto; na primeira vez,
 * a pessoa escolhe quem é — a loja, o garçom ou o tablet da mesa.
 */
import { Redirect, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { Modo } from "@/lib/config";
import { gravarModo, lerModo } from "@/lib/guardado";

const OPCOES: { modo: Modo; emoji: string; titulo: string; texto: string }[] = [
  { modo: "loja", emoji: "🏪", titulo: "Sou a loja", texto: "Painel de pedidos, aviso de pedido novo com o celular bloqueado e impressora Bluetooth." },
  { modo: "garcom", emoji: "🙋", titulo: "Sou garçom", texto: "Mesas e pedidos pelo celular ou tablet, com o login que a loja te passou." },
  { modo: "mesa", emoji: "🍽️", titulo: "Tablet da mesa", texto: "Este tablet fica na mesa: o cliente vê o cardápio e pede sozinho." },
];

export default function Inicio() {
  const router = useRouter();
  const [modo, setModo] = useState<Modo | null | undefined>(undefined);
  useEffect(() => { lerModo().then(setModo); }, []);

  if (modo === undefined) return <View style={{ flex: 1, backgroundColor: "#0B1220" }} />;
  if (modo) return <Redirect href={`/${modo}`} />;

  return (
    <SafeAreaView style={estilos.fundo}>
      <ScrollView contentContainerStyle={estilos.conteudo}>
        <Image source={require("../../assets/images/firehub-chama.png")} style={estilos.logo} resizeMode="contain" />
        <Text style={estilos.titulo}>Bem-vindo ao FireHub</Text>
        <Text style={estilos.sub}>Como este aparelho vai ser usado?</Text>
        {OPCOES.map((o) => (
          <Pressable
            key={o.modo}
            style={({ pressed }) => [estilos.cartao, pressed && { opacity: 0.85 }]}
            onPress={async () => {
              await gravarModo(o.modo);
              router.replace(`/${o.modo}`);
            }}
          >
            <Text style={estilos.emoji}>{o.emoji}</Text>
            <View style={{ flex: 1 }}>
              <Text style={estilos.cartaoTitulo}>{o.titulo}</Text>
              <Text style={estilos.cartaoTexto}>{o.texto}</Text>
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const estilos = StyleSheet.create({
  fundo: { flex: 1, backgroundColor: "#0B1220" },
  conteudo: { padding: 20, gap: 14, maxWidth: 560, width: "100%", alignSelf: "center" },
  logo: { width: 72, height: 72, alignSelf: "center", marginTop: 20 },
  titulo: { color: "#fff", fontSize: 26, fontWeight: "900", textAlign: "center" },
  sub: { color: "#94A3B8", fontSize: 16, textAlign: "center", marginBottom: 8 },
  cartao: { flexDirection: "row", gap: 14, alignItems: "center", backgroundColor: "#111C30", borderRadius: 18, padding: 18, borderWidth: 1, borderColor: "#1E2A44" },
  emoji: { fontSize: 36 },
  cartaoTitulo: { color: "#fff", fontSize: 19, fontWeight: "800" },
  cartaoTexto: { color: "#94A3B8", fontSize: 14, marginTop: 4, lineHeight: 20 },
});
