/**
 * A SOLICITAÇÃO DO APLICATIVO PRÓPRIO DA LOJA — tela /store/aplicativo.
 *
 * Douglas, 17/10/2026: "a gente está desenvolvendo um aplicativo próprio da
 * loja; vamos cobrar por mês: R$ 149 só Android, R$ 149 só Apple, R$ 197 os
 * dois (promoção). Tem que ter uma página na barra lateral, 'Aplicativo da
 * loja', para o pessoal solicitar e a gente desenvolver para eles."
 *
 * O app em si é o projeto apps/loja (um app por marca, ver o vault "FireHub -
 * App próprio da loja"). Esta lib só guarda o PEDIDO da loja e avisa o Douglas
 * pelo canal interno de alertas (o WhatsApp pessoal dele — nunca o número do
 * atendimento do FireHub, que só responde quem escreveu).
 *
 * Tabela própria criada no primeiro uso (mesma categoria de
 * lib/assessor/estrutura-no-banco.ts): se faltar, só esta tela para.
 * A mensalidade ainda NÃO entra no boleto por aqui: o Douglas combina com a
 * loja quando o app estiver publicado.
 */
import { prisma } from "@/lib/prisma";
import { avisarDono } from "@/lib/atendimento/avisos";

export const PRECOS_DO_APP = { android: 149, apple: 149, ambos: 197 } as const;
export type Plataformas = keyof typeof PRECOS_DO_APP;
export const PLATAFORMAS: Plataformas[] = ["android", "apple", "ambos"];

export type SolicitacaoDoApp = {
  id: string;
  plataformas: Plataformas;
  nomeDoApp: string;
  contato: string;
  observacao: string | null;
  status: string;
  criadoEm: string;
  atualizadoEm: string;
};

const INSTRUCOES = [
  `CREATE TABLE IF NOT EXISTS "AppDaLojaSolicitacao" (
     "id" TEXT NOT NULL,
     "franchiseeId" TEXT NOT NULL,
     "plataformas" TEXT NOT NULL,
     "nomeDoApp" TEXT NOT NULL,
     "contato" TEXT NOT NULL,
     "observacao" TEXT,
     "status" TEXT NOT NULL DEFAULT 'PEDIDO',
     "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     "atualizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     CONSTRAINT "AppDaLojaSolicitacao_pkey" PRIMARY KEY ("id")
   )`,
  `CREATE INDEX IF NOT EXISTS "AppDaLojaSolicitacao_franchiseeId_idx" ON "AppDaLojaSolicitacao"("franchiseeId")`,
];

let pronto = false;
export async function garantirEstruturaDaSolicitacao(): Promise<boolean> {
  if (pronto) return true;
  if (!/^postgres/i.test(process.env.DATABASE_URL || "")) { pronto = true; return true; }
  try {
    for (const sql of INSTRUCOES) await prisma.$executeRawUnsafe(sql);
    pronto = true;
  } catch (err: any) {
    console.error("[App da loja] Estrutura da solicitação falhou:", err?.message);
  }
  return pronto;
}

type Linha = { id: string; plataformas: string; nomeDoApp: string; contato: string; observacao: string | null; status: string; criadoEm: Date; atualizadoEm: Date };
function paraFora(l: Linha): SolicitacaoDoApp {
  return {
    id: l.id,
    plataformas: (PLATAFORMAS.includes(l.plataformas as Plataformas) ? l.plataformas : "ambos") as Plataformas,
    nomeDoApp: l.nomeDoApp, contato: l.contato, observacao: l.observacao, status: l.status,
    criadoEm: l.criadoEm.toISOString(), atualizadoEm: l.atualizadoEm.toISOString(),
  };
}

/** A solicitação em aberto da loja (a mais recente), ou null. */
export async function solicitacaoDaLoja(franchiseeId: string): Promise<SolicitacaoDoApp | null> {
  try {
    if (!(await garantirEstruturaDaSolicitacao())) return null;
    const r = await prisma.$queryRaw<Linha[]>`
      SELECT "id", "plataformas", "nomeDoApp", "contato", "observacao", "status", "criadoEm", "atualizadoEm"
        FROM "AppDaLojaSolicitacao" WHERE "franchiseeId" = ${franchiseeId}
       ORDER BY "criadoEm" DESC LIMIT 1`;
    return r[0] ? paraFora(r[0]) : null;
  } catch (err: any) {
    console.error("[App da loja] Erro ao ler a solicitação:", err?.message);
    return null;
  }
}

export type DadosDaSolicitacao = { plataformas: Plataformas; nomeDoApp: string; contato: string; observacao?: string | null };

/**
 * Grava (ou atualiza a que está em aberto) e avisa o Douglas. O aviso não
 * segura a gravação: falhou o WhatsApp, o pedido fica no banco mesmo assim.
 */
export async function registrarSolicitacao(
  franchiseeId: string,
  loja: { storeName: string | null; slug: string | null },
  dados: DadosDaSolicitacao,
): Promise<SolicitacaoDoApp> {
  if (!(await garantirEstruturaDaSolicitacao())) throw new Error("A solicitação não está disponível agora. Tente de novo em alguns minutos.");
  const nome = dados.nomeDoApp.trim().slice(0, 60);
  const contato = dados.contato.trim().slice(0, 40);
  const obs = (dados.observacao || "").trim().slice(0, 600) || null;
  if (!PLATAFORMAS.includes(dados.plataformas)) throw new Error("Escolha Android, Apple ou os dois.");
  if (nome.length < 2) throw new Error("Diga o nome que o aplicativo vai ter.");
  if (contato.replace(/\D/g, "").length < 10) throw new Error("Informe um WhatsApp com DDD para a gente falar com você.");

  const aberta = await solicitacaoDaLoja(franchiseeId);
  const atualizar = aberta && aberta.status === "PEDIDO";
  const id = atualizar ? aberta.id : `app_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  if (atualizar) {
    await prisma.$executeRaw`
      UPDATE "AppDaLojaSolicitacao" SET "plataformas" = ${dados.plataformas}, "nomeDoApp" = ${nome}, "contato" = ${contato},
             "observacao" = ${obs}, "atualizadoEm" = CURRENT_TIMESTAMP WHERE "id" = ${id}`;
  } else {
    await prisma.$executeRaw`
      INSERT INTO "AppDaLojaSolicitacao" ("id", "franchiseeId", "plataformas", "nomeDoApp", "contato", "observacao")
      VALUES (${id}, ${franchiseeId}, ${dados.plataformas}, ${nome}, ${contato}, ${obs})`;
  }

  const rotulo = { android: "só Android", apple: "só Apple (iPhone)", ambos: "Android + Apple" }[dados.plataformas];
  const texto = [
    `📱 *${atualizar ? "Pedido de aplicativo ATUALIZADO" : "Pedido de aplicativo próprio"}*`,
    `Loja: ${loja.storeName || "(sem nome)"}${loja.slug ? ` (${loja.slug})` : ""}`,
    `Nome do app: ${nome}`,
    `Plataformas: ${rotulo} — R$ ${PRECOS_DO_APP[dados.plataformas]}/mês`,
    `Contato: ${contato}`,
    obs ? `Obs.: ${obs}` : null,
  ].filter(Boolean).join("\n");
  avisarDono(texto).catch(() => false);

  const gravada = await solicitacaoDaLoja(franchiseeId);
  if (!gravada) throw new Error("Não consegui gravar a solicitação.");
  return gravada;
}
