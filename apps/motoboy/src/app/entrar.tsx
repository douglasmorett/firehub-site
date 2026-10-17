/**
 * Entrar: loja, telefone (ou nome) e senha — o mesmo login da página web
 * (api/motoboys/login). A loja vem do link que ela mandou, do QR do painel ou
 * do QR de qualquer comanda; quem escaneia a comanda já cai com o pedido
 * pronto para puxar depois de entrar.
 *
 * O jeito principal é o QR (botão grande): digitar "o nome da loja" gerava
 * dúvida (Douglas, 16/10/2026). O campo de texto fica escondido atrás de
 * "Digitar o link da loja". Lida a loja, a tela mostra o nome e pede só o
 * telefone e a senha. O link do QR aberto pela câmera do celular chega aqui
 * com ?loja=&puxar= (src/app/loja/[slug]/motoboy.tsx).
 */
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Botao } from "@/components/Botao";
import { LeitorDeQr } from "@/components/LeitorDeQr";
import { cor, raio } from "@/components/tema";
import { ErroDaApi } from "@/lib/api";
import { lerUltimaLoja } from "@/lib/guardado";
import { lerLinkDaLoja, lojaParaOLogin } from "@/lib/loja";
import { useSessao } from "@/lib/sessao";

export default function Entrar() {
  const { entrar, avisoDeSaida } = useSessao();
  const params = useLocalSearchParams<{ loja?: string; puxar?: string }>();
  const [loja, setLoja] = useState(String(params.loja || ""));
  const [digitarLoja, setDigitarLoja] = useState(false);
  const [acesso, setAcesso] = useState("");
  const [senha, setSenha] = useState("");
  const [verSenha, setVerSenha] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [entrando, setEntrando] = useState(false);
  const [lendoQr, setLendoQr] = useState(false);
  const comandaDoQr = useRef<string | null>(params.puxar ? String(params.puxar) : null);
  const campoAcesso = useRef<TextInput>(null);
  const campoSenha = useRef<TextInput>(null);

  useEffect(() => {
    lerUltimaLoja().then((l) => l && setLoja((atual) => atual || l));
  }, []);

  async function aoEntrar() {
    setErro(null);
    if (!loja.trim()) return setErro("Escaneie o QR de uma comanda da loja (ou digite o link da loja).");
    if (!acesso.trim() || !senha) return setErro("Informe o telefone e a senha.");
    setEntrando(true);
    try {
      await entrar({ loja, acesso, senha });
      const puxar = comandaDoQr.current;
      router.replace({
        pathname: "/entregas",
        params: puxar ? { puxar } : {},
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

            {loja.trim() && !digitarLoja ? (
              <View style={s.lojaLida}>
                <Ionicons name="storefront" size={20} color={cor.texto} />
                <Text style={s.lojaLidaNome} numberOfLines={1}>{lojaParaOLogin(loja)}</Text>
                <Botao titulo="Trocar" variante="contorno" aoTocar={() => setLendoQr(true)} estilo={{ minHeight: 40, paddingHorizontal: 12 }} />
              </View>
            ) : (
              <>
                <Botao
                  titulo="Escanear a comanda ou o QR da loja"
                  variante="roxo"
                  icone={<Ionicons name="qr-code" size={22} color="#FFFFFF" />}
                  aoTocar={() => setLendoQr(true)}
                  estilo={{ minHeight: 60 }}
                />
                <Text style={s.dica}>Aponte para o QR impresso em qualquer comanda da loja, ou o QR do painel.</Text>
                {digitarLoja ? (
                  <>
                    <Text style={s.rotulo}>LINK DA LOJA</Text>
                    <TextInput
                      value={loja}
                      onChangeText={setLoja}
                      placeholder="Ex.: firehubfood.com.br/loja/minha-loja"
                      placeholderTextColor="#94A3B8"
                      autoCapitalize="none"
                      autoCorrect={false}
                      returnKeyType="next"
                      onSubmitEditing={() => campoAcesso.current?.focus()}
                      style={s.campo}
                      accessibilityLabel="Link da loja"
                    />
                  </>
                ) : (
                  <Text style={s.linkTexto} onPress={() => setDigitarLoja(true)} accessibilityRole="button">
                    Sem comanda? Digitar o link da loja
                  </Text>
                )}
              </>
            )}

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
                rotulo={verSenha ? "Esconder a senha" : "Mostrar a senha"}
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
          setDigitarLoja(false);
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
  dica: { fontSize: 12, color: cor.textoApagado, textAlign: "center" },
  lojaLida: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#F1F5F9", borderRadius: raio.pequeno, paddingVertical: 8, paddingHorizontal: 12 },
  lojaLidaNome: { flex: 1, fontSize: 17, fontWeight: "800", color: cor.texto },
  linkTexto: { fontSize: 14, fontWeight: "700", color: "#7C3AED", textAlign: "center", paddingVertical: 8, textDecorationLine: "underline" },
  erro: { backgroundColor: cor.vermelhoClaro, borderWidth: 1, borderColor: "#FCA5A5", borderRadius: raio.pequeno, padding: 10 },
  erroTexto: { color: "#DC2626", fontWeight: "800", fontSize: 14, textAlign: "center" },
  avisoSaida: { backgroundColor: cor.ambarClaro, color: cor.ambar, borderRadius: raio.pequeno, padding: 10, fontWeight: "800", textAlign: "center", overflow: "hidden" },
  rodape: { color: "#94A3B8", fontSize: 13, textAlign: "center", lineHeight: 19 },
});
