import { Ionicons } from "@expo/vector-icons";
import { Redirect } from "expo-router";
import { Tabs } from "expo-router/js-tabs";

import { cor } from "@/components/tema";
import { useSessao } from "@/lib/sessao";

export default function AbasDoEntregador() {
  const { sessao, carregando } = useSessao();
  if (!carregando && !sessao) return <Redirect href="/entrar" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: cor.azul,
        tabBarInactiveTintColor: cor.textoApagado,
        tabBarLabelStyle: { fontSize: 12, fontWeight: "800" },
        tabBarStyle: { minHeight: 60 },
      }}
    >
      <Tabs.Screen
        name="entregas"
        options={{ title: "Entregas", tabBarIcon: ({ color, size }) => <Ionicons name="bicycle" color={color} size={size + 2} /> }}
      />
      <Tabs.Screen
        name="relatorio"
        options={{ title: "Relatório", tabBarIcon: ({ color, size }) => <Ionicons name="stats-chart" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="conta"
        options={{ title: "Conta", tabBarIcon: ({ color, size }) => <Ionicons name="person-circle" color={color} size={size + 2} /> }}
      />
    </Tabs>
  );
}
