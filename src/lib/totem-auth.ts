/**
 * /src/lib/totem-auth.ts
 *
 * Autenticação do totem.
 *
 * O token é procurado NO BANCO, não validado por assinatura. `TotemLicense.token`
 * é `@unique` — o banco já é a fonte da verdade sobre qual licença é qual.
 *
 * Por que mudou: o token era um JWT assinado com `NEXTAUTH_SECRET`, e isso
 * amarrava o totem ao segredo do ambiente que gerou a licença. O totem da Hakim
 * Centro nunca funcionou por causa disso — a licença foi criada rodando o sistema
 * na máquina do dono (segredo de 44 caracteres) e produção tem outro segredo (40).
 * Mesmo token, mesma linha no banco, e produção respondia
 * "Token inválido ou expirado" desde 14/08. O `lastHeartbeat` nunca saiu de nulo.
 *
 * Havia ainda uma armadilha pior à espera: a auditoria de segurança pede para
 * rotacionar o `NEXTAUTH_SECRET`. No desenho antigo, rotacionar matava todos os
 * totens de todos os clientes de uma vez, em silêncio, sem caminho de volta a não
 * ser regerar licença por licença.
 *
 * Não se perde segurança: nos dois desenhos quem tem a string do token entra.
 * A assinatura não protegia nada que a coluna única já não proteja — ela só
 * adicionava um jeito de o token morrer sozinho.
 */
import { prisma } from "./prisma";

/** Menor token que aceitamos consultar. Evita bater no banco com "" ou "abc". */
const TAMANHO_MINIMO_DO_TOKEN = 20;

export type LicencaDoTotem = {
  id: string;
  label: string;
  franchiseeId: string;
  active: boolean;
  deviceFingerprint: string | null;
};

export type ResultadoDaAutenticacao =
  | { ok: true; licenca: LicencaDoTotem }
  | { ok: false; status: number; erro: string; codigo: string };

/**
 * Confere o token e devolve a licença.
 *
 * As respostas de erro são distintas de propósito. Antes, três situações bem
 * diferentes — token desconhecido, licença desligada no painel e módulo Totem
 * desativado na loja — chegavam ao operador como o mesmo "Token inválido ou
 * expirado", que não diz o que fazer. Agora cada uma diz o próprio problema.
 */
export async function autenticarTotem(
  token: unknown,
  opcoes: { exigirModuloAtivo?: boolean } = {}
): Promise<ResultadoDaAutenticacao> {
  const { exigirModuloAtivo = true } = opcoes;

  if (typeof token !== "string" || token.trim().length < TAMANHO_MINIMO_DO_TOKEN) {
    return { ok: false, status: 400, erro: "Token obrigatório", codigo: "TOKEN_AUSENTE" };
  }

  const licenca = await prisma.totemLicense.findUnique({
    where: { token: token.trim() },
    select: {
      id: true,
      label: true,
      franchiseeId: true,
      active: true,
      deviceFingerprint: true,
      franchisee: { select: { totemEnabled: true } },
    },
  });

  if (!licenca) {
    return {
      ok: false,
      status: 401,
      erro: "Este totem não está cadastrado. Gere uma nova licença no painel, em Totem.",
      codigo: "TOKEN_DESCONHECIDO",
    };
  }

  if (!licenca.active) {
    return {
      ok: false,
      status: 403,
      erro: "Esta licença de totem está desativada. Reative no painel, em Totem.",
      codigo: "LICENCA_DESATIVADA",
    };
  }

  if (exigirModuloAtivo && !licenca.franchisee.totemEnabled) {
    return {
      ok: false,
      status: 403,
      erro: "O módulo Totem está desligado para esta loja.",
      codigo: "MODULO_DESLIGADO",
    };
  }

  return {
    ok: true,
    licenca: {
      id: licenca.id,
      label: licenca.label,
      franchiseeId: licenca.franchiseeId,
      active: licenca.active,
      deviceFingerprint: licenca.deviceFingerprint,
    },
  };
}

/** IP de quem chamou, para o registro de heartbeat. */
export function ipDaRequisicao(req: { headers: { get(nome: string): string | null } }): string {
  const encaminhado = req.headers.get("x-forwarded-for");
  // x-forwarded-for pode vir com vários IPs; o primeiro é o cliente.
  if (encaminhado) return encaminhado.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "desconhecido";
}
