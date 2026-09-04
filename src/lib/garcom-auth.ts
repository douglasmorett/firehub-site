/**
 * /src/lib/garcom-auth.ts
 *
 * Sessão própria do garçom.
 *
 * O garçom entra pelo link `/garcom/<slug-da-loja>` com o login e a senha que
 * o gerente cadastrou na aba Garçons, e só enxerga o módulo de mesa. Ele NÃO
 * é um User do painel, de propósito:
 *
 *   - User exige e-mail único no sistema inteiro, e garçom não tem e-mail
 *     corporativo — o cadastro viraria "joao.mesa.hakim@..." inventado;
 *   - a sessão do NextAuth abre o /store inteiro (layout, menu, todas as
 *     rotas de API que só conferem "está logado"). Restringir por permissão
 *     seria uma lista negra que alguém esquece de atualizar na próxima tela.
 *
 * Então a sessão do garçom é OUTRO cookie, com OUTRO salt, que nenhuma rota
 * conhece a não ser as poucas do módulo de mesa que chamam
 * `resolverOperadorDaMesa()`. Rota nova nasce fechada para o garçom sem
 * ninguém precisar lembrar de nada.
 *
 * O token é um JWE do next-auth (mesma biblioteca do painel) com salt
 * próprio: o cookie de sessão do lojista não decodifica como garçom, e o do
 * garçom não decodifica como sessão do painel. O token só carrega QUEM é o
 * garçom; se ele ainda pode entrar (ativo, senha não trocada, loja certa) é
 * decidido no banco a cada requisição — desativar na aba Garçons derruba o
 * celular dele na hora.
 */
import { cookies } from "next/headers";
import { encode, decode } from "next-auth/jwt";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth";
import { prisma } from "./prisma";

/** Nome do cookie. O prefixo __Secure- exige HTTPS, que é o caso em produção. */
export const COOKIE_DO_GARCOM =
  process.env.NODE_ENV === "production" ? "__Secure-firehub_garcom" : "firehub_garcom";

/** Muda o salt e TODO garçom precisa entrar de novo. Não mexer sem motivo. */
const SALT_DO_GARCOM = "firehub-garcom-v1";

/** Turno de garçom não tem hora para acabar; 30 dias evita login todo dia. */
export const DURACAO_DA_SESSAO_S = 30 * 24 * 60 * 60;

function segredo(): string {
  const s = process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error("NEXTAUTH_SECRET não definido");
  return s;
}

export type GarcomAutenticado = {
  id: string;
  name: string;
  login: string;
  franchiseeId: string;
};

export type ResultadoDoGarcom =
  | { ok: true; garcom: GarcomAutenticado }
  | { ok: false; status: number; erro: string; codigo: string };

/** Emite o token que vai no cookie. Só identidade; nada de nome ou permissão. */
export async function emitirTokenDoGarcom(garcom: { id: string; franchiseeId: string }): Promise<string> {
  return encode({
    token: { tipo: "garcom", gid: garcom.id, lid: garcom.franchiseeId },
    secret: segredo(),
    salt: SALT_DO_GARCOM,
    maxAge: DURACAO_DA_SESSAO_S,
  });
}

/** Opções do cookie, iguais no login (gravar) e no logout (apagar). */
export function opcoesDoCookieDoGarcom(maxAge: number = DURACAO_DA_SESSAO_S) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  };
}

type TokenDoGarcom = { gid: string; lid: string; iat: number };

/** Lê e decodifica o cookie. Token de outro tipo, vencido ou adulterado = nulo. */
async function lerTokenDoGarcom(): Promise<TokenDoGarcom | null> {
  let valor: string | undefined;
  try {
    valor = (await cookies()).get(COOKIE_DO_GARCOM)?.value;
  } catch {
    return null;
  }
  if (!valor) return null;
  try {
    const t = await decode({ token: valor, secret: segredo(), salt: SALT_DO_GARCOM });
    if (!t || t.tipo !== "garcom" || typeof t.gid !== "string" || typeof t.lid !== "string") return null;
    return { gid: t.gid, lid: t.lid, iat: Number(t.iat) || 0 };
  } catch {
    return null;
  }
}

