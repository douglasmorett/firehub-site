import crypto from "crypto";

/**
 * Cofre para segredo de LOJA gravado no banco (hoje: a chave de API do Asaas
 * do lojista, que movimenta a conta inteira dele).
 *
 * Até aqui todo segredo por loja ia em texto puro (token do iFood, do 99, da
 * Focus). A chave do Asaas não pode seguir esse caminho: quem lê o banco não
 * pode sair com o poder de transferir o saldo de todas as lojas.
 *
 * AES-256-GCM. A chave de cifra vem de `COFRE_CHAVE`; sem ela, de uma derivação
 * do `NEXTAUTH_SECRET`, que o servidor já exige para subir (lib/auth.ts). O
 * texto cifrado diz de qual das duas veio, para o valor gravado continuar
 * legível depois que alguém cadastrar a `COFRE_CHAVE` no Coolify.
 *
 * Formato: `v1.<fonte>.<iv>.<tag>.<dados>` (base64url), fonte "c" ou "n".
 */

type Fonte = "c" | "n";

function chaveDaFonte(fonte: Fonte): Buffer | null {
  if (fonte === "c") {
    const bruta = (process.env.COFRE_CHAVE || "").trim();
    if (!bruta) return null;
    return crypto.createHash("sha256").update(`firehub-cofre:${bruta}`).digest();
  }
  const segredo = (process.env.NEXTAUTH_SECRET || "").trim();
  if (!segredo) return null;
  return crypto.createHash("sha256").update(`firehub-cofre-nextauth:${segredo}`).digest();
}

function fonteAtual(): Fonte | null {
  if (chaveDaFonte("c")) return "c";
  if (chaveDaFonte("n")) return "n";
  return null;
}

export function cifrar(texto: string): string {
  const fonte = fonteAtual();
  if (!fonte) throw new Error("Cofre sem chave: defina COFRE_CHAVE (ou NEXTAUTH_SECRET) no servidor.");
  const chave = chaveDaFonte(fonte)!;
  const iv = crypto.randomBytes(12);
  const cifra = crypto.createCipheriv("aes-256-gcm", chave, iv);
  const dados = Buffer.concat([cifra.update(texto, "utf8"), cifra.final()]);
  const tag = cifra.getAuthTag();
  return ["v1", fonte, iv.toString("base64url"), tag.toString("base64url"), dados.toString("base64url")].join(".");
}

/** Devolve o texto, ou null se o valor não abrir (chave trocada, dado corrompido). */
export function decifrar(guardado: string | null | undefined): string | null {
  if (!guardado) return null;
  const partes = guardado.split(".");
  if (partes.length !== 5 || partes[0] !== "v1") return null;
  const [, fonte, iv, tag, dados] = partes;
  const chave = chaveDaFonte(fonte as Fonte);
  if (!chave) return null;
  try {
    const decifra = crypto.createDecipheriv("aes-256-gcm", chave, Buffer.from(iv, "base64url"));
    decifra.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decifra.update(Buffer.from(dados, "base64url")), decifra.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** Comparação de segredo sem vazar tempo (token de webhook). */
export function mesmoSegredo(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}
