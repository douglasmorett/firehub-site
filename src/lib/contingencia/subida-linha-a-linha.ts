/**
 * A SUBIDA na nuvem, linha por linha: aplica o que a loja fez durante a queda,
 * em ordem, com as regras de lib/contingencia/mescla.ts. Idempotente: a nuvem
 * guarda até que número da saída já aplicou (por banco do computador — se a
 * cópia for recriada, a numeração recomeça e a conta também).
 *
 * Cada linha passa por duas conferências antes de qualquer gravação:
 *   - a linha é da loja dona da chave (a de agora E a que está na nuvem) —
 *     um computador nunca mexe em linha de outra loja;
 *   - a tabela está na cópia (lib/contingencia/catalogo.ts). O que a loja
 *     gravou fora dela é recusado e aparece no episódio.
 *
 * ── UMA LINHA RUIM NÃO TRAVA A VOLTA ────────────────────────────────────────
 * Era tudo-ou-nada: o lote inteiro numa transação, e uma linha que o banco da
 * nuvem recusava (o pedido apontando para a rota que nunca subiu, achado
 * volta-1) desfazia tudo. A rota respondia 500, o computador tentava de novo a
 * cada 3 s e a loja ficava presa na cópia congelada. Agora cada linha roda num
 * SAVEPOINT dentro da mesma transação:
 *   - deu certo: segue;
 *   - chave estrangeira numa coluna anulável que a tabela declara
 *     (`paiQuePodeFaltar`): tenta de novo com a coluna vazia e anota o
 *     conflito — o pedido sobe sem a rota, mas sobe;
 *   - qualquer outro erro: desfaz só essa linha, que vai para as recusadas e
 *     vira um ContingenciaConflito "recusada" com o erro, para o dono ver o
 *     que não subiu. O cursor anda e as outras seguem.
 *
 * Sem Prisma aqui (subida-no-banco.ts abre a transação e passa o `banco`): o
 * teste roda o mesmo laço num Postgres em memória (scripts/teste-contingencia.ts).
 */
import crypto from "node:crypto";
import { colunasQueNaoDescem, tabelaDaCopia, type TabelaDaCopia } from "./catalogo";
import { comColunaVazia, decidir, oQueFazerComOErro, type LinhaDaSaida } from "./mescla";

/** O que a subida precisa do banco, dentro de UMA transação já aberta. */
export type BancoDaSubida = {
  consultar<T = Record<string, unknown>>(sql: string, ...valores: unknown[]): Promise<T[]>;
  executar(sql: string, ...valores: unknown[]): Promise<unknown>;
  /** As colunas da tabela na nuvem (pode vir de um cache). */
  colunas(tabela: string): Promise<string[]>;
};

const q = (nome: string) => `"${nome.replace(/"/g, '""')}"`;

