/**
 * Qual instalador o botão "Baixar o FireHub para Windows" entrega
 * (api/contingencia/instalador e a tela do Modo Contingência).
 *
 *   FIREHUB_INSTALADOR_COMPLETO_URL   https://… do FireHub-Completo-Setup.exe
 *   FIREHUB_INSTALADOR_COMPLETO_MB    o tamanho, para a tela avisar (opcional)
 *
 * Sem a variável (ou com endereço que não é https), vai o Assistente de
 * sempre: ele baixa o FireHub sozinho depois da ativação.
 */
export const INSTALADOR_DO_ASSISTENTE = "/downloads/FireHub-Assistente-Impressao-Setup.exe";

export type EnderecoDoInstalador = { completo: boolean; url: string; tamanhoMb: number | null };

export function enderecoDoInstalador(env: Record<string, string | undefined> = process.env): EnderecoDoInstalador {
  const url = (env.FIREHUB_INSTALADOR_COMPLETO_URL || "").trim();
  if (/^https:\/\/[^\s]+$/i.test(url)) {
    const mb = Number(env.FIREHUB_INSTALADOR_COMPLETO_MB);
    return { completo: true, url, tamanhoMb: Number.isFinite(mb) && mb > 0 ? Math.round(mb) : null };
  }
  return { completo: false, url: INSTALADOR_DO_ASSISTENTE, tamanhoMb: null };
}
