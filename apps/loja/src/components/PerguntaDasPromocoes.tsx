/**
 * "Ative as notificações para receber as promoções da <loja>" — a tela de
 * boas-vindas da PRIMEIRA abertura (Douglas, 17/10/2026: "logo na entrada").
 *
 * Apple 4.5.4: promoção por notificação só com aceite explícito dentro do
 * app e com um jeito de sair. Por isso:
 * - o texto diz claramente que são PROMOÇÕES;
 * - "Ativar notificações" grava o aceite e só então pede a permissão do
 *   sistema; "Agora não" fecha e o app segue normal (nada é bloqueado);
 * - a chave "Promoções e novidades" na aba Loja liga e desliga a qualquer hora.
 *
 * Quem disse "agora não" é perguntado de novo UMA única vez, logo depois do
 * primeiro pedido feito pelo app (PaginaDaLoja chama `perguntarDepoisDoPedido`).
 * É a nossa tela, não o pedido de permissão do sistema (que o iPhone só mostra
 * uma vez); perguntar de novo uma vez, num momento com motivo, está dentro da
 * regra — insistir a cada abertura não estaria.
 */
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { tokenDoAparelho } from "@/lib/avisos";
import { logoDaMarca } from "@/lib/logo-da-marca";
import { marca } from "@/lib/marca";
import { avisarAbertura, guardarRespostaDasPromocoes, marcarReperguntado, podeReperguntar, respostaDasPromocoes } from "@/lib/presenca";

type Modo = "boasVindas" | "depoisDoPedido";
let abrirDeFora: ((m: Modo) => void) | null = null;

/** Depois do primeiro pedido pelo app: pergunta de novo, uma vez só, a quem recusou. */
export async function perguntarDepoisDoPedido(): Promise<void> {
  if (!(await podeReperguntar())) return;
  await marcarReperguntado();
  // Um respiro: a página acabou de mostrar o pedido feito.
  setTimeout(() => abrirDeFora?.("depoisDoPedido"), 2500);
}

export function PerguntaDasPromocoes() {
  const [modo, setModo] = useState<Modo | null>(null);
  const inferior = useSafeAreaInsets().bottom;

  useEffect(() => {
    abrirDeFora = setModo;
    let vivo = true;
    respostaDasPromocoes().then((r) => {
      if (vivo && r === null) setModo("boasVindas");
    });
    return () => {
      vivo = false;
      abrirDeFora = null;
    };
  }, []);

  const responder = async (quer: boolean) => {
    setModo(null);
    await guardarRespostaDasPromocoes(quer ? "sim" : "nao");
    if (quer) await tokenDoAparelho(true);
    // Leva a resposta (e o token, se veio) ao servidor sem contar abertura nova.
    avisarAbertura(true);
  };

  const depois = modo === "depoisDoPedido";
  return (
    <Modal visible={modo !== null} animationType="slide" onRequestClose={() => responder(false)} statusBarTranslucent>
      <View style={[estilos.tela, { backgroundColor: marca.cor, paddingBottom: inferior + 24 }]}>
        <View style={estilos.topo}>
          {!!logoDaMarca && <Image source={logoDaMarca} style={estilos.logo} contentFit="cover" />}
          <View style={estilos.sino}>
            <Ionicons name="notifications" size={34} color={marca.cor} />
          </View>
        </View>
        <View style={estilos.cartao}>
          <Text style={estilos.titulo}>
            {depois ? `Pedido feito! Quer saber das próximas promoções da ${marca.nome}?` : `Ative as notificações para receber as promoções da ${marca.nome}`}
          </Text>
          <View style={estilos.lista}>
            <Item icone="pricetags" texto="Ofertas e novidades da loja, de vez em quando" />
            <Item icone="bicycle" texto="Aviso quando o seu pedido sair e estiver chegando" />
            <Item icone="toggle" texto="Desliga quando quiser, na aba Loja" />
          </View>
          <Pressable style={[estilos.botao, { backgroundColor: marca.cor }]} onPress={() => responder(true)} accessibilityRole="button">
            <Text style={[estilos.textoDoBotao, { color: marca.corDoTexto }]}>Ativar notificações</Text>
          </Pressable>
          <Pressable style={estilos.botaoLeve} onPress={() => responder(false)} accessibilityRole="button" hitSlop={8}>
            <Text style={estilos.textoLeve}>Agora não</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function Item({ icone, texto }: { icone: keyof typeof Ionicons.glyphMap; texto: string }) {
  return (
    <View style={estilos.item}>
      <View style={[estilos.itemIcone, { backgroundColor: `${marca.cor}1A` }]}>
        <Ionicons name={icone} size={18} color={marca.cor} />
      </View>
      <Text style={estilos.itemTexto}>{texto}</Text>
    </View>
  );
}

const estilos = StyleSheet.create({
  tela: { flex: 1, justifyContent: "flex-end" },
  topo: { flex: 1, alignItems: "center", justifyContent: "center", gap: 18 },
  logo: { width: 104, height: 104, borderRadius: 26, borderWidth: 3, borderColor: "rgba(255,255,255,0.9)" },
  sino: { width: 72, height: 72, borderRadius: 36, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  cartao: { backgroundColor: "#fff", borderRadius: 26, marginHorizontal: 16, padding: 24 },
  titulo: { fontSize: 22, fontWeight: "800", color: "#111", textAlign: "center", lineHeight: 28, marginBottom: 18 },
  lista: { gap: 12, marginBottom: 22 },
  item: { flexDirection: "row", alignItems: "center", gap: 12 },
  itemIcone: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  itemTexto: { flex: 1, fontSize: 15, color: "#444", lineHeight: 20 },
  botao: { paddingVertical: 16, borderRadius: 14, alignItems: "center" },
  textoDoBotao: { fontSize: 17, fontWeight: "800" },
  botaoLeve: { paddingVertical: 12, alignItems: "center", marginTop: 4 },
  textoLeve: { fontSize: 14, fontWeight: "600", color: "#8A8A8A" },
});
