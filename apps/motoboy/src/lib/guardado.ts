/**
 * O que o app guarda no aparelho. Tudo no SecureStore (Keychain no iPhone,
 * Keystore no Android): o token da sessão abre a lista de clientes da loja,
 * e não pode ficar em arquivo solto.
 */
import * as SecureStore from "expo-secure-store";

const CHAVE_SESSAO = "firehub.sessao";
const CHAVE_ULTIMA_LOJA = "firehub.ultima-loja";
const CHAVE_GPS_PAUSADO = "firehub.gps-pausado";

export type Sessao = {
  token: string;
  motoboyId: string;
  motoboyNome: string;
  lojaId: string;
  lojaNome: string;
  lojaSlug: string;
  /** Ainda na senha padrão: o app pede a troca logo depois de entrar. */
  trocarSenha?: boolean;
};

async function ler<T>(chave: string): Promise<T | null> {
  try {
    const bruto = await SecureStore.getItemAsync(chave);
    return bruto ? (JSON.parse(bruto) as T) : null;
  } catch {
    return null;
  }
}

async function gravar(chave: string, valor: unknown): Promise<void> {
  try {
    if (valor === null) await SecureStore.deleteItemAsync(chave);
    else await SecureStore.setItemAsync(chave, JSON.stringify(valor));
  } catch {
    // Keychain indisponível (raro, aparelho bloqueado no boot): segue em memória.
  }
}

export const lerSessao = () => ler<Sessao>(CHAVE_SESSAO);
export const gravarSessao = (s: Sessao | null) => gravar(CHAVE_SESSAO, s);

/** A loja do último login, para o entregador não digitar de novo. */
export const lerUltimaLoja = () => ler<string>(CHAVE_ULTIMA_LOJA);
export const gravarUltimaLoja = (loja: string) => gravar(CHAVE_ULTIMA_LOJA, loja);

/**
 * O entregador PAUSOU a localização (fim do turno, intervalo). Sem a pausa, o
 * GPS liga sozinho ao abrir o app — é o que a página web sempre fez, e é o
 * que a loja espera de quem está logado. Entrar de novo zera a pausa.
 */
export const lerGpsPausado = async () => (await ler<boolean>(CHAVE_GPS_PAUSADO)) === true;
export const gravarGpsPausado = (pausado: boolean) => gravar(CHAVE_GPS_PAUSADO, pausado ? true : null);
