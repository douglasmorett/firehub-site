/**
 * A fila de impressão da nuvem, em BYTES, para o celular com a impressora
 * Bluetooth (app FireHub).
 *
 * O celular entra na fila como mais um Assistente (api/store/print-queue): a
 * fila decide o que sai (categoria, só bebida, mesa, modelo da comanda,
 * reimpressão, conta da mesa) e este arquivo faz o que o Assistente faz com o
 * trabalho — o mesmo laço de firehub-print-assistant/server.js (a montagem do
 * `order` de cada destino) — e monta os bytes com o MESMO buildEscPos
 * (comanda-escpos.gerado.ts). O celular só manda os bytes para a impressora.
 *
 * Quem é dono de cada impressora continua sendo a fila (lib/dono-da-impressora.ts):
 * o celular não diz enxergar impressora nenhuma, então nunca tira papel do
 * PC com o Assistente; ele imprime o que não tem dono — a loja só de celular.
 */
import { buildEscPos } from "@/lib/app-firehub/comanda-escpos.gerado";

export type LarguraDoCelular = "58mm" | "80mm";

export type TrabalhoParaOCelular = {
  /** Id do trabalho: depois de imprimir TODOS os papéis, o app confirma (ack). */
  jobId: string;
  /** Bytes ESC/POS de cada papel, em base64, na ordem. Vazio = nada a imprimir, só confirmar. */
  papeis: string[];
};

type Job = {
  id?: unknown;
  order?: Record<string, any> | null;
  storeName?: string;
  escposProfile?: string;
  destinos?: Array<Record<string, any>> | null;
};

/** Perfil dos bytes. "windows" (driver do Windows) não existe no celular: monta como "safe". */
function perfil(p: unknown): string {
  const s = String(p || "safe");
  return s === "windows" ? "safe" : s;
}

const emBase64 = (b: unknown) => (b ? (b as Buffer).toString("base64") : null);

/**
 * Os papéis de cada trabalho. A largura do CELULAR vence a da impressora
 * cadastrada: a térmica Bluetooth é quase sempre 58 mm, e a comanda de 48
 * colunas sairia quebrada.
 */
export function trabalhosParaOCelular(jobs: Job[], largura: LarguraDoCelular): TrabalhoParaOCelular[] {
  const saida: TrabalhoParaOCelular[] = [];
  const cols = largura === "58mm" ? 32 : 48;
  for (const job of jobs || []) {
    const jobId = String(job?.id ?? "");
    if (!jobId || !job?.order) continue;
    // DANFE não chega aqui: o celular não anuncia `danfe=1` na fila.
    const destinos = Array.isArray(job.destinos) ? job.destinos.filter((d) => d && d.printer) : [];
    const storeName = job.storeName || "FIREHUB";
    const papeis: string[] = [];

    if (destinos.length === 0) {
      const b = emBase64(buildEscPos(job.order, storeName, cols, perfil(job.escposProfile)));
      if (b) papeis.push(b);
    }

    for (const destino of destinos) {
      // O mesmo `order` que o Assistente monta para o destino (server.js,
      // laço da fila da nuvem). Mudou lá, muda aqui.
      const order = {
        ...job.order,
        items: Array.isArray(destino.items) ? destino.items : job.order?.items,
        somenteBebidas: destino.somenteBebidas === true,
        restoDoPedido: destino.restoDoPedido || undefined,
        qrPuxarUrl: destino.qrPuxarUrl || undefined,
        qrPuxarCodigo: destino.qrPuxarCodigo || undefined,
        campanha: destino.campanha || undefined,
        blocos: Array.isArray(destino.blocos) && destino.blocos.length ? destino.blocos : job.order?.blocos,
        avisos: destino.avisos && typeof destino.avisos === "object" ? destino.avisos : job.order?.avisos,
        semValores: destino.semValores === true || job.order?.semValores === true,
      };
      // null = impressora só de bebida num pedido sem bebida: nada a imprimir.
      const b = emBase64(buildEscPos(order, storeName, cols, perfil(destino.escposProfile || job.escposProfile)));
      if (!b) continue;
      const copias = Math.min(5, Math.max(1, Number(destino.copies) || 1));
      for (let i = 0; i < copias; i++) papeis.push(b);
    }
    saida.push({ jobId, papeis });
  }
  return saida;
}
