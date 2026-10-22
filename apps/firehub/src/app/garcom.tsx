/**
 * Modo GARÇOM: o módulo do garçom do site (/garcom/<loja>), com a tela acesa.
 * No celular abre a tela de celular; no tablet, a completa. A loja vem do link
 * que o gerente mandou (o app abre direto por ele) ou é digitada uma vez.
 */
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Painel } from "@/components/Painel";
import { gravarLojaDoGarcom, gravarModo, lerLojaDoGarcom } from "@/lib/guardado";

/** "firehubfood.com.br/garcom/minha-loja/celular", "/garcom/minha-loja" ou "minha-loja" → "minha-loja". */
function lojaDoTexto(texto: string): string | null {
  const t = texto.trim();
  const doLink = /\/garcom\/([a-z0-9-]+)/i.exec(t);
  if (doLink) return doLink[1].toLowerCase();
  return /^[a-z0-9-]{2,80}$/i.test(t) ? t.toLowerCase() : null;
}

export default function Garcom() {
  const router = useRouter();
  const { loja: daUrl } = useLocalSearchParams<{ loja?: string }>();
  const { width } = useWindowDimensions();
  const [loja, setLoja] = useState<string | null | undefined>(undefined);
  const [digitado, setDigitado] = useState("");
  const [erro, setErro] = useState("");

  useEffect(() => {
    (async () => {
      if (daUrl) {
        await gravarModo("garcom");
        await gravarLojaDoGarcom(daUrl);
        setLoja(daUrl);
      } else setLoja(await lerLojaDoGarcom());
    })();
  }, [daUrl]);

  useEffect(() => {
    void activateKeepAwakeAsync("garcom");
    return () => { void deactivateKeepAwake("garcom"); };
  }, []);

  if (loja === undefined) return <View style={{ flex: 1, backgroundColor: "#0B1220" }} />;

  if (!loja) {
    return (
      <SafeAreaView style={estilos.fundo}>
        <View style={estilos.caixa}>
          <Text style={estilos.titulo}>🙋 Garçom</Text>
          <Text style={estilos.texto}>Cole o link que a loja te mandou (ou só o nome da loja que aparece nele).</Text>
          <TextInput
            value={digitado}
            onChangeText={(t) => { setDigitado(t); setErro(""); }}
            placeholder="firehubfood.com.br/garcom/sua-loja"
            placeholderTextColor="#64748B"
            autoCapitalize="none"
            autoCorrect={false}
            style={estilos.campo}
          />
          {!!erro && <Text style={estilos.erro}>{erro}</Text>}
          <Pressable
            style={estilos.botao}
            onPress={async () => {
              const l = lojaDoTexto(digitado);
              if (!l) return setErro("Não reconheci o link. Peça o link do garçom ao gerente.");
              await gravarLojaDoGarcom(l);
              setLoja(l);
            }}
          >
            <Text style={estilos.botaoTexto}>Entrar</Text>
          </Pressable>
          <Pressable onPress={async () => { await gravarModo(null); router.replace("/"); }}>
            <Text style={estilos.link}>Voltar</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // Tablet (tela larga): a tela completa das mesas; celular: a tela de celular.
  const caminho = width >= 700 ? `/garcom/${loja}` : `/garcom/${loja}?tela=celular`;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#0B1220" }} edges={["top"]}>
      <View style={{ flex: 1, backgroundColor: "#fff" }}>
        <Painel caminho={caminho} modo="garcom" />
      </View>
    </SafeAreaView>
  );
}

const estilos = StyleSheet.create({
  fundo: { flex: 1, backgroundColor: "#0B1220", justifyContent: "center" },
  caixa: { padding: 24, gap: 12, maxWidth: 480, width: "100%", alignSelf: "center" },
  titulo: { color: "#fff", fontSize: 26, fontWeight: "900" },
  texto: { color: "#94A3B8", fontSize: 15, lineHeight: 21 },
  campo: { backgroundColor: "#111C30", borderWidth: 1, borderColor: "#1E2A44", borderRadius: 12, padding: 14, color: "#fff", fontSize: 16 },
  erro: { color: "#FCA5A5", fontSize: 14 },
  botao: { backgroundColor: "#FF4D00", borderRadius: 12, padding: 15, alignItems: "center" },
  botaoTexto: { color: "#fff", fontWeight: "800", fontSize: 16 },
  link: { color: "#94A3B8", textAlign: "center", marginTop: 8, fontSize: 15 },
});
