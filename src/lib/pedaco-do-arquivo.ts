/**
 * HTTP Range para os arquivos enviados — o vídeo da capa, servido por
 * app/uploads/[...path]/route.ts.
 *
 * Fica fora da rota porque um route.ts só pode exportar os métodos e as opções
 * do Next, e isto precisa de teste (scripts/teste-video-da-capa.ts).
 */

/**
 * O pedaço pedido no cabeçalho Range ("bytes=0-", "bytes=100-199", "bytes=-500").
 * null = sem Range (ou um que não se entende: vai o arquivo inteiro, 200).
 * "fora" = começa depois do fim — 416.
 */
export function pedacoPedido(range: string | null, tamanho: number): { ini: number; fim: number } | "fora" | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(range || "").trim());
  if (!m || (m[1] === "" && m[2] === "")) return null;
  if (m[1] === "") {
    // "bytes=-500": os últimos 500 bytes.
    const ultimos = Math.min(Number(m[2]), tamanho);
    return ultimos <= 0 ? "fora" : { ini: tamanho - ultimos, fim: tamanho - 1 };
  }
  const ini = Number(m[1]);
  if (ini >= tamanho) return "fora";
  const fim = m[2] === "" ? tamanho - 1 : Math.min(Number(m[2]), tamanho - 1);
  return fim < ini ? null : { ini, fim };
}
