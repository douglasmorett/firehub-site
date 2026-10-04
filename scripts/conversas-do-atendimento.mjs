/**
 * AS CONVERSAS DO NÚMERO DO FIREHUB, PARA O ROBÔ APRENDER — só leitura.
 *
 *   node scripts/conversas-do-atendimento.mjs                 (últimas 24 h)
 *   node scripts/conversas-do-atendimento.mjs --desde 2026-10-03
 *   node scripts/conversas-do-atendimento.mjs --horas 72 --saida revisao.md
 *
 * Pedido do Douglas (03/10/2026): "de vez em quando eu mandar você analisar as
 * conversas que o robô atendeu e as que eu tive que atender, para deixar o
 * robô cada vez mais inteligente". A rotina inteira está em
 * .claude/skills/revisar-robo-do-firehub/SKILL.md; este script é o primeiro
 * passo dela: põe cada conversa em ordem, no horário de Brasília, e separa o
 * que ensina alguma coisa:
 *
 *   - ✋ o robô barrou a própria resposta (sem fonte) ou chamou a equipe, e o
 *     que a equipe respondeu DEPOIS — é a linha que falta na base;
 *   - 👤 conversa em que só a equipe respondeu — o robô estava pausado (alguém
 *     respondeu antes) ou não sabia;
 *   - 🤖 toda resposta do robô, para conferir se estava CERTA (o revisor só
 *     barra o que não tem fonte; resposta com fonte e errada passa).
 *
 * Lê .env.local e .env como o Next (ENV_DIR aponta a pasta numa worktree).
 * A hora vem como texto ("criadoEm"::text) e é lida como UTC: pelo driver
 * neon a coluna sem fuso chega deslocada.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pasta = process.env.ENV_DIR || process.cwd();
const dotenv = require("dotenv");
dotenv.config({ path: path.join(pasta, ".env.local"), quiet: true });
dotenv.config({ path: path.join(pasta, ".env"), quiet: true });
const { neon } = require("@neondatabase/serverless");

const arg = (nome) => {
  const i = process.argv.indexOf(`--${nome}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

// "--desde 2026-10-03" é meia-noite de Brasília (UTC−3).
const desde = arg("desde")
  ? new Date(`${arg("desde")}${arg("desde").length <= 10 ? "T00:00:00" : ""}-03:00`)
  : new Date(Date.now() - Number(arg("horas") || 24) * 3_600_000);
if (Number.isNaN(desde.getTime())) throw new Error("--desde inválido (use 2026-10-03 ou 2026-10-03T14:00)");

/** O próprio número do FireHub (anotações do Douglas para si mesmo) não é conversa. */
const NUMERO_DO_FIREHUB = "2281118514";

const sql = neon(process.env.DATABASE_URL);
const desdeUtc = desde.toISOString().replace("T", " ").replace("Z", "");

const contatos = await sql`
  SELECT c.id, c.telefone, c.nome, c."nomeDaLoja", c.cidade, c.etapa, c."userId", c.resumo,
         c."aguardandoHumanoDesde"::text AS aguardando
  FROM "CrmContato" c
  WHERE EXISTS (SELECT 1 FROM "CrmMensagem" m WHERE m."contatoId" = c.id AND m."criadoEm" >= ${desdeUtc}::timestamp)
    AND coalesce(c.telefone, '') <> ${NUMERO_DO_FIREHUB}`;

const hora = (texto) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
    .format(new Date(`${String(texto).replace(" ", "T")}Z`));

const linhas = [];
const sai = (t = "") => linhas.push(t);
const total = { conversas: 0, robo: 0, equipe: 0, barrou: 0, chamou: 0, soEquipe: 0 };
const licoes = [];

