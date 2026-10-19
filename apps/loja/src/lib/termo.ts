/**
 * O TERMO DE USO do app da loja — aceito na primeira abertura, antes do
 * cardápio (Douglas, 18/10/2026: "tem que aceitar o termo para acessar o app").
 *
 * - O termo é obrigatório para usar o app; a NOTIFICAÇÃO não é. Apple 4.5.4:
 *   "Push Notifications must not be required for the app to function" — quem
 *   aceita o termo e nega a permissão no celular usa o app normalmente.
 * - O termo diz, em destaque, que as notificações do app incluem PROMOÇÕES e
 *   que dá para desligá-las nos ajustes do celular. Logo depois do "Aceito" o
 *   app abre o pedido de permissão do sistema: o texto do termo + o toque em
 *   "Permitir" são o aceite explícito de promoção que a 4.5.4 pede (consent
 *   language no app); a opção de sair é a linha "Notificações" da aba Loja,
 *   que abre os ajustes do celular. Não há chave para tirar só a promoção
 *   (Douglas, 18/10/2026). Ver também /privacidade-app no site.
 * - Mudou o texto de um jeito que importa → suba VERSAO_DO_TERMO: o app pede o
 *   aceite de novo na próxima abertura. A versão aceita vai ao servidor junto
 *   com a abertura (AppDaLojaAparelho.termoVersao).
 */
import * as SecureStore from "expo-secure-store";

import { marca } from "./marca";

export const VERSAO_DO_TERMO = "2026-10-18";

const CHAVE = "loja.termo";

export type TrechoDoTermo = { titulo: string; texto: string; destaque?: boolean };

/** O texto do termo, com o nome da loja. Curto de propósito: é para ser lido. */
export function textoDoTermo(loja = marca.nome): TrechoDoTermo[] {
  return [
    {
      titulo: "O app",
      texto: `Este é o aplicativo de pedidos da ${loja}. Por ele você vê o cardápio, faz pedidos para entrega ou retirada, paga e acompanha o andamento.`,
    },
    {
      titulo: "Notificações: pedido e promoções",
      destaque: true,
      texto:
        `O app envia notificações com o andamento do seu pedido e também com promoções e novidades da ${loja}. ` +
        `Para recebê-las, toque em “Permitir” quando o celular perguntar. ` +
        `Você pode desligar as notificações a qualquer momento nos ajustes do celular. O app funciona normalmente sem notificações.`,
    },
    {
      titulo: "Seus dados",
      texto: "Nome, telefone e endereço são usados só para o pedido e para falar com você sobre ele. Os detalhes estão na Política de Privacidade.",
    },
    {
      titulo: "Pedidos",
      texto: `Cardápio, preços, entrega, troca e atendimento são da ${loja}. O app funciona com o sistema FireHub.`,
    },
  ];
}

/** A versão do termo que este celular aceitou (null = nenhuma). */
export async function termoAceito(): Promise<string | null> {
  try {
    return (await SecureStore.getItemAsync(CHAVE)) || null;
  } catch {
    return null;
  }
}

export async function aceitouOTermoAtual(): Promise<boolean> {
  return (await termoAceito()) === VERSAO_DO_TERMO;
}

export async function guardarAceite(): Promise<void> {
  try {
    await SecureStore.setItemAsync(CHAVE, VERSAO_DO_TERMO);
  } catch {
    /* sem onde guardar: o termo aparece de novo na próxima abertura */
  }
}
