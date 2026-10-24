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

/**
 * Nem todo remetente manda a chave: a Evolution API oficial (número do
 * atendimento e, talvez, alguma loja) avisa por conta própria, sem o nosso
 * cabeçalho. Exigir de todos calaria esses robôs. Então a exigência é por
 * instância: a que já chegou com a chave certa é de um gateway nosso, e dali
 * em diante evento dela sem a chave é forjado. A que nunca mandou segue
 * passando (e fica no log). Memória do processo: depois de um reinício, a
 * primeira mensagem legítima de cada loja reaprende.
 */
const INSTANCIAS_COM_CHAVE = new Set<string>();
const TETO = 20_000;

export function aceitarEventoDoGateway(instancia: string | null | undefined, chave: "ok" | "errada" | "ausente"): boolean {
  const nome = String(instancia || "");
  if (chave === "ok") {
    if (nome && !INSTANCIAS_COM_CHAVE.has(nome)) {
      if (INSTANCIAS_COM_CHAVE.size >= TETO) INSTANCIAS_COM_CHAVE.clear();
      INSTANCIAS_COM_CHAVE.add(nome);
    }
    return true;
  }
  return !INSTANCIAS_COM_CHAVE.has(nome);
}
