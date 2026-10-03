/**
 * Entrar: loja, telefone (ou nome) e senha — o mesmo login da página web
 * (api/motoboys/login). A loja vem do link que ela mandou, do QR do painel ou
 * do QR de qualquer comanda; quem escaneia a comanda já cai com o pedido
 * pronto para puxar depois de entrar.
 */
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Botao } from "@/components/Botao";
import { LeitorDeQr } from "@/components/LeitorDeQr";
import { cor, raio } from "@/components/tema";
import { ErroDaApi } from "@/lib/api";
import { lerUltimaLoja } from "@/lib/guardado";
import { lerLinkDaLoja } from "@/lib/loja";
import { useSessao } from "@/lib/sessao";

export default function Entrar() {
  const { entrar, avisoDeSaida } = useSessao();
  const [loja, setLoja] = useState("");
  const [acesso, setAcesso] = useState("");
  const [senha, setSenha] = useState("");
  const [verSenha, setVerSenha] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [entrando, setEntrando] = useState(false);
  const [lendoQr, setLendoQr] = useState(false);
  const comandaDoQr = useRef<string | null>(null);
  const campoAcesso = useRef<TextInput>(null);
  const campoSenha = useRef<TextInput>(null);

  useEffect(() => {
    lerUltimaLoja().then((l) => l && setLoja((atual) => atual || l));
  }, []);

  async function aoEntrar() {
    setErro(null);
    if (!loja.trim()) return setErro("Informe a loja (o link que ela mandou ou o nome).");
    if (!acesso.trim() || !senha) return setErro("Informe o telefone e a senha.");
    setEntrando(true);
    try {
      const sessao = await entrar({ loja, acesso, senha });
      const puxar = comandaDoQr.current;
      router.replace({
        pathname: "/entregas",
        params: { ...(puxar ? { puxar } : {}), ...(sessao.trocarSenha ? { trocarSenha: "1" } : {}) },
      });
    } catch (e: any) {
      if (e instanceof ErroDaApi && e.status === 404) setErro("Não achei essa loja. Confira o link ou peça o QR para a loja.");
      else setErro(e?.message || "Não consegui entrar. Tente de novo.");
    } finally {
      setEntrando(false);
    }
  }

  return (
    <SafeAreaView style={s.tela} edges={["top", "bottom"]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={s.conteudo} keyboardShouldPersistTaps="handled">
          <View style={s.marca}>
            <Image source={require("@/assets/images/firehub-chama.png")} style={s.logo} contentFit="contain" />
            <Text style={s.titulo}>FireHub Entregador</Text>
            <Text style={s.subtitulo}>Suas entregas, o mapa e o acerto do dia.</Text>
          </View>

          <View style={s.cartao}>
            {avisoDeSaida ? <Text style={s.avisoSaida}>{avisoDeSaida}</Text> : null}
            {erro ? (
              <View style={s.erro} accessibilityLiveRegion="assertive">
                <Text style={s.erroTexto}>⚠️ {erro}</Text>
              </View>
            ) : null}

            <Text style={s.rotulo}>LOJA</Text>
            <View style={s.linhaLoja}>
              <TextInput
                value={loja}
                onChangeText={setLoja}
                placeholder="Link ou nome da loja"
                placeholderTextColor="#94A3B8"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
                onSubmitEditing={() => campoAcesso.current?.focus()}
                style={[s.campo, { flex: 1 }]}
                accessibilityLabel="Loja"
              />
              <Botao
                titulo="QR"
                variante="roxo"
                icone={<Ionicons name="qr-code" size={20} color="#FFFFFF" />}
                aoTocar={() => setLendoQr(true)}
                estilo={{ paddingHorizontal: 16 }}
              />
            </View>
            <Text style={s.dica}>Escaneie o QR do painel da loja ou de qualquer comanda.</Text>

            <Text style={s.rotulo}>TELEFONE OU NOME CADASTRADO</Text>
            <TextInput
              ref={campoAcesso}
              value={acesso}
              onChangeText={setAcesso}
              placeholder="Seu telefone ou nome"
              placeholderTextColor="#94A3B8"
              autoCapitalize="words"
              autoCorrect={false}
              textContentType="telephoneNumber"
              returnKeyType="next"
              onSubmitEditing={() => campoSenha.current?.focus()}
              style={s.campo}
              accessibilityLabel="Telefone ou nome"
            />

            <Text style={s.rotulo}>SENHA</Text>
            <View style={s.linhaLoja}>
              <TextInput
                ref={campoSenha}
                value={senha}
                onChangeText={setSenha}
                placeholder="Sua senha"
                placeholderTextColor="#94A3B8"
                secureTextEntry={!verSenha}
                autoCapitalize="none"
                textContentType="password"
                returnKeyType="go"
                onSubmitEditing={aoEntrar}
                style={[s.campo, { flex: 1 }]}
                accessibilityLabel="Senha"
              />
              <Botao
                titulo=""
                variante="contorno"
                icone={<Ionicons name={verSenha ? "eye-off" : "eye"} size={20} color={cor.textoSuave} />}
                aoTocar={() => setVerSenha((v) => !v)}
                estilo={{ width: 56 }}
              />
            </View>

            <Botao
              titulo="Entrar"
              carregando={entrando}
              icone={<Ionicons name="log-in" size={20} color="#FFFFFF" />}
              aoTocar={aoEntrar}
              estilo={{ marginTop: 8, minHeight: 56 }}
            />
          </View>

          <Text style={s.rodape}>
            O acesso é criado pela loja, no painel do FireHub (Motoboys). Esqueceu a senha? Peça para a loja redefinir.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>

      <LeitorDeQr
        aberto={lendoQr}
        titulo="QR da loja"
        dica="Aponte para o QR do painel da loja ou para o QR de uma comanda."
        aoFechar={() => setLendoQr(false)}
        aoLer={(texto) => {
          const lido = lerLinkDaLoja(texto);
          if (!lido) return false;
          setLoja(lido.loja);
          comandaDoQr.current = lido.comanda;
          setLendoQr(false);
          setTimeout(() => campoAcesso.current?.focus(), 400);
          return true;
        }}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  tela: { flex: 1, backgroundColor: cor.topo },
  conteudo: { padding: 18, gap: 18, flexGrow: 1, justifyContent: "center" },
  marca: { alignItems: "center", gap: 6 },
  logo: { width: 72, height: 72 },
  titulo: { color: "#FFFFFF", fontSize: 26, fontWeight: "900" },
  subtitulo: { color: "#94A3B8", fontSize: 15, fontWeight: "600" },
  cartao: { backgroundColor: cor.cartao, borderRadius: 22, padding: 18, gap: 8 },
  rotulo: { fontSize: 12, fontWeight: "900", color: "#334155", letterSpacing: 0.5, marginTop: 6 },
  campo: {
    minHeight: 52,
    borderWidth: 1.5,
    borderColor: cor.bordaForte,
    borderRadius: raio.pequeno,
    paddingHorizontal: 14,
    fontSize: 17,
    fontWeight: "600",
    color: cor.texto,
  },
  linhaLoja: { flexDirection: "row", gap: 8, alignItems: "center" },
  dica: { fontSize: 12, color: cor.textoApagado },
  erro: { backgroundColor: cor.vermelhoClaro, borderWidth: 1, borderColor: "#FCA5A5", borderRadius: raio.pequeno, padding: 10 },
  erroTexto: { color: "#DC2626", fontWeight: "800", fontSize: 14, textAlign: "center" },
  avisoSaida: { backgroundColor: cor.ambarClaro, color: cor.ambar, borderRadius: raio.pequeno, padding: 10, fontWeight: "800", textAlign: "center", overflow: "hidden" },
  rodape: { color: "#94A3B8", fontSize: 13, textAlign: "center", lineHeight: 19 },
});
