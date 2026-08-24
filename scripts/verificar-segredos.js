#!/usr/bin/env node
/**
 * Barra commit que carregue credencial.
 *
 * Existe porque a chave de produção do Asaas ficou meses num repositório
 * público dentro de `scripts/test-asaas.js` — não no código que roda, mas no
 * `|| 'valor'` de fallback, que é justamente onde ninguém repara depois que a
 * variável de ambiente passa a existir.
 *
 * Roda no pre-commit e olha só o que está sendo commitado. Para pular num caso
 * legítimo: `git commit --no-verify`.
 */
const { execSync } = require("child_process");
const fs = require("fs");

const PADROES = [
  { nome: "chave Asaas", re: /\$?aact_(prod|hmlg)_[A-Za-z0-9+/=]{20,}/ },
  { nome: "URL de Postgres com senha", re: /postgres(?:ql)?:\/\/[^\s:"']+:[^\s@"']+@/ },
  { nome: "chave do Google/Gemini", re: /AIza[A-Za-z0-9_-]{30,}/ },
  { nome: "chave do Resend", re: /\bre_[A-Za-z0-9]{20,}/ },
  { nome: "token do Mercado Pago", re: /\b(APP_USR|TEST)-\d{10,}-\d{6}-[a-f0-9]{32}/ },
  { nome: "token do GitHub", re: /\bgh[pousr]_[A-Za-z0-9]{30,}/ },
  { nome: "token do Vercel Blob", re: /vercel_blob_rw_[A-Za-z0-9_]{20,}/ },
  { nome: "chave privada", re: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
];

// Arquivos que existem justamente para falar sobre segredos.
const IGNORAR = [/^scripts\/verificar-segredos\.js$/, /^\.env\.example$/, /\.md$/];

function arquivosDoCommit() {
  const saida = execSync("git diff --cached --name-only --diff-filter=ACM", { encoding: "utf8" });
  return saida.split("\n").map((l) => l.trim()).filter(Boolean);
}

const achados = [];

for (const arquivo of arquivosDoCommit()) {
  if (IGNORAR.some((re) => re.test(arquivo))) continue;

  let conteudo;
  try {
    conteudo = fs.readFileSync(arquivo, "utf8");
  } catch {
    continue; // binário ou removido no meio do caminho
  }

  conteudo.split("\n").forEach((linha, i) => {
    for (const p of PADROES) {
      if (p.re.test(linha)) {
        achados.push({ arquivo, linha: i + 1, tipo: p.nome, trecho: linha.trim().slice(0, 70) });
      }
    }
  });
}

if (achados.length === 0) process.exit(0);

console.error("\n\x1b[31m✖ Commit bloqueado: credencial no código.\x1b[0m\n");
for (const a of achados) {
  console.error(`  ${a.arquivo}:${a.linha} — ${a.tipo}`);
  console.error(`    ${a.trecho}…\n`);
}
console.error("Mova o valor para o .env e leia com process.env.\n");
console.error("Se for falso positivo: git commit --no-verify\n");
process.exit(1);
