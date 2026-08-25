/**
 * src/lib/imagem-enviada.ts
 * Carrega, para mandar à IA, uma imagem que o próprio lojista acabou de enviar
 * pelo /api/upload — a partir da URL que o upload devolveu.
 *
 * ─── Por que ler do disco em vez de fazer fetch(imageUrl) ──────────────────
 * src/lib/storage.ts devolve uma URL RELATIVA ("/uploads/invoices/<arquivo>").
 * O fetch do Node (undici) só aceita URL absoluta, então as rotas de leitura de
 * nota morriam em "Failed to parse URL" antes mesmo de falar com o Gemini: a
 * foto era gravada, o cliente recebia a URL e o scan estourava em seguida.
 * Montar a URL absoluta resolveria o parse, mas faria o servidor abrir uma
 * conexão HTTP consigo mesmo só para ler um arquivo que já está no disco dele.
 *
 * ─── E é aqui que o SSRF morre ─────────────────────────────────────────────
 * A imageUrl chega do cliente e ia direto para o fetch, sem validação alguma.
 * Bastava POSTar { imageUrl: "http://169.254.169.254/latest/meta-data/" } — ou
 * qualquer host interno da rede do container — para o servidor buscar o
 * conteúdo e devolvê-lo, já que a resposta da IA repete o que foi lido. Agora
 * nada sai para a rede: ou o caminho cai dentro de UPLOADS_ROOT, ou a leitura
 * falha. Host de fora e protocolos como file:/data: são recusados antes disso,
 * para que ninguém reintroduza um fetch de fallback achando que é seguro.
 */
import { readFile, stat } from "fs/promises";
import path from "path";
import { LEGACY_PUBLIC_ROOT, UPLOADS_ROOT } from "@/lib/storage";

/** Único prefixo público aceito — é o que saveUploadedFile gera. */
const PREFIXO_PUBLICO = "/uploads/";

/**
 * Mesma tabela da rota que serve os uploads. Extensão desconhecida é recusada:
 * o Gemini precisa de um mimeType real e isso trava a leitura de qualquer coisa
 * que não seja um dos formatos que o upload aceita.
 */
const TIPOS: Record<string, string> = {
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".pdf": "application/pdf",
};

/**
 * O upload já corta em 8 MB, mas o arquivo pode ter vindo de antes desse limite
 * ou de outra origem no volume. Em base64 o conteúdo cresce ~33% e a requisição
 * inline do Gemini tem teto de 20 MB, então 12 MB é o máximo que ainda passa.
 */
const MAX_BYTES = 12 * 1024 * 1024;

/** Base fictícia só para o construtor de URL aceitar caminho relativo. */
const BASE_RELATIVA = "http://relativa.interna";

export type ImagemEnviada =
  | { ok: true; base64: string; mimeType: string; caminho: string }
  | { ok: false; erro: string };

/**
 * Hosts que contam como "o próprio site". NEXTAUTH_URL cobre produção; o header
 * Host cobre o dev em localhost:3001 e o domínio de preview, sem precisar de
 * mais variável de ambiente.
 */
function hostsProprios(req?: Request): Set<string> {
  const hosts = new Set<string>();

  const configurado = (process.env.NEXTAUTH_URL || "").trim();
  if (configurado.startsWith("http")) {
    try {
      hosts.add(new URL(configurado).host.toLowerCase());
    } catch {
      // NEXTAUTH_URL mal formada não pode derrubar a leitura da nota.
    }
  }

  const doPedido = req?.headers.get("host");
  if (doPedido) hosts.add(doPedido.toLowerCase());

  return hosts;
}

/**
 * Resolve o caminho dentro da raiz e recusa qualquer coisa que escape dela.
 * Sem isto, "/uploads/../../.env" viraria leitura de arquivo do servidor.
 */
function resolverDentroDe(raiz: string, relativo: string): string | null {
  const base = path.resolve(raiz);
  const alvo = path.resolve(base, relativo);
  return alvo.startsWith(base + path.sep) ? alvo : null;
}

/**
 * Devolve a imagem em base64 pronta para o inlineData do Gemini.
 * Nunca lança: as rotas precisam responder 400 com a mensagem, não 500.
 */
export async function lerImagemEnviada(imageUrl: unknown, req?: Request): Promise<ImagemEnviada> {
  if (typeof imageUrl !== "string" || !imageUrl.trim()) {
    return { ok: false, erro: "URL da imagem é obrigatória" };
  }

  let url: URL;
  try {
    url = new URL(imageUrl.trim(), BASE_RELATIVA);
  } catch {
    return { ok: false, erro: "Endereço da imagem inválido" };
  }

  // Só o que veio do upload deste site. Absoluta de outro host, file:, data: e
  // protocolo-relativa ("//169.254.169.254/uploads/x.jpg") caem todas aqui.
  const ehRelativa = url.protocol === "http:" && url.host === new URL(BASE_RELATIVA).host;
  if (!ehRelativa) {
    const proprio =
      (url.protocol === "http:" || url.protocol === "https:") &&
      hostsProprios(req).has(url.host.toLowerCase());
    if (!proprio) {
      return { ok: false, erro: "A imagem precisa ser um arquivo enviado por este site" };
    }
  }

  if (!url.pathname.startsWith(PREFIXO_PUBLICO)) {
    return { ok: false, erro: "A imagem precisa ser um arquivo enviado por este site" };
  }

  let relativo: string;
  try {
    relativo = decodeURIComponent(url.pathname.slice(PREFIXO_PUBLICO.length));
  } catch {
    return { ok: false, erro: "Endereço da imagem inválido" };
  }
  // %00 encerra a string em chamadas de sistema antigas e mascararia a extensão.
  if (!relativo || relativo.includes("\0")) {
    return { ok: false, erro: "Endereço da imagem inválido" };
  }

  const mimeType = TIPOS[path.extname(relativo).toLowerCase()];
  if (!mimeType) {
    return { ok: false, erro: "Formato não suportado. Envie JPG, PNG, WEBP, GIF ou PDF." };
  }

  // Raiz nova (volume persistente) primeiro; public/uploads é o legado, para as
  // notas enviadas antes de UPLOADS_DIR existir.
  for (const raiz of [UPLOADS_ROOT, LEGACY_PUBLIC_ROOT]) {
    const caminho = resolverDentroDe(raiz, relativo);
    if (!caminho) continue;

    let tamanho: number;
    try {
      const info = await stat(caminho);
      if (!info.isFile()) continue;
      tamanho = info.size;
    } catch {
      continue;
    }

    if (tamanho > MAX_BYTES) {
      return {
        ok: false,
        erro: `Imagem muito grande (${(tamanho / 1024 / 1024).toFixed(1)} MB). O limite é 12 MB.`,
      };
    }

    const conteudo = await readFile(caminho);
    return { ok: true, base64: conteudo.toString("base64"), mimeType, caminho };
  }

  return { ok: false, erro: "Não foi possível ler a imagem enviada. Tire a foto novamente." };
}
