/**
 * /src/lib/nfce/numeracao.ts
 *
 * O NÚMERO da NFC-e do emissor próprio — sem coluna nova e sem contador.
 *
 * ── Por que não um contador ─────────────────────────────────────────────────
 *
 * Um "próximo número" guardado no fiscalConfig seria reescrito pelo PUT da
 * tela fiscal, que grava o fiscalConfig INTEIRO lido no começo da requisição:
 * um "Salvar" no meio de uma venda devolveria o contador a um valor velho, e a
 * nota seguinte repetiria número — rejeição 539 na hora ou, pior, em
 * contingência (que a SEFAZ só vê depois), dois cupons com o mesmo número na
 * mão de dois clientes.
 *
 * Então o número sai do que já está gravado nos PEDIDOS: o maior número usado
 * ou reservado naquela série e ambiente, lido do fiscalInfo das notas da loja
 * (SQL pelos índices de franchiseeId; a consulta rápida olha só os pedidos
 * dos últimos 32 dias — ver `JANELA_DA_NUMERACAO_MS`), a MARCA DE MAIOR NÚMERO
 * (fiscalConfig.sefaz.maiorNumero, ver `sqlMarcarMaiorNumero`), as faixas
 * inutilizadas e o número inicial da série — e +1. Homologação e produção têm
 * numeração própria: a SEFAZ separa pelo tpAmb, e o teste de homologação não
 * pode empurrar a sequência real.
 *
 * A marca NÃO é o contador que o parágrafo acima recusa: ela só sobe
 * (GREATEST no próprio banco, dentro da trava da reserva) e o número continua
 * saindo do maior entre ela e os pedidos. Um "Salvar" da tela não a devolve a
 * um valor velho (a gravação da tela é compare-and-swap e preserva o bloco
 * `sefaz` — lib/nfce/gravar-config-fiscal); e, se devolvesse, os pedidos da
 * janela ainda seguram o maior recente.
 *
 * ── A trava ─────────────────────────────────────────────────────────────────
 *
 * Duas vendas no mesmo instante leriam o mesmo "maior" e sairiam com o mesmo
 * número. A reserva roda numa transação com pg_advisory_xact_lock(hash de
 * loja+série+ambiente): a segunda espera a primeira GRAVAR a reserva no
 * fiscalInfo do pedido e só então lê o maior — já com o número da primeira. A
 * trava é da transação (solta sozinha no COMMIT/ROLLBACK, nunca fica presa) e
 * cobre só a leitura e a gravação; a conversa com a SEFAZ fica de fora.
 *
 * ── Reuso e o que NÃO se reusa ──────────────────────────────────────────────
 *
 * Nota rejeitada não existe na SEFAZ: o mesmo pedido reusa a própria reserva
 * na próxima tentativa, sem abrir buraco na sequência. Não se reusa o número
 * que a SEFAZ diz já estar usado (539, denegação — vão para
 * `numerosQueimados`), nem o de uma nota que pode ter chegado lá sem resposta
 * (`envioSefaz`, conferido pela chave antes — lib/nfce/emissao-da-loja).
 *
 * ── Emissão em curso ────────────────────────────────────────────────────────
 *
 * A reserva leva `emissaoEmCurso` (a hora): enquanto ela vale (3 minutos — o
 * tempo de uma transmissão com contingência, com folga), outra emissão para o
 * MESMO pedido é recusada. Sem isso, o duplo toque que dispara duas emissões
 * mandaria duas notas com o mesmo número (uma volta 539) — ou, em contingência,
 * dois cupons de números diferentes para a mesma venda. A gravação do
 * resultado (lib/fiscal-automatico → gravarResultado) apaga a marca.
 *
 * ── Os papéis de um número no fiscalInfo ────────────────────────────────────
 *
 *   nota          nfceNumber / serie / ambiente   a nota do pedido, em qualquer situação
 *   anterior      notasAnteriores[].nfceNumber    canceladas que uma reemissão substituiu
 *   reserva       numeroReservado                 reservado para a (próxima) tentativa
 *   envio         envioSefaz                      assinada e enviada; a conferir pela chave
 *   tentado       numeroTentado                   enviado sem resposta; a contingência saiu com outro
 *   contingencia  numeroDeContingencia            a reserva extra da contingência
 *   queimado      numerosQueimados[]              usado na SEFAZ por outra chave / denegado
 *
 * `numerosDoFiscalInfo` é a MESMA leitura em TypeScript (o teste, a inutilização
 * mensal e o banco falso usam); scripts/nfce-conferir-sql-da-numeracao.ts
 * confere, num Postgres de verdade e só lendo, que o SQL e ela concordam.
 *
 * Só servidor.
 */
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type Ambiente = 1 | 2;
export type PapelDoNumero = "nota" | "anterior" | "reserva" | "envio" | "tentado" | "contingencia" | "queimado";

export type NumeroGravado = {
  pedido: string;
  fiscalStatus: string | null;
  papel: PapelDoNumero;
  numero: number;
  serie: number;
  ambiente: Ambiente;
  /** A data do registro (emissão, reserva, envio...), como está gravada. */
  em: string | null;
  /** Reserva: a hora da emissão em curso; tentado: a situação; queimado: o motivo. */
  situacao: string | null;
};

