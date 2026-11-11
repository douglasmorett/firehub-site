/**
 * O que o app guarda no aparelho. Tudo no SecureStore (Keychain no iPhone,
 * Keystore no Android): o token da sessão abre a lista de clientes da loja,
 * e não pode ficar em arquivo solto.
 */
import * as SecureStore from "expo-secure-store";

/** Até a 1.0.2 a sessão ficava aqui, legível só com o iPhone desbloqueado (ver LEGIVEL_NO_BOLSO). */
const CHAVE_SESSAO_ANTIGA = "firehub.sessao";
const CHAVE_SESSAO = "firehub.sessao.no-bolso";
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

/**
 * A tarefa do GPS (lib/gps.ts) lê a sessão com o iPhone BLOQUEADO, no bolso.
 * O padrão do SecureStore no iPhone é WHEN_UNLOCKED: bloqueado, a leitura dá
 * erro, `ler` devolve null e `enviarPosicao` saía calada — nenhuma posição até
 * ele desbloquear ("a localização para quando ele sai do app", Lucas/Frangoso,
 * motoboys todos de iPhone). AFTER_FIRST_UNLOCK fica legível depois do primeiro
 * desbloqueio desde que o celular ligou. O Android ignora esta opção.
 */
const LEGIVEL_NO_BOLSO: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK };

async function ler<T>(chave: string): Promise<T | null> {
  try {
    const bruto = await SecureStore.getItemAsync(chave);
    return bruto ? (JSON.parse(bruto) as T) : null;
  } catch {
    return null;
  }
}

async function gravar(chave: string, valor: unknown, opcoes?: SecureStore.SecureStoreOptions): Promise<void> {
  try {
    if (valor === null) await SecureStore.deleteItemAsync(chave);
    else await SecureStore.setItemAsync(chave, JSON.stringify(valor), opcoes);
  } catch {
    // Keychain indisponível (raro, aparelho bloqueado no boot): segue em memória.
  }
}

/**
 * A sessão gravada antes ficou WHEN_UNLOCKED, e o setItem só troca o VALOR de
 * um item que já existe, não a regra de acesso. Por isso a chave é outra: quem
 * já estava logado tem a sessão copiada na primeira leitura com o celular
 * desbloqueado (ao abrir o app) e não precisa entrar de novo. A antiga só sai
 * no próximo entrar/sair — apagá-la aqui deixaria uma leitura simultânea (tela
 * e GPS ao abrir) sem sessão nenhuma.
 */
export async function lerSessao(): Promise<Sessao | null> {
  const s = await ler<Sessao>(CHAVE_SESSAO);
  if (s) return s;
  const antiga = await ler<Sessao>(CHAVE_SESSAO_ANTIGA);
  if (antiga) await gravar(CHAVE_SESSAO, antiga, LEGIVEL_NO_BOLSO);
  return antiga;
}

export async function gravarSessao(s: Sessao | null): Promise<void> {
  await gravar(CHAVE_SESSAO, s, LEGIVEL_NO_BOLSO);
  await gravar(CHAVE_SESSAO_ANTIGA, null);
}

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
