/**
 * Monta o material de divulgação (apresentação e folder) com os dados de quem
 * indica: o QR, o "Indicado por:" e o WhatsApp do bloco de contato. Sem quem
 * indica, sai o material genérico — QR para o WhatsApp do FireHub e a linha
 * do "Indicado por:" em branco, para preencher à caneta.
 *
 * O HTML é o modelo aprovado (modelo-apresentacao.ts / modelo-folder.ts) com
 * três trocas de texto. Cada troca confere que achou o trecho: se o modelo
 * mudar e o trecho sumir, a rota quebra alto em vez de imprimir o contato errado.
 */
import QRCode from "qrcode";
import { MODELO_DA_APRESENTACAO } from "./modelo-apresentacao";
import { MODELO_DO_FOLDER } from "./modelo-folder";
import { telefoneFormatado } from "./telefone";

export type Material = "apresentacao" | "folder";
export type QrLeva = "whatsapp" | "cadastro";
/** Quem indica: o vendedor/embaixador ou a loja do Indique e ganhe. */
export type Indicador = { nome: string; whatsapp: string | null; linkDeCadastro: string };

const WHATSAPP_DO_FIREHUB = "5522981118514";
const TEXTO_DO_WHATSAPP = "Oi! Vi o material do FireHub e quero conhecer";