/**
 * Confere o cookie E o banco. É esta função que toda página e rota do garçom
 * chama; as mensagens são distintas de propósito para o garçom saber o que
 * fazer (e o gerente saber o que aconteceu) em vez de um "não autorizado".
 */
export async function autenticarGarcom(): Promise<ResultadoDoGarcom> {
  const token = await lerTokenDoGarcom();
  if (!token) {
    return { ok: false, status: 401, erro: "Faça login para continuar.", codigo: "SEM_SESSAO" };
  }

  const w = await prisma.waiter.findUnique({
    where: { id: token.gid },
    select: { id: true, name: true, login: true, active: true, franchiseeId: true, credentialsUpdatedAt: true },
  });

  if (!w || w.franchiseeId !== token.lid) {
    return {
      ok: false,
      status: 401,
      erro: "Este acesso não existe mais. Peça ao gerente um novo login.",
      codigo: "GARCOM_INEXISTENTE",
    };
  }
  if (!w.active) {
    return { ok: false, status: 403, erro: "Seu acesso foi desativado. Fale com o gerente.", codigo: "GARCOM_DESATIVADO" };
  }
  if (!w.login) {
    return { ok: false, status: 403, erro: "Este garçom não tem login pelo link.", codigo: "SEM_LOGIN" };
  }
  // `iat` vem em segundos truncados: um token emitido no MESMO segundo da
  // troca de senha pode parecer até 999 ms mais velho do que é. A folga evita
  // recusar o login que acabou de acontecer logo depois de o gerente salvar.
  if (w.credentialsUpdatedAt && token.iat * 1000 + 999 < w.credentialsUpdatedAt.getTime()) {
    return { ok: false, status: 401, erro: "A senha foi alterada. Entre de novo.", codigo: "SENHA_ALTERADA" };
  }

  return { ok: true, garcom: { id: w.id, name: w.name, login: w.login, franchiseeId: w.franchiseeId } };
}

/**
 * Quem está operando a mesa: alguém do painel ou um garçom pelo link.
 *
 * As rotas do módulo de mesa aceitam os dois. O painel vem primeiro: se o
 * dono estiver logado no mesmo navegador em que um garçom entrou, vale o
 * dono — é a sessão de maior alcance e a que ele espera estar usando.
 *
 * `franchiseeId` é sempre a LOJA (dono), nunca o funcionário: funcionário
 * grava na loja do dono, e garçom grava na loja que o cadastrou.
 */
export type OperadorDaMesa =
  | { tipo: "loja"; franchiseeId: string; userId: string; ownerId: string | null }
  | { tipo: "garcom"; franchiseeId: string; garcom: GarcomAutenticado };

export async function resolverOperadorDaMesa(): Promise<OperadorDaMesa | null> {
  try {
    const session = await getServerSession(authOptions);
    if (session?.user?.email) {
      const u = await prisma.user.findUnique({
        where: { email: session.user.email },
        select: { id: true, ownerId: true },
      });
      if (u) return { tipo: "loja", franchiseeId: u.ownerId || u.id, userId: u.id, ownerId: u.ownerId };
    }
  } catch (err) {
    console.error("[resolverOperadorDaMesa] Erro ao ler sessão do painel:", err);
  }

  const r = await autenticarGarcom();
  if (r.ok) return { tipo: "garcom", franchiseeId: r.garcom.franchiseeId, garcom: r.garcom };
  return null;
}

/** Formato de login aceito: minúsculas, números, ponto, traço e sublinhado. */
export const FORMATO_DO_LOGIN = /^[a-z0-9._-]{3,30}$/;

export function normalizarLogin(valor: unknown): string {
  return String(valor ?? "").trim().toLowerCase();
}
