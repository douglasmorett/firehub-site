import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";

import { cor } from "@/components/tema";
import { useSessao } from "@/lib/sessao";

export default function Inicio() {
  const { sessao, carregando } = useSessao();
  if (carregando) {
    return (
      <View style={{ flex: 1, backgroundColor: cor.topo, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color="#FFFFFF" size="large" />
      </View>
    );
  }
  return <Redirect href={sessao ? "/entregas" : "/entrar"} />;
}
