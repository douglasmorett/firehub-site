/**
 * O cofre dos arquivos fiscais do emissor próprio: o certificado A1 da loja e
 * os XMLs (nota autorizada, nota de contingência, cancelamento, inutilização).
 *
 * ── Por que no disco, e por que cifrado ─────────────────────────────────────
 *
 * Com a Focus, o XML ficava guardado lá. Com o emissor próprio, a guarda é
 * nossa, e a loja é obrigada a guardar o XML por 5 anos (prazo decadencial).
 * No banco ele pesaria em toda consulta que lê o fiscalInfo do pedido; por isso
 * mora no volume do Coolify, o único disco que sobrevive ao deploy.
 *
 * Esse volume está montado em public/uploads (lib/storage.ts), e o Next serve
 * de public/ o que existia quando o servidor subiu. A rota /uploads só entrega
 * imagem e PDF, mas não dá para contar só com isso. Então:
 *   - o conteúdo é CIFRADO (lib/fiscal-credenciais.ts, cifrarBytes, "FHC2" +
 *     o id da chave): quem chegar ao arquivo não lê CPF, endereço nem a chave
 *     privada da loja;
 *   - o nome é OPACO (HMAC da identificação com a subchave de nomes, que não é
 *     a de cifra): a chave de acesso sai impressa no cupom, e ela não pode
 *     levar ao arquivo;
 *   - a extensão ".fh" não é tipo que a rota /uploads entregue.
 *
 * O CAMINHO vai gravado no banco (`ArquivoGuardado.caminho`) e é por ele que
 * se lê: trocar a FISCAL_CHAVE (com a velha em FISCAL_CHAVES_ANTIGAS) não perde
 * arquivo nenhum — o nome muda só para o que for guardado depois da troca, e o
 * conteúdo antigo abre pelo id da chave no cabeçalho.
 *
 * A segunda cópia, fora do servidor, é o pacote mensal do contador
 * (lib/contador-pacote.ts), que já vai por e-mail. O backup do volume no
 * Coolify deve estar ligado — é a primeira cópia. Com o bucket R2 configurado
 * (lib/arquivos-no-bucket.ts), cada arquivo também vai, cifrado, para
 * "fiscal/" no bucket privado: é dali que a outra instância lê.
 *
 * Só servidor.
 */
import { mkdir, readFile, rename, writeFile } from "fs/promises";
import path from "path";
import { createHash, randomBytes } from "crypto";
import { UPLOADS_ROOT } from "@/lib/storage";
import { baixarDoBucket, subirAoBucket } from "@/lib/arquivos-no-bucket";
import { cifrarBytes, decifrarBytes, nomeOpaco } from "@/lib/fiscal-credenciais";

/** Onde fica o cofre. FH_FISCAL_DIR existe para testes e para o dia em que o volume mudar. */
// Os caminhos do cofre são DINÂMICOS (FH_FISCAL_DIR, o volume): sem o
// `turbopackIgnore`, o rastreador do build standalone não sabe o que copiar e
// traz o projeto inteiro para a imagem ("whole project was traced").
export function raizDoCofre(): string {
  return process.env.FH_FISCAL_DIR || path.join(/*turbopackIgnore: true*/ UPLOADS_ROOT, "_fiscal");
}

export type TipoDeArquivoFiscal = "certificado" | "nota" | "contingencia" | "evento" | "inutilizacao";

export type ArquivoGuardado = {
  /** Caminho RELATIVO à raiz do cofre — é o que se grava no banco. */
  caminho: string;
  /** SHA-256 do conteúdo EM CLARO: confere que o que volta é o que foi guardado. */
  sha256: string;
  bytes: number;
  guardadoEm: string;
};

const LOJA_OK = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * Onde o cofre fica no bucket (lib/arquivos-no-bucket.ts): "fiscal/", fora do
 * "uploads/" que a rota /uploads consulta — nenhuma URL pública chega aqui. O
 * bucket inteiro é privado; só o servidor, com a chave, lê.
 */
export const chaveNoBucket = (relativo: string) => `fiscal/${relativo.split(path.sep).join("/")}`;

