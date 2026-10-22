/**
 * O aviso de pedido novo com o celular bloqueado.
 *
 * O servidor manda pelo Expo (src/lib/app-firehub/aparelhos.ts no site) para o
 * canal "pedido-novo", criado aqui com importância máxima e a campainha do
 * FireHub (assets/sons/pedido.wav): é o que faz o Android tocar alto e mostrar
 * o aviso por cima da tela bloqueada. Pedido da Holy Top (19/10/2026): o som
 * só tocava com a tela de Pedidos aberta no navegador.
 */
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { chamar } from "./api";

export const CANAL_DE_PEDIDOS = "pedido-novo";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

async function criarCanal(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(CANAL_DE_PEDIDOS, {
    name: "Pedido novo",
    description: "Pedido novo, mesa chamando o garçom e mesa pedindo a conta.",
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 500, 250, 500, 250, 500],
    lightColor: "#FF4D00",
    sound: "pedido.wav",
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    bypassDnd: true,
  });
}

async function tokenDoAparelho(): Promise<string | null> {
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId || !Device.isDevice) return null;
  const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
  return data;
}

export type ResultadoDoAviso = { ok: true } | { ok: false; mensagem: string };

/** Pede a permissão e registra este celular na loja. Nunca lança. */
export async function registrarAvisos(tokenDoApp: string): Promise<ResultadoDoAviso> {
  try {
    if (!Device.isDevice) return { ok: false, mensagem: "Avisos só funcionam num celular de verdade." };
    await criarCanal();
    let permissao = await Notifications.getPermissionsAsync();
    if (!permissao.granted) permissao = await Notifications.requestPermissionsAsync();
    if (!permissao.granted) return { ok: false, mensagem: "Avisos desligados: libere as notificações do FireHub nos ajustes do celular." };
    const pushToken = await tokenDoAparelho();
    if (!pushToken) return { ok: false, mensagem: "App sem projeto do Expo configurado." };
    await chamar("/api/app-firehub/aparelho", {
      metodo: "POST",
      token: tokenDoApp,
      corpo: { pushToken, plataforma: Platform.OS, versaoDoApp: Constants.expoConfig?.version ?? null },
    });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, mensagem: `Não consegui ligar os avisos: ${e?.message || e}` };
  }
}

/** Sair do app: este celular para de receber os avisos da loja. */
export async function esquecerAvisos(): Promise<void> {
  try {
    const permissao = await Notifications.getPermissionsAsync();
    if (!permissao.granted) return;
    const pushToken = await tokenDoAparelho();
    if (pushToken) await chamar("/api/app-firehub/aparelho", { metodo: "DELETE", corpo: { pushToken }, limite: 8_000 });
  } catch {
    // Sair nunca trava por causa disto.
  }
}
