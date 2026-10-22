/**
 * Modo TABLET DA MESA: o cardápio da mesa (firehubfood.com.br/tablet) em tela
 * cheia, sempre acesa, sem barra de status e sem o Voltar do Android — o
 * cliente não sai do cardápio. O pareamento com a mesa é pelo número de 6
 * dígitos que o dono gera no painel (lib/tablet-da-mesa no site).
 *
 * Para sair do modo (a equipe, não o cliente): 7 toques seguidos no canto de
 * cima à esquerda. Sair não despareia: a mesa continua guardada no tablet.
 * Para prender de vez, o Android tem "Fixar app" e o iPad, "Acesso Guiado".
 */
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useRef } from "react";
import { Alert, Pressable, View } from "react-native";

import { Painel } from "@/components/Painel";
import { gravarModo } from "@/lib/guardado";

export default function Mesa() {
  const router = useRouter();
  const toques = useRef<number[]>([]);

  useEffect(() => {
    void activateKeepAwakeAsync("mesa");
    return () => { void deactivateKeepAwake("mesa"); };
  }, []);

  function tocouNoCanto() {
    const agora = Date.now();
    toques.current = [...toques.current.filter((t) => agora - t < 4000), agora];
    if (toques.current.length < 7) return;
    toques.current = [];
    Alert.alert("Sair do modo tablet da mesa?", "O tablet continua pareado com a mesa.", [
      { text: "Cancelar", style: "cancel" },
      { text: "Sair", style: "destructive", onPress: async () => { await gravarModo(null); router.replace("/"); } },
    ]);
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#0B1220" }}>
      <StatusBar hidden />
      <Painel caminho="/tablet" modo="mesa" />
      <Pressable onPress={tocouNoCanto} style={{ position: "absolute", top: 0, left: 0, width: 56, height: 56 }} />
    </View>
  );
}
