import { timingSafeEqual } from "crypto";

/**
 * O webhook do WhatsApp (api/webhook/whatsapp) aceitava qualquer POST: bastava
 * saber o nome da instância para forjar mensagem de cliente, queda do robô ou
 * "vínculo doente" de qualquer loja. O gateway manda no cabeçalho `apikey` a
 * mesma chave que o FireHub usa para chamá-lo (EVOLUTION_API_KEY, e a
 * _ANTERIOR durante uma troca de chave).
 */
export function chaveDoGateway(
  recebida: string | null | undefined,
  aceitas: (string | undefined)[] = [process.env.EVOLUTION_API_KEY, process.env.EVOLUTION_API_KEY_ANTERIOR],
): "ok" | "errada" | "ausente" {
  if (!recebida) return "ausente";
  const r = Buffer.from(recebida);
  return aceitas.some((c) => !!c && Buffer.from(c).length === r.length && timingSafeEqual(Buffer.from(c), r)) ? "ok" : "errada";
}
