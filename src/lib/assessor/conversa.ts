/**
 * A CONVERSA COM O BILL — uma por loja, gravada no banco.
 *
 * Douglas, 14/10/2026: "tanto pelo WhatsApp quanto pelo painel, com a mesma
 * linha de raciocínio… pra não falar informação separada. Tem que ser o mesmo
 * informante." O dono pausa a esfirra pelo WhatsApp no caminho e, no painel,
 * pergunta "e o frango?": o Bill precisa lembrar. Até aqui a conversa ficava
 * na memória do servidor, separada por canal, e morria no deploy.
 */
import { prisma } from "@/lib/prisma";
import { garantirEstruturaDoAssessor } from "./estrutura-no-banco";

export type FalaGravada = {
  id: string;
  papel: "DONO" | "BILL";
  texto: string;
  canal: "WHATSAPP" | "PAINEL";
  autor: string | null;
  ferramentas: string | null;
  criadoEm: string;
};

/** Conversa que o modelo relê: as últimas falas das últimas 3 horas. */
const JANELA_DO_MODELO_MS = 3 * 60 * 60 * 1000;
const FALAS_DO_MODELO = 14;

export async function gravarFala(f: { franchiseeId: string; papel: "DONO" | "BILL"; texto: string; canal: string; autor?: string | null; ferramentas?: string | null }) {
  try {
    if (!(await garantirEstruturaDoAssessor())) return;
    await prisma.assessorMensagem.create({
      data: { franchiseeId: f.franchiseeId, papel: f.papel, texto: f.texto.slice(0, 4000), canal: f.canal, autor: f.autor || null, ferramentas: f.ferramentas || null },
    });
  } catch (err: any) {
    console.error("[Bill] Não gravou a fala:", err?.message);
  }
}

/** Para o balão do painel: as últimas falas, das mais antigas para as mais novas. */
export async function lerConversa(franchiseeId: string, limite = 40, depoisDe?: Date | null): Promise<FalaGravada[]> {
  if (!(await garantirEstruturaDoAssessor())) return [];
  const linhas = await prisma.assessorMensagem.findMany({
    where: { franchiseeId, ...(depoisDe ? { criadoEm: { gt: depoisDe } } : {}) },
    orderBy: { criadoEm: "desc" },
    take: limite,
  });
  return linhas.reverse().map((l) => ({
    id: l.id, papel: l.papel as any, texto: l.texto, canal: l.canal as any, autor: l.autor, ferramentas: l.ferramentas, criadoEm: l.criadoEm.toISOString(),
  }));
}

/** Para o modelo: cada fala diz por onde veio, e a do Bill diz o que ele executou. */
export async function historicoParaOModelo(franchiseeId: string): Promise<{ role: "user" | "model"; texto: string }[]> {
  try {
    const desde = new Date(Date.now() - JANELA_DO_MODELO_MS);
    const falas = (await lerConversa(franchiseeId, FALAS_DO_MODELO)).filter((f) => new Date(f.criadoEm) >= desde);
    // O Gemini quer a conversa começando pelo usuário.
    while (falas.length && falas[0].papel === "BILL") falas.shift();
    return falas.map((f) =>
      f.papel === "DONO"
        ? { role: "user" as const, texto: `[${f.canal === "PAINEL" ? `painel${f.autor ? `, ${f.autor}` : ""}` : "WhatsApp"}] ${f.texto}` }
        : { role: "model" as const, texto: `[ferramentas desta resposta: ${f.ferramentas || "nenhuma — nada foi alterado"}]\n${f.texto}` },
    );
  } catch {
    return [];
  }
}
