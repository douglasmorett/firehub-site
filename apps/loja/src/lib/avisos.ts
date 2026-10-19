/**
 * "Seu pedido saiu para entrega" com o app fechado.
 *
 * O servidor manda pelo Expo (src/lib/app-da-loja/aparelhos.ts no site) para
 * os aparelhos ligados ao pedido. O app liga este celular a cada pedido feito
 * nele (registrarNoPedido). A permissão é pedida logo depois do termo da
 * primeira abertura (components/TermoDeUso.tsx) e, para quem negou, de novo na
 * hora do pedido enquanto o sistema deixar perguntar.
 */
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { idDaInstalacao } from "./instalacao";
import { marca, urlDoSite } from "./marca";

export const CANAL_DE_PEDIDOS = "pedidos";
/** As promoções que a loja manda pelo painel (Meu aplicativo). Canal à parte: o cliente pode calar só este no Android. */
export const CANAL_DE_PROMOCOES = "promocoes";

// Com o app aberto o aviso também aparece: o cliente pode estar no cardápio.
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
    name: "Andamento do pedido",
    description: "Pedido aceito, saiu para entrega, pronto para retirar, entregue.",
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 300, 150, 300],
    lightColor: marca.cor,
    sound: "default",
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
  await Notifications.setNotificationChannelAsync(CANAL_DE_PROMOCOES, {
    name: "Promoções e novidades",
    description: `Ofertas e novidades da ${marca.nome}. Dá para desligar só estas na aba Loja do app.`,
    importance: Notifications.AndroidImportance.DEFAULT,
    lightColor: marca.cor,
    sound: "default",
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
}

/** Cria os canais do Android logo na abertura: a promoção pode chegar antes do primeiro pedido. */
export async function prepararCanais(): Promise<void> {
  try {
    await criarCanal();
  } catch {
    /* sem canal, o Android usa o padrão */
  }
}

function projetoDoExpo(): string | null {
  return (Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId) || null;
}

/** Pede a permissão (se ainda não foi dada) e devolve o token deste aparelho. Nunca lança. */
export async function tokenDoAparelho(pedirPermissao: boolean): Promise<string | null> {
  try {
    if (!Device.isDevice) return null;
    await criarCanal(); // Android 13+: o canal antes do token.
    let permissao = await Notifications.getPermissionsAsync();
    if (!permissao.granted && pedirPermissao && permissao.canAskAgain) {
      permissao = await Notifications.requestPermissionsAsync();
    }
    if (!permissao.granted) return null;
    const projectId = projetoDoExpo();
    if (!projectId) return null;
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    return data;
  } catch {
    return null;
  }
}

/**
 * Liga este celular ao pedido: o servidor passa a avisar o andamento dele
 * aqui. Sem permissão de aviso o pedido ainda é contado como "pedido do app"
 * no painel da loja (vai só o id da instalação).
 */
export async function registrarNoPedido(pedidoId: string): Promise<boolean> {
  const [pushToken, instalacaoId] = await Promise.all([tokenDoAparelho(true), idDaInstalacao()]);
  try {
    const res = await fetch(urlDoSite("/api/app-da-loja/aparelho"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pushToken,
        instalacaoId,
        pedidoId,
        plataforma: Platform.OS,
        versaoDoApp: Constants.expoConfig?.version ?? null,
        app: marca.bundleId,
      }),
    });
    return res.ok && Boolean(pushToken);
  } catch {
    return false;
  }
}

export type EstadoDosAvisos = "ligados" | "desligados" | "nao-perguntado" | "indisponivel";

export async function estadoDosAvisos(): Promise<EstadoDosAvisos> {
  try {
    if (!Device.isDevice) return "indisponivel";
    const p = await Notifications.getPermissionsAsync();
    if (p.granted) return "ligados";
    return p.canAskAgain ? "nao-perguntado" : "desligados";
  } catch {
    return "indisponivel";
  }
}