for (const c of contatos) {
  // A conversa inteira (contexto), marcando o que é da janela pedida.
  const itens = await sql`
    SELECT 'M' AS k, "criadoEm"::text AS t, direcao, autor, "autorNome", texto, status FROM "CrmMensagem" WHERE "contatoId" = ${c.id}
    UNION ALL
    SELECT 'E', "criadoEm"::text, tipo, coalesce("autorTipo", ''), "autorNome", texto, '' FROM "CrmEvento" WHERE "contatoId" = ${c.id}
    ORDER BY t`;
  const naJanela = (i) => new Date(`${i.t.replace(" ", "T")}Z`) >= desde;
  const msgs = itens.filter((i) => i.k === "M" && naJanela(i));
  const doRobo = msgs.filter((i) => i.direcao === "SAIDA" && i.autor === "ROBO").length;
  const daEquipe = msgs.filter((i) => i.direcao === "SAIDA" && i.autor !== "ROBO").length;
  total.conversas++;
  total.robo += doRobo;
  total.equipe += daEquipe;
  if (daEquipe && !doRobo) total.soEquipe++;

  const quem = c.userId ? "LOJISTA" : "lead";
  sai(`\n## ${c.nome || "?"} · ${c.nomeDaLoja || "?"} · ${c.telefone || "?"} · ${quem} · ${c.etapa}${c.aguardando ? " · ⏳ esperando pessoa" : ""}`);
  sai(`robô ${doRobo} · equipe ${daEquipe}${daEquipe && !doRobo ? " · 👤 só a equipe respondeu" : ""}`);
  if (c.resumo) sai(`> resumo: ${c.resumo}`);

  // Contexto: até 6 mensagens antes da janela.
  const primeira = itens.findIndex(naJanela);
  const inicio = Math.max(0, primeira - 6);
  if (inicio > 0) sai(`  … ${inicio} itens antes`);
  for (let n = inicio; n < itens.length; n++) {
    const i = itens[n];
    const antes = !naJanela(i) ? " (antes)" : "";
    const texto = String(i.texto || "").replace(/\n+/g, " ⏎ ");
    if (i.k === "E") {
      const ehLicao = /Revisão|Chamou uma pessoa|Barrado|recusou|Diz ser da loja/.test(i.texto);
      if (/Revisão|Barrado/.test(i.texto) && naJanela(i)) total.barrou++;
      if (/Chamou uma pessoa/.test(i.texto) && naJanela(i)) total.chamou++;
      sai(`  [${hora(i.t)}]${antes} ${ehLicao ? "✋" : "·"} (${i.direcao}) ${texto}`);
      if (ehLicao && naJanela(i) && /Revisão|Chamou uma pessoa|Barrado/.test(i.texto)) {
        // O que a equipe disse depois: candidato a linha nova na base.
        const depois = itens.slice(n + 1).filter((x) => x.k === "M" && x.direcao === "SAIDA" && x.autor !== "ROBO").slice(0, 4);
        licoes.push({ conversa: c.nome || c.telefone, quando: hora(i.t), evento: i.texto, equipe: depois.map((x) => x.texto.replace(/\n+/g, " ⏎ ")) });
      }
      continue;
    }
    const papel = i.direcao === "ENTRADA" ? "💬 contato" : i.autor === "ROBO" ? "🤖 ROBÔ" : `👤 ${i.autorNome || "equipe"}`;
    sai(`  [${hora(i.t)}]${antes} ${papel}${i.status !== "OK" ? ` [${i.status}]` : ""}: ${texto}`);
  }
}

const cabecalho = [
  `# Conversas do número do FireHub desde ${hora(desdeUtc)}`,
  "",
  `${total.conversas} conversas · ${total.robo} respostas do robô · ${total.equipe} da equipe · ${total.soEquipe} só com a equipe · ${total.barrou} barradas/cortadas pela revisão · ${total.chamou} vezes chamou a equipe`,
  "",
  "## ✋ Onde o robô não soube (e o que a equipe respondeu depois)",
  ...(licoes.length
    ? licoes.flatMap((l) => [`- **${l.conversa}** ${l.quando}: ${l.evento}`, ...l.equipe.map((t) => `  - equipe: ${t}`), ...(l.equipe.length ? [] : ["  - (a equipe não respondeu depois)"])])
    : ["- nenhum"]),
  "",
  "# Conversas",
];
const texto = [...cabecalho, ...linhas].join("\n");
if (arg("saida")) {
  fs.writeFileSync(arg("saida"), texto);
  console.log(`Gravado em ${arg("saida")} (${total.conversas} conversas).`);
} else console.log(texto);
