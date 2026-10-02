// Guarda o relatório mensal de um cliente do ACOMPANHAMENTO iFOOD no histórico
// (aba "Acompanhamento iFood" do admin), sem passar pela tela.
//
//   node --env-file=.env scripts/acompanhamento-guardar-relatorio.mjs --listar
//   node --env-file=.env scripts/acompanhamento-guardar-relatorio.mjs \
//     --cliente "Divinos" --mes 2026-10 --arquivo "C:/…/Relatorio outubro.html" \
//     --titulo "Combos com foto puxaram o ticket" --resumo "…" \
//     --numeros '{"totalFaturamento":1234.5,"pedidos":48,"honorario":61.2}' [--enviado|--rascunho]
//
// Um relatório por cliente e mês: rodar de novo o mesmo mês substitui o que veio
// (o arquivo só se vier outro). SQL cru de propósito — funciona com qualquer
// cliente Prisma gerado, mesmo antes do schema novo chegar no checkout.
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { randomBytes } from "node:crypto";

const args = process.argv.slice(2);
const opc = (nome) => {
  const i = args.indexOf(`--${nome}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const tem = (nome) => args.includes(`--${nome}`);

const CAMPOS = ["vendas", "totalFaturamento", "pedidos", "ticketMedio", "visitas", "conversao", "nota", "cancelamentos", "honorario"];
const TIPOS = { ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8", ".pdf": "application/pdf" };

if (!process.env.DATABASE_URL) {
  console.error("Sem DATABASE_URL. Rode com: node --env-file=.env scripts/acompanhamento-guardar-relatorio.mjs …");
  process.exit(1);
}
const prisma = new PrismaClient();

async function main() {
  if (tem("listar")) {
    const linhas = await prisma.$queryRaw`
      SELECT c.id, c.nome, c.status, c."lojaId",
             (SELECT string_agg(r.mes || CASE WHEN r.status = 'ENVIADO' THEN '✓' ELSE '✎' END, ' ' ORDER BY r.mes)
                FROM "AcompanhamentoRelatorio" r WHERE r."clienteId" = c.id) AS relatorios
        FROM "AcompanhamentoIfood" c ORDER BY c.nome`;
    console.table(linhas.map((l) => ({ id: l.id, nome: l.nome, status: l.status, firehub: !!l.lojaId, relatorios: l.relatorios || "—" })));
    return;
  }

  const quem = opc("cliente");
  const mes = opc("mes");
  if (!quem || !/^\d{4}-(0[1-9]|1[0-2])$/.test(mes || "")) {
    console.error('Uso: --cliente "<nome ou id>" --mes AAAA-MM [--arquivo x.html|x.pdf] [--titulo …] [--resumo …] [--numeros \'{…}\'] [--enviado|--rascunho]');
    process.exit(1);
  }

  const achados = await prisma.$queryRaw`
    SELECT id, nome FROM "AcompanhamentoIfood"
     WHERE id = ${quem} OR nome ILIKE ${"%" + quem + "%"}`;
  if (achados.length !== 1) {
    console.error(achados.length ? `Mais de um cliente com "${quem}": ${achados.map((a) => a.nome).join(", ")}. Use o id (--listar).` : `Nenhum cliente com "${quem}". Veja --listar.`);
    process.exit(1);
  }
  const cliente = achados[0];

  let numeros = {};
  if (opc("numeros")) {
    const bruto = JSON.parse(opc("numeros"));
    for (const k of CAMPOS) if (typeof bruto[k] === "number" && Number.isFinite(bruto[k])) numeros[k] = bruto[k];
    const fora = Object.keys(bruto).filter((k) => !CAMPOS.includes(k));
    if (fora.length) console.warn(`Ignorados (não são campos do relatório): ${fora.join(", ")}`);
  }

  let arquivo = null;
  if (opc("arquivo")) {
    const caminho = opc("arquivo");
    const tipo = TIPOS[extname(caminho).toLowerCase()];
    if (!tipo) { console.error("O arquivo tem de ser .html ou .pdf."); process.exit(1); }
    const conteudo = readFileSync(caminho);
    if (conteudo.length > 8 * 1024 * 1024) { console.error("Arquivo acima de 8 MB."); process.exit(1); }
    arquivo = { conteudo, nome: basename(caminho), tipo };
  }

  // Sem --enviado/--rascunho, um relatório que já existe fica na situação em que está.
  const pedido = tem("enviado") ? "ENVIADO" : tem("rascunho") ? "RASCUNHO" : null;
  const titulo = opc("titulo") ?? null;
  const resumo = opc("resumo") ?? null;
  const json = JSON.stringify(numeros);

  const existente = await prisma.$queryRaw`
    SELECT id, status, "enviadoEm" FROM "AcompanhamentoRelatorio" WHERE "clienteId" = ${cliente.id} AND mes = ${mes} LIMIT 1`;

  if (existente.length) {
    const r = existente[0];
    const status = pedido || r.status;
    const enviadoEm = status === "ENVIADO" ? r.enviadoEm || new Date() : null;
    await prisma.$executeRaw`
      UPDATE "AcompanhamentoRelatorio"
         SET titulo = COALESCE(${titulo}, titulo), resumo = COALESCE(${resumo}, resumo),
             numeros = CASE WHEN ${json} = '{}' THEN numeros ELSE ${json}::jsonb END,
             status = ${status}, "enviadoEm" = ${enviadoEm}, "updatedAt" = NOW()
       WHERE id = ${r.id}`;
    if (arquivo) {
      await prisma.$executeRaw`
        UPDATE "AcompanhamentoRelatorio" SET arquivo = ${arquivo.conteudo}, "arquivoNome" = ${arquivo.nome}, "arquivoTipo" = ${arquivo.tipo}
         WHERE id = ${r.id}`;
    }
    console.log(`✓ Relatório de ${mes} de ${cliente.nome} atualizado (${status}).`);
  } else {
    const status = pedido || "RASCUNHO";
    const id = "c" + Date.now().toString(36) + randomBytes(8).toString("hex");
    await prisma.$executeRaw`
      INSERT INTO "AcompanhamentoRelatorio"
        (id, "clienteId", mes, titulo, resumo, numeros, status, "enviadoEm", arquivo, "arquivoNome", "arquivoTipo", "criadoPor", "createdAt", "updatedAt")
      VALUES (${id}, ${cliente.id}, ${mes}, ${titulo}, ${resumo}, ${json}::jsonb, ${status},
              ${status === "ENVIADO" ? new Date() : null}, ${arquivo?.conteudo ?? null}, ${arquivo?.nome ?? null}, ${arquivo?.tipo ?? null},
              'claude-code', NOW(), NOW())`;
    console.log(`✓ Relatório de ${mes} de ${cliente.nome} guardado (${status}).`);
  }
}

main()
  .catch((e) => { console.error(e?.message || e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
