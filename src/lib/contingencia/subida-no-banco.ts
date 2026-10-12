/**
 * A SUBIDA na nuvem: aplica o que a loja fez durante a queda, em ordem, com
 * as regras de lib/contingencia/mescla.ts. Idempotente: a nuvem guarda até
 * que número da saída já aplicou (por banco do computador — se a cópia for
 * recriada, a numeração recomeça e a conta também).
 *
 * Cada linha passa por duas conferências antes de qualquer gravação:
 *   - a linha é da loja dona da chave (a de agora E a que está na nuvem) —
 *     um computador nunca mexe em linha de outra loja;
 *   - a tabela está na cópia (lib/contingencia/catalogo.ts). O que a loja
 *     gravou fora dela é recusado e aparece no episódio.
 */
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { colunasQueNaoDescem, tabelaDaCopia, type TabelaDaCopia } from "./catalogo";
import { decidir, type LinhaDaSaida } from "./mescla";
import { colunasDaTabela } from "./servidor";

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

const q = (nome: string) => `"${nome.replace(/"/g, '""')}"`;

async function lojaDaLinha(tx: Tx, t: TabelaDaCopia, linha: Record<string, unknown>): Promise<string[]> {
  const l = t.loja;
  if (l.tipo === "coluna") return [linha[l.coluna], l.tambem ? linha[l.tambem] : null].filter((x): x is string => typeof x === "string");
  if (l.tipo === "usuario") return [String(linha.ownerId || linha.id || "")].filter(Boolean);
  if (l.tipo === "pai") {
    const r = await tx.$queryRawUnsafe<{ loja: string | null }[]>(
      `SELECT p.${q(l.lojaDoPai)} AS loja FROM ${q(l.tabela)} p WHERE p.id = $1`,
      String(linha[l.coluna] ?? ""),
    );
    return r[0]?.loja ? [r[0].loja] : [];
  }
  const r = await tx.$queryRawUnsafe<{ loja: string | null }[]>(
    `SELECT a.${q(l.lojaDoAvo)} AS loja FROM ${q(l.tabela)} p JOIN ${q(l.tabelaDoAvo)} a ON a.id = p.${q(l.colunaDoPai)} WHERE p.id = $1`,
    String(linha[l.coluna] ?? ""),
  );
  return r[0]?.loja ? [r[0].loja] : [];
}

function ondeEstaAChave(t: TabelaDaCopia, linha: Record<string, unknown>): { sql: string; valores: unknown[] } {
  return {
    sql: t.chave.map((c, i) => `t.${q(c)} = $${i + 1}`).join(" AND "),
    valores: t.chave.map((c) => linha[c]),
  };
}

async function linhaNaNuvem(tx: Tx, t: TabelaDaCopia, linha: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const onde = ondeEstaAChave(t, linha);
  const r = await tx.$queryRawUnsafe<{ linha: Record<string, unknown> }[]>(
    `SELECT to_jsonb(t) AS linha FROM ${q(t.nome)} t WHERE ${onde.sql} FOR UPDATE`,
    ...onde.valores,
  );
  return r[0]?.linha ?? null;
}

export type ResultadoDaSubida = { aplicadoAte: string; aplicadas: number; conflitos: number; recusadas: { tabela: string; motivo: string }[] };