export const NUMERO_MAXIMO = 999_999_999;
/** Quanto vale a marca de emissão em curso (ver o cabeçalho). */
export const PRAZO_DA_EMISSAO_EM_CURSO_MS = 3 * 60_000;

const RE_NUMERO = /^[0-9]{1,9}$/;
const RE_SERIE = /^[0-9]{1,3}$/;
const RE_AMBIENTE = /^[12]$/;

const objeto = (v: unknown): Record<string, any> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, any>) : {});
/** O que o `->>` do Postgres devolve para um valor escalar do JSON (objeto/lista: não é número). */
const comoTexto = (v: unknown): string | null => (v == null || typeof v === "object" ? null : String(v));

/** Uma linha (do SQL ou do JS) vira número gravado — ou nada, se não for número de NFC-e. */
function lerNumero(p: {
  pedido: string;
  fiscalStatus: string | null;
  papel: PapelDoNumero;
  numero: unknown;
  serie: unknown;
  ambiente: unknown;
  em: unknown;
  situacao: unknown;
}): NumeroGravado | null {
  const numero = comoTexto(p.numero);
  const serie = comoTexto(p.serie);
  const ambiente = comoTexto(p.ambiente);
  if (numero == null || serie == null || ambiente == null) return null;
  if (!RE_NUMERO.test(numero) || !RE_SERIE.test(serie) || !RE_AMBIENTE.test(ambiente)) return null;
  const n = Number(numero);
  if (n < 1) return null;
  return {
    pedido: p.pedido,
    fiscalStatus: p.fiscalStatus,
    papel: p.papel,
    numero: n,
    serie: Number(serie),
    ambiente: Number(ambiente) as Ambiente,
    em: comoTexto(p.em),
    situacao: comoTexto(p.situacao),
  };
}

/**
 * Os números que o fiscalInfo de um pedido ocupa — a leitura de referência,
 * igual à do SQL (`sqlDosNumeros`): cada papel lê as mesmas chaves, valor que
 * não é número de 1 a 9 dígitos com série e ambiente válidos não conta.
 */
export function numerosDoFiscalInfo(pedido: { id: string; fiscalStatus?: string | null; fiscalInfo?: unknown }): NumeroGravado[] {
  const j = objeto(pedido.fiscalInfo);
  const fs = pedido.fiscalStatus ?? null;
  const saida: NumeroGravado[] = [];
  const pegar = (papel: PapelDoNumero, bruto: unknown, campoNumero: string, campoEm: string, campoSituacao: string | null) => {
    // No SQL, `->` numa chave de algo que não é objeto dá NULL.
    if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) return;
    const o = bruto as Record<string, unknown>;
    const lido = lerNumero({
      pedido: pedido.id,
      fiscalStatus: fs,
      papel,
      numero: o[campoNumero],
      serie: o.serie,
      ambiente: o.ambiente,
      em: o[campoEm],
      situacao: campoSituacao ? o[campoSituacao] : null,
    });
    if (lido) saida.push(lido);
  };
  pegar("nota", j, "nfceNumber", "emittedAt", null);
  pegar("reserva", j.numeroReservado, "numero", "em", "emissaoEmCurso");
  pegar("envio", j.envioSefaz, "numero", "em", null);
  pegar("tentado", j.numeroTentado, "numero", "desde", "situacao");
  pegar("contingencia", j.numeroDeContingencia, "numero", "em", null);
  for (const a of Array.isArray(j.notasAnteriores) ? j.notasAnteriores : []) pegar("anterior", a, "nfceNumber", "emittedAt", null);
  for (const q of Array.isArray(j.numerosQueimados) ? j.numerosQueimados : []) pegar("queimado", q, "numero", "em", "motivo");
  return saida;
}

// ── O SQL ────────────────────────────────────────────────────────────────────

/**
 * Os números de cada linha de `fonte` (colunas `id`, `fs` = fiscalStatus e `j`
 * = fiscalInfo), um por papel. `fonte` é parâmetro para o script de conferência
 * rodar a MESMA consulta sobre um VALUES, sem tocar em tabela.
 *
 * `->>` em chave de algo que não é objeto dá NULL (não erro), e
 * jsonb_array_elements só recebe lista (CASE com jsonb_typeof).
 */
