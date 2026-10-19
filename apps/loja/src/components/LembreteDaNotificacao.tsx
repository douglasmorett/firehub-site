/**
 * Quem NÃO permitiu a notificação é lembrado UMA única vez, logo depois do
 * primeiro pedido feito pelo app (o momento em que o aviso "saiu para
 * entrega" faz sentido). Nunca a cada abertura.
 *
 * - O celular ainda pode perguntar (canAskAgain): quem pergunta é o próprio
 *   pedido — `registrarNoPedido` (lib/avisos.ts) abre o pedido do sistema na
 *   hora do pedido. Aqui não se pergunta de novo em cima dele.
 * - Não pode mais (iPhone que já negou, Android com "não perguntar de novo"):
 *   explica em uma linha e "Abrir ajustes" leva às configurações do app
 *   (Linking.openSettings, que os dois sistemas permitem).
 *
 * "Agora não" fecha e o app segue normal: a notificação nunca é obrigatória
 * (Apple 4.5.4).
 */
import { Ionicons } from "@expo/vector-icons";
import * as Linking from "expo-linking";
import * as Notifications from "expo-notifications";
import { useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { marca } from "@/lib/marca";
import { jaReperguntou, marcarReperguntado } from "@/lib/presenca";

let abrirDeFora: ((aberto: boolean) => void) | null = null;

/** Chamado pela página da loja DEPOIS de `registrarNoPedido` (que já fez o pedido do sistema, se ainda dava). */
export async function lembrarDepoisDoPedido(): Promise<void> {
  try {
    if (await jaReperguntou()) return;
    const p = await Notifications.getPermissionsAsync();
    if (p.granted || p.canAskAgain) return;
    await marcarReperguntado();
    // Um respiro: a página acabou de mostrar o pedido feito.
    setTimeout(() => abrirDeFora?.(true), 2500);
  } catch {
    /* sem como saber: não lembra */
  }
}

export function LembreteDaNotificacao() {
  const [aberto, setAberto] = useState(false);
  useEffect(() => {
    abrirDeFora = setAberto;
    return () => {
      abrirDeFora = null;
    };
  }, []);

  const abrirAjustes = () => {
    setAberto(false);
    Linking.openSettings().catch(() => {});
  };

  return (
    <Modal visible={aberto} transparent animationType="fade" onRequestClose={() => setAberto(false)}>
      <View style={estilos.fundo}>
        <View style={estilos.caixa}>
          <View style={[estilos.icone, { backgroundColor: `${marca.cor}1A` }]}>
            <Ionicons name="notifications" size={28} color={marca.cor} />
          </View>
          <Text style={estilos.titulo}>Quer saber quando o pedido sair?</Text>
          <Text style={estilos.texto}>
            {`As notificações da ${marca.nome} estão desligadas neste celular. Ligue nos ajustes para acompanhar seus pedidos e receber as promoções e novidades.`}
          </Text>
          <Pressable style={[estilos.botao, { backgroundColor: marca.cor }]} onPress={abrirAjustes} accessibilityRole="button">
            <Text style={[estilos.textoDoBotao, { color: marca.corDoTexto }]}>Abrir ajustes</Text>
          </Pressable>
          <Pressable style={estilos.botaoLeve} onPress={() => setAberto(false)} accessibilityRole="button" hitSlop={8}>
            <Text style={estilos.textoLeve}>Agora não</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const estilos = StyleSheet.create({
  fundo: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center", padding: 24 },
  caixa: { backgroundColor: "#fff", borderRadius: 20, padding: 24, width: "100%", maxWidth: 380, alignItems: "center" },
  icone: { width: 56, height: 56, borderRadius: 16, alignItems: "center", justifyContent: "center", marginBottom: 12 },
  titulo: { fontSize: 19, fontWeight: "800", color: "#111", textAlign: "center", marginBottom: 8 },
  texto: { fontSize: 15, color: "#555", textAlign: "center", lineHeight: 21, marginBottom: 20 },
  botao: { alignSelf: "stretch", paddingVertical: 14, borderRadius: 12, alignItems: "center" },
  textoDoBotao: { fontSize: 16, fontWeight: "700" },
  botaoLeve: { alignSelf: "stretch", paddingVertical: 12, alignItems: "center", marginTop: 6 },
  textoLeve: { fontSize: 14, fontWeight: "600", color: "#8A8A8A" },
});
