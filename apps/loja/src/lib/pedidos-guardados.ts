/**
 * Os pedidos feitos por ESTE celular, para a aba Pedidos.
 *
 * O cliente da loja não tem login de verdade no site, e o app não pede um: o
 * que identifica o pedido é o id, que é segredo de quem pediu (é ele que abre
 * a página de acompanhamento). Guardamos só os ids e a hora, no SecureStore.
 */
import * as SecureStore from "expo-secure-store";

const CHAVE = "loja.pedidos";
/** O SecureStore do iPhone reclama de valor grande; 25 pedidos cabem com folga. */
const MAXIMO = 25;

export type PedidoGuardado = { id: string; slug: string; em: number };

export async function lerPedidos(): Promise<PedidoGuardado[]> {
  try {
    const bruto = await SecureStore.getItemAsync(CHAVE);
    const lista = bruto ? (JSON.parse(bruto) as PedidoGuardado[]) : [];
    return Array.isArray(lista) ? lista : [];
  } catch {
    return [];
  }
}

/** Devolve true se o pedido é novo (o mesmo pedido chega de duas telas do site). */
export async function guardarPedido(p: { id: string; slug: string }): Promise<boolean> {
  const atual = await lerPedidos();
  if (atual.some((x) => x.id === p.id)) return false;
  const nova = [{ id: p.id, slug: p.slug, em: Date.now() }, ...atual].slice(0, MAXIMO);
  try {
    await SecureStore.setItemAsync(CHAVE, JSON.stringify(nova));
  } catch {
    // Sem onde guardar, o pedido só não aparece na aba; o aviso ainda sai.
  }
  return true;
}

export async function esquecerPedido(id: string): Promise<void> {
  const nova = (await lerPedidos()).filter((x) => x.id !== id);
  try {
    await SecureStore.setItemAsync(CHAVE, JSON.stringify(nova));
  } catch {
    /* idem */
  }
}
