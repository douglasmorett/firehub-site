/**
 * /src/lib/nfce/danfe-do-pedido.ts
 *
 * O DANFE de um PEDIDO do emissor próprio: acha a nota no fiscalInfo, lê o XML
 * no cofre fiscal e devolve os dados do cupom (lib/nfce/danfe.ts). Um lugar só
 * para as três portas que mostram o DANFE — a rota da loja
 * (api/store/fiscal/danfe), o link do cliente (app/nfce/[token]) e a
 * impressão pela fila (impressao-do-danfe.ts) — não divergirem sobre QUAL
 * nota vale.
 *
 * Contrato com a emissão (frente A), gravado em CustomerOrder.fiscalInfo:
 *   nfceKey      a chave de acesso (44)
 *   provedor     "sefaz"
 *   xmlNoCofre   { caminho, sha256, tipo? } — o nfeProc autorizado, ou a NFe
 *                assinada da contingência off-line enquanto ela não é autorizada
 *
 * Só servidor (lê o cofre).
 */
import { lerXmlFiscal } from "./armazenamento";
import { dadosDoDanfe, ErroDoDanfe, type DadosDoDanfe } from "./danfe";

export type NotaNoCofre = {
  /** fiscalInfo.nfceKey (null se não veio ou não tem cara de chave). */
  chave: string | null;
  caminho: string;
  sha256: string | null;
  /** "nota", "contingencia"... — informativo; quem decide o estado é o XML. */
  tipo: string | null;
};

const objeto = (v: unknown): Record<string, any> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, any>) : {});

/** A nota do emissor próprio guardada no pedido, ou null (Focus, ou nota sem XML no cofre). */
export function notaDoEmissorProprio(fiscalInfo: unknown): NotaNoCofre | null {
  const info = objeto(fiscalInfo);
  const cofre = objeto(info.xmlNoCofre);
  const caminho = typeof cofre.caminho === "string" ? cofre.caminho.trim() : "";
  if (!caminho) return null;
  const chave = String(info.nfceKey ?? "").trim().toUpperCase();
  return {
    chave: /^[0-9]{6}[0-9A-Z]{12}[0-9]{26}$/.test(chave) ? chave : null,
    caminho,
    sha256: typeof cofre.sha256 === "string" && cofre.sha256 ? cofre.sha256 : null,
    tipo: typeof cofre.tipo === "string" && cofre.tipo ? cofre.tipo : null,
  };
}

export type DanfeDoPedido =
  | { ok: true; dados: DadosDoDanfe; nota: NotaNoCofre; xml: string }
  | { ok: false; status: number; erro: string; mensagem: string };

/**
 * Lê o DANFE do pedido. Só a nota VIVA vira cupom: EMITTED (autorizada, ou em
 * contingência aguardando a SEFAZ — o fiscalInfo tem `contingencia: true` e o
 * XML diz tpEmis 9). A cancelada e a contingência recusada (FAILED) não: o
 * papel diria que vale uma nota que não vale.
 *
 * `ler` existe para o teste (o padrão é o cofre de verdade).
 */
export async function danfeDoPedido(
  pedido: { id: string; fiscalStatus?: string | null; fiscalInfo?: unknown },
  opcoes: { ler?: (caminho: string, sha256: string | null) => Promise<string> } = {}
): Promise<DanfeDoPedido> {
  const nota = notaDoEmissorProprio(pedido.fiscalInfo);
  if (!nota) {
    return { ok: false, status: 404, erro: "sem_documento", mensagem: "Este pedido não tem NFC-e do emissor próprio guardada." };
  }
  if (pedido.fiscalStatus === "CANCELED") {
    return {
      ok: false,
      status: 410,
      erro: "cancelada",
      mensagem: "Esta NFC-e foi cancelada: o DANFE dela não vale mais. Consulte a chave de acesso no portal da SEFAZ.",
    };
  }
  if (pedido.fiscalStatus !== "EMITTED") {
    return {
      ok: false,
      status: 409,
      erro: "nao_autorizada",
      mensagem: "Este pedido não tem NFC-e autorizada (nem em contingência válida): não há DANFE para mostrar.",
    };
  }
  let xml: string;
  try {
    xml = await (opcoes.ler ?? lerXmlFiscal)(nota.caminho, nota.sha256);
  } catch (e: any) {
    console.error(`[DANFE] pedido ${pedido.id}: não li o XML no cofre:`, String(e?.message ?? e).slice(0, 200));
    return { ok: false, status: 500, erro: "cofre", mensagem: "Não consegui ler o XML desta nota no cofre fiscal." };
  }
  let dados: DadosDoDanfe;
  try {
    dados = dadosDoDanfe(xml);
  } catch (e: any) {
    const mensagem = e instanceof ErroDoDanfe ? e.message : "O XML guardado desta nota não pôde ser lido.";
    return { ok: false, status: 409, erro: "xml_invalido", mensagem };
  }
  if (nota.chave && dados.chave !== nota.chave) {
    return { ok: false, status: 409, erro: "xml_de_outra_nota", mensagem: "O XML guardado não é o desta nota (chave diferente)." };
  }
  return { ok: true, dados, nota, xml };
}
