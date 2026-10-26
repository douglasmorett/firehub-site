import { cssDaEtiqueta, type TamanhoDaEtiqueta } from "./etiqueta-css";

const TEMPO_PARA_CARREGAR = 15000;

async function esperarImagens(doc: Document) {
  await Promise.all(Array.from(doc.images, async (imagem) => {
    // A etiqueta fica fora da tela; imagens lazy não podem depender do scroll.
    imagem.loading = "eager";
    if (!imagem.complete) {
      await new Promise<void>((resolve, reject) => {
        const terminar = (erro?: Error) => {
          clearTimeout(limite);
          imagem.removeEventListener("load", carregou);
          imagem.removeEventListener("error", falhou);
          if (erro) reject(erro);
          else resolve();
        };
        const carregou = () => terminar();
        const falhou = () => terminar(new Error("Não consegui carregar uma imagem da etiqueta. Tente imprimir novamente."));
        const limite = setTimeout(falhou, TEMPO_PARA_CARREGAR);
        imagem.addEventListener("load", carregou, { once: true });
        imagem.addEventListener("error", falhou, { once: true });
      });
    }
    if (!imagem.naturalWidth) {
      throw new Error("Não consegui carregar uma imagem da etiqueta. Tente imprimir novamente.");
    }
    await imagem.decode();
  }));
}

/**
 * Abre a seleção de impressora do navegador, com uma página por etiqueta.
 * O `@page` sai do tamanho escolhido: é ele que diz ao Chrome o papel certo.
 */
export async function imprimirEtiquetas(area: HTMLElement, tamanho: TamanhoDaEtiqueta = "4x6"): Promise<void> {
  document.getElementById("label-print-frame")?.remove();
  const iframe = document.createElement("iframe");
  iframe.id = "label-print-frame";
  iframe.title = "Impressão de etiquetas";
  iframe.style.cssText = "position:fixed;left:-9999px;top:0;width:384px;height:576px;border:0;";

  try {
    // O listener vem ANTES do documento. Não há popup a ser bloqueado nem
    // atraso arbitrário que dispute com o carregamento do logo e dos QR.
    await new Promise<void>((resolve, reject) => {
      const limite = setTimeout(() => reject(new Error("A janela de impressão não carregou. Tente novamente.")), TEMPO_PARA_CARREGAR);
      iframe.onload = () => {
        clearTimeout(limite);
        resolve();
      };
      iframe.srcdoc = `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<title>Etiquetas de validade</title><style>${cssDaEtiqueta(tamanho)}</style>
</head><body>${area.innerHTML}</body></html>`;
      document.body.appendChild(iframe);
    });

    const janela = iframe.contentWindow;
    const doc = iframe.contentDocument;
    if (!janela || !doc) throw new Error("Não consegui abrir a janela de impressão. Tente novamente.");
    await esperarImagens(doc);
    await doc.fonts.ready;

    // Não remover por tempo: o usuário pode demorar para escolher impressora
    // e papel. afterprint também acontece quando ele cancela o diálogo.
    janela.addEventListener("afterprint", () => iframe.remove(), { once: true });
    janela.focus();
    janela.print();
  } catch (erro) {
    iframe.remove();
    throw erro;
  }
}
