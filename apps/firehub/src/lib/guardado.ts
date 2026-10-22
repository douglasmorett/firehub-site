/**
 * O que o app guarda no aparelho. Tudo no SecureStore (Keychain no iPhone,
 * Keystore no Android): o token do app recebe os pedidos da loja.
 */
import * as SecureStore from "expo-secure-store";

import type { Modo } from "./config";

export type SessaoDaLoja = { token: string; lojaId: string; nomeDaLoja: string; slug: string | null };
export type Impressora = { endereco: string; nome: string; largura: "58mm" | "80mm"; ligada: boolean };

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
    // Keychain indisponível (raro): segue em memória até a próxima abertura.
  }
}

export const lerModo = () => ler<Modo>("firehub.modo");
export const gravarModo = (m: Modo | null) => gravar("firehub.modo", m);

export const lerSessaoDaLoja = () => ler<SessaoDaLoja>("firehub.sessao-da-loja");
export const gravarSessaoDaLoja = (s: SessaoDaLoja | null) => gravar("firehub.sessao-da-loja", s);

export const lerImpressora = () => ler<Impressora>("firehub.impressora");
export const gravarImpressora = (i: Impressora | null) => gravar("firehub.impressora", i);

/** A loja do garçom (o slug do link /garcom/<slug>). */
export const lerLojaDoGarcom = () => ler<string>("firehub.loja-do-garcom");
export const gravarLojaDoGarcom = (slug: string | null) => gravar("firehub.loja-do-garcom", slug);

/** Um id deste aparelho, para a fila de impressão contar cada celular à parte. */
export async function idDoAparelho(): Promise<string> {
  const atual = await ler<string>("firehub.aparelho");
  if (atual) return atual;
  const novo = Array.from({ length: 16 }, () => Math.floor(Math.random() * 36).toString(36)).join("");
  await gravar("firehub.aparelho", novo);
  return novo;
}
