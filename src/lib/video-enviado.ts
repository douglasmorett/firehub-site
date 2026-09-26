/**
 * O VÍDEO DA CAPA que a loja envia: conferido pelos BYTES, não pelo nome.
 *
 * Três coisas decidem se o vídeo pode ir para a capa do cardápio:
 *
 *  1. É vídeo mesmo. O `file.type` é escrito por quem envia; os uploads são
 *     servidos do nosso domínio, então um .html renomeado seria XSS. Vale o
 *     mesmo cuidado das imagens (lib/storage.ts, tipoRealPelosBytes).
 *  2. Toca no celular do cliente. O iPhone grava em HEVC ("Alta eficiência"),
 *     que a maior parte dos Android não toca: a capa ficaria parada no pôster
 *     para metade dos clientes, sem ninguém saber por quê. O codec está na
 *     caixa `stsd` do MP4/MOV — lido aqui, a loja fica sabendo na hora.
 *  3. Cabe. O proxy do Next guarda o corpo do envio em memória até 10 MB e
 *     CORTA o resto (proxyClientMaxBodySize) — um vídeo maior chegaria
 *     truncado. E cada visita ao cardápio baixa o vídeo: capa é um laço de
 *     poucos segundos, não um filme.
 */

/** Abaixo do corte de 10 MB do proxy, com folga para o resto do formulário. */
export const MAX_VIDEO_BYTES = 9 * 1024 * 1024;

export type TipoDeVideo = "video/mp4" | "video/webm";

/** MP4/MOV começam com a caixa `ftyp` (bytes 4–8); WebM, com o cabeçalho EBML. */
export function tipoRealDoVideo(b: Uint8Array): TipoDeVideo | null {
  if (b.length < 12) return null;
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return "video/mp4"; // "ftyp"
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "video/webm";
  return null;
}

const ascii = (b: Uint8Array, i: number) => String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);
const u32 = (b: Uint8Array, i: number) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];

/** As caixas que só guardam outras caixas, no caminho até a `stsd`. */
const CONTAINERS = new Set(["moov", "trak", "mdia", "minf", "stbl"]);

/**
 * O codec da PRIMEIRA faixa de vídeo do MP4/MOV ("avc1" = H.264, "hvc1"/"hev1"
 * = HEVC, "av01", "vp09"...). null quando não dá para ler — aí o envio segue:
 * a trava é para o caso que se sabe que quebra, não para o que não se sabe ler.
 *
 * A faixa de áudio também tem `stsd` ("mp4a"); só vale a que está numa `trak`
 * cujo `hdlr` é "vide".
 */
export function codecDoVideo(b: Uint8Array): string | null {
  let achado: string | null = null;

  const percorrer = (ini: number, fim: number, naTrakDeVideo: boolean | null): void => {
    let i = ini;
    while (i + 8 <= fim && achado == null) {
      let tamanho = u32(b, i);
      const tipo = ascii(b, i + 4);
      let cabecalho = 8;
      if (tamanho === 1) {
        // Tamanho de 64 bits: só a metade de baixo cabe num arquivo de 9 MB.
        if (i + 16 > fim) return;
        tamanho = u32(b, i + 12);
        cabecalho = 16;
      } else if (tamanho === 0) {
        tamanho = fim - i; // vai até o fim do arquivo
      }
      if (tamanho < cabecalho || i + tamanho > fim) return;

      if (tipo === "trak") {
        percorrer(i + cabecalho, i + tamanho, ehTrakDeVideo(i + cabecalho, i + tamanho));
      } else if (CONTAINERS.has(tipo)) {
        percorrer(i + cabecalho, i + tamanho, naTrakDeVideo);
      } else if (tipo === "stsd" && naTrakDeVideo !== false) {
        // versão/flags (4) + quantidade (4) + a primeira entrada: tamanho (4) e tipo (4).
        const entrada = i + cabecalho + 8;
        if (entrada + 8 <= i + tamanho) achado = ascii(b, entrada + 4);
      }
      i += tamanho;
    }
  };

  /** A `trak` é de vídeo? Procura o `hdlr` dentro da `mdia` dela. */
  const ehTrakDeVideo = (ini: number, fim: number): boolean | null => {
    let i = ini;
    while (i + 8 <= fim) {
      const tamanho = u32(b, i);
      const tipo = ascii(b, i + 4);
      if (tamanho < 8 || i + tamanho > fim) return null;
      if (tipo === "mdia") {
        let j = i + 8;
        while (j + 8 <= i + tamanho) {
          const t = u32(b, j);
          if (t < 8 || j + t > i + tamanho) return null;
          // hdlr: cabeçalho (8) + versão/flags (4) + pre_defined (4) + handler_type (4).
          if (ascii(b, j + 4) === "hdlr" && j + 20 <= i + tamanho) return ascii(b, j + 16) === "vide";
          j += t;
        }
      }
      i += tamanho;
    }
    return null;
  };

  percorrer(0, b.length, null);
  return achado;
}

/** HEVC: o padrão do iPhone, que a maioria dos Android não toca no navegador. */
export const CODECS_QUE_NAO_TOCAM_EM_TODO_LUGAR = new Set(["hvc1", "hev1", "dvh1", "dvhe"]);

export const DICA_DO_VIDEO =
  "Dica: mande o vídeo para você mesmo pelo WhatsApp e baixe de lá — ele chega em MP4, leve e no formato que todo celular toca.";

export type ConferenciaDoVideo =
  | { ok: true; tipo: TipoDeVideo; extensao: "mp4" | "webm"; codec: string | null }
  | { ok: false; erro: string };

/** Confere o vídeo enviado. Não grava nada — quem grava é lib/storage.ts. */
export function conferirVideo(bytes: Uint8Array, tamanho = bytes.length): ConferenciaDoVideo {
  if (tamanho > MAX_VIDEO_BYTES) {
    const mb = (tamanho / 1024 / 1024).toFixed(1).replace(".", ",");
    return { ok: false, erro: `O vídeo tem ${mb} MB e o limite é 9 MB. Use um trecho curto (até uns 15 segundos). ${DICA_DO_VIDEO}` };
  }
  const tipo = tipoRealDoVideo(bytes);
  if (!tipo) {
    return { ok: false, erro: `Esse arquivo não é um vídeo MP4 ou WebM. ${DICA_DO_VIDEO}` };
  }
  if (tipo === "video/webm") return { ok: true, tipo, extensao: "webm", codec: null };
  const codec = codecDoVideo(bytes);
  if (codec && CODECS_QUE_NAO_TOCAM_EM_TODO_LUGAR.has(codec)) {
    return {
      ok: false,
      erro: `Esse vídeo está em HEVC (o formato "Alta eficiência" do iPhone), que muitos celulares Android não conseguem tocar. ${DICA_DO_VIDEO}`,
    };
  }
  // MOV com H.264 é o mesmo conteúdo de um MP4: vai gravado como .mp4.
  return { ok: true, tipo, extensao: "mp4", codec };
}
