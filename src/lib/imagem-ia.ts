/**
 * /src/lib/imagem-ia.ts
 *
 * Geração de imagem de anúncio com o Gemini (Nano Banana / Gemini 2.5 Flash Image).
 *
 * Custo verificado em 03/2026: US$ 0,039 por imagem 1024×1024 (~R$ 0,21).
 * O pacote de R$ 50/semana inclui 10 gerações — o custo por imagem é irrelevante,
 * o que pesa é o volume: um lojista indeciso clicando "gerar outra" cinquenta
 * vezes consumiria quase metade da margem sozinho. Por isso a cota.
 *
 * Escolha do modelo: Nano Banana usa a MESMA chave do Gemini que o chatbot já
 * usa — sem serviço novo, sem contrato novo, sem outra fatura.
 */
import { segredoOpcional } from "./segredos";

const MODELO = "gemini-2.5-flash-image";
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODELO}:generateContent`;

export type ImagemGerada = {
  /** data URI da imagem — quem chama decide onde gravar. */
  dataUri: string;
  mime: string;
};

/**
 * Monta o pedido de imagem.
 *
 * A instrução é deliberadamente conservadora quanto ao PRATO: pede uma cena de
 * apresentação, não a invenção de um produto específico. Anunciar uma foto de
 * comida que não corresponde ao que a loja entrega é propaganda enganosa — o
 * cliente pede e recebe outra coisa. Para o prato em si, a orientação do
 * produto é usar foto real do cardápio; a IA serve para composição e fundo.
 */
function montarPrompt(descricao: string, nomeDaLoja: string): string {
  return [
    `Fotografia publicitária de comida para anúncio de delivery do restaurante "${nomeDaLoja}".`,
    `Tema: ${descricao}.`,
    "Enquadramento quadrado, prato em destaque no centro, luz natural suave,",
    "fundo desfocado de mesa de restaurante, cores quentes e apetitosas.",
    "Estilo realista de fotografia gastronômica profissional.",
    "SEM texto, SEM letras, SEM logotipo e SEM marca d'água na imagem.",
  ].join(" ");
}

export type ResultadoGeracao =
  | { ok: true; imagem: ImagemGerada }
  | { ok: false; motivo: "sem_chave" | "recusado" | "erro"; detalhe?: string };

export async function gerarImagemDeAnuncio(
  descricao: string,
  nomeDaLoja: string,
  chaveDaLoja?: string | null
): Promise<ResultadoGeracao> {
  // A chave da loja tem prioridade (mesma regra do chatbot); a global é reserva.
  const chave = (chaveDaLoja && chaveDaLoja.trim()) || segredoOpcional("GEMINI_API_KEY");
  if (!chave) return { ok: false, motivo: "sem_chave" };

  try {
    const res = await fetch(`${ENDPOINT}?key=${encodeURIComponent(chave)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: montarPrompt(descricao, nomeDaLoja) }] }],
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      const erro = await res.text().catch(() => "");
      return { ok: false, motivo: "erro", detalhe: `HTTP ${res.status} ${erro.slice(0, 180)}` };
    }

    const data = await res.json();
    const partes = data?.candidates?.[0]?.content?.parts ?? [];
    const comImagem = partes.find((p: any) => p?.inlineData?.data);

    if (!comImagem) {
      // O modelo pode recusar por política de conteúdo e devolver só texto.
      const texto = partes.find((p: any) => p?.text)?.text;
      return { ok: false, motivo: "recusado", detalhe: texto?.slice(0, 180) };
    }

    const mime = comImagem.inlineData.mimeType || "image/png";
    return {
      ok: true,
      imagem: { dataUri: `data:${mime};base64,${comImagem.inlineData.data}`, mime },
    };
  } catch (e: any) {
    return { ok: false, motivo: "erro", detalhe: String(e?.message).slice(0, 180) };
  }
}

/** Semana de referência no formato "2026-W34", em horário de São Paulo. */
export function semanaDeReferencia(ref: Date = new Date()): string {
  const emSP = new Date(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
      year: "numeric", month: "2-digit", day: "2-digit",
    }).format(ref) + "T12:00:00Z"
  );

  // Semana ISO: quinta-feira da semana define o ano.
  const d = new Date(Date.UTC(emSP.getUTCFullYear(), emSP.getUTCMonth(), emSP.getUTCDate()));
  const diaISO = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - diaISO);
  const inicioDoAno = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const semana = Math.ceil(((d.getTime() - inicioDoAno.getTime()) / 86400000 + 1) / 7);

  return `${d.getUTCFullYear()}-W${String(semana).padStart(2, "0")}`;
}

/** Gerações incluídas no pacote semanal. */
export const COTA_SEMANAL_DE_IMAGENS = 10;
