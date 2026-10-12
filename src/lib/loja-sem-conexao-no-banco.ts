import { prisma } from "@/lib/prisma";
import { lerEstadoSemConexao, type EstadoSemConexao } from "./loja-sem-conexao";

/**
 * O estado da LOJA SEM CONEXÃO no banco (User.semConexaoEstado, JSONB). As
 * decisões moram em lib/loja-sem-conexao.ts; aqui só se lê e se grava.
 *
 * ── Por que SQL cru, e não um campo no schema.prisma ────────────────────────
 *
 * O mesmo desenho da memória do robô (lib/memoria-da-conversa-no-banco.ts) e
 * das colunas da Brendi: o schema não conhece a coluna, o boot a cria
 * (src/instrumentation.ts) e TUDO aqui falha em silêncio para quem chama. Sem a
 * coluna, a proteção simplesmente não age — que é o comportamento de antes
 * dela existir. Campo no schema com a coluna ausente seria erro em TODA
 * consulta de User, a tabela mais lida do sistema.
 *
 * ── Por que não em chatbotConfig ────────────────────────────────────────────
 *
 * Pelo mesmo motivo do User.aberturaEstado (api/cron/abertura-da-loja): o cron
 * gravaria a cada minuto num JSON que a tela do robô regrava inteiro, e um dos
 * dois desfaria o outro.
 *
 * ── A `versao` ──────────────────────────────────────────────────────────────
 *
 * Toda gravação é condicionada à versão lida e a incrementa. Duas rodadas do
 * cron ao mesmo tempo (um deploy com os dois servidores de pé por alguns
 * segundos) não abrem duas pausas no iFood nem mandam dois avisos: a segunda
 * gravação não acha a versão que leu e desiste daquela loja nesta rodada.
 */

let colunaOk = false;

/** Garante a coluna uma vez por processo — e só marca DEPOIS de conseguir. */
export async function garantirColunaDaLojaSemConexao(): Promise<boolean> {
  if (colunaOk) return true;
  if (!/^postgres/i.test(process.env.DATABASE_URL || "")) return false;
  try {
    // Confere ANTES de alterar: `ADD COLUMN IF NOT EXISTS` pede trava exclusiva
    // em User mesmo quando a coluna já existe, e esta é a tabela mais quente.
    const existe = await prisma.$queryRaw<{ ok: number }[]>`
      SELECT 1 AS ok FROM information_schema.columns
      WHERE table_name = 'User' AND column_name = 'semConexaoEstado' LIMIT 1
    `;
    if (existe.length === 0) {
      await prisma.$executeRawUnsafe(`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "semConexaoEstado" JSONB`);
      console.log("[Boot] ✅ Coluna User.semConexaoEstado criada (loja sem conexão).");
    }
    colunaOk = true;
    return true;
  } catch (err: any) {
    console.error(`[Loja sem conexão] Não consegui garantir a coluna: ${err?.message || err}`);
    return false;
  }
}

export type EstadoGravado = { estado: EstadoSemConexao; versao: number };

/** Os estados gravados, só das lojas que têm algum. Sem a coluna: mapa vazio. */
export async function lerEstadosSemConexao(): Promise<Map<string, EstadoGravado>> {
  const mapa = new Map<string, EstadoGravado>();
  if (!(await garantirColunaDaLojaSemConexao())) return mapa;
  const linhas = await prisma.$queryRaw<{ id: string; estado: unknown }[]>`
    SELECT "id", "semConexaoEstado" AS estado FROM "User" WHERE "semConexaoEstado" IS NOT NULL
  `;
  for (const l of linhas) mapa.set(l.id, lerEstadoSemConexao(l.estado));
  return mapa;
}

/**
 * Grava o estado de uma loja, só se ninguém gravou depois da leitura
 * (`versaoLida`). Na MESMA instrução, quando pedido, mexe no "Site aberto":
 *
 *   "fechar"  — só acontece se ele ainda está ligado; se o dono fechou neste
 *               meio-tempo, nada é gravado e a queda não começa;
 *   "reabrir" — religa (se já estava ligado, fica como está).
 *
 * Devolve true se gravou. Nunca lança.
 */
export async function gravarEstadoSemConexao(o: {
  lojaId: string;
  versaoLida: number;
  estado: EstadoSemConexao;
  site?: "fechar" | "reabrir";
}): Promise<boolean> {
  try {
    if (!(await garantirColunaDaLojaSemConexao())) return false;
    const json = JSON.stringify({ ...o.estado, versao: o.versaoLida + 1 });
    const fechar = o.site === "fechar";
    const reabrir = o.site === "reabrir";
    // Tipos explícitos nos parâmetros: o driver não precisa adivinhar se o
    // `true` é booleano e se a versão é inteiro.
    const n = await prisma.$executeRaw`
      UPDATE "User"
      SET "semConexaoEstado" = ${json}::jsonb,
          "storeOpen" = CASE WHEN ${fechar}::boolean THEN false WHEN ${reabrir}::boolean THEN true ELSE "storeOpen" END
      WHERE "id" = ${o.lojaId}
        AND (CASE WHEN jsonb_typeof("semConexaoEstado"->'versao') = 'number'
                  THEN ("semConexaoEstado"->>'versao')::int ELSE 0 END) = ${o.versaoLida}::int
        AND (NOT ${fechar}::boolean OR "storeOpen" = true)
    `;
    return Number(n) === 1;
  } catch (err: any) {
    console.error(`[Loja sem conexão] Falha ao gravar a loja ${o.lojaId}: ${err?.message || err}`);
    return false;
  }
}

/** As lojas em queda agora (para o cron da abertura não reabrir nem avisar "loja fechada"). Nunca lança. */
export async function lojasEmQueda(): Promise<Set<string>> {
  try {
    if (!(await garantirColunaDaLojaSemConexao())) return new Set();
    const linhas = await prisma.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "User" WHERE jsonb_typeof("semConexaoEstado"->'episodio') = 'object'
    `;
    return new Set(linhas.map((l) => l.id));
  } catch (err: any) {
    console.error(`[Loja sem conexão] Falha ao ler as lojas em queda: ${err?.message || err}`);
    return new Set();
  }
}

/**
 * A loja está FECHADA PELA PROTEÇÃO agora? É o que troca o "fechado" do site,
 * do robô e do checkout por "estamos com instabilidade, volte em alguns
 * minutos". Só vale enquanto o fechamento é nosso: se o dono religou no meio
 * da queda e fechou de novo, o fechado é dele e a frase é a de sempre.
 *
 * Quem chama só pergunta com o "Site aberto" desligado. Nunca lança: na
 * dúvida, a resposta é "não" e a loja aparece fechada como sempre apareceu.
 */
export async function lojaFechadaPelaQueda(lojaId: string | null | undefined): Promise<boolean> {
  if (!lojaId) return false;
  try {
    if (!(await garantirColunaDaLojaSemConexao())) return false;
    const linhas = await prisma.$queryRaw<{ site: string | null }[]>`
      SELECT ("semConexaoEstado"->'episodio'->>'site') AS site FROM "User" WHERE "id" = ${lojaId} LIMIT 1
    `;
    return linhas[0]?.site === "fechado_por_nos";
  } catch {
    return false;
  }
}
