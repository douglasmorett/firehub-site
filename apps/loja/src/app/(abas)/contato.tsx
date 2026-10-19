/**
 * A loja: como falar com ela, onde fica, as notificações deste celular e, por
 * último e sem destaque, a chave que desliga só as promoções (Apple 4.5.4:
 * quem recebe promoção tem de poder sair).
 */
import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import { Image } from "expo-image";
import * as Linking from "expo-linking";
import { useFocusEffect } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { estadoDosAvisos, tokenDoAparelho, type EstadoDosAvisos } from "@/lib/avisos";
import { logoDaMarca } from "@/lib/logo-da-marca";
import { marca } from "@/lib/marca";
import { avisarAbertura, desligarPromocoes, promocoesDesligadas } from "@/lib/presenca";

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

const TEXTO_DOS_AVISOS: Record<EstadoDosAvisos, string> = {
  ligados: "Ligados — você é avisado quando o pedido é aceito, sai para entrega e chega.",
  desligados: "Desligados. Toque para ligar nos ajustes do celular.",
  "nao-perguntado": "Toque para ligar e saber quando o pedido sair para entrega.",
  indisponivel: "Indisponíveis neste aparelho.",
};

export default function Contato() {
  const topo = useSafeAreaInsets().top;
  const [avisos, setAvisos] = useState<EstadoDosAvisos>("indisponivel");
  const [promocoes, setPromocoes] = useState(true);
  const { whatsapp, telefone, instagram, endereco } = marca.contato || {};

  useFocusEffect(
    useCallback(() => {
      estadoDosAvisos().then(setAvisos);
      promocoesDesligadas().then((d) => setPromocoes(!d));
    }, []),
  );

  const ligarAvisos = async () => {
    if (avisos === "nao-perguntado") {
      await tokenDoAparelho(true);
      setAvisos(await estadoDosAvisos());
    } else if (avisos === "desligados") {
      Linking.openSettings();
    }
  };

  // Desligar tira só a promoção; os avisos do pedido continuam (uma permissão só no celular).
  const trocarPromocoes = async (quer: boolean) => {
    setPromocoes(quer);
    await desligarPromocoes(!quer);
    avisarAbertura(true);
  };

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
        <Linha icone="notifications" titulo="Avisos do pedido" detalhe={TEXTO_DOS_AVISOS[avisos]} aoTocar={ligarAvisos} />
        <Linha icone="shield-checkmark" titulo="Privacidade" detalhe="Como seus dados são usados" aoTocar={() => WebBrowser.openBrowserAsync(marca.privacidade)} />
        {/* Sem destaque, de propósito: é a opção de sair que a Apple exige (4.5.4). */}
        <View style={[estilos.linha, { borderBottomWidth: 0 }]}>
          <View style={[estilos.icone, { backgroundColor: "#F1F1F1" }]}>
            <Ionicons name="pricetags-outline" size={18} color="#8A8A8A" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={estilos.titulo}>Promoções e novidades</Text>
            <Text style={estilos.detalhe}>
              {promocoes ? "Chegam junto com os avisos do pedido." : "Desligadas — você recebe só os avisos do pedido."}
            </Text>
          </View>
          <Switch
            value={promocoes}
            onValueChange={trocarPromocoes}
            trackColor={{ true: "#9CA3AF", false: "#D4D4D4" }}
            accessibilityLabel="Receber promoções e novidades"
          />
        </View>
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