export function sqlDosNumeros(fonte: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`SELECT f.id AS pedido, f.fs AS "fiscalStatus", x.papel, x.numero, x.serie, x.ambiente, x.em, x.situacao
FROM (${fonte}) f
CROSS JOIN LATERAL (
  SELECT 'nota'::text AS papel, f.j->>'nfceNumber' AS numero, f.j->>'serie' AS serie, f.j->>'ambiente' AS ambiente, f.j->>'emittedAt' AS em, NULL::text AS situacao
  UNION ALL SELECT 'reserva', f.j->'numeroReservado'->>'numero', f.j->'numeroReservado'->>'serie', f.j->'numeroReservado'->>'ambiente', f.j->'numeroReservado'->>'em', f.j->'numeroReservado'->>'emissaoEmCurso'
  UNION ALL SELECT 'envio', f.j->'envioSefaz'->>'numero', f.j->'envioSefaz'->>'serie', f.j->'envioSefaz'->>'ambiente', f.j->'envioSefaz'->>'em', NULL
  UNION ALL SELECT 'tentado', f.j->'numeroTentado'->>'numero', f.j->'numeroTentado'->>'serie', f.j->'numeroTentado'->>'ambiente', f.j->'numeroTentado'->>'desde', f.j->'numeroTentado'->>'situacao'
  UNION ALL SELECT 'contingencia', f.j->'numeroDeContingencia'->>'numero', f.j->'numeroDeContingencia'->>'serie', f.j->'numeroDeContingencia'->>'ambiente', f.j->'numeroDeContingencia'->>'em', NULL
  UNION ALL SELECT 'anterior', a->>'nfceNumber', a->>'serie', a->>'ambiente', a->>'emittedAt', NULL
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(f.j->'notasAnteriores') = 'array' THEN f.j->'notasAnteriores' ELSE '[]'::jsonb END) a
  UNION ALL SELECT 'queimado', q->>'numero', q->>'serie', q->>'ambiente', q->>'em', q->>'motivo'
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(f.j->'numerosQueimados') = 'array' THEN f.j->'numerosQueimados' ELSE '[]'::jsonb END) q
) x
WHERE x.numero IS NOT NULL`;
}

/**
 * Os pedidos da loja que têm fiscalInfo — pelo índice (franchiseeId). Com
 * `desde`, só os criados de lá para cá, pelo índice (franchiseeId, createdAt):
 * a consulta rápida da reserva (ver `JANELA_DA_NUMERACAO_MS`).
 */
export const fonteDaLoja = (lojaId: string, desde?: Date): Prisma.Sql =>
  desde
    ? Prisma.sql`SELECT "id" AS id, "fiscalStatus" AS fs, "fiscalInfo" AS j FROM "CustomerOrder" WHERE "franchiseeId" = ${lojaId} AND "createdAt" >= ${desde} AND "fiscalInfo" IS NOT NULL`
    : Prisma.sql`SELECT "id" AS id, "fiscalStatus" AS fs, "fiscalInfo" AS j FROM "CustomerOrder" WHERE "franchiseeId" = ${lojaId} AND "fiscalInfo" IS NOT NULL`;

/**
 * A consulta rápida da reserva olha só os pedidos CRIADOS nos últimos 32 dias.
 *
 * ── Por que basta ───────────────────────────────────────────────────────────
 *
 * A varredura de todos os pedidos da loja custa ~200 ms a cada 20 mil notas
 * (medido num Postgres de verdade em 30/09/2026 — scripts/nfce-conferir-sql-da-numeracao.ts),
 * e é feita DENTRO da trava: com anos de nota, cada venda esperaria a leitura
 * do histórico inteiro. A janela sozinha NÃO basta: a janela é pela data do
 * PEDIDO, e o número mais alto pode estar num pedido que sai dela — a nota
 * de uma venda de 31 dias emitida agora pela tela, que no dia seguinte já
 * está fora (reproduzido em 30/09/2026: a venda seguinte repetia o número,
 * impresso num cupom de contingência). Por isso a reserva lê também a MARCA
 * DE MAIOR NÚMERO (`sqlMarcarMaiorNumero`), gravada a cada número reservado:
 * o próximo é o maior entre a janela e a marca, + 1. Janela vazia (loja que
 * não emite há um mês, série nova, volta a um ambiente) → a varredura
 * completa, como antes. A inutilização mensal e a conferência de faixa
 * continuam lendo tudo.
 */
export const JANELA_DA_NUMERACAO_MS = 32 * 24 * 60 * 60_000;

/**
 * O corpo do "maior número" de uma série/ambiente. As conversões ficam dentro
 * de CASE: o Postgres não garante a ordem de um AND, e um `serie::int`
 * avaliado antes da regex derrubaria a consulta num valor torto.
 */
function maiorNumeroDe(fonte: Prisma.Sql, serie: number, ambiente: Ambiente): Prisma.Sql {
  return Prisma.sql`SELECT MAX(CASE WHEN n.numero ~ '^[0-9]{1,9}$' THEN n.numero::bigint END) AS maior
FROM (${sqlDosNumeros(fonte)}) n
WHERE (CASE WHEN n.serie ~ '^[0-9]{1,3}$' THEN n.serie::int END) = ${serie}::int
  AND (CASE WHEN n.ambiente ~ '^[12]$' THEN n.ambiente::int END) = ${ambiente}::int`;
}

/** O maior número usado ou reservado de uma série/ambiente, em TODOS os pedidos da loja. */
export function sqlDoMaiorNumero(lojaId: string, serie: number, ambiente: Ambiente, fonte: Prisma.Sql = fonteDaLoja(lojaId)): Prisma.Sql {
  return Prisma.sql`/* fh:maior-numero */ ${maiorNumeroDe(fonte, serie, ambiente)}`;
}

