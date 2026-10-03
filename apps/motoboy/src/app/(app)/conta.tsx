/**
 * Conta: trocar a senha, ver se GPS e avisos estão ligados, sair.
 *
 * Trocar a senha invalida as sessões antigas (o hash da senha entra na
 * assinatura, src/lib/motoboy-sessao.ts no site). O servidor devolve um token
 * novo, e é ele que mantém ESTE celular dentro.
 */
import { Ionicons } from "@expo/vector-icons";
import * as Application from "expo-application";
import * as Notifications from "expo-notifications";
import * as Location from "expo-location";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, Linking, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAviso } from "@/components/Aviso";
import { Botao } from "@/components/Botao";
import { cor, raio } from "@/components/tema";
import { chamar } from "@/lib/api";
import { API_URL } from "@/lib/config";
import { registrarAvisos } from "@/lib/notificacoes";
import { useSessao } from "@/lib/sessao";

export default function Conta() {
  const { sessao, sair, trocarToken } = useSessao();
  const { avisar } = useAviso();
  const [atual, setAtual] = useState("");
  const [nova, setNova] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erroSenha, setErroSenha] = useState<string | null>(null);
  const [localizacao, setLocalizacao] = useState<string>("…");
  const [avisos, setAvisos] = useState<string>("…");

  useFocusEffect(
    useCallback(() => {
      Location.getForegroundPermissionsAsync()
        .then((p) => setLocalizacao(p.granted ? "Liberada" : p.canAskAgain ? "Ainda não pedida" : "Bloqueada"))
        .catch(() => setLocalizacao("—"));
      Notifications.getPermissionsAsync()
        .then((p) => setAvisos(p.granted ? "Ligados" : p.canAskAgain ? "Ainda não pedidos" : "Bloqueados"))
        .catch(() => setAvisos("—"));
    }, []),
  );

  if (!sessao) return null;

  async function salvarSenha() {
    setErroSenha(null);
    if (!atual || !nova) return setErroSenha("Preencha a senha atual e a nova.");
    if (nova.trim().length < 6) return setErroSenha("A nova senha precisa ter pelo menos 6 caracteres.");
    setSalvando(true);
    try {
      const r = await chamar<{ token?: string }>("/api/motoboys/login", {
        metodo: "PATCH",
        corpo: { motoboyId: sessao!.motoboyId, currentPassword: atual, newPassword: nova.trim() },
      });
      if (r.token) await trocarToken(r.token);
      setAtual("");
      setNova("");
      avisar("✅ Senha alterada!", "ok");
    } catch (e) {
      setErroSenha((e as Error)?.message || "Não consegui trocar a senha.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <SafeAreaView style={s.tela} edges={["top"]}>
      <View style={s.topo}>
        <Text style={s.titulo}>{sessao.motoboyNome}</Text>
        <Text style={s.subtitulo}>Entregador · {sessao.lojaNome}</Text>
      </View>
      <ScrollView contentContainerStyle={s.conteudo} keyboardShouldPersistTaps="handled">
        <View style={[s.cartao, sessao.trocarSenha && { borderColor: cor.ambarBorda, borderWidth: 2 }]}>
          <Text style={s.cartaoTitulo}>🔑 Trocar minha senha</Text>
          {sessao.trocarSenha ? <Text style={s.alerta}>Você ainda usa a senha padrão. Escolha uma só sua.</Text> : null}
          <TextInput
            value={atual}
            onChangeText={setAtual}
            placeholder="Senha atual"
            placeholderTextColor="#94A3B8"
            secureTextEntry
            autoCapitalize="none"
            style={s.campo}
            accessibilityLabel="Senha atual"
          />
          <TextInput
            value={nova}
            onChangeText={setNova}
            placeholder="Nova senha (mínimo 6)"
            placeholderTextColor="#94A3B8"
            secureTextEntry
            autoCapitalize="none"
            textContentType="newPassword"
            style={s.campo}
            accessibilityLabel="Nova senha"
          />
          {erroSenha ? <Text style={s.erro}>{erroSenha}</Text> : null}
          <Botao titulo="Salvar nova senha" carregando={salvando} aoTocar={salvarSenha} />
        </View>

        <View style={s.cartao}>
          <Text style={s.cartaoTitulo}>📱 Este celular</Text>
          <Linha rotulo="Localização" valor={localizacao} />
          <Linha rotulo="Avisos de pedido" valor={avisos} />
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Botao
              titulo="Religar avisos"
              variante="contorno"
              pequeno
              estilo={{ flex: 1 }}
              aoTocar={async () => {
                const r = await registrarAvisos(sessao.token);
                avisar(r.ok ? "🔔 Avisos ligados neste celular." : `🔕 ${r.mensagem}`, r.ok ? "ok" : "alerta", 5000);
                Notifications.getPermissionsAsync().then((p) => setAvisos(p.granted ? "Ligados" : "Bloqueados"));
              }}
            />
            <Botao titulo="Configurações" variante="contorno" pequeno estilo={{ flex: 1 }} aoTocar={() => Linking.openSettings()} />
          </View>
        </View>

        <View style={s.cartao}>
          <Text style={s.cartaoTitulo}>ℹ️ Sobre</Text>
          <Linha rotulo="Versão" valor={`${Application.nativeApplicationVersion ?? "—"} (${Application.nativeBuildVersion ?? "—"})`} />
          <Text style={s.dica}>
            Seus dados de entregador (nome, telefone, entregas) são da loja que te cadastrou. Para corrigir ou excluir, fale com ela.
          </Text>
          <Botao
            titulo="Política de privacidade"
            variante="contorno"
            pequeno
            icone={<Ionicons name="open-outline" size={16} color={cor.texto} />}
            aoTocar={() => Linking.openURL(`${API_URL}/privacidade`)}
          />
        </View>

        <Botao
          titulo="Sair deste celular"
          variante="perigo"
          icone={<Ionicons name="log-out" size={20} color={cor.vermelho} />}
          aoTocar={() =>
            Alert.alert("Sair do app?", "A loja deixa de te ver no mapa e este celular para de receber os seus pedidos.", [
              { text: "Ficar", style: "cancel" },
              { text: "Sair", style: "destructive", onPress: () => sair() },
            ])
          }
        />
      </ScrollView>
    </SafeAreaView>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <View style={s.linha}>
      <Text style={s.linhaRotulo}>{rotulo}</Text>
      <Text style={s.linhaValor}>{valor}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  tela: { flex: 1, backgroundColor: cor.topo },
  topo: { paddingHorizontal: 16, paddingVertical: 14 },
  titulo: { color: "#FFFFFF", fontSize: 22, fontWeight: "900" },
  subtitulo: { color: "#94A3B8", fontSize: 14, fontWeight: "600" },
  conteudo: { backgroundColor: cor.fundo, padding: 14, gap: 12, paddingBottom: 40, flexGrow: 1 },
  cartao: { backgroundColor: cor.cartao, borderRadius: raio.medio, borderWidth: 1, borderColor: cor.borda, padding: 14, gap: 10 },
  cartaoTitulo: { fontSize: 17, fontWeight: "900", color: cor.texto },
  alerta: { color: cor.ambar, fontWeight: "800", fontSize: 14 },
  campo: { minHeight: 50, borderWidth: 1.5, borderColor: cor.bordaForte, borderRadius: raio.pequeno, paddingHorizontal: 14, fontSize: 16, color: cor.texto },
  erro: { color: cor.vermelho, fontWeight: "800", fontSize: 14 },
  linha: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", minHeight: 32 },
  linhaRotulo: { fontSize: 15, color: cor.textoSuave, fontWeight: "600" },
  linhaValor: { fontSize: 15, color: cor.texto, fontWeight: "800" },
  dica: { fontSize: 13, color: cor.textoApagado, lineHeight: 19 },
});
