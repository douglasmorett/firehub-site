import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";

import { marca } from "@/lib/marca";

export default function Abas() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: marca.cor,
        tabBarInactiveTintColor: "#8A8A8A",
        tabBarLabelStyle: { fontSize: 12, fontWeight: "600" },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: "Cardápio", tabBarIcon: ({ color, size }) => <Ionicons name="restaurant" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="pedidos"
        options={{ title: "Pedidos", tabBarIcon: ({ color, size }) => <Ionicons name="receipt" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="contato"
        options={{ title: "Loja", tabBarIcon: ({ color, size }) => <Ionicons name="storefront" color={color} size={size} /> }}
      />
    </Tabs>
  );
}
