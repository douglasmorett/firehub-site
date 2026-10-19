/**
 * A loja: como falar com ela, onde fica, a privacidade e, por último e sem
 * destaque, a linha que abre os ajustes de notificação do celular (a opção de
 * sair da Apple 4.5.4).
 */
import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import { Image } from "expo-image";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { logoDaMarca } from "@/lib/logo-da-marca";
import { marca } from "@/lib/marca";

function Linha({ icone, titulo, detalhe, aoTocar }: { icone: keyof typeof Ionicons.glyphMap; titulo: string; detalhe?: string; aoTocar: () => void }) {
  return (
    <Pressable style={estilos.linha} onPress={aoTocar} accessibilityRole="button">
      <View style={[estilos.icone, { backgroundColor: `${marca.cor}14` }]}>
        <Ionicons name={icone} size={20} color={marca.cor} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={estilos.titulo}>{titulo}</Text>
        {!!detalhe && <Text style={estilos.detalhe}>{detalhe}</Text>}
      </View>
      <Ionicons name="chevron-forward" size={18} color="#B5B5B5" />
    </Pressable>
  );
}

export default function Contato() {
  const topo = useSafeAreaInsets().top;
  const { whatsapp, telefone, instagram, endereco } = marca.contato || {};

  return (
    <ScrollView style={{ flex: 1, backgroundColor: "#F6F6F7" }} contentContainerStyle={{ paddingBottom: 32 }}>
      <View style={[estilos.topo, { paddingTop: topo + 24, backgroundColor: marca.cor }]}>
        {!!logoDaMarca && <Image source={logoDaMarca} style={estilos.logo} contentFit="cover" />}
        <Text style={[estilos.nome, { color: marca.corDoTexto }]}>{marca.nome}</Text>
        {!!endereco && <Text style={[estilos.endereco, { color: marca.corDoTexto }]}>{endereco}</Text>}
      </View>

      <Text style={estilos.secao}>Fale com a loja</Text>
      <View style={estilos.grupo}>
        {!!whatsapp && (
          <Linha icone="logo-whatsapp" titulo="WhatsApp" detalhe="Dúvidas sobre o pedido" aoTocar={() => Linking.openURL(`https://wa.me/${whatsapp}`)} />
        )}
        {!!telefone && <Linha icone="call" titulo="Ligar" detalhe={telefone} aoTocar={() => Linking.openURL(`tel:${telefone.replace(/\D/g, "")}`)} />}
        {!!instagram && (
          <Linha icone="logo-instagram" titulo="Instagram" detalhe={`@${instagram}`} aoTocar={() => Linking.openURL(`https://instagram.com/${instagram}`)} />
        )}
        {!!endereco && (
          <Linha
            icone="location"
            titulo="Como chegar"
            detalhe="Abrir no mapa"
            aoTocar={() => Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(endereco)}`)}
          />
        )}
      </View>

      <Text style={estilos.secao}>Este celular</Text>
      <View style={estilos.grupo}>
        <Linha icone="shield-checkmark" titulo="Privacidade" detalhe="Como seus dados são usados" aoTocar={() => WebBrowser.openBrowserAsync(marca.privacidade)} />
        {/* A opção de sair que a Apple exige (4.5.4: "provide a method in your app for a user
            to opt out"): uma linha discreta que só abre os ajustes do app no celular. Não há
            chave para tirar só a promoção — Douglas, 18/10/2026: "nada de botão de tirar
            notificação". Quem desliga nos ajustes para de receber tudo (pedido e promoção). */}
        <Linha icone="notifications-outline" titulo="Notificações" detalhe="Ativar ou desativar nos ajustes do celular" aoTocar={() => Linking.openSettings().catch(() => {})} />
      </View>

      <Text style={estilos.rodape}>
        Versão {Constants.expoConfig?.version ?? "—"} · Pedidos com FireHub
      </Text>
    </ScrollView>
  );
}

const estilos = StyleSheet.create({
  topo: { alignItems: "center", paddingBottom: 24, paddingHorizontal: 24, gap: 6 },
  logo: { width: 88, height: 88, borderRadius: 20, marginBottom: 8, borderWidth: 3, borderColor: "rgba(255,255,255,0.85)" },
  nome: { fontSize: 22, fontWeight: "800" },
  endereco: { fontSize: 13, opacity: 0.9, textAlign: "center" },
  secao: { fontSize: 13, fontWeight: "700", color: "#777", textTransform: "uppercase", marginTop: 24, marginBottom: 8, marginHorizontal: 20 },
  grupo: { backgroundColor: "#fff", marginHorizontal: 16, borderRadius: 14, overflow: "hidden" },
  linha: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14, paddingHorizontal: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#E7E7E7" },
  icone: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  titulo: { fontSize: 15, fontWeight: "600", color: "#111" },
  detalhe: { fontSize: 13, color: "#777", marginTop: 2 },
  rodape: { textAlign: "center", color: "#9A9A9A", fontSize: 12, marginTop: 28 },
});
