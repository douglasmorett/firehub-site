/**
 * A impressora Bluetooth deste celular: escolher entre as pareadas, a largura
 * da bobina, ligar/pausar, imprimir um teste. E, no fim, sair da conta e
 * trocar o modo do app.
 */
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, Linking, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import ImpressoraBluetooth, { type ImpressoraPareada } from "../../modules/impressora-bluetooth";
import { gravarModo } from "@/lib/guardado";
import { permitirBluetooth, useImpressao } from "@/lib/impressao";
import { useSessaoDaLoja } from "@/lib/sessao";

export default function TelaDaImpressora() {
  const router = useRouter();
  const { sessao, avisos, sair } = useSessaoDaLoja();
  const { impressora, situacao, erro, impressasHoje, escolher, ligar, imprimirTeste } = useImpressao();
  const [pareadas, setPareadas] = useState<ImpressoraPareada[] | null>(null);
  const [problema, setProblema] = useState<string | null>(null);

  const procurar = useCallback(async () => {
    setProblema(null);
    if (Platform.OS !== "android") {
      setProblema("No iPhone a impressora Bluetooth ainda não funciona: a térmica comum usa Bluetooth clássico, que o iOS não libera para apps. Use um celular Android para imprimir; o aviso de pedido funciona normal no iPhone.");
      setPareadas([]);
      return;
    }
    try {
      if (!(await permitirBluetooth())) throw new Error("Permita o acesso a \"Dispositivos por perto\" para o FireHub.");
      setPareadas(await ImpressoraBluetooth.pareadas());
    } catch (e: any) {
      setProblema(e?.message || "Não consegui ver as impressoras.");
      setPareadas([]);
    }
  }, []);

  useEffect(() => { void procurar(); }, [procurar]);

  return (
    <SafeAreaView style={estilos.fundo} edges={["top", "bottom"]}>
      <View style={estilos.topo}>
        <Pressable onPress={() => router.back()} hitSlop={12}><Text style={estilos.voltar}>‹ Voltar</Text></Pressable>
        <Text style={estilos.tituloTopo}>Impressora Bluetooth</Text>
        <View style={{ width: 60 }} />
      </View>
      <ScrollView contentContainerStyle={estilos.conteudo}>
        {!sessao && <Text style={estilos.aviso}>Entre no painel primeiro: a impressora imprime os pedidos da loja logada.</Text>}

        {impressora && (
          <View style={estilos.cartao}>
            <View style={estilos.linha}>
              <View style={{ flex: 1 }}>
                <Text style={estilos.nome}>🖨️ {impressora.nome}</Text>
                <Text style={estilos.sub}>{impressora.largura} · {impressasHoje} {impressasHoje === 1 ? "comanda impressa" : "comandas impressas"} desde que abriu</Text>
              </View>
              <Switch value={impressora.ligada} onValueChange={(v) => void ligar(v)} trackColor={{ true: "#16A34A" }} />
            </View>
            <Text style={[estilos.sub, { marginTop: 8 }]}>{impressora.ligada ? situacao || "Ligando…" : "Pausada: as comandas ficam esperando na fila."}</Text>
            {erro && <Text style={estilos.erro}>⚠️ {erro}</Text>}
            <View style={[estilos.linha, { marginTop: 12, gap: 8 }]}>
              {(["58mm", "80mm"] as const).map((l) => (
                <Pressable key={l} onPress={() => void escolher({ ...impressora, largura: l })} style={[estilos.opcao, impressora.largura === l && estilos.opcaoMarcada]}>
                  <Text style={[estilos.opcaoTexto, impressora.largura === l && { color: "#fff" }]}>Bobina {l}</Text>
                </Pressable>
              ))}
              <Pressable onPress={() => void imprimirTeste()} style={[estilos.opcao, { marginLeft: "auto" }]}>
                <Text style={estilos.opcaoTexto}>Imprimir teste</Text>
              </Pressable>
            </View>
            <Text style={[estilos.sub, { marginTop: 10 }]}>
              Deixe o app aberto neste celular (a tela fica acesa sozinha): cada pedido sai aqui igual à comanda do computador. Se a loja tem o Assistente no computador, ele continua com as impressoras dele.
            </Text>
          </View>
        )}

        <Text style={estilos.secao}>Impressoras pareadas neste celular</Text>
        {problema && <Text style={estilos.erro}>{problema}</Text>}
        {pareadas?.map((p) => (
          <Pressable
            key={p.endereco}
            style={[estilos.cartao, estilos.linha, impressora?.endereco === p.endereco && { borderColor: "#16A34A" }]}
            onPress={() => void escolher({ endereco: p.endereco, nome: p.nome, largura: impressora?.largura || "58mm", ligada: true })}
          >
            <Text style={[estilos.nome, { flex: 1 }]}>{p.nome}</Text>
            <Text style={estilos.sub}>{impressora?.endereco === p.endereco ? "✓ em uso" : "Usar esta"}</Text>
          </Pressable>
        ))}
        {pareadas && pareadas.length === 0 && !problema && (
          <Text style={estilos.sub}>Nenhuma impressora pareada. Ligue a impressora, pareie nas configurações de Bluetooth do celular (a senha costuma ser 0000 ou 1234) e volte aqui.</Text>
        )}
        <View style={[estilos.linha, { gap: 8, marginTop: 6 }]}>
          <Pressable style={estilos.opcao} onPress={() => void procurar()}><Text style={estilos.opcaoTexto}>Procurar de novo</Text></Pressable>
          {Platform.OS === "android" && (
            <Pressable style={estilos.opcao} onPress={() => Linking.sendIntent("android.settings.BLUETOOTH_SETTINGS").catch(() => Linking.openSettings())}>
              <Text style={estilos.opcaoTexto}>Abrir o Bluetooth</Text>
            </Pressable>
          )}
        </View>

        <Text style={estilos.secao}>Aviso de pedido novo</Text>
        <View style={estilos.cartao}>
          <Text style={estilos.sub}>
            {avisos?.ok ? "✅ Ligado: este celular toca a cada pedido novo, mesmo bloqueado." : avisos ? `🔕 ${avisos.mensagem}` : sessao ? "Ligando…" : "Entre no painel para ligar."}
          </Text>
          {avisos && !avisos.ok && (
            <Pressable style={[estilos.opcao, { marginTop: 10, alignSelf: "flex-start" }]} onPress={() => Linking.openSettings()}>
              <Text style={estilos.opcaoTexto}>Abrir os ajustes do app</Text>
            </Pressable>
          )}
        </View>

        <Text style={estilos.secao}>Conta</Text>
        <View style={[estilos.linha, { gap: 8, flexWrap: "wrap" }]}>
          {sessao && (
            <Pressable style={estilos.opcao} onPress={() => Alert.alert("Sair deste celular?", "Ele para de receber os avisos e de imprimir os pedidos da loja.", [
              { text: "Cancelar", style: "cancel" },
              { text: "Sair", style: "destructive", onPress: async () => { await escolher(null); await sair(); router.replace("/loja"); } },
            ])}><Text style={estilos.opcaoTexto}>Sair da loja {sessao.nomeDaLoja}</Text></Pressable>
          )}
          <Pressable style={estilos.opcao} onPress={async () => { await gravarModo(null); router.replace("/"); }}>
            <Text style={estilos.opcaoTexto}>Trocar o modo do app</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const estilos = StyleSheet.create({
  fundo: { flex: 1, backgroundColor: "#F1F5F9" },
  topo: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12, backgroundColor: "#0B1220" },
  voltar: { color: "#fff", fontSize: 16, fontWeight: "700", width: 60 },
  tituloTopo: { color: "#fff", fontSize: 17, fontWeight: "800" },
  conteudo: { padding: 16, gap: 10, maxWidth: 640, width: "100%", alignSelf: "center" },
  cartao: { backgroundColor: "#fff", borderRadius: 16, padding: 14, borderWidth: 1.5, borderColor: "#E2E8F0" },
  linha: { flexDirection: "row", alignItems: "center" },
  nome: { fontSize: 16, fontWeight: "800", color: "#0F172A" },
  sub: { fontSize: 13.5, color: "#475569", lineHeight: 19 },
  erro: { fontSize: 14, color: "#B91C1C", backgroundColor: "#FEF2F2", borderRadius: 10, padding: 10, marginTop: 8 },
  aviso: { fontSize: 14, color: "#92400E", backgroundColor: "#FFFBEB", borderRadius: 10, padding: 10 },
  secao: { fontSize: 13, fontWeight: "800", color: "#64748B", textTransform: "uppercase", marginTop: 12 },
  opcao: { borderWidth: 1.5, borderColor: "#CBD5E1", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: "#fff" },
  opcaoMarcada: { backgroundColor: "#0F172A", borderColor: "#0F172A" },
  opcaoTexto: { fontWeight: "700", color: "#334155", fontSize: 14 },
});
