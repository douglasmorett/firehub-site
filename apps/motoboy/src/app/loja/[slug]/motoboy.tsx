/**
 * O link do QR (https://firehubfood.com.br/loja/<slug>/motoboy?p=<comanda>)
 * cai AQUI quando o celular abre o app em vez do navegador — câmera do celular
 * apontada para a comanda ou para o QR do painel (Universal Links / App Links:
 * app.json + src/app/.well-known no site).
 *
 * - Já logado: vai para Entregas com a comanda pronta para puxar.
 * - Sem login: vai para Entrar com a loja preenchida; depois de entrar, puxa.
 */
import { Redirect, useLocalSearchParams } from "expo-router";
import { ActivityIndicator, View } from "react-native";

import { cor } from "@/components/tema";
import { lerComanda } from "@/lib/loja";
import { useSessao } from "@/lib/sessao";

export default function LinkDaLoja() {
  const { slug, p } = useLocalSearchParams<{ slug?: string; p?: string }>();
  const { sessao, carregando } = useSessao();
  if (carregando) {
    return (
      <View style={{ flex: 1, backgroundColor: cor.topo, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color="#FFFFFF" size="large" />
      </View>
    );
  }
  const loja = String(slug || "").toLowerCase();
  const puxar = lerComanda(String(p || ""));
  // Logado em OUTRA loja: a comanda não é dele — entra de novo pela loja do QR.
  if (sessao && (!loja || sessao.lojaSlug === loja)) {
    return <Redirect href={{ pathname: "/entregas", params: puxar ? { puxar } : {} }} />;
  }
  return <Redirect href={{ pathname: "/entrar", params: { ...(loja ? { loja } : {}), ...(puxar ? { puxar } : {}) } }} />;
}