/**
 * O arquivo cifrado: do disco; se não estiver aqui (gravado pela outra
 * instância), do bucket — e fica no disco para a próxima leitura.
 */
async function lerCifrado(relativo: string): Promise<Buffer> {
  const destino = dentroDoCofre(relativo);
  try {
    return await readFile(destino);
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code !== "ENOENT") throw e;
    const doBucket = await baixarDoBucket(chaveNoBucket(relativo));
    if (!doBucket) throw e;
    try {
      await mkdir(path.dirname(destino), { recursive: true });
      const temporario = `${destino}.${randomBytes(6).toString("hex")}.tmp`;
      await writeFile(temporario, doBucket, { mode: 0o600 });
      await rename(temporario, destino);
    } catch {
      /* sem a cópia no disco, a próxima leitura busca de novo no bucket */
    }
    return doBucket;
  }
}

function dentroDoCofre(relativo: string): string {
  const raiz = path.resolve(/*turbopackIgnore: true*/ raizDoCofre());
  const alvo = path.resolve(/*turbopackIgnore: true*/ raiz, relativo);
  if (!alvo.startsWith(raiz + path.sep)) throw new Error("Caminho fora do cofre fiscal.");
  return alvo;
}

/**
 * Guarda um arquivo no cofre. `identificacao` é o que o torna único dentro do
 * tipo: a chave de acesso da nota, "cancelamento:<chave>", "inut:<id>", ou
 * "a1" para o certificado. O mesmo (loja, tipo, identificação) sempre cai no
 * mesmo arquivo — guardar de novo substitui (o certificado renovado, por
 * exemplo). A gravação é atômica: arquivo temporário e depois rename, para uma
 * queda no meio não deixar XML pela metade.
 */
export async function guardarArquivoFiscal(p: {
  lojaId: string;
  tipo: TipoDeArquivoFiscal;
  identificacao: string;
  conteudo: Buffer | string;
  /** Pasta do mês (AAAAMM) — facilita o pacote do contador e a limpeza depois de 5 anos. */
  mes?: string;
}): Promise<ArquivoGuardado> {
  if (!LOJA_OK.test(p.lojaId)) throw new Error("Loja inválida para o cofre fiscal.");
  const claro = Buffer.isBuffer(p.conteudo) ? p.conteudo : Buffer.from(p.conteudo, "utf8");
  const mes = p.mes && /^\d{6}$/.test(p.mes) ? p.mes : "geral";
  const relativo = path.posix.join(p.lojaId, p.tipo, mes, `${nomeOpaco(`${p.lojaId}:${p.tipo}:${p.identificacao}`)}.fh`);
  const destino = dentroDoCofre(relativo);
  await mkdir(path.dirname(destino), { recursive: true });
  const temporario = `${destino}.${randomBytes(6).toString("hex")}.tmp`;
  const cifrado = cifrarBytes(claro);
  await writeFile(temporario, cifrado, { mode: 0o600 });
  await rename(temporario, destino);
  // A cópia no bucket, para a outra instância ler (duas instâncias). Já vai
  // cifrada, e falha dela não desfaz a nota: o arquivo está no disco.
  await subirAoBucket(chaveNoBucket(relativo), cifrado, "application/octet-stream");
  return {
    caminho: relativo,
    sha256: createHash("sha256").update(claro).digest("hex"),
    bytes: claro.length,
    guardadoEm: new Date().toISOString(),
  };
}

/** Lê e decifra. Com `sha256`, confere a integridade e recusa arquivo trocado. */
export async function lerArquivoFiscal(caminho: string, sha256?: string | null): Promise<Buffer> {
  const claro = decifrarBytes(await lerCifrado(caminho));
  if (sha256) {
    const conferido = createHash("sha256").update(claro).digest("hex");
    if (conferido !== sha256) throw new Error("Arquivo fiscal não confere com o que foi guardado.");
  }
  return claro;
}

/** Atalho para XML. */
export async function lerXmlFiscal(caminho: string, sha256?: string | null): Promise<string> {
  return (await lerArquivoFiscal(caminho, sha256)).toString("utf8");
}
