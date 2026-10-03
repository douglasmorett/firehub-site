/**
 * O celular do entregador com o APP NATIVO instalado, e o aviso que chega
 * nele com o app fechado ("Pedido #47 é seu").
 *
 * A página web não tem isso: o navegador só olha a lista quando está aberto
 * na frente, e o entregador descobria o pedido novo pelo WhatsApp ou pelo
 * grito no balcão. O app nativo registra aqui o token de notificação do Expo
 * (apps/motoboy/src/lib/notificacoes.ts), e a loja, ao atribuir, avisa.
 *
 * ── Um token, um dono ───────────────────────────────────────────────────────
 *
 * O token é do APARELHO, não da pessoa. Celular da loja que passa de mão na
 * troca de turno manda o mesmo token com outro login: o token muda de dono
 * (ON CONFLICT), senão o entregador da noite receberia os pedidos do da tarde.
 * Sair do app apaga a linha.
 *
 * ── A tabela não está no schema.prisma de propósito ─────────────────────────
 *
 * Como CashbackAjuste (lib/cashback-no-banco.ts): SQL cru, a tabela se cria
 * na primeira chamada, e se ela faltar o aviso simplesmente não sai — atribuir
 * pedido, despachar rota e dar baixa nunca dependem disto.
 */
import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";

const URL_DO_EXPO = "https://exp.host/--/api/v2/push/send";

/** O formato que o Expo devolve em getExpoPushTokenAsync. Qualquer outra coisa é lixo. */
const TOKEN_VALIDO = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,}\]$/;

let tabelaOk = false;

