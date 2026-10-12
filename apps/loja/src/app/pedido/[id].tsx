import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PaginaDaLoja } from "@/components/PaginaDaLoja";
import { marca, urlDoSite } from "@/lib/marca";

/** O acompanhamento do pedido — a mesma página que o link do WhatsApp abre. */
export default function Pedido() {
  const { id, slug } = useLocalSearchParams<{ id: string; slug?: string }>();
  const topo = useSafeAreaInsets().top;
  const lojaDoPedido = slug || marca.paginaInicial.split("/").filter(Boolean).pop() || "";
  return (
    <View style={{ flex: 1, backgroundColor: "#fff" }}>
      <View style={{ paddingTop: topo, backgroundColor: marca.cor }}>
        <View style={{ height: 52, flexDirection: "row", alignItems: "center", paddingHorizontal: 8 }}>
          <Pressable
            onPress={() => (router.canGoBack() ? router.back() : router.replace("/pedidos"))}
            hitSlop={12}
            style={{ padding: 8 }}
            accessibilityLabel="Voltar"
          >
            <Ionicons name="chevron-back" size={26} color={marca.corDoTexto} />
          </Pressable>
          <Text style={{ color: marca.corDoTexto, fontSize: 18, fontWeight: "700" }}>Seu pedido</Text>
        </View>
      </View>
      <PaginaDaLoja url={urlDoSite(`/loja/${lojaDoPedido}/pedido/${id}`)} />
    </View>
  );
}
