/**
 * O aviso de pedido novo com o app no bolso.
 *
 * O servidor manda pelo Expo (src/lib/app-motoboy/aparelhos.ts no site) para o
 * canal "pedidos", criado aqui com importância máxima: é o que faz o Android
 * tocar e mostrar o aviso por cima de outro app (o Maps aberto na moto).
 */
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { chamar } from "./api";

export const CANAL_DE_PEDIDOS = "pedidos";

// Com o app aberto o aviso também aparece: o entregador pode estar olhando
// outra coisa dentro do app.
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
    name: "Pedidos para entregar",
    description: "Pedido novo, pedido cancelado e pedido que saiu da sua lista.",
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 400, 200, 400],
    lightColor: "#2563EB",
    sound: "default",
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
}

export type ResultadoDoAviso = { ok: true; token: string } | { ok: false; mensagem: string };

/**
 * Pede a permissão, pega o token do aparelho e registra no FireHub.
 * Nunca lança: sem aviso, o app continua funcionando pela lista.
 */
export async function registrarAvisos(tokenDaSessao: string): Promise<ResultadoDoAviso> {
  try {
    if (!Device.isDevice) return { ok: false, mensagem: "Avisos só funcionam num celular de verdade." };
    // No Android 13+ o canal tem de existir ANTES do token.
    await criarCanal();

    let permissao = await Notifications.getPermissionsAsync();
    if (!permissao.granted) permissao = await Notifications.requestPermissionsAsync();
    if (!permissao.granted) {
      return { ok: false, mensagem: "Avisos desligados: você só vê pedido novo com o app aberto." };
    }

    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) return { ok: false, mensagem: "App sem projeto do Expo configurado." };
    const { data: pushToken } = await Notifications.getExpoPushTokenAsync({ projectId });

    await chamar("/api/app-motoboy/aparelho", {
      metodo: "POST",
      token: tokenDaSessao,
      corpo: {
        pushToken,
        plataforma: Platform.OS,
        versaoDoApp: Constants.expoConfig?.version ?? null,
      },
    });
    return { ok: true, token: pushToken };
  } catch (e: any) {
    return { ok: false, mensagem: `Não consegui ligar os avisos: ${e?.message || e}` };
  }
}

/** Sair do app: este celular para de receber os avisos deste entregador. */
export async function esquecerAvisos(tokenDaSessao: string): Promise<void> {
  try {
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId || !Device.isDevice) return;
    const permissao = await Notifications.getPermissionsAsync();
    if (!permissao.granted) return;
    const { data: pushToken } = await Notifications.getExpoPushTokenAsync({ projectId });
    await chamar("/api/app-motoboy/aparelho", { metodo: "DELETE", token: tokenDaSessao, corpo: { pushToken }, limite: 8_000 });
  } catch {
    // Sair nunca trava por causa disto.
  }
}