export async function garantirTabelaDeAparelhos(): Promise<boolean> {
  if (tabelaOk) return true;
  if (!/^postgres/i.test(process.env.DATABASE_URL || "")) return false;
  try {
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "MotoboyAparelho" (
      "id" TEXT NOT NULL,
      "motoboyId" TEXT NOT NULL,
      "lojaId" TEXT NOT NULL,
      "pushToken" TEXT NOT NULL,
      "plataforma" TEXT,
      "versaoDoApp" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL,
      "updatedAt" TIMESTAMP(3) NOT NULL,
      CONSTRAINT "MotoboyAparelho_pkey" PRIMARY KEY ("id")
    )`);
    await prisma.$executeRawUnsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS "MotoboyAparelho_pushToken_key" ON "MotoboyAparelho"("pushToken")`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "MotoboyAparelho_motoboyId_idx" ON "MotoboyAparelho"("motoboyId")`,
    );
    tabelaOk = true;
    return true;
  } catch (err: any) {
    console.error(`[App Motoboy] 🛑 Tabela MotoboyAparelho falhou: ${err?.message}`);
    return false;
  }
}

export function tokenDeNotificacaoValido(token: unknown): token is string {
  return typeof token === "string" && TOKEN_VALIDO.test(token.trim());
}

/** Grava (ou muda de dono) o aparelho. Devolve false se não deu para gravar. */
export async function registrarAparelho(a: {
  motoboyId: string;
  lojaId: string;
  pushToken: string;
  plataforma?: string | null;
  versaoDoApp?: string | null;
}): Promise<boolean> {
  if (!(await garantirTabelaDeAparelhos())) return false;
  const plataforma = String(a.plataforma || "").slice(0, 20) || null;
  const versao = String(a.versaoDoApp || "").slice(0, 40) || null;
  // TIMESTAMP sem fuso, em UTC, como o Prisma grava (ver horaEmUtc em
  // lib/cashback-no-banco.ts): now() solto seguiria o fuso da sessão.
  await prisma.$executeRaw`
    INSERT INTO "MotoboyAparelho" ("id", "motoboyId", "lojaId", "pushToken", "plataforma", "versaoDoApp", "createdAt", "updatedAt")
    VALUES (${randomUUID()}, ${a.motoboyId}, ${a.lojaId}, ${a.pushToken.trim()}, ${plataforma}, ${versao},
            (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC'))
    ON CONFLICT ("pushToken") DO UPDATE SET
      "motoboyId" = EXCLUDED."motoboyId",
      "lojaId" = EXCLUDED."lojaId",
      "plataforma" = EXCLUDED."plataforma",
      "versaoDoApp" = EXCLUDED."versaoDoApp",
      "updatedAt" = EXCLUDED."updatedAt"
  `;
  return true;
}

/**
 * Sair do app: o aparelho para de receber avisos. Com o entregador, só a
 * linha dele; sem (sessão já morta), a do token — que só o aparelho conhece.
 */
export async function esquecerAparelho(pushToken: string, motoboyId?: string | null): Promise<void> {
  if (!(await garantirTabelaDeAparelhos())) return;
  if (motoboyId) {
    await prisma.$executeRaw`
      DELETE FROM "MotoboyAparelho" WHERE "pushToken" = ${pushToken.trim()} AND "motoboyId" = ${motoboyId}
    `;
    return;
  }
  await prisma.$executeRaw`DELETE FROM "MotoboyAparelho" WHERE "pushToken" = ${pushToken.trim()}`;
}

export type AvisoAoMotoboy = {
  titulo: string;
  corpo: string;
  /** Vai junto para o app decidir o que abrir quando ele tocar no aviso. */
  dados?: Record<string, unknown>;
};

/**
 * Manda o aviso para todos os aparelhos do entregador. NUNCA lança e nunca
 * deve ser esperado por quem atribui: é `avisarMotoboy(...).catch(() => {})`
 * no fim da rota. Token que o Expo diz que morreu (app desinstalado) sai da
 * tabela aqui mesmo.
 */
export async function avisarMotoboy(motoboyId: string | null | undefined, aviso: AvisoAoMotoboy): Promise<void> {
  if (!motoboyId) return;
  try {
    if (!(await garantirTabelaDeAparelhos())) return;
    const linhas = await prisma.$queryRaw<{ pushToken: string }[]>`
      SELECT "pushToken" FROM "MotoboyAparelho" WHERE "motoboyId" = ${motoboyId}
    `;
    if (linhas.length === 0) return;

    const mensagens = linhas.map((l) => ({
      to: l.pushToken,
      title: aviso.titulo,
      body: aviso.corpo,
      data: aviso.dados ?? {},
      sound: "default",
      priority: "high",
      // O canal "pedidos" é criado pelo app com importância máxima: é ele que
      // faz o aviso tocar e aparecer por cima no Android.
      channelId: "pedidos",
      // Aviso de pedido de 20 minutos atrás não serve para nada.
      ttl: 15 * 60,
    }));

    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
    };
    // Só se a conta do Expo ligar o "acesso com segurança reforçada".
    if (process.env.EXPO_ACCESS_TOKEN) headers.Authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;

    const res = await fetch(URL_DO_EXPO, {
      method: "POST",
      headers,
      body: JSON.stringify(mensagens),
      signal: AbortSignal.timeout(8000),
    });
    const corpo = await res.json().catch(() => null as any);
    if (!res.ok) {
      console.warn(`[App Motoboy] aviso para ${motoboyId} recusado pelo Expo: ${res.status} ${JSON.stringify(corpo).slice(0, 200)}`);
      return;
    }

    const tickets: any[] = Array.isArray(corpo?.data) ? corpo.data : [];
    const mortos = tickets
      .map((t, i) => (t?.status === "error" && t?.details?.error === "DeviceNotRegistered" ? mensagens[i]?.to : null))
      .filter((t): t is string => Boolean(t));
    for (const token of mortos) {
      await prisma.$executeRaw`DELETE FROM "MotoboyAparelho" WHERE "pushToken" = ${token}`.catch(() => {});
    }
    const outrosErros = tickets.filter((t) => t?.status === "error" && t?.details?.error !== "DeviceNotRegistered");
    if (outrosErros.length > 0) {
      console.warn(`[App Motoboy] aviso para ${motoboyId}: ${outrosErros.map((t) => t?.details?.error || t?.message).join(" | ").slice(0, 300)}`);
    }
  } catch (err: any) {
    console.warn(`[App Motoboy] aviso para ${motoboyId} falhou: ${err?.message}`);
  }
}

/** "Bairro" do endereço para o aviso: a parte antes da cidade, sem rua e número. */
function lugarCurto(endereco: string | null | undefined): string {
  const texto = String(endereco || "").trim();
  if (!texto) return "";
  const partes = texto.split(/\s+-\s+|,/).map((p) => p.trim()).filter(Boolean);
  // "Rua X, 123 - Bairro - Cidade": a rua com número é o que o entregador
  // reconhece no aviso; o resto ele vê ao abrir.
  return partes.slice(0, 2).join(", ").slice(0, 80);
}

/**
 * O aviso de pedido novo, com o número do painel. Um pedido diz o endereço;
 * vários (a rota despachada) dizem quantos são.
 */
export async function avisarPedidosNovos(
  motoboyId: string | null | undefined,
  pedidos: { dailyOrderNumber?: number | null; customerAddress?: string | null }[],
  rota?: string | null,
): Promise<void> {
  if (!motoboyId || pedidos.length === 0) return;
  if (pedidos.length === 1) {
    const p = pedidos[0];
    await avisarMotoboy(motoboyId, {
      titulo: p.dailyOrderNumber ? `🛵 Pedido #${p.dailyOrderNumber} é seu` : "🛵 Pedido novo para você",
      corpo: lugarCurto(p.customerAddress) || "Abra o app para ver a entrega.",
      dados: { tipo: "PEDIDO_NOVO" },
    });
    return;
  }
  const numeros = pedidos.map((p) => (p.dailyOrderNumber ? `#${p.dailyOrderNumber}` : null)).filter(Boolean);
  await avisarMotoboy(motoboyId, {
    titulo: `🛵 ${rota ? `${rota}: ` : ""}${pedidos.length} entregas para você`,
    corpo: numeros.length > 0 ? `Pedidos ${numeros.join(", ")}` : "Abra o app para ver as entregas.",
    dados: { tipo: "PEDIDO_NOVO" },
  });
}
