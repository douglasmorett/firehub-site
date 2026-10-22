/**
 * Para onde o app aponta. Produção por padrão; para testar contra um servidor
 * local, rode com EXPO_PUBLIC_API_URL=http://192.168.0.10:3139 npx expo start.
 */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL || "https://firehubfood.com.br").replace(/\/+$/, "");

/** De quanto em quanto tempo o celular com a impressora pergunta se há comanda nova. */
export const PUXAR_COMANDAS_MS = 4_000;

/** Os três jeitos de usar o app. */
export type Modo = "loja" | "garcom" | "mesa";