/** O mesmo, só nos pedidos criados desde `desde` (a consulta rápida da reserva). */
export function sqlDoMaiorNumeroRecente(lojaId: string, serie: number, ambiente: Ambiente, desde: Date): Prisma.Sql {
  return Prisma.sql`/* fh:maior-numero-recente */ ${maiorNumeroDe(fonteDaLoja(lojaId, desde), serie, ambiente)}`;
}

/**
 * A MARCA DE MAIOR NÚMERO: fiscalConfig.sefaz.maiorNumero["<ambiente>"]["<série>"]
 * sobe para `numero` se ele for maior (GREATEST no banco) — nunca desce. Roda
 * dentro da transação e da trava da reserva (normal e de contingência), então
 * a próxima reserva, esperando a trava, já a lê atualizada. O resto do
 * fiscalConfig não é reescrito (`||` do jsonb, nível a nível: jsonb_set não
 * cria o pai que falta). Valor torto na marca (texto, fração) conta como 0 —
 * a conversão fica dentro de CASE, como em `maiorNumeroDe`. Não mexe no
 * `updatedAt` da loja: é um marcador interno, não uma edição do cadastro.
 */
export function sqlMarcarMaiorNumero(lojaId: string, serie: number, ambiente: Ambiente, numero: number): Prisma.Sql {
  return Prisma.sql`/* fh:marcar-maior-numero */ UPDATE "User"
SET "fiscalConfig" = jsonb_set(
      CASE WHEN jsonb_typeof("fiscalConfig") = 'object' THEN "fiscalConfig" ELSE '{}'::jsonb END,
      '{sefaz}',
      (CASE WHEN jsonb_typeof("fiscalConfig"->'sefaz') = 'object' THEN "fiscalConfig"->'sefaz' ELSE '{}'::jsonb END)
        || jsonb_build_object('maiorNumero',
             (CASE WHEN jsonb_typeof("fiscalConfig"->'sefaz'->'maiorNumero') = 'object' THEN "fiscalConfig"->'sefaz'->'maiorNumero' ELSE '{}'::jsonb END)
               || jsonb_build_object(p.a,
                    (CASE WHEN jsonb_typeof("fiscalConfig"->'sefaz'->'maiorNumero'->p.a) = 'object' THEN "fiscalConfig"->'sefaz'->'maiorNumero'->p.a ELSE '{}'::jsonb END)
                      || jsonb_build_object(p.s, GREATEST(p.n,
                           COALESCE(CASE WHEN ("fiscalConfig"->'sefaz'->'maiorNumero'->p.a->>p.s) ~ '^[0-9]{1,9}$'
                                         THEN ("fiscalConfig"->'sefaz'->'maiorNumero'->p.a->>p.s)::bigint END, 0))))),
      true)
FROM (SELECT ${String(ambiente)}::text AS a, ${String(serie)}::text AS s, ${numero}::bigint AS n) p
WHERE "id" = ${lojaId}`;
}

/** A marca de maior número de uma série/ambiente (0 sem marca). Ver `sqlMarcarMaiorNumero`. */
export function marcaDoMaiorNumero(fiscalConfig: unknown, serie: number, ambiente: Ambiente): number {
  const bruto = objeto(objeto(objeto(objeto(fiscalConfig).sefaz).maiorNumero)[String(ambiente)])[String(serie)];
  const texto = comoTexto(bruto);
  return texto != null && RE_NUMERO.test(texto) ? Number(texto) : 0;
}

/** Todos os números gravados da loja (a inutilização mensal e a conferência de faixa). */
export const sqlDosNumerosDaLoja = (lojaId: string): Prisma.Sql =>
  Prisma.sql`/* fh:numeros-da-loja */ ${sqlDosNumeros(fonteDaLoja(lojaId))}`;

/** As linhas do SQL de números, já lidas como na referência JS. */
export function lerLinhasDosNumeros(linhas: Array<Record<string, unknown>>): NumeroGravado[] {
  const saida: NumeroGravado[] = [];
  for (const l of linhas) {
    const lido = lerNumero({
      pedido: String(l.pedido ?? ""),
      fiscalStatus: (l.fiscalStatus as string | null) ?? null,
      papel: l.papel as PapelDoNumero,
      numero: l.numero,
      serie: l.serie,
      ambiente: l.ambiente,
      em: l.em,
      situacao: l.situacao,
    });
    if (lido) saida.push(lido);
  }
  return saida;
}

/** A chave da trava: 64 bits do SHA-256 de loja+série+ambiente (texto: o Prisma não manda BigInt como texto). */
export function chaveDaTrava(lojaId: string, serie: number, ambiente: Ambiente): string {
  const h = createHash("sha256").update(`nfce-numeracao:${lojaId}:${serie}:${ambiente}`).digest();
  return BigInt.asIntN(64, h.readBigUInt64BE(0)).toString();
}

/**
 * A trava da transação. `$executeRaw` e não `$queryRaw`: a função devolve
 * `void`, e o Prisma não sabe desserializar uma coluna void.
 */
