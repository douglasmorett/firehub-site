import { useEffect, useState } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PaginaDaLoja } from "@/components/PaginaDaLoja";
import { ouvirCardapio } from "@/lib/abrir-no-cardapio";
import { marca, urlDoSite } from "@/lib/marca";

/**
 * O cardápio da loja. Com várias unidades, a página escolhe a que atende o
 * bairro do cliente. O toque numa notificação de promoção troca a página
 * (o cardápio de uma unidade ou um produto dele — lib/abrir-no-cardapio.ts).
 */
export default function Cardapio() {
  const topo = useSafeAreaInsets().top;
  const [pagina, setPagina] = useState({ url: urlDoSite(marca.paginaInicial), vez: 0 });

  useEffect(
    () => ouvirCardapio((caminho) => setPagina((p) => ({ url: urlDoSite(caminho), vez: p.vez + 1 }))),
    [],
  );

  return (
    <View style={{ flex: 1, paddingTop: topo, backgroundColor: marca.cor }}>
      {/* `key` troca a cada toque: a mesma promoção tocada duas vezes recarrega a página. */}
      <PaginaDaLoja key={pagina.vez} url={pagina.url} />
    </View>
  );
}
