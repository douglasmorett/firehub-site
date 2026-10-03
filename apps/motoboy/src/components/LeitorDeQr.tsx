/**
 * A câmera lendo QR, dentro do app. Na página web o caminho ensinado era o
 * leitor de dentro da página, porque a câmera do iPhone abria o Safari, onde
 * a sessão não existia. Aqui a câmera é do app, e a sessão vem junto.
 */
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Haptics from "expo-haptics";
import { useEffect, useRef } from "react";
import { Linking, Modal, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Botao } from "./Botao";
import { cor } from "./tema";

export function LeitorDeQr({
  aberto,
  titulo,
  dica,
  aoLer,
  aoFechar,
  textoAlternativo,
  aoAlternativo,
}: {
  aberto: boolean;
  titulo: string;
  dica: string;
  /** Devolve true se o texto serviu (fecha o leitor); false continua lendo. */
  aoLer: (texto: string) => boolean;
  aoFechar: () => void;
  textoAlternativo?: string;
  aoAlternativo?: () => void;
}) {
  const [permissao, pedirPermissao] = useCameraPermissions();
  const jaLeu = useRef(false);

  useEffect(() => {
    if (aberto) jaLeu.current = false;
    if (aberto && permissao && !permissao.granted && permissao.canAskAgain) pedirPermissao();
  }, [aberto, permissao, pedirPermissao]);

  return (
    <Modal visible={aberto} animationType="slide" onRequestClose={aoFechar} presentationStyle="fullScreen">
      <SafeAreaView style={s.tela}>
        <Text style={s.titulo}>{titulo}</Text>
        <Text style={s.dica}>{dica}</Text>

        <View style={s.moldura}>
          {permissao?.granted ? (
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
              onBarcodeScanned={({ data }) => {
                // A câmera dispara várias leituras por segundo; só a primeira vale.
                if (jaLeu.current) return;
                if (aoLer(String(data))) {
                  jaLeu.current = true;
                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
                }
              }}
            />
          ) : (
            <View style={s.semCamera}>
              <Text style={s.semCameraTexto}>
                {permissao && !permissao.canAskAgain
                  ? "A câmera está bloqueada para o app. Libere nas configurações do celular."
                  : "Preciso da câmera para ler o QR."}
              </Text>
              {permissao && !permissao.canAskAgain ? (
                <Botao titulo="Abrir configurações" variante="contorno" aoTocar={() => Linking.openSettings()} />
              ) : (
                <Botao titulo="Liberar a câmera" variante="contorno" aoTocar={() => pedirPermissao()} />
              )}
            </View>
          )}
          <View style={[s.mira, { pointerEvents: "none" }]} />
        </View>

        <View style={s.botoes}>
          {textoAlternativo && aoAlternativo ? (
            <Botao titulo={textoAlternativo} variante="contorno" aoTocar={aoAlternativo} estilo={{ flex: 1 }} />
          ) : null}
          <Botao titulo="Cancelar" variante="claro" aoTocar={aoFechar} estilo={{ flex: 1 }} />
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const s = StyleSheet.create({
  tela: { flex: 1, backgroundColor: cor.topo, padding: 16, gap: 10 },
  titulo: { color: "#FFFFFF", fontSize: 20, fontWeight: "900", textAlign: "center", marginTop: 8 },
  dica: { color: "#94A3B8", fontSize: 14, fontWeight: "600", textAlign: "center" },
  moldura: { flex: 1, borderRadius: 20, overflow: "hidden", backgroundColor: "#000", marginVertical: 8 },
  mira: {
    position: "absolute",
    top: "22%",
    left: "15%",
    right: "15%",
    aspectRatio: 1,
    borderColor: "#FFFFFF",
    borderWidth: 3,
    borderRadius: 18,
    opacity: 0.85,
  },
  semCamera: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 16 },
  semCameraTexto: { color: "#E2E8F0", fontSize: 16, fontWeight: "700", textAlign: "center" },
  botoes: { flexDirection: "row", gap: 10 },
});