export const sqlDaTrava = (chave: string): Prisma.Sql => Prisma.sql`/* fh:trava */ SELECT pg_advisory_xact_lock(${chave}::bigint)`;

/**
 * Junta chaves ao fiscalInfo dos pedidos, NO BANCO (jsonb `||`): não reescreve
 * o resto — o aviso do iFood gravado no meio, por exemplo, fica. `remover`
 * tira chaves antes. O fiscalInfo que não é objeto (null do JSON) vira `{}`.
 * `updatedAt` vai à mão: o @updatedAt do Prisma não vale em SQL cru, e o cron
 * (lib/fiscal-automatico) acha as notas a consultar por ele.
 */
export function sqlMesclarNoFiscalInfo(ids: string[], dados: Record<string, unknown>, remover: string[] = []): Prisma.Sql {
  return Prisma.sql`/* fh:mesclar-fiscal-info */ UPDATE "CustomerOrder"
SET "fiscalInfo" = ((CASE WHEN jsonb_typeof("fiscalInfo") = 'object' THEN "fiscalInfo" ELSE '{}'::jsonb END) - ${remover}::text[]) || ${JSON.stringify(dados)}::jsonb,
    "updatedAt" = NOW()
WHERE "id" = ANY(${ids}::text[])`;
}

/**
 * Marca os pedidos da nota como EM EMISSÃO: PENDING com `processando`, em
 * TODOS ou em nenhum, e nunca por cima de nota autorizada (se outro caminho
 * autorizou algum deles no meio, a contagem volta 0). Duas horas:
 *  - na RESERVA, com o número: se o processo cair daqui até o envio, o cron
 *    acha o pedido "processando" e, sem envio registrado, sabe que nada saiu
 *    (lib/nfce/emissao-da-loja → sincronizarNotaNaSefaz) — sem a marca, o
 *    pedido ficaria PENDING com a reserva e nenhum passo do cron o veria;
 *  - no "vai sair agora" (aoAssinar), com a chave e o XML assinado.
 */
export function sqlMarcarEmEmissao(ids: string[], dados: Record<string, unknown>): Prisma.Sql {
  return Prisma.sql`/* fh:marcar-em-emissao */ UPDATE "CustomerOrder"
SET "fiscalStatus" = 'PENDING',
    "fiscalInfo" = (CASE WHEN jsonb_typeof("fiscalInfo") = 'object' THEN "fiscalInfo" ELSE '{}'::jsonb END) || ${JSON.stringify(dados)}::jsonb,
    "updatedAt" = NOW()
WHERE "id" = ANY(${ids}::text[])
  AND NOT EXISTS (SELECT 1 FROM "CustomerOrder" o WHERE o."id" = ANY(${ids}::text[]) AND o."fiscalStatus" = 'EMITTED')`;
}

/**
 * Solta a reserva VENCIDA de um pedido (inutilização mensal) — só se ela ainda
 * for aquele número e não estiver em uso: a condição está no WHERE, e quem
 * reusou a reserva no meio (e refrescou a data) não perde nada.
 */
export function sqlLiberarReserva(
  pedido: string,
  reserva: { numero: number; serie: number; ambiente: Ambiente; em: string | null },
  registro: Record<string, unknown>
): Prisma.Sql {
  const mesmaData =
    reserva.em == null
      ? Prisma.sql`"fiscalInfo"->'numeroReservado'->>'em' IS NULL`
      : Prisma.sql`"fiscalInfo"->'numeroReservado'->>'em' = ${reserva.em}`;
  return Prisma.sql`/* fh:liberar-reserva */ UPDATE "CustomerOrder"
SET "fiscalInfo" = ("fiscalInfo" - 'numeroReservado') || ${JSON.stringify(registro)}::jsonb, "updatedAt" = NOW()
WHERE "id" = ${pedido}
  AND jsonb_typeof("fiscalInfo") = 'object'
  AND "fiscalInfo"->'numeroReservado'->>'numero' = ${String(reserva.numero)}
  AND "fiscalInfo"->'numeroReservado'->>'serie' = ${String(reserva.serie)}
  AND "fiscalInfo"->'numeroReservado'->>'ambiente' = ${String(reserva.ambiente)}
  AND ${mesmaData}`;
}

// ── Leituras puras ───────────────────────────────────────────────────────────

export type FaixaInutilizada = { serie: number; ambiente: Ambiente; inicial: number; final: number; em: string | null };

/** As faixas inutilizadas gravadas em fiscalConfig.inutilizacoes (a tela e a mensal gravam lá). */
export function faixasInutilizadas(fiscalConfig: unknown): FaixaInutilizada[] {
  const lista = objeto(fiscalConfig).inutilizacoes;
  const saida: FaixaInutilizada[] = [];
  for (const bruto of Array.isArray(lista) ? lista : []) {
    const i = objeto(bruto);
    const serie = Number(i.serie);
    const ini = Number(i.numeroInicial);
    const fim = Number(i.numeroFinal);
    const ambiente = Number(i.ambiente) === 1 ? 1 : Number(i.ambiente) === 2 ? 2 : null;
    if (!ambiente || !Number.isInteger(serie) || !Number.isInteger(ini) || !Number.isInteger(fim) || ini < 1 || fim < ini) continue;
    saida.push({ serie, ambiente, inicial: ini, final: fim, em: comoTexto(i.homologadaEm) });
  }
  return saida;
}