export const linkDoWhatsapp = (whatsapp: string) => `https://wa.me/${whatsapp}?text=${encodeURIComponent(TEXTO_DO_WHATSAPP)}`;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const semProtocolo = (link: string) => link.replace(/^https?:\/\//, "");

function trocar(html: string, de: string, para: string): string {
  if (!html.includes(de)) throw new Error(`Modelo do material sem o trecho esperado: ${de.slice(0, 60)}`);
  return html.replace(de, para);
}

/** Largura de uma página na tela, em px (210 mm e 303 mm a 96 dpi): base do zoom do celular. */
const LARGURA_DA_PAGINA: Record<Material, number> = { apresentacao: 794, folder: 1146 };

export async function montarMaterial(opcoes: {
  material: Material;
  indicador: Indicador | null;
  qr: QrLeva;
  /** Dentro da prévia da tela do material: sem a barra do "Baixar PDF". */
  previa?: boolean;
  /** Abre a janela de impressão sozinho (o "Baixar PDF" da tela do material). */
  imprimir?: boolean;
}): Promise<string> {
  const { material, indicador, previa, imprimir } = opcoes;
  const w = indicador?.whatsapp ?? null;
  // QR para o WhatsApp de quem indica só se houver número; senão, o cadastro com o código dele.
  const qr: QrLeva = opcoes.qr === "whatsapp" && w ? "whatsapp" : "cadastro";
  const alvoDoQr = !indicador ? linkDoWhatsapp(WHATSAPP_DO_FIREHUB) : qr === "whatsapp" ? linkDoWhatsapp(w!) : indicador.linkDeCadastro;
  const svg = await QRCode.toString(alvoDoQr, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#111111", light: "#ffffff" } });

  let html = material === "apresentacao" ? MODELO_DA_APRESENTACAO : MODELO_DO_FOLDER;
  html = trocar(html, "__QR__", svg);

  if (indicador) {
    const nome = esc(indicador.nome);
    const cadastro = esc(semProtocolo(indicador.linkDeCadastro));
    html = trocar(html, `<div class="indicado"><b>Indicado por:</b><i></i></div>`,
      `<div class="indicado"><b>Indicado por:</b><i class="preenchido">${nome}</i></div>`);
    if (material === "apresentacao") {
      if (w) html = trocar(html, `<div><span>WhatsApp</span>(22) 98111-8514</div>`, `<div><span>WhatsApp</span>${telefoneFormatado(w)}</div>`);
      // O cadastro com o código dele sempre à vista: quem digitar o endereço também fica marcado.
      html = trocar(html, `<div><span>Teste grátis</span>firehubfood.com.br/cadastro</div>`,
        `<div><span>Teste grátis</span><small class="cadastro">${cadastro}</small></div>`);
      if (qr === "cadastro") {
        html = trocar(html, `<p>Aponte a câmera do celular para o código ou chame a gente no WhatsApp.</p>`,
          `<p>Aponte a câmera do celular para o código e comece o teste grátis, ou chame no WhatsApp.</p>`);
      }
    } else {
      const de = `<p>Aponte a câmera e chame a gente.<br>WhatsApp <b>(22) 98111-8514</b><br><b>firehubfood.com.br</b></p>`;
      const chamada = qr === "cadastro" ? "Aponte a câmera e comece o teste grátis." : "Aponte a câmera e chame no WhatsApp.";
      const fone = w ? telefoneFormatado(w) : "(22) 98111-8514";
      // QR no WhatsApp dele: o cadastro com o código vai em letra miúda, para a indicação não se perder.
      const miudo = qr === "whatsapp" ? `<br><small class="cadastro">${cadastro}</small>` : "";
      html = trocar(html, de, `<p>${chamada}<br>WhatsApp <b>${fone}</b><br><b>firehubfood.com.br</b>${miudo}</p>`);
    }
  }

  const nomeDoArquivo = `${material === "apresentacao" ? "FireHub - Apresentação" : "FireHub - Folder grafica"}${indicador ? ` - ${indicador.nome}` : ""}`;
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${esc(nomeDoArquivo)}</title>`);
  html = trocar(html, "</head>", `<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
.indicado i.preenchido { font-style: normal; font-weight: 800; color: var(--tinta); height: auto; padding-bottom: .4mm; }
small.cadastro { font-size: .78em; font-weight: 600; word-break: break-all; }
@media screen {
  html, body { background: #D6D3D1 !important; }
  body { padding: ${previa ? "8px" : "76px 8px 24px"}; }
  .pg, .folha { zoom: var(--zoom, 1); margin: 0 auto 14px; box-shadow: 0 6px 24px -10px rgba(28,25,23,.45); }
  /* Papel branco sem vencer o fundo próprio da página (a capa escura): especificidade zero. */
  :where(.pg, .folha) { background-color: #fff; }
  .barra-material { position: fixed; top: 0; left: 0; right: 0; z-index: 10; background: #1C1917; color: #fff; display: flex; align-items: center; gap: 10px; padding: 10px 14px; font: 600 14px/1.3 Inter, system-ui, sans-serif; flex-wrap: wrap; }
  .barra-material img { width: 26px; height: 26px; }
  .barra-material span { flex: 1; min-width: 0; color: #D6D3D1; font-size: 12.5px; }
  .barra-material button { background: #E8360C; color: #fff; border: 0; border-radius: 10px; padding: 10px 16px; font: inherit; font-weight: 800; cursor: pointer; }
}
@media print { .barra-material { display: none !important; } }
</style>
</head>`);
  const barra = previa ? "" : `<div class="barra-material"><img src="/materiais/img/firehub-flame.png" alt=""><span>${material === "apresentacao" ? "Apresentação do FireHub" : "Folder para gráfica"}${indicador ? ` · ${esc(indicador.nome)}` : ""}<br>Na janela de impressão, escolha “Salvar como PDF”.</span><button type="button" onclick="window.print()">Baixar PDF</button></div>`;
  html = html.replace(/<body([^>]*)>/, `<body$1>${barra}`);
  html = trocar(html, "</body>", `<script>(function(){
  var L = ${LARGURA_DA_PAGINA[material]};
  function z(){ document.documentElement.style.setProperty("--zoom", String(Math.min(1, (document.documentElement.clientWidth - 16) / L))); }
  z(); addEventListener("resize", z);${imprimir ? `
  addEventListener("load", function(){ (document.fonts ? document.fonts.ready : Promise.resolve()).then(function(){ setTimeout(function(){ window.print(); }, 400); }); });` : ""}
})();</script>
</body>`);
  return html;
}
