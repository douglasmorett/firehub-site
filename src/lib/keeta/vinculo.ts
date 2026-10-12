/**
 * lib/keeta/vinculo.ts — ligar uma loja do FireHub a uma loja da Keeta.
 *
 * Um caminho só para o admin e para o lojista (tela de Integrações): grava o
 * vínculo e faz o onboarding na Keeta. Se a Keeta recusar o onboarding, o
 * vínculo é desfeito — vínculo pela metade é "Ativa dos dois lados e nenhum
 * pedido" (Pastel da Paulista no iFood, agosto/2026).
 *
 * E o "de quem é a conexão" do autoatendimento: um cookie assinado, com a loja
 * que clicou em "Conectar" e prazo de 30 min. A volta da Keeta só liga a loja
 * desse cookie, e só se ela for a mesma da sessão — link aberto no painel de
 * outra loja ia amarrar a autorização à loja errada (foi assim no 99Food).
 */
import { createHmac, timingSafeEqual } from "crypto";
import { onboardingDaLoja, lojasAutorizadas } from "./api";
import { gravarVinculo, desligarVinculo, type LojaKeeta } from "./lojas";

export function urlBaseDoFireHub(host?: string | null): string {
  return (process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || (host ? `https://${host}` : "https://firehubfood.com.br")).replace(/\/+$/, "");
}

export async function vincularLojaNaKeeta(params: {
  lojaId: string;
  keetaMerchantId: number;
  nome: string | null;
  quem: string;
  urlBase: string;
}): Promise<{ ok: boolean; motivo?: string; loja?: LojaKeeta; onboarding?: boolean }> {
  const v = await gravarVinculo(params.lojaId, params.keetaMerchantId, params.nome, params.quem);
  if (!v.ok) return { ok: false, motivo: v.motivo };
  if (v.novo) {
    const r = await onboardingDaLoja(v.loja!.merchantId, params.keetaMerchantId, `${params.urlBase}/api/keeta/webhook`);
    if (!r.ok) {
      await desligarVinculo({ franchiseeId: params.lojaId });
      return { ok: false, motivo: `A Keeta recusou o registro da loja: ${r.erro}` };
    }
  }
  return { ok: true, loja: v.loja, onboarding: !!v.novo };
}

export type LojaAutorizada = { id: number; nome: string; endereco: string };

/** As lojas que o lojista acabou de autorizar (a sessão `authId` da Keeta). */
export async function lojasDaAutorizacao(authId: string): Promise<{ ok: boolean; lojas: LojaAutorizada[]; erro?: string }> {
  const r = await lojasAutorizadas(authId);
  if (!r.ok) return { ok: false, lojas: [], erro: r.erro };
  const lista = Array.isArray(r.dados?.authorizedShops) ? r.dados.authorizedShops : [];
  return {
    ok: true,
    lojas: lista
      .filter((s: any) => Number.isSafeInteger(Number(s?.id)))
      .map((s: any) => ({ id: Number(s.id), nome: String(s.name || ""), endereco: String(s.address || "") })),
  };
}

// ── Cookie da conexão ────────────────────────────────────────────────────────

export const COOKIE_DA_CONEXAO = "keeta_conexao";
const PRAZO_MS = 30 * 60_000;

function segredoDoCookie(): string {
  return process.env.NEXTAUTH_SECRET || process.env.KEETA_CLIENT_SECRET || "";
}

export function assinarConexao(lojaId: string, agora = Date.now()): string {
  const corpo = `${lojaId}.${agora + PRAZO_MS}`;
  const sig = createHmac("sha256", segredoDoCookie()).update(corpo).digest("base64url");
  return `${Buffer.from(corpo).toString("base64url")}.${sig}`;
}

/** A loja do cookie, se ele for nosso e estiver no prazo. */
export function lojaDaConexao(valor: string | null | undefined, agora = Date.now()): string | null {
  if (!valor || !segredoDoCookie()) return null;
  const [corpoB64, sig] = String(valor).split(".");
  if (!corpoB64 || !sig) return null;
  const corpo = Buffer.from(corpoB64, "base64url").toString();
  const esperada = Buffer.from(createHmac("sha256", segredoDoCookie()).update(corpo).digest("base64url"));
  const recebida = Buffer.from(sig);
  if (esperada.length !== recebida.length || !timingSafeEqual(esperada, recebida)) return null;
  const ponto = corpo.lastIndexOf(".");
  const lojaId = corpo.slice(0, ponto);
  const vence = Number(corpo.slice(ponto + 1));
  if (!lojaId || !Number.isFinite(vence) || vence < agora) return null;
  return lojaId;
}