/** A reserva está numa emissão que ainda pode estar transmitindo? */
export function emissaoEmCurso(fiscalInfo: unknown, agora: Date): boolean {
  const t = Date.parse(String(objeto(objeto(fiscalInfo).numeroReservado).emissaoEmCurso ?? ""));
  return Number.isFinite(t) && agora.getTime() - t < PRAZO_DA_EMISSAO_EM_CURSO_MS && t <= agora.getTime() + 60_000;
}

/**
 * A reserva deste pedido pode ser reusada nesta série/ambiente? Não, se o
 * número já é de uma nota que a SEFAZ conhece (a autorizada ou cancelada do
 * próprio pedido, uma anterior, uma queimada) ou se foi descartado agora.
 */
export function reservaReusavel(
  pedido: { id: string; fiscalStatus?: string | null; fiscalInfo?: unknown },
  serie: number,
  ambiente: Ambiente,
  descartar: number[] = []
): number | null {
  const r = numerosDoFiscalInfo(pedido).find((t) => t.papel === "reserva");
  if (!r || r.serie !== serie || r.ambiente !== ambiente || descartar.includes(r.numero)) return null;
  if (pedido.fiscalStatus === "EMITTED") return null;
  const naSefaz = numerosDoFiscalInfo(pedido).some(
    (t) =>
      t.numero === r.numero &&
      t.serie === serie &&
      t.ambiente === ambiente &&
      (t.papel === "anterior" || t.papel === "queimado" || (t.papel === "nota" && pedido.fiscalStatus === "CANCELED"))
  );
  return naSefaz ? null : r.numero;
}

// ── A reserva ────────────────────────────────────────────────────────────────

/**
 * O que é preciso do banco: o Prisma (ou o falso dos testes). A transação
 * interativa dá o `tx` com os mesmos delegates e o SQL cru.
 */
export type BancoDaNumeracao = { $transaction: (...args: any[]) => Promise<any> } & Record<string, any>;
const bancoPadrao = (): BancoDaNumeracao => prisma as unknown as BancoDaNumeracao;
const OPCOES_DA_TRANSACAO = { maxWait: 10_000, timeout: 20_000 };

export type PedidoLido = { id: string; fiscalStatus: string | null; fiscalInfo: Record<string, any> };

export type ReservaFeita =
  | { ok: true; numero: number; reusada: boolean; reservadaEm: string; lidos: PedidoLido[] }
  | { ok: false; motivo: "em_curso" | "ja_emitida" | "sem_numero" | "sem_pedidos"; mensagem: string };

/**
 * Os números anotados fora da janela da consulta rápida
 * (fiscalConfig.sefaz.numerosForaDaJanela) pela versão anterior da reserva —
 * hoje quem cobre isso é a marca de maior número (`sqlMarcarMaiorNumero`);
 * a lista antiga continua sendo LIDA para o que já foi anotado.
 */
export function numerosForaDaJanela(fiscalConfig: unknown, serie: number, ambiente: Ambiente): number[] {
  const lista = objeto(objeto(fiscalConfig).sefaz).numerosForaDaJanela;
  return (Array.isArray(lista) ? lista : [])
    .map((bruto) => {
      const o = objeto(bruto);
      return lerNumero({ pedido: String(o.pedido ?? ""), fiscalStatus: null, papel: "reserva", numero: o.numero, serie: o.serie, ambiente: o.ambiente, em: o.em, situacao: null });
    })
    .filter((t): t is NumeroGravado => t != null && t.serie === serie && t.ambiente === ambiente)
    .map((t) => t.numero);
}

const lerMaior = (linhas: unknown): number | null => {
  const v = (linhas as Array<{ maior: unknown }> | null)?.[0]?.maior;
  return v == null ? null : Number(v);
};

/**
 * O maior número ocupado, lido dentro da trava: os pedidos (a janela recente,
 * ou todos se ela estiver vazia — ver `JANELA_DA_NUMERACAO_MS`), a marca de
 * maior número, os anotados fora da janela (legado), as faixas inutilizadas e
 * o início da série.
 */
