/**
 * Modo LOJA: o painel do FireHub (o mesmo do navegador) com uma faixa do app
 * em cima — a loja, o aviso de pedido novo e a impressora Bluetooth.
 * Tocar no aviso de pedido novo abre a tela de Pedidos e puxa a impressão.
 */
import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";
import { useEffect, useRef } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Painel, type PainelRef } from "@/components/Painel";
import { useImpressao } from "@/lib/impressao";
import { useSessaoDaLoja } from "@/lib/sessao";

const TELA_DE_PEDIDOS = "/store/pedidos-clientes";

export default function Loja() {
  const router = useRouter();
  const painel = useRef<PainelRef>(null);
  const { sessao, avisos, entrou } = useSessaoDaLoja();
  const { impressora, erro, puxarAgora } = useImpressao();

  // Aviso de pedido: com o app aberto, já puxa a impressão; tocado, abre os Pedidos.
  useEffect(() => {
    const chegou = Notifications.addNotificationReceivedListener(() => puxarAgora());
    const tocou = Notifications.addNotificationResponseReceivedListener((r) => {
      const dados: any = r.notification.request.content.data || {};
      painel.current?.abrir(dados.tipo === "chamado" ? "/store/mesas" : TELA_DE_PEDIDOS);
      puxarAgora();
    });
    return () => { chegou.remove(); tocou.remove(); };
  }, [puxarAgora]);

  const corDaImpressora = !impressora ? "#64748B" : erro ? "#DC2626" : impressora.ligada ? "#16A34A" : "#64748B";
  const textoDaImpressora = !impressora ? "Impressora" : erro ? "Impressora com erro" : impressora.ligada ? "Imprimindo" : "Impressão pausada";

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#0B1220" }} edges={["top"]}>
      {sessao && (
        <View style={estilos.faixa}>
          <Text style={estilos.loja} numberOfLines={1}>{sessao.nomeDaLoja}</Text>
          {avisos && !avisos.ok && <Text style={estilos.alerta} numberOfLines={1}>🔕 Avisos desligados</Text>}
          <Pressable style={[estilos.chip, { borderColor: corDaImpressora }]} onPress={() => router.push("/impressora")}>
            <View style={[estilos.bolinha, { backgroundColor: corDaImpressora }]} />
            <Text style={estilos.chipTexto}>🖨️ {textoDaImpressora}</Text>
          </Pressable>
        </View>
      )}
      <View style={{ flex: 1, backgroundColor: "#fff" }}>
        <Painel ref={painel} caminho={TELA_DE_PEDIDOS} modo="loja" aoEntrarNaLoja={entrou} />
      </View>
    </SafeAreaView>
  );
}

const estilos = StyleSheet.create({
  faixa: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: "#0B1220" },
  loja: { flex: 1, color: "#fff", fontWeight: "800", fontSize: 15 },
  alerta: { color: "#FCA5A5", fontSize: 12, fontWeight: "700" },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  bolinha: { width: 8, height: 8, borderRadius: 4 },
  chipTexto: { color: "#fff", fontWeight: "700", fontSize: 13 },
});
