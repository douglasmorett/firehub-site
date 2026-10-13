/**
 * Assina o PACOTE do Modo Contingência no build (Dockerfile, etapa final).
 *
 *   node scripts/contingencia/assinar-pacote.mjs /app
 *
 * Lista os arquivos do FireHub que vão para o computador da loja (server.js,
 * .next, node_modules, public, o supervisor), com o sha256 de cada um, e
 * assina a lista com a chave privada Ed25519 que só existe no segredo do
 * GitHub (CONTINGENCIA_CHAVE_PRIVADA, montado pelo BuildKit em
 * /run/secrets/contingencia_chave). O Assistente da loja confere a assinatura
 * com a chave pública embutida nele antes de baixar qualquer arquivo — nem
 * quem tomasse o nosso servidor conseguiria mandar código para as lojas.
 *
 * Sem a chave (build local, build do Coolify), a lista sai SEM assinatura e
 * nenhum Assistente aceita: a contingência simplesmente não se instala.
 *
 * Gera <raiz>/contingencia/pacote.json (a lista, exatamente os bytes
 * assinados) e <raiz>/contingencia/pacote.assinatura (base64).
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const raiz = path.resolve(process.argv[2] || "/app");
const pastaDeSaida = path.join(raiz, "contingencia");
const arquivoDaChave = process.env.CONTINGENCIA_CHAVE_PRIVADA_ARQUIVO || "/run/secrets/contingencia_chave";

/** O que não entra no pacote (caminho relativo, com "/"). */
export function ficaDeFora(rel) {
  if (rel.startsWith(".next/cache/") || /(^|\/)\.cache\//.test(rel)) return true;
  if (rel.startsWith("public/downloads/") || rel.startsWith("public/uploads/")) return true;
  if (rel.startsWith("uploads/") || rel.startsWith("scripts/") || rel.startsWith("prisma/")) return true;
  if (rel.startsWith(".git/")) return true;
  if (rel === "contingencia/pacote.json" || rel === "contingencia/pacote.assinatura") return true;
  // Ambiente nunca vai para a loja, nem se um dia algum .env entrar na imagem.
  if (/(^|\/)\.env(\.[^/]*)?$/.test(rel) || /(^|\/)\.npmrc$/.test(rel)) return true;
  // O motor de migração do Prisma não roda na loja; .tmpNNN são restos de
  // `prisma generate` com a DLL presa (só acontece no Windows).
  if (/(^|\/)schema-engine-/.test(rel) || /\.tmp\d+$/.test(rel)) return true;
  // Binário nativo de outro sistema: o Windows não carrega.
  if (/\.(node|so(\.\d+)*)$/.test(rel) && /(linux|musl|darwin|debian|rhel|openssl-1)/i.test(rel)) return true;
  if (/libquery_engine-(?!windows)/.test(rel)) return true;
  return false;
}

const raizReal = fs.realpathSync(raiz);

/**
 * Link entra pelo CONTEÚDO, se o alvo é do próprio pacote: o Turbopack põe em
 * .next/node_modules os pacotes externos com nome de hash
 * (@prisma/client-<hash>, sharp-<hash>) como link para node_modules, e sem
 * eles o FireHub da loja não abre o banco. O Assistente monta tudo como
 * arquivo comum (no Windows, link pede administrador); o conteúdo repetido não
 * custa download, porque os arquivos vão por hash.
 */
function listar(dir, saida, acima = new Set()) {
  for (const nome of fs.readdirSync(dir)) {
    const cheio = path.join(dir, nome);
    const rel = path.relative(raiz, cheio).split(path.sep).join("/");
    let st;
    try {
      st = fs.lstatSync(cheio);
      if (st.isSymbolicLink()) {
        const alvo = fs.realpathSync(cheio);
        if (!alvo.startsWith(raizReal + path.sep)) {
          console.warn(`[Contingência] Link para fora do pacote, ignorado: ${rel}`);
          continue;
        }
        st = fs.statSync(cheio);
      }
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      const real = fs.realpathSync(cheio);
      if (acima.has(real) || ficaDeFora(`${rel}/`)) continue; // `acima`: link em ciclo
      listar(cheio, saida, new Set([...acima, real]));
    } else if (st.isFile() && !ficaDeFora(rel) && st.size < 80 * 1024 * 1024) {
      saida.push(rel);
    }
  }
}

function principal() {
  let versao = "sem-build";
  try {
    versao = fs.readFileSync(path.join(raiz, ".next", "BUILD_ID"), "utf8").trim();
  } catch {
    /* fora de um build do Next */
  }
  const caminhos = [];
  listar(raiz, caminhos);
  caminhos.sort();
  const arquivos = [];
  let total = 0;
  for (const rel of caminhos) {
    const dados = fs.readFileSync(path.join(raiz, rel));
    arquivos.push({ caminho: rel, hash: crypto.createHash("sha256").update(dados).digest("hex"), tamanho: dados.length });
    total += dados.length;
  }
  const conteudo = JSON.stringify({ versao, criadoEm: new Date().toISOString(), total, arquivos });
  fs.mkdirSync(pastaDeSaida, { recursive: true });
  fs.writeFileSync(path.join(pastaDeSaida, "pacote.json"), conteudo);

  let chave = "";
  try {
    chave = fs.readFileSync(arquivoDaChave, "utf8").trim();
  } catch {
    /* sem segredo */
  }
  if (!chave) {
    fs.rmSync(path.join(pastaDeSaida, "pacote.assinatura"), { force: true });
    console.warn(`[Contingência] Pacote ${versao} SEM assinatura (${arquivos.length} arquivos): nenhum Assistente vai aceitar.`);
    return;
  }
  const assinatura = crypto.sign(null, Buffer.from(conteudo, "utf8"), crypto.createPrivateKey(chave)).toString("base64");
  fs.writeFileSync(path.join(pastaDeSaida, "pacote.assinatura"), assinatura);
  console.log(`[Contingência] Pacote ${versao} assinado: ${arquivos.length} arquivos, ${(total / 1024 / 1024).toFixed(1)} MB.`);
}

principal();
