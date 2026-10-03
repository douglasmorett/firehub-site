/**
 * Para onde o app aponta. Produção por padrão; para testar contra um servidor
 * local, rode com EXPO_PUBLIC_API_URL=http://192.168.0.10:3001 npx expo start.
 */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL || "https://firehubfood.com.br").replace(/\/+$/, "");

/** De quanto em quanto tempo a lista se atualiza com o app aberto na frente. */
export const ATUALIZAR_LISTA_MS = 10_000;

/** Menor intervalo entre duas posições enviadas à loja (o mapa dela atualiza a cada 10 s). */
export const INTERVALO_DO_GPS_MS = 12_000;

/** Nome da tarefa de localização com a tela apagada (expo-task-manager). */
export const TAREFA_DO_GPS = "firehub-gps-do-entregador";
