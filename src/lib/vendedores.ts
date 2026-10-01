/**
 * VENDEDORES — quem acompanha a loja que chegou por tráfego pago ou orgânico.
 *
 * Pedido do dono em 27/09/2026: a loja nova entra, o admin escolhe um
 * vendedor ao lado dela na aba Lojistas, e ela aparece na carteira do vendedor
 * (/vendedor) como "Aguardando atendimento" até ele marcar que já fez contato.
 * O admin vê, por vendedor, quantas atendeu e quantas estão paradas.
 *
 * O vendedor é uma linha de `Ambassador` com `isVendedor`: o login, a carteira
 * do Asaas e o portal já existiam para o embaixador, e um embaixador pode
 * passar a vender também sem ganhar outra conta. A comissão é
 * `sellerPercent` (3%) da mensalidade das lojas com `User.vendedorId` dele,
 * pelo split do Asaas no fechamento (lib/billing.ts) — somada ao que o
 * embaixador que INDICOU a loja já leva.
 *
 * MAS SÓ EM LOJA QUE NÃO É DELE (regra do dono, 27/09/2026): os 3% pagam
 * quem cuida de um cliente que a FireHub conseguiu. Se o vendedor é o
 * embaixador que indicou a loja — ou está acima de quem indicou, na rede —
 * ele já ganha os 20/30% (ou os 3% de nível 2) dela e só acompanha, sem o +3%.
 * Ver `ganhaComoVendedor`.
 */
import { randomInt } from "crypto";
import { prisma } from "@/lib/prisma";

/**
 * O vendedor leva `sellerPercent` desta loja? Não quando já ganha nela como
 * embaixador: indicou a loja (nível 1) ou trouxe quem indicou (nível 2). Mora
 * em lib/parceiro/regras.ts, junto com o resto das regras do parceiro que o
 * portal mostra — o split do fechamento e o portal leem a mesma função.
 */
export { ganhaComoVendedor } from "@/lib/parceiro/regras";

/** Campos da loja que `ganhaComoVendedor` precisa, para os `select` da carteira. */
export const SELECT_DO_EMBAIXADOR_DA_LOJA = {
  ambassadorId: true,
  ambassador: { select: { parentAmbassadorId: true } },
} as const;

export type StatusDoAtendimento = "AGUARDANDO" | "ATENDIDO";

export function statusDoAtendimento(v: unknown): StatusDoAtendimento | null {
  const s = String(v ?? "").trim().toUpperCase();
  return s === "AGUARDANDO" || s === "ATENDIDO" ? s : null;
}

/** Percentual do vendedor: número entre 0 e 20, ou null se inválido. */
export function percentualDoVendedor(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = parseFloat(String(v).replace(",", "."));
  return Number.isFinite(n) && n >= 0 && n <= 20 ? n : null;
}

/** Senha temporária do primeiro acesso: volta em texto UMA vez, para o admin repassar. */
export function gerarSenhaTemporaria(): string {
  const letras = "abcdefghjkmnpqrstuvwxyz";
  let s = "";
  for (let i = 0; i < 4; i++) s += letras[randomInt(letras.length)];
  return `${s}${randomInt(1000, 10000)}`;
}

/** Código do link de convite (o vendedor também tem um, como embaixador), único na tabela. */
export async function gerarCodigoUnico(nome: string): Promise<string> {
  const base =
    String(nome || "vendedor")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]/g, "")
      .slice(0, 20) || "vendedor";
  for (let i = 0; i < 20; i++) {
    const code = `${base}${randomInt(1000, 10000)}`;
    const existe = await prisma.ambassador.findUnique({ where: { code }, select: { id: true } });
    if (!existe) return code;
  }
  return `${base}${Date.now().toString(36)}`;
}