async function lojaDaLinha(db: BancoDaSubida, t: TabelaDaCopia, linha: Record<string, unknown>): Promise<string[]> {
  const l = t.loja;
  if (l.tipo === "coluna") return [linha[l.coluna], l.tambem ? linha[l.tambem] : null].filter((x): x is string => typeof x === "string");
  if (l.tipo === "usuario") return [String(linha.ownerId || linha.id || "")].filter(Boolean);
  if (l.tipo === "pai") {
    const r = await db.consultar<{ loja: string | null }>(
      `SELECT p.${q(l.lojaDoPai)} AS loja FROM ${q(l.tabela)} p WHERE p.id = $1`,
      String(linha[l.coluna] ?? ""),
    );
    return r[0]?.loja ? [r[0].loja] : [];
  }
  const r = await db.consultar<{ loja: string | null }>(
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

async function linhaNaNuvem(db: BancoDaSubida, t: TabelaDaCopia, linha: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const onde = ondeEstaAChave(t, linha);
  const r = await db.consultar<{ linha: Record<string, unknown> }>(
    `SELECT to_jsonb(t) AS linha FROM ${q(t.nome)} t WHERE ${onde.sql} FOR UPDATE`,
    ...onde.valores,
  );
  return r[0]?.linha ?? null;
}

type ConflitoAGravar = { coluna: string | null; valorDaLoja: unknown; valorDaNuvem: unknown; decisao: string };

async function gravarConflito(
  db: BancoDaSubida,
  lojaId: string,
  episodioId: string | null,
  s: LinhaDaSaida,
  c: ConflitoAGravar,
): Promise<void> {
  await db.executar(
    `INSERT INTO "ContingenciaConflito" ("id", "lojaId", "episodioId", "tabela", "registro", "coluna", "valorDaLoja", "valorDaNuvem", "decisao")
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9)`,
    crypto.randomUUID(), lojaId, episodioId, s.tabela, s.registro, c.coluna,
    JSON.stringify(c.valorDaLoja ?? null), JSON.stringify(c.valorDaNuvem ?? null), c.decisao,
  );
}

/**
 * Pedido da queda com o MESMO número de outro pedido da loja no mesmo período
 * (achado numero-1): a nuvem seguiu numerando o iFood e o site enquanto o PC
 * numerava o balcão. Não renumera — o número já saiu impresso na comanda —, só
 * anota para o painel mostrar. "Mesmo período" = até 12 h de distância e sem
 * fechamento de caixa entre os dois (o caixa é quem zera a contagem,
 * lib/order-number.ts).
 */
async function outroPedidoComOMesmoNumero(
  db: BancoDaSubida,
  lojaId: string,
  pedido: Record<string, unknown>,
): Promise<{ id: string; dailyOrderNumber: number } | null> {
  const numero = pedido.dailyOrderNumber;
  const criado = pedido.createdAt;
  if (typeof numero !== "number" || typeof criado !== "string" || typeof pedido.id !== "string") return null;
  // Num SAVEPOINT próprio: a conferência é um aviso, e um erro nela não pode
  // fazer o pedido (que já entrou) ser recusado.
  await db.executar(`SAVEPOINT "numero_do_pedido"`);
  try {
    const r = await consultarNumeroRepetido(db, lojaId, numero, pedido.id, criado);
    await db.executar(`RELEASE SAVEPOINT "numero_do_pedido"`);
    return r;
  } catch {
    await db.executar(`ROLLBACK TO SAVEPOINT "numero_do_pedido"`);
    return null;
  }
}

async function consultarNumeroRepetido(
  db: BancoDaSubida,
  lojaId: string,
  numero: number,
  id: string,
  criado: string,
): Promise<{ id: string; dailyOrderNumber: number } | null> {
  const r = await db.consultar<{ id: string; dailyOrderNumber: number }>(
    `SELECT o.id, o."dailyOrderNumber" FROM "CustomerOrder" o
      WHERE o."franchiseeId" = $1 AND o."dailyOrderNumber" = $2 AND o.id <> $3
        AND o."createdAt" BETWEEN $4::timestamp - interval '12 hours' AND $4::timestamp + interval '12 hours'
        AND NOT EXISTS (
          SELECT 1 FROM "CashSession" c
           WHERE c."franchiseeId" = $1 AND c."closedAt" IS NOT NULL
             AND c."closedAt" BETWEEN LEAST(o."createdAt", $4::timestamp) AND GREATEST(o."createdAt", $4::timestamp))
      LIMIT 1`,
    lojaId, numero, id, criado,
  );
  return r[0] ?? null;
}

type ResultadoDaLinha =
  | { tipo: "aplicada"; pedido: boolean; conflitos: number }
  | { tipo: "pulada" }
  | { tipo: "recusada"; motivo: string };

/** Uma linha da saída. Lança no erro de SQL: quem chama desfaz o SAVEPOINT. */
async function aplicarLinha(
  db: BancoDaSubida,
  lojaId: string,
  episodioId: string | null,
  s: LinhaDaSaida,
  anuladas: ConflitoAGravar[],
): Promise<ResultadoDaLinha> {
  const t = tabelaDaCopia(s.tabela);
  const linha = (s.depois || s.antes || {}) as Record<string, unknown>;

  // Cadastro do cliente é global (telefone único): a loja só cria o novo.
  if (t?.nome === "StoreCustomer") {
    if (s.operacao === "INSERT" && s.depois) {
      const colunas = (await db.colunas(t.nome)).filter((c) => c in s.depois! && !colunasQueNaoDescem(t, [c]).length);
      await db.executar(
        `INSERT INTO ${q(t.nome)} (${colunas.map(q).join(", ")}) SELECT ${colunas.map(q).join(", ")} FROM jsonb_populate_record(NULL::${q(t.nome)}, $1::jsonb) ON CONFLICT DO NOTHING`,
        JSON.stringify(s.depois),
      );
      return { tipo: "aplicada", pedido: false, conflitos: 0 };
    }
    return { tipo: "pulada" };
  }
  if (!t || t.soPorFoto) return { tipo: "recusada", motivo: "tabela fora da cópia" };
  const lojasDaLinha = await lojaDaLinha(db, t, linha);
  if (!lojasDaLinha.includes(lojaId)) return { tipo: "recusada", motivo: "linha de outra loja" };
  const naNuvem = await linhaNaNuvem(db, t, linha);
  if (naNuvem && !(await lojaDaLinha(db, t, naNuvem)).includes(lojaId)) {
    return { tipo: "recusada", motivo: "a linha da nuvem é de outra loja" };
  }
  const colunasNaNuvem = await db.colunas(t.nome);
  const proibidas = new Set(colunasQueNaoDescem(t, colunasNaNuvem));
  const decisao = decidir(t, s, naNuvem, proibidas);

  if (decisao.tipo === "recusar") return { tipo: "recusada", motivo: decisao.motivo };
  if (decisao.tipo === "nada") return { tipo: "pulada" };

  const existentes = new Set(colunasNaNuvem);
  const conflitos: ConflitoAGravar[] = [...decisao.conflitos, ...anuladas];
  let pedido = false;
  if (decisao.tipo === "inserir") {
    const colunas = Object.keys(decisao.linha).filter((c) => existentes.has(c));
    await db.executar(
      `INSERT INTO ${q(t.nome)} (${colunas.map(q).join(", ")})
       SELECT ${colunas.map(q).join(", ")} FROM jsonb_populate_record(NULL::${q(t.nome)}, $1::jsonb)`,
      JSON.stringify(decisao.linha),
    );
    if (t.nome === "CustomerOrder" && s.operacao === "INSERT") {
      pedido = true;
      const outro = await outroPedidoComOMesmoNumero(db, lojaId, decisao.linha);
      if (outro) {
        conflitos.push({
          coluna: "dailyOrderNumber",
          valorDaLoja: decisao.linha.dailyOrderNumber,
          valorDaNuvem: { pedido: outro.id, numero: outro.dailyOrderNumber },
          decisao: `número repetido: o #${outro.dailyOrderNumber} da queda tem o mesmo número de outro pedido da nuvem — confira as comandas`,
        });
      }
    }
  } else if (decisao.tipo === "atualizar") {
    const colunas = Object.keys(decisao.mudar).filter((c) => existentes.has(c));
    if (colunas.length) {
      const onde = ondeEstaAChave(t, linha);
      const deslocado = onde.sql.replace(/\$(\d+)/g, (_m, n) => `$${Number(n) + 1}`);
      await db.executar(
        `UPDATE ${q(t.nome)} t SET (${colunas.map(q).join(", ")}) =
           (SELECT ${colunas.map(q).join(", ")} FROM jsonb_populate_record(NULL::${q(t.nome)}, $1::jsonb))
         WHERE ${deslocado}`,
        JSON.stringify(decisao.mudar),
        ...onde.valores,
      );
    }
  } else if (decisao.tipo === "apagar") {
    const onde = ondeEstaAChave(t, linha);
    await db.executar(`DELETE FROM ${q(t.nome)} t WHERE ${onde.sql}`, ...onde.valores);
  }

  for (const c of conflitos) await gravarConflito(db, lojaId, episodioId, s, c);
  return { tipo: "aplicada", pedido, conflitos: conflitos.length };
}

export type ResultadoDaSubida = {
  aplicadoAte: string;
  aplicadas: number;
  conflitos: number;
  recusadas: { tabela: string; registro?: string; motivo: string }[];
};

/** Nome do SAVEPOINT de cada linha (um por vez: liberado ou desfeito antes da próxima). */
const PONTO = `"linha_da_subida"`;

/**
 * O lote inteiro, dentro da transação que `db` representa (o "Contingencia"
 * da loja fica travado até o fim — duas subidas da mesma loja não se cruzam).
 */
export async function aplicarLote(
  db: BancoDaSubida,
  lojaId: string,
  banco: string,
  lote: LinhaDaSaida[],
  episodio: { inicio: string; fim: string | null } | null,
  final: boolean,
): Promise<ResultadoDaSubida> {
  const estado = await db.consultar<{ ultimaSubida: string; subidaBanco: string | null }>(
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

  for (const original of [...lote].sort((a, b) => (BigInt(a.seq) < BigInt(b.seq) ? -1 : BigInt(a.seq) > BigInt(b.seq) ? 1 : 0))) {
    const seq = BigInt(original.seq);
    if (seq <= ultima) continue; // já aplicada numa tentativa anterior
    ultima = seq;
    const t = tabelaDaCopia(original.tabela);

    let s = original;
    const anuladas: ConflitoAGravar[] = [];
    // Uma tentativa por coluna que pode ficar vazia, e a primeira.
    for (let tentativa = 0; tentativa <= (t?.paiQuePodeFaltar?.length ?? 0); tentativa++) {
      await db.executar(`SAVEPOINT ${PONTO}`);
      let r: ResultadoDaLinha;
      try {
        r = await aplicarLinha(db, lojaId, episodioId, s, anuladas);
        await db.executar(`RELEASE SAVEPOINT ${PONTO}`);
      } catch (e) {
        // Se nem o ROLLBACK TO der certo (conexão caiu, transação vencida),
        // isto lança e o lote inteiro volta para a próxima rodada — como antes.
        await db.executar(`ROLLBACK TO SAVEPOINT ${PONTO}`);
        const o = oQueFazerComOErro(t, s, e, anuladas.map((a) => a.coluna!));
        if (o.tipo === "anular") {
          anuladas.push({
            coluna: o.coluna,
            valorDaLoja: s.depois?.[o.coluna] ?? null,
            valorDaNuvem: null,
            decisao: "a linha-pai não está na nuvem: a mudança desta coluna ficou de fora (vazia na linha nova)",
          });
          s = comColunaVazia(s, o.coluna);
          continue;
        }
        r = { tipo: "recusada", motivo: o.motivo };
        recusadas.push({ tabela: original.tabela, registro: original.registro, motivo: o.motivo });
        await gravarConflito(db, lojaId, episodioId, original, {
          coluna: null,
          valorDaLoja: original.depois ?? original.antes,
          valorDaNuvem: { erro: o.motivo },
          decisao: `recusada: ${o.motivo}`,
        });
        conflitos++;
        break;
      }
      if (r.tipo === "aplicada") {
        aplicadas++;
        conflitos += r.conflitos;
        if (r.pedido) pedidos++;
        break;
      }
      if (r.tipo === "recusada") recusadas.push({ tabela: original.tabela, registro: original.registro, motivo: r.motivo });
      // A coluna esvaziada sumiu da mudança (ex.: o UPDATE que só punha a
      // rota que não subiu): a linha não grava nada, mas o painel precisa
      // saber que a mudança da loja ficou de fora.
      for (const a of anuladas) {
        await gravarConflito(db, lojaId, episodioId, original, a);
        conflitos++;
      }
      break;
    }
  }

  await db.executar(
    `UPDATE "Contingencia" SET "ultimaSubida" = $2::bigint, "subidaBanco" = $3 WHERE "lojaId" = $1`,
    lojaId, ultima.toString(), banco,
  );

  if (episodioId && episodio) {
    await db.executar(
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
}
