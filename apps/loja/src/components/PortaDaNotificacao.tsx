/**
 * A NOTIFICAÇÃO É CONDIÇÃO PARA USAR O APP (Douglas, 21/10/2026: "se ela não
 * permitir, não pode usar o aplicativo").
 *
 * - ANDROID: sem a permissão, esta tela cobre o app e não tem como fechá-la.
 *   Só sai ligando (o pedido do sistema, ou os ajustes quando o sistema não
 *   pergunta mais). O Google Play não proíbe.
 * - IPHONE: a Apple (4.5.4: "Push Notifications must not be required for the app
 *   to function") reprova app que trava sem push. Então a mesma tela aparece a
 *   CADA abertura, mas com "Continuar sem avisos", que vale só até fechar o app.
 *
 * Só aparece depois do aceite do termo (o termo abre o pedido do sistema e
 * avisa daqui por `termoRespondido`). Ao voltar dos ajustes, o app confere de
 * novo e a tela some sozinha.
 */
import { Ionicons } from "@expo/vector-icons";
import * as Linking from "expo-linking";
import * as Notifications from "expo-notifications";
import { useCallback, useEffect, useState } from "react";
import { AppState, Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { estadoDosAvisos, tokenDoAparelho } from "@/lib/avisos";
import { marca } from "@/lib/marca";
import { aceitouOTermoAtual } from "@/lib/termo";

let liberar: (() => void) | null = null;

/** O termo acabou de ser aceito e o pedido do sistema já foi respondido: a porta pode conferir. */
export function termoRespondido(): void {
  liberar?.();
}

export function PortaDaNotificacao() {
  const [fechada, setFechada] = useState(false);
  const [pulou, setPulou] = useState(false); // só no iPhone, só até fechar o app

  const conferir = useCallback(async () => {
    if (!(await aceitouOTermoAtual())) return; // o termo vem primeiro
    const estado = await estadoDosAvisos();
    setFechada(estado === "desligados" || estado === "nao-perguntado");
  }, []);

  useEffect(() => {
    liberar = () => void conferir();
    conferir();
    const sub = AppState.addEventListener("change", (e) => {
      if (e === "active") conferir();
    });
    return () => {
      liberar = null;
      sub.remove();
    };
  }, [conferir]);

  const ligar = async () => {
    const p = await Notifications.getPermissionsAsync();
    if (p.canAskAgain) {
      await tokenDoAparelho(true);
      conferir();
    } else {
      Linking.openSettings().catch(() => {});
    }
  };

  const iphone = Platform.OS === "ios";
  return (
    // Sem onRequestClose que feche: o Voltar do Android não pula a porta.
    <Modal visible={fechada && !pulou} animationType="fade" onRequestClose={() => {}} statusBarTranslucent>
      <View style={[estilos.tela, { backgroundColor: marca.cor }]}>
        <View style={estilos.icone}>
          <Ionicons name="notifications" size={44} color={marca.cor} />
        </View>
        <Text style={[estilos.titulo, { color: marca.corDoTexto }]}>Ative as notificações</Text>
        <Text style={[estilos.texto, { color: marca.corDoTexto }]}>
          {`Para usar o app da ${marca.nome} as notificações precisam estar ligadas. É por elas que você acompanha o pedido e recebe as promoções e novidades.`}
        </Text>
        <Pressable style={estilos.botao} onPress={ligar} accessibilityRole="button">
          <Text style={[estilos.textoDoBotao, { color: marca.cor }]}>Ativar notificações</Text>
        </Pressable>
        {iphone && (
          <Pressable onPress={() => setPulou(true)} accessibilityRole="button" hitSlop={10} style={estilos.leve}>
            <Text style={[estilos.textoLeve, { color: marca.corDoTexto }]}>Continuar sem avisos</Text>
          </Pressable>
        )}
      </View>
    </Modal>
  );
}

const estilos = StyleSheet.create({
  tela: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28, gap: 16 },
  icone: { width: 88, height: 88, borderRadius: 26, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  titulo: { fontSize: 24, fontWeight: "800", textAlign: "center" },
  texto: { fontSize: 16, lineHeight: 23, textAlign: "center", opacity: 0.92 },
  botao: { alignSelf: "stretch", backgroundColor: "#fff", paddingVertical: 16, borderRadius: 14, alignItems: "center", marginTop: 8 },
  textoDoBotao: { fontSize: 17, fontWeight: "800" },
  leve: { paddingVertical: 10 },
  textoLeve: { fontSize: 13, fontWeight: "600", opacity: 0.75, textDecorationLine: "underline" },
});
