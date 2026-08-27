import crypto from "crypto";

/**
 * /src/lib/extensao-token.ts
 *
 * Token da extensão de navegador (a que sincroniza ETA com o iFood).
 *
 * ── O QUE ESTAVA ERRADO ─────────────────────────────────────────────────────
 *
 * O "token" era o `user.id` puro. E o id da loja NÃO é segredo: ele vai para o
 * navegador em toda página de cardápio público (`franchisee.id`), aparece em
 * chamadas do próprio site e em links. Ou seja, qualquer pessoa copiava o id
 * da loja no cardápio e passava a escrever a configuração de ETA dela —
 * colocando "entrega em 3 horas" no concorrente, por exemplo.
 *
 * Agora o token é o id ASSINADO com a mesma chave que assina as sessões. Sem a
 * chave não dá para forjar, e o id sozinho deixa de valer como credencial.
 *
 * ── COMPATIBILIDADE ─────────────────────────────────────────────────────────
 *
 * A extensão já instalada guardou o token antigo (o id cru). Para não derrubar
 * quem está usando agora, o id cru continua valendo para LEITURA — mas nunca
 * mais para ESCRITA. Assim que o lojista fizer login na extensão de novo, ela
 * recebe o token assinado e a escrita volta a funcionar.
 */

function chave(): string {
  const s = process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error("NEXTAUTH_SECRET ausente: não dá para assinar o token da extensão.");
  return s;
}

function assinar(userId: string): string {
  return crypto.createHmac("sha256", chave()).update(`extensao:${userId}`).digest("hex").slice(0, 32);
}

/** Token entregue no login da extensão: `<userId>.<assinatura>`. */
export function criarTokenDeExtensao(userId: string): string {
  return `${userId}.${assinar(userId)}`;
}

export type LeituraDoToken =
  /** Token assinado e válido — vale para ler E escrever. */
  | { valido: true; assinado: true; userId: string }
  /** Formato antigo (id cru) — só leitura, até a extensão relogar. */
  | { valido: true; assinado: false; userId: string }
  | { valido: false };

/**
 * Interpreta o token recebido. `exigirAssinatura` é o que separa leitura de
 * escrita: quem escreve precisa de token assinado.
 */
export function lerTokenDeExtensao(token: string | null | undefined): LeituraDoToken {
  const bruto = String(token || "").trim();
  if (!bruto) return { valido: false };

  const partes = bruto.split(".");
  if (partes.length === 2) {
    const [userId, assinatura] = partes;
    const esperada = assinar(userId);
    const a = Buffer.from(esperada);
    const b = Buffer.from(assinatura);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
      return { valido: true, assinado: true, userId };
    }
    return { valido: false };
  }

  // Formato antigo: o id cru. Aceito só onde a leitura basta.
  return { valido: true, assinado: false, userId: bruto };
}