async function maiorOcupado(
  tx: any,
  p: { lojaId: string; serie: number; ambiente: Ambiente; numeroInicial?: number | null },
  agora: Date
): Promise<number> {
  const desde = new Date(agora.getTime() - JANELA_DA_NUMERACAO_MS);
  let doBanco = lerMaior(await tx.$queryRaw(sqlDoMaiorNumeroRecente(p.lojaId, p.serie, p.ambiente, desde)));
  if (doBanco == null) doBanco = lerMaior(await tx.$queryRaw(sqlDoMaiorNumero(p.lojaId, p.serie, p.ambiente))) ?? 0;
  const loja = await tx.user.findUnique({ where: { id: p.lojaId }, select: { fiscalConfig: true } });
  const inutilizado = faixasInutilizadas(loja?.fiscalConfig)
    .filter((f) => f.serie === p.serie && f.ambiente === p.ambiente)
    .reduce((m, f) => Math.max(m, f.final), 0);
  const marca = marcaDoMaiorNumero(loja?.fiscalConfig, p.serie, p.ambiente);
  const fora = numerosForaDaJanela(loja?.fiscalConfig, p.serie, p.ambiente).reduce((m, n) => Math.max(m, n), 0);
  const inicio = Number.isInteger(Number(p.numeroInicial)) && Number(p.numeroInicial) >= 1 ? Number(p.numeroInicial) : 1;
  return Math.max(doBanco, marca, inutilizado, fora, inicio - 1);
}

/**
 * Reserva o número da nota dos `pedidos` (um pedido, ou os da conta da mesa)
 * e grava a reserva no fiscalInfo de todos eles, na MESMA transação da trava.
 * Devolve também o fiscalInfo lido dentro da trava — é ele (e não o que o
 * chamador leu antes) que diz se há envio a conferir.
 */
export async function reservarNumero(p: {
  lojaId: string;
  pedidos: string[];
  serie: number;
  ambiente: Ambiente;
  numeroInicial?: number | null;
  agora?: Date;
  /** Números que não podem ser reusados (queimados agora). */
  descartar?: number[];
  /** A própria emissão pedindo outro número (a marca de "em curso" é dela). */
  ignorarEmCurso?: boolean;
  banco?: BancoDaNumeracao;
}): Promise<ReservaFeita> {
  const pedidos = [...new Set(p.pedidos.filter(Boolean))];
  if (pedidos.length === 0) return { ok: false, motivo: "sem_pedidos", mensagem: "Nenhum pedido para reservar o número da nota." };
  const agora = p.agora ?? new Date();
  const banco = p.banco ?? bancoPadrao();
  return banco.$transaction(async (tx: any) => {
    await tx.$executeRaw(sqlDaTrava(chaveDaTrava(p.lojaId, p.serie, p.ambiente)));
    const brutos: Array<{ id: string; fiscalStatus: string | null; fiscalInfo: unknown }> = await tx.customerOrder.findMany({
      where: { id: { in: pedidos } },
      select: { id: true, fiscalStatus: true, fiscalInfo: true },
    });
    const lidos: PedidoLido[] = brutos.map((o) => ({ id: o.id, fiscalStatus: o.fiscalStatus ?? null, fiscalInfo: objeto(o.fiscalInfo) }));

    if (!p.ignorarEmCurso && lidos.some((o) => emissaoEmCurso(o.fiscalInfo, agora))) {
      return {
        ok: false,
        motivo: "em_curso",
        mensagem: "A nota deste pedido já está sendo transmitida agora. Aguarde o resultado — não emita de novo.",
      } as ReservaFeita;
    }

    const reusavel = lidos.map((o) => reservaReusavel(o, p.serie, p.ambiente, p.descartar)).find((n): n is number => n != null);
    let numero: number;
    if (reusavel != null) {
      numero = reusavel;
    } else {
      const maior = Math.max(await maiorOcupado(tx, p, agora), ...(p.descartar ?? []));
      numero = maior + 1;
      if (numero > NUMERO_MAXIMO) {
        return { ok: false, motivo: "sem_numero", mensagem: "A série chegou ao número máximo (999.999.999). Troque a série da NFC-e em Fiscal → Configuração." } as ReservaFeita;
      }
    }
    const reservadaEm = agora.toISOString();
    const reserva = { serie: p.serie, numero, ambiente: p.ambiente, em: reservadaEm, emissaoEmCurso: reservadaEm };
    const marcados = await tx.$executeRaw(sqlMarcarEmEmissao(pedidos, { numeroReservado: reserva, provedor: "sefaz", processando: true, ambiente: p.ambiente }));
    if (Number(marcados) < pedidos.length) {
      // Um pedido da nota foi autorizado por outro caminho no meio: a nota
      // dele existe, e esta emissão não tem o que fazer.
      return { ok: false, motivo: "ja_emitida", mensagem: "A nota deste pedido acabou de ser autorizada por outro caminho. Nada foi enviado de novo." } as ReservaFeita;
    }
    // A marca na MESMA transação (e trava): a reserva reusada também marca —
    // a de antes desta versão pode não ter marcado.
    await tx.$executeRaw(sqlMarcarMaiorNumero(p.lojaId, p.serie, p.ambiente, numero));
    return { ok: true, numero, reusada: reusavel != null, reservadaEm, lidos } as ReservaFeita;
  }, OPCOES_DA_TRANSACAO);
}

/**
 * O número EXTRA da contingência (lib/nfce/emissor chama só quando o número
 * tentado pode ter chegado à SEFAZ): mesma trava, maior + 1, gravado em
 * `numeroDeContingencia` — ocupado desde já, para nenhuma outra venda pegar.
 */
