/**
 * A chave do Google DA LOJA no servidor: ler (cifrada no banco, lib/cofre.ts),
 * lembrar por alguns minutos e contar as buscas do mês. O porquê está em
 * lib/google-maps-da-loja.ts.
 *
 * A chave nunca vai para o log nem volta para o navegador.
 */
import { prisma } from "@/lib/prisma";
import { decifrar } from "@/lib/cofre";
import { escolherChaveDoGoogle, mesDoUso, type OrigemDaChave } from "@/lib/google-maps-da-loja";
import { chaveDoGoogle } from "@/lib/geocodificacao-google";

/**
 * Qual chave do Google uma busca usa — a escolha mora SÓ aqui
 * (`chaveGoogleDaLoja`):
 *   - "LOJA": a loja conectou a própria conta. Google PRIMEIRO em tudo, a cota
 *     é dela, o uso conta no "buscas no mês" da tela;
 *   - "PLATAFORMA": a chave do FireHub no ambiente (GOOGLE_MAPS_API_KEY, que
 *     já existia), SÓ para as lojas HAKIM (as do dono: `isFranqueadoHakim`, a
 *     conta contatohakim@gmail.com e o grupo dela — Douglas, 01/11/2026) e só
 *     de RESERVA, quando o mapa aberto não achou o endereço, com o teto do dia
 *     e a contagem dela (lib/geocodificacao-servidor.ts, /api/health). Sem a
 *     env: desligada. As outras lojas: só a chave delas, ou nada (o de hoje).
 */
export type ChaveDoGoogle = { chave: string; origem: OrigemDaChave; lojaId: string | null };

const VALIDADE_MS = 5 * 60 * 1000;
const lembradas = new Map<string, { chave: string | null; hakim: boolean; ate: number }>();

/** A conta do dono: as lojas dela (e do grupo dela) são as "Hakim". */
const CONTA_HAKIM = "contatohakim@gmail.com";

/** A chave da loja (ou null: sem conexão, ou não abre) e se ela é Hakim, do banco. */
async function lerDoBanco(lojaId: string): Promise<{ chave: string | null; hakim: boolean }> {
  let chave: string | null = null;
  let hakim = false;
  try {
    const u = await prisma.user.findUnique({
      where: { id: lojaId },
      select: { googleMapsChaveCifrada: true, isFranqueadoHakim: true, email: true, accountGroupId: true },
    });
    chave = decifrar(u?.googleMapsChaveCifrada) || null;
    hakim = !!u?.isFranqueadoHakim || String(u?.email || "").toLowerCase() === CONTA_HAKIM;
    if (!hakim && u?.accountGroupId) {
      const principal = await prisma.user.findUnique({ where: { id: u.accountGroupId }, select: { email: true, isFranqueadoHakim: true } });
      hakim = !!principal?.isFranqueadoHakim || String(principal?.email || "").toLowerCase() === CONTA_HAKIM;
    }
  } catch (e: any) {
    // Coluna ainda não criada ou banco fora: a loja segue no mapa aberto.
    console.warn(`[Google da loja] leitura falhou: ${e?.message}`);
  }
  return { chave, hakim };
}

/** Onde se lê a loja. Trocável de propósito: o teste põe um de memória no lugar do banco. */
export const leituraDaLoja = { ler: lerDoBanco };

/** O mesmo, lembrado por 5 min (cada cotação pergunta). */
async function lerDaLoja(lojaId: string): Promise<{ chave: string | null; hakim: boolean }> {
  const l = lembradas.get(lojaId);
  if (l && l.ate > Date.now()) return l;
  const lido = await leituraDaLoja.ler(lojaId);
  if (lembradas.size > 2000) lembradas.delete(lembradas.keys().next().value as string);
  lembradas.set(lojaId, { ...lido, ate: Date.now() + VALIDADE_MS });
  return lido;
}

/** Só a chave PRÓPRIA da loja (o fundo do mapa do painel), ou null. */
export async function chaveDoGoogleDaLoja(lojaId: string | null | undefined): Promise<string | null> {
  if (!lojaId) return null;
  return (await lerDaLoja(lojaId)).chave;
}

/**
 * A chave que a loja usa — a ÚNICA escolha: a dela; sem ela, se a loja for
 * Hakim e houver a env, a do FireHub; senão null (o mapa aberto de sempre).
 */
export async function chaveGoogleDaLoja(lojaId: string | null | undefined): Promise<ChaveDoGoogle | null> {
  if (!lojaId) return null;
  const { chave, hakim } = await lerDaLoja(lojaId);
  const escolhida = escolherChaveDoGoogle({ chaveDaLoja: chave, hakim, chaveDoAmbiente: chaveDoGoogle() });
  return escolhida ? { ...escolhida, lojaId } : null;
}

/** Depois de conectar ou desconectar: a próxima busca relê do banco. Sem id: esquece todas (teste). */
export function esquecerChaveDaLoja(lojaId?: string) {
  if (lojaId) lembradas.delete(lojaId);
  else lembradas.clear();
}

/** Mais uma busca no mês (só as que foram ao Google; cache não conta). Nunca lança. */
export function contarBuscaNoGoogle(lojaId: string): void {
  const mes = mesDoUso();
  prisma
    .$executeRawUnsafe(
      `UPDATE "User" SET "googleMapsUso" = jsonb_set(COALESCE("googleMapsUso", '{}'::jsonb), ARRAY[$2::text], to_jsonb(COALESCE(("googleMapsUso"->>$2)::int, 0) + 1)) WHERE "id" = $1`,
      lojaId,
      mes,
    )
    .catch((e: any) => console.warn(`[Google da loja] contador falhou: ${e?.message}`));
}
