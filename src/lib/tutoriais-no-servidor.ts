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
import { trazerDoBucket, UPLOADS_ROOT } from "./storage";
import { bucketLigado, listarDoBucket } from "./arquivos-no-bucket";

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
 * Os vídeos do FireCheck moram neste mesmo volume (o FireCheck fica na
 * Vercel, que não guarda vídeo): `tutoriais/firecheck-<tela>/<versao>/`. As
 * fichas deles ficam no app do FireCheck (src/tutoriais/fichas.json de lá), então
 * aqui só se confere o FORMATO — o id com o prefixo e a versão de 8 letras
 * hexadecimais que o publicar.mjs de lá gera —, nunca um caminho livre.
 */
const ID_DO_FIRECHECK = /^firecheck-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VERSAO = /^[0-9a-f]{8}$/;
export const ehTutorialDoFirecheck = (id: string, versao: string) => id.length <= 60 && ID_DO_FIRECHECK.test(id) && VERSAO.test(versao);

/**
 * Onde gravar um arquivo de tutorial. Só aceita a versão ATUAL de um tutorial
 * que existe (ou um vídeo do FireCheck, pelo formato) e os três arquivos dele —
 * nunca um caminho escolhido por quem envia.
 */
export function caminhoDoArquivoDoTutorial(id: string, versao: string, arquivo: string): string | null {
  const pasta = pastaDosTutoriais();
  const ficha = FICHAS[id];
  if (!pasta) return null;
  if (!(ficha && ficha.versao === versao) && !ehTutorialDoFirecheck(id, versao)) return null;
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
  if (pasta === path.join(/*turbopackIgnore: true*/ UPLOADS_ROOT, "tutoriais")) puxarDoBucket();
  return ids;
}

// ─── Duas instâncias: o vídeo enviado para a outra ─────────────────────────
//
// O botão só aparece com os arquivos NO DISCO, e o envio (/api/admin/tutoriais)
// grava no disco de uma instância só. A outra lista o bucket (uma chamada a
// cada 10 min, não uma por arquivo que falta) e traz o que é da versão atual
// e ainda não tem; na conta seguinte o botão aparece. Sem bucket, nada muda.
const INTERVALO_DO_BUCKET_MS = 10 * 60_000;
let puxouEm = 0;

function puxarDoBucket() {
  if (!bucketLigado() || Date.now() - puxouEm < INTERVALO_DO_BUCKET_MS) return;
  puxouEm = Date.now();
  const atuais = new Set(Object.values(FICHAS).flatMap((f) => ARQUIVOS_DO_TUTORIAL.map((a) => `tutoriais/${f.id}/${f.versao}/${a}`)));
  void (async () => {
    const noBucket = await listarDoBucket("uploads/tutoriais/");
    let trouxe = 0;
    for (const { chave } of noBucket || []) {
      const relativo = chave.slice("uploads/".length);
      if (!atuais.has(relativo) || fs.existsSync(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ UPLOADS_ROOT, relativo))) continue;
      if (await trazerDoBucket(relativo)) trouxe++;
    }
    if (trouxe) esquecerTutoriaisEnviados();
  })().catch(() => {});
}

/** Depois de um envio, a lista é refeita na hora (sem esperar os 30 s). */
export function esquecerTutoriaisEnviados() {
  lembrado = null;
}
