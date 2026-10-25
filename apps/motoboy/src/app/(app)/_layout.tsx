import { Ionicons } from "@expo/vector-icons";
import { Redirect } from "expo-router";
import { Tabs } from "expo-router/js-tabs";
import { useEffect, useState } from "react";
import { AppState } from "react-native";

import { cor } from "@/components/tema";
import { chamar } from "@/lib/api";
import { useSessao } from "@/lib/sessao";

export default function AbasDoEntregador() {
  const { sessao, carregando } = useSessao();
  // A aba Ranking só aparece se a loja ligou (padrão desligado). Pergunta ao
  // abrir e ao voltar para a frente; sem resposta, fica escondida.
  const [rankingAtivo, setRankingAtivo] = useState(false);
  useEffect(() => {
    if (!sessao) return;
    const perguntar = () =>
      chamar<{ ativo: boolean }>("/api/motoboys/ranking?so=ativo", { token: sessao.token })
        .then((r) => setRankingAtivo(Boolean(r?.ativo)))
        .catch(() => {});
    perguntar();
    const ouvinte = AppState.addEventListener("change", (estado) => { if (estado === "active") perguntar(); });
    return () => ouvinte.remove();
  }, [sessao]);

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
        name="ranking"
        options={{
          title: "Ranking",
          href: rankingAtivo ? undefined : null,
          tabBarIcon: ({ color, size }) => <Ionicons name="trophy" color={color} size={size} />,
        }}
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
