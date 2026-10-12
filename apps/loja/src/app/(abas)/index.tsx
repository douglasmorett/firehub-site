import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PaginaDaLoja } from "@/components/PaginaDaLoja";
import { marca, urlDoSite } from "@/lib/marca";

/** O cardápio da loja. Com várias unidades, a página escolhe a que atende o bairro do cliente. */
export default function Cardapio() {
  const topo = useSafeAreaInsets().top;
  return (
    <View style={{ flex: 1, paddingTop: topo, backgroundColor: marca.cor }}>
      <PaginaDaLoja url={urlDoSite(marca.paginaInicial)} />
    </View>
  );
}
