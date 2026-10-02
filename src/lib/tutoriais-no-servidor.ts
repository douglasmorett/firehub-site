/**
 * Os arquivos dos tutoriais no disco do servidor — só roda no servidor.
 *
 * O botão de uma tela só aparece quando o vídeo DAQUELA tela já está no disco
 * (o layout do painel passa a lista para o navegador). Assim o deploy do código
 * e a chegada dos vídeos não precisam acontecer juntos: o código vai antes, sem
 * botão nenhum, e cada vídeo aparece sozinho assim que é enviado.
 *
 * Cada versão mora na própria pasta (`tutoriais/<id>/<versao>/video.mp4`): o
 * arquivo pode ser cacheado para sempre, e regravar um vídeo nunca mostra o
 * velho do cache — a versão nova tem outro endereço.
 */
import fs from "fs";
import path from "path";
import fichas from "./tutoriais-fichas.json";
import { BASE_DOS_TUTORIAIS, ARQUIVOS_DO_TUTORIAL } from "./tutoriais";
import { UPLOADS_ROOT } from "./storage";

type Ficha = { id: string; versao: string };
const FICHAS = fichas as Record<string, Ficha>;

/**
 * A pasta que serve BASE_DOS_TUTORIAIS: o volume de uploads em produção, a
 * pasta public na gravação local (`/tutoriais`). Endereço externo (ex.: um
 * armazenamento na nuvem): null — não há como olhar, todos contam como enviados.
 */
export function pastaDosTutoriais(): string | null {
  if (BASE_DOS_TUTORIAIS === "/uploads/tutoriais") return path.join(/*turbopackIgnore: true*/ UPLOADS_ROOT, "tutoriais");
  if (BASE_DOS_TUTORIAIS.startsWith("/")) return path.join(/*turbopackIgnore: true*/ process.cwd(), "public", BASE_DOS_TUTORIAIS);
  return null;
}

/**
 * Onde gravar um arquivo de tutorial. Só aceita a versão ATUAL de um tutorial
 * que existe e os três arquivos dele — nunca um caminho escolhido por quem envia.
 */
export function caminhoDoArquivoDoTutorial(id: string, versao: string, arquivo: string): string | null {
  const pasta = pastaDosTutoriais();
  const ficha = FICHAS[id];
  if (!pasta || !ficha || ficha.versao !== versao) return null;
  if (!(ARQUIVOS_DO_TUTORIAL as readonly string[]).includes(arquivo)) return null;
  return path.join(/*turbopackIgnore: true*/ pasta, id, versao, arquivo);
}

let lembrado: { em: number; ids: string[] | null } | null = null;

/** Os tutoriais com os três arquivos da versão atual no disco. null = não dá para saber (todos valem). */
export function tutoriaisEnviados(): string[] | null {
  if (lembrado && Date.now() - lembrado.em < 30_000) return lembrado.ids;
  const pasta = pastaDosTutoriais();
  let ids: string[] | null = null;
  if (pasta) {
    ids = Object.values(FICHAS)
      .filter((f) => ARQUIVOS_DO_TUTORIAL.every((a) => fs.existsSync(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ pasta, f.id, f.versao, a))))
      .map((f) => f.id);
  }
  lembrado = { em: Date.now(), ids };
  return ids;
}

/** Depois de um envio, a lista é refeita na hora (sem esperar os 30 s). */
export function esquecerTutoriaisEnviados() {
  lembrado = null;
}