export async function reservarNumeroDeContingencia(p: {
  lojaId: string;
  pedidos: string[];
  serie: number;
  ambiente: Ambiente;
  numeroInicial?: number | null;
  agora?: Date;
  banco?: BancoDaNumeracao;
}): Promise<number> {
  const agora = p.agora ?? new Date();
  const banco = p.banco ?? bancoPadrao();
  return banco.$transaction(async (tx: any) => {
    await tx.$executeRaw(sqlDaTrava(chaveDaTrava(p.lojaId, p.serie, p.ambiente)));
    const numero = (await maiorOcupado(tx, p, agora)) + 1;
    if (numero > NUMERO_MAXIMO) throw new Error("A série chegou ao número máximo (999.999.999).");
    await tx.$executeRaw(
      sqlMesclarNoFiscalInfo(p.pedidos, { numeroDeContingencia: { serie: p.serie, numero, ambiente: p.ambiente, em: agora.toISOString() } })
    );
    await tx.$executeRaw(sqlMarcarMaiorNumero(p.lojaId, p.serie, p.ambiente, numero));
    return numero;
  }, OPCOES_DA_TRANSACAO);
}

// ── Buracos na sequência (inutilização mensal) ───────────────────────────────

export type BuracosDaSerie = {
  faixas: Array<{ inicial: number; final: number }>;
  total: number;
  /** Reservas vencidas cujo número caiu num buraco: soltas antes de inutilizar. */
  reservasVencidas: Array<{ pedido: string; numero: number; em: string | null }>;
  /** O maior número ocupado ANTES do mês corrente — até onde se procura buraco. */
  limite: number;
};

/**
 * Os números que ficaram para trás sem nota, numa série/ambiente — os que o
 * Ajuste SINIEF 19/16, cl. 16ª, manda inutilizar até o dia 10 do mês seguinte
 * ("na eventualidade de quebra de sequência da numeração da NFC-e").
 *
 * Buraco = número entre o início da série e o maior número ocupado ANTES do
 * mês corrente (o que é deste mês fica para o mês que vem) que nenhum
 * registro ocupa. Ocupam: toda nota (autorizada, cancelada, denegada, em
 * contingência — "nunca inutilizar número usado em contingência": a nota
 * off-line ainda vai ser transmitida com ELE), o envio a conferir, o número
 * tentado (é conferido pela chave antes — ver lib/nfce/rotina-da-sefaz), os
 * queimados, as faixas já inutilizadas e a reserva viva. A reserva VENCIDA (de
 * antes do mês corrente, de pedido que não virou nota) não ocupa: aquele
 * número não foi usado e não vai ser — ela é solta e o número, inutilizado.
 */
export function buracosParaInutilizar(e: {
  numeros: NumeroGravado[];
  inutilizadas: Array<{ inicial: number; final: number; em?: string | null }>;
  numeroInicial: number;
  inicioDoMes: Date;
  agora: Date;
}): BuracosDaSerie {
  const antesDoMes = (em: string | null | undefined) => {
    const t = Date.parse(String(em ?? ""));
    return !Number.isFinite(t) || t < e.inicioDoMes.getTime();
  };
  const vencida = (t: NumeroGravado) =>
    t.papel === "reserva" &&
    t.fiscalStatus !== "EMITTED" &&
    antesDoMes(t.em) &&
    !(t.situacao && Number.isFinite(Date.parse(t.situacao)) && e.agora.getTime() - Date.parse(t.situacao) < PRAZO_DA_EMISSAO_EM_CURSO_MS);

  const ocupados = new Set<number>();
  let limite = 0;
  for (const t of e.numeros) {
    if (antesDoMes(t.em)) limite = Math.max(limite, t.numero);
    if (!vencida(t)) ocupados.add(t.numero);
  }
  for (const f of e.inutilizadas) if (antesDoMes(f.em ?? null)) limite = Math.max(limite, f.final);

  // Por INTERVALOS, não número a número: um registro torto com número alto
  // (999.999.999) faria um laço de um bilhão de voltas dentro do cron.
  const cobertos: Array<[number, number]> = [...ocupados].map((n) => [n, n] as [number, number]);
  for (const f of e.inutilizadas) cobertos.push([f.inicial, f.final]);
  cobertos.sort((a, b) => a[0] - b[0]);
  const faixas: Array<{ inicial: number; final: number }> = [];
  let proximo = Math.max(1, e.numeroInicial);
  for (const [a, b] of cobertos) {
    if (proximo > limite || a > limite) break;
    if (b < proximo) continue;
    if (a > proximo) faixas.push({ inicial: proximo, final: a - 1 });
    proximo = Math.max(proximo, b + 1);
  }
  if (proximo <= limite) faixas.push({ inicial: proximo, final: limite });
  const total = faixas.reduce((s, f) => s + (f.final - f.inicial + 1), 0);
  const noBuraco = (n: number) => faixas.some((f) => n >= f.inicial && n <= f.final);
  const reservasVencidas = e.numeros.filter((t) => vencida(t) && noBuraco(t.numero)).map((t) => ({ pedido: t.pedido, numero: t.numero, em: t.em }));
  return { faixas, total, reservasVencidas, limite };
}
