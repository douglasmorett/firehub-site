/**
 * A marca deste app (marcas/<marca>/marca.json), lida da configuração do Expo.
 * O app inteiro fala com a loja só por aqui: trocar de loja é trocar de marca.
 */
import Constants from "expo-constants";

export type Marca = {
  id: string;
  nome: string;
  nomeNaLoja: string;
  bundleId: string;
  esquema: string;
  /** Raiz do FireHub (https://firehubfood.com.br). */
  site: string;
  /** O que abre na aba Cardápio: /lojas/<slug> (escolhe a unidade pelo bairro) ou /loja/<slug>. */
  paginaInicial: string;
  /** Logo da loja (URL), para a aba Loja. */
  logo?: string;
  /** Hosts que abrem DENTRO do app. Qualquer outro vai para o navegador ou para o app certo. */
  dominiosDaLoja: string[];
  cor: string;
  corDoTexto: string;
  contato: { whatsapp?: string; telefone?: string; instagram?: string; endereco?: string };
  privacidade: string;
};

export const marca: Marca = Constants.expoConfig?.extra?.marca as Marca;

export const urlDoSite = (caminho: string) => `${marca.site.replace(/\/$/, "")}${caminho.startsWith("/") ? caminho : `/${caminho}`}`;