export async function aplicarSubida(
  lojaId: string,
  banco: string,
  lote: LinhaDaSaida[],
  episodio: { inicio: string; fim: string | null } | null,
  final: boolean,
): Promise<ResultadoDaSubida> {
  return prisma.$transaction(
    async (tx) => {
      const estado = await tx.$queryRawUnsafe<{ ultimaSubida: string; subidaBanco: string | null }[]>(
        `SELECT "ultimaSubida"::text AS "ultimaSubida", "subidaBanco" FROM "Contingencia" WHERE "lojaId" = $1 FOR UPDATE`,
        lojaId,
      );
      if (!estado[0]) throw new Error("Contingência desativada.");
      let ultima = estado[0].subidaBanco === banco ? BigInt(estado[0].ultimaSubida || "0") : BigInt(0);

      let aplicadas = 0;
      let conflitos = 0;
      let pedidos = 0;
      const recusadas: ResultadoDaSubida["recusadas"] = [];
      const episodioId = episodio ? `${lojaId}:${episodio.inicio}` : null;

      for (const s of [...lote].sort((a, b) => (BigInt(a.seq) < BigInt(b.seq) ? -1 : 1))) {
        const seq = BigInt(s.seq);
        if (seq <= ultima) continue; // já aplicada numa tentativa anterior
        ultima = seq;
        const t = tabelaDaCopia(s.tabela);
        const linha = (s.depois || s.antes || {}) as Record<string, unknown>;

        // Cadastro do cliente é global (telefone único): a loja só cria o novo.
        if (t?.nome === "StoreCustomer") {
          if (s.operacao === "INSERT" && s.depois) {
            const colunas = (await colunasDaTabela(t.nome)).filter((c) => c in s.depois! && !colunasQueNaoDescem(t, [c]).length);
            await tx.$executeRawUnsafe(
              `INSERT INTO ${q(t.nome)} (${colunas.map(q).join(", ")}) SELECT ${colunas.map(q).join(", ")} FROM jsonb_populate_record(NULL::${q(t.nome)}, $1::jsonb) ON CONFLICT DO NOTHING`,
              JSON.stringify(s.depois),
            );
            aplicadas++;
          }
          continue;
        }
        if (!t || t.soPorFoto) {
          recusadas.push({ tabela: s.tabela, motivo: "tabela fora da cópia" });
          continue;
        }
        const lojasDaLinha = await lojaDaLinha(tx, t, linha);
        if (!lojasDaLinha.includes(lojaId)) {
          recusadas.push({ tabela: s.tabela, motivo: "linha de outra loja" });
          continue;
        }
        const naNuvem = await linhaNaNuvem(tx, t, linha);
        if (naNuvem && !(await lojaDaLinha(tx, t, naNuvem)).includes(lojaId)) {
          recusadas.push({ tabela: s.tabela, motivo: "a linha da nuvem é de outra loja" });
          continue;
        }
        const colunasNaNuvem = await colunasDaTabela(t.nome);
        const proibidas = new Set(colunasQueNaoDescem(t, colunasNaNuvem));
        const decisao = decidir(t, s, naNuvem, proibidas);

        if (decisao.tipo === "recusar") {
          recusadas.push({ tabela: s.tabela, motivo: decisao.motivo });
          continue;
        }
        if (decisao.tipo === "nada") continue;

        const existentes = new Set(colunasNaNuvem);
        if (decisao.tipo === "inserir") {
          const colunas = Object.keys(decisao.linha).filter((c) => existentes.has(c));
          await tx.$executeRawUnsafe(
            `INSERT INTO ${q(t.nome)} (${colunas.map(q).join(", ")})
             SELECT ${colunas.map(q).join(", ")} FROM jsonb_populate_record(NULL::${q(t.nome)}, $1::jsonb)`,
            JSON.stringify(decisao.linha),
          );
          if (t.nome === "CustomerOrder" && s.operacao === "INSERT") pedidos++;
        } else if (decisao.tipo === "atualizar") {
          const colunas = Object.keys(decisao.mudar).filter((c) => existentes.has(c));
          if (colunas.length) {
            const onde = ondeEstaAChave(t, linha);
            const deslocado = onde.sql.replace(/\$(\d+)/g, (_m, n) => `$${Number(n) + 1}`);
            await tx.$executeRawUnsafe(
              `UPDATE ${q(t.nome)} t SET (${colunas.map(q).join(", ")}) =
                 (SELECT ${colunas.map(q).join(", ")} FROM jsonb_populate_record(NULL::${q(t.nome)}, $1::jsonb))
               WHERE ${deslocado}`,
              JSON.stringify(decisao.mudar),
              ...onde.valores,
            );
          }
        } else if (decisao.tipo === "apagar") {
          const onde = ondeEstaAChave(t, linha);
          await tx.$executeRawUnsafe(`DELETE FROM ${q(t.nome)} t WHERE ${onde.sql}`, ...onde.valores);
        }
        aplicadas++;

        for (const c of decisao.conflitos) {
          conflitos++;
          await tx.$executeRawUnsafe(
            `INSERT INTO "ContingenciaConflito" ("id", "lojaId", "episodioId", "tabela", "registro", "coluna", "valorDaLoja", "valorDaNuvem", "decisao")
             VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9)`,
            crypto.randomUUID(), lojaId, episodioId, s.tabela, s.registro, c.coluna,
            JSON.stringify(c.valorDaLoja ?? null), JSON.stringify(c.valorDaNuvem ?? null), c.decisao,
          );
        }
      }

      await tx.$executeRawUnsafe(
        `UPDATE "Contingencia" SET "ultimaSubida" = $2::bigint, "subidaBanco" = $3 WHERE "lojaId" = $1`,
        lojaId, ultima.toString(), banco,
      );

      if (episodioId && episodio) {
        await tx.$executeRawUnsafe(
          `INSERT INTO "ContingenciaEpisodio" ("id", "lojaId", "inicio", "fim", "subiuEm", "linhas", "pedidos", "conflitos", "resumo")
           VALUES ($1, $2, $3::timestamp, $4::timestamp, now(), $5, $6, $7, $8::jsonb)
           ON CONFLICT ("id") DO UPDATE SET "fim" = COALESCE(EXCLUDED."fim", "ContingenciaEpisodio"."fim"), "subiuEm" = now(),
             "linhas" = "ContingenciaEpisodio"."linhas" + EXCLUDED."linhas",
             "pedidos" = "ContingenciaEpisodio"."pedidos" + EXCLUDED."pedidos",
             "conflitos" = "ContingenciaEpisodio"."conflitos" + EXCLUDED."conflitos",
             "resumo" = jsonb_build_object('recusadas', COALESCE("ContingenciaEpisodio"."resumo"->'recusadas', '[]'::jsonb) || EXCLUDED."resumo"->'recusadas', 'terminou', $9::boolean)`,
          episodioId, lojaId, episodio.inicio, episodio.fim, aplicadas, pedidos, conflitos,
          JSON.stringify({ recusadas: recusadas.slice(0, 50) }), final,
        );
      }

      return { aplicadoAte: ultima.toString(), aplicadas, conflitos, recusadas };
    },
    { timeout: 120_000, maxWait: 15_000 },
  );
}
