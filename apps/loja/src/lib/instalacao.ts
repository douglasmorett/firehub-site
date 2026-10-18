/**
 * O id desta instalação do app: sorteado na primeira abertura e guardado no
 * SecureStore. Não é o telefone nem o id do aparelho, e some quando o app é
 * desinstalado. Serve para o painel da loja contar aparelhos sem repetir e
 * para ligar o pedido feito aqui ao app (apps/loja/src/lib/presenca.ts).
 */
import * as SecureStore from "expo-secure-store";

const CHAVE_DA_INSTALACAO = "loja.instalacao";

let promessa: Promise<string> | null = null;

function sortearId(): string {
  const letras = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  for (let i = 0; i < 32; i++) id += letras[Math.floor(Math.random() * letras.length)];
  return id;
}

/** O id desta instalação (sorteado uma vez). Duas chamadas juntas na abertura recebem o mesmo. */
export function idDaInstalacao(): Promise<string> {
  if (!promessa) promessa = lerOuSortear();
  return promessa;
}

async function lerOuSortear(): Promise<string> {
  try {
    const guardado = await SecureStore.getItemAsync(CHAVE_DA_INSTALACAO);
    if (guardado && /^[A-Za-z0-9_-]{16,64}$/.test(guardado)) return guardado;
  } catch {
    /* sem SecureStore: usa um id só desta sessão */
  }
  const novo = sortearId();
  try {
    await SecureStore.setItemAsync(CHAVE_DA_INSTALACAO, novo);
  } catch {
    /* idem */
  }
  return novo;
}
