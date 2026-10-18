/**
 * "Quer receber as promoções da loja?" — UMA vez, alguns segundos depois de
 * abrir o app.
 *
 * Apple 4.5.4: notificação de promoção só para quem aceitou dentro do app,
 * com texto claro, e com um jeito de sair (a chave "Promoções e novidades" na
 * aba Loja). O aviso do PEDIDO é outra coisa e segue pedindo permissão na hora
 * do primeiro pedido (lib/avisos.ts).
 *
 * "Quero receber" grava a resposta e só então pede a permissão do sistema.
 * "Agora não" grava "não" e não pergunta de novo.
 */
import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { tokenDoAparelho } from "@/lib/avisos";
import { marca } from "@/lib/marca";
import { avisarAbertura, guardarRespostaDasPromocoes, respostaDasPromocoes } from "@/lib/presenca";

const ESPERA_MS = 4000;

export function PerguntaDasPromocoes() {
  const [aberta, setAberta] = useState(false);

  useEffect(() => {
    let vivo = true;
    const t = setTimeout(() => {
      respostaDasPromocoes().then((r) => {
        if (vivo && r === null) setAberta(true);
      });
    }, ESPERA_MS);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, []);

  const responder = async (quer: boolean) => {
    setAberta(false);
    await guardarRespostaDasPromocoes(quer ? "sim" : "nao");
    if (quer) await tokenDoAparelho(true);
    // Leva a resposta (e o token, se veio) ao servidor sem contar abertura nova.
    avisarAbertura(true);
  };

  return (
    <Modal visible={aberta} transparent animationType="fade" onRequestClose={() => responder(false)}>
      <View style={estilos.fundo}>
        <View style={estilos.caixa} accessibilityViewIsModal>
          <View style={[estilos.icone, { backgroundColor: `${marca.cor}1A` }]}>
            <Ionicons name="pricetags" size={28} color={marca.cor} />
          </View>
          <Text style={estilos.titulo}>Quer receber as promoções da {marca.nome}?</Text>
          <Text style={estilos.texto}>
            Mandamos ofertas e novidades da loja por notificação, de vez em quando. Você pode desligar quando quiser na aba Loja.
          </Text>
          <Pressable style={[estilos.botao, { backgroundColor: marca.cor }]} onPress={() => responder(true)} accessibilityRole="button">
            <Text style={[estilos.textoDoBotao, { color: marca.corDoTexto }]}>Quero receber</Text>
          </Pressable>
          <Pressable style={estilos.botaoLeve} onPress={() => responder(false)} accessibilityRole="button">
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
  textoLeve: { fontSize: 15, fontWeight: "600", color: "#777" },
});
