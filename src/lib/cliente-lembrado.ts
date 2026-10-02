/**
 * O CLIENTE LEMBRADO NESTE APARELHO: nome, WhatsApp e o endereço de entrega.
 *
 * O Flavio (Showrrascão, 02/10/2026) pediu de novo e teve de digitar nome,
 * telefone e endereço outra vez — o cardápio só lembrava o CPF. Fica no
 * navegador do cliente, nunca no servidor: puxar nome e endereço pelo número
 * digitado mostraria a casa de qualquer pessoa a quem soubesse o celular dela.
 *
 * - Nome e WhatsApp valem para todas as lojas (é a mesma pessoa).
 * - O endereço é POR LOJA: o bairro da loja por bairros é um nome da lista
 *   dela, e o ponto confirmado no mapa (GPS ou pino) foi validado para a área
 *   daquela loja.
 * - Só se grava depois do pedido aceito pelo servidor, para não guardar
 *   endereço digitado errado; "Não é você? Limpar" apaga (aparelho dividido).
 */
import type { PontoDoCliente } from "@/lib/entrega-no-checkout";

const CHAVE = "fh_cliente_lembrado";

export type EnderecoLembrado = {
  rua: string;
  numero: string;
  bairro: string;
  complemento: string;
  cep: string;
  /** O ponto que o próprio cliente deu, para o mesmo rua/número/bairro. */
  ponto: PontoDoCliente | null;
};

export type ClienteLembrado = {
  nome: string;
  telefone: string;
  /** O endereço desta loja, se ele já recebeu entrega dela. */
  endereco: EnderecoLembrado | null;
};

type Guardado = {
  nome?: string;
  telefone?: string;
  enderecos?: Record<string, EnderecoLembrado & { at?: number }>;
  at?: number;
};

const texto = (v: unknown, max = 160) => String(v ?? "").trim().slice(0, max);

function lerTudo(): Guardado | null {
  try {
    const g = JSON.parse(localStorage.getItem(CHAVE) || "null");
    return g && typeof g === "object" ? g : null;
  } catch {
    return null;
  }
}

function pontoValido(p: any): PontoDoCliente | null {
  if (!p || (p.origem !== "gps" && p.origem !== "pino")) return null;
  const lat = Number(p.lat);
  const lng = Number(p.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng, origem: p.origem };
}

export function lerClienteLembrado(loja: string): ClienteLembrado | null {
  const g = lerTudo();
  if (!g) return null;
  const nome = texto(g.nome, 80);
  const telefone = texto(g.telefone, 20);
  if (!nome || telefone.replace(/\D/g, "").length < 10) return null;
  const e = g.enderecos?.[loja];
  const endereco: EnderecoLembrado | null = e && texto(e.rua)
    ? {
        rua: texto(e.rua),
        numero: texto(e.numero, 20),
        bairro: texto(e.bairro, 80),
        complemento: texto(e.complemento),
        cep: texto(e.cep, 10),
        ponto: pontoValido(e.ponto),
      }
    : null;
  return { nome, telefone, endereco };
}

/** Grava depois do pedido aceito. Sem `endereco` (retirada), mantém o que já havia. */
export function lembrarCliente(loja: string, c: { nome: string; telefone: string; endereco?: EnderecoLembrado | null }) {
  try {
    const nome = texto(c.nome, 80);
    const telefone = texto(c.telefone, 20);
    if (!nome || telefone.replace(/\D/g, "").length < 10) return;
    const g = lerTudo() || {};
    const enderecos = { ...(g.enderecos || {}) };
    if (c.endereco && texto(c.endereco.rua)) {
      enderecos[loja] = { ...c.endereco, ponto: pontoValido(c.endereco.ponto), at: Date.now() };
    }
    localStorage.setItem(CHAVE, JSON.stringify({ nome, telefone, enderecos, at: Date.now() }));
  } catch {
    /* sem storage (aba anônima, cota cheia): o cliente só digita de novo */
  }
}

export function esquecerCliente() {
  try {
    localStorage.removeItem(CHAVE);
  } catch {}
}
