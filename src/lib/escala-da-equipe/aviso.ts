/**
 * ESCALA DA EQUIPE — a mensagem do WhatsApp que pede o aceite e o link
 * pessoal (Lucas/Frangoso, 13/11/2026: "prova de que o funcionário escolheu
 * aqueles dias").
 *
 * ── De onde sai a mensagem ──────────────────────────────────────────────────
 * Do WhatsApp DA LOJA (a instância do robô dela, `enviarPelaLoja`, o mesmo
 * envio da cotação com fornecedor) — nunca do número do FireHub. Se o robô da
 * loja estiver desconectado, a inscrição fica "falhou" e a tela mostra.
 *
 * ── Quando sai ──────────────────────────────────────────────────────────────
 * Só por ação de alguém: o gerente escala a pessoa (painel), a pessoa escolhe
 * a vaga (link) ou o gerente toca em "pedir aceite". Nada de disparo em massa
 * nem de cron. A mesma pessoa recebe no máximo uma a cada 5 min (o link que
 * ela já tem mostra tudo o que falta aceitar — regras.ts, deveMandarAviso).
 *
 * ── O link pessoal ──────────────────────────────────────────────────────────
 * /escala/<código>/minha/<token>: o token é "tipo + id da pessoa" assinado
 * (HMAC com o NEXTAUTH_SECRET) junto com o código do link da loja. Ninguém
 * inventa o de um colega, e "gerar link novo" na loja invalida todos — como
 * o link do grupo. Não precisa de tabela: o token se confere sozinho.
 */
import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { segredoObrigatorio } from "@/lib/segredos";
import { enviarPelaLoja } from "@/lib/cotacao/fila";
import { fusoDaLoja } from "@/lib/fuso-da-loja";
import { lerTokenDaPessoa, tokenDaPessoa } from "./link-pessoal";
import { configDaLoja, escalaDaPessoa, pessoasDaLoja, registrarAviso, ultimoAvisoEAceite } from "./banco";
import { agoraDaLoja, deveMandarAviso, mensagemDoAviso, somarDias, telefoneUtilizavel, turnoJaTerminou, type StatusDoAviso, type TipoDePessoa } from "./regras";

// ── O link pessoal (o token: ./link-pessoal.ts) ─────────────────────────────

const segredo = () => segredoObrigatorio("NEXTAUTH_SECRET");
const siteDoFireHub = () => ((process.env.NEXTAUTH_URL || "").startsWith("http") ? process.env.NEXTAUTH_URL!.replace(/\/+$/, "") : "https://firehubfood.com.br");

/** O caminho da página pessoal ("/escala/<código>/minha/<token>"). */
export function caminhoDoLinkPessoal(codigo: string, pessoa: { tipo: TipoDePessoa; id: string }): string {
  return `/escala/${codigo}/minha/${tokenDaPessoa(segredo(), codigo, pessoa.tipo, pessoa.id)}`;
}

/** Quem é o dono deste token no link desta loja (nulo = não vale). */
export function pessoaDoToken(codigo: string, token: string): { tipo: TipoDePessoa; id: string } | null {
  return lerTokenDaPessoa(segredo(), codigo, token);
}

// ── A mensagem ──────────────────────────────────────────────────────────────

export type ResultadoDoAviso = { status: StatusDoAviso | "nada" | "espera"; turnos: number };

/**
 * Manda (ou não) a mensagem de aceite para a pessoa: os turnos dela que ainda
 * não terminaram e faltam aceitar, com o link pessoal. Nunca lança.
 *   nada    — não há o que aceitar;
 *   espera  — o gerente pediu de novo em menos de 1 min (nada foi gravado);
 *   junto   — recebeu uma há menos de 5 min: o link dela já mostra o turno novo.
 */
export async function avisarPessoa(lojaId: string, quem: { tipo: TipoDePessoa; id: string }, motivo: "painel" | "link" | "manual"): Promise<ResultadoDoAviso> {
  try {
    const [config, fuso, pessoas, loja] = await Promise.all([
      configDaLoja(lojaId), fusoDaLoja(lojaId), pessoasDaLoja(lojaId),
      prisma.user.findUnique({ where: { id: lojaId }, select: { storeName: true, name: true } }),
    ]);
    const pessoa = pessoas.find((p) => p.tipo === quem.tipo && p.id === quem.id);
    if (!pessoa) return { status: "nada", turnos: 0 };
    const agora = agoraDaLoja(fuso);
    // Da véspera (turno que vira a meia-noite) até ~2 meses: o que ainda vai acontecer.
    const turnos = (await escalaDaPessoa(lojaId, pessoa, somarDias(agora.data, -1), somarDias(agora.data, 62)))
      .filter((t) => !t.aceitoEm && !turnoJaTerminou(t, agora));
    if (!turnos.length) return { status: "nada", turnos: 0 };
    const ids = turnos.map((t) => t.inscricaoId);
    if (!telefoneUtilizavel(pessoa.telefone)) {
      await registrarAviso(lojaId, ids, "sem-whatsapp");
      return { status: "sem-whatsapp", turnos: ids.length };
    }
    const { ultimoAviso, ultimoAceite } = await ultimoAvisoEAceite(lojaId, pessoa);
    if (!deveMandarAviso({ ultimoAviso, ultimoAceite, agora: new Date(), manual: motivo === "manual" })) {
      if (motivo === "manual") return { status: "espera", turnos: ids.length };
      // As que ainda não tinham mensagem nenhuma vão "junto" com a que acabou de sair.
      const semAviso = turnos.filter((t) => !t.avisoStatus || t.avisoStatus === "falhou" || t.avisoStatus === "sem-whatsapp").map((t) => t.inscricaoId);
      await registrarAviso(lojaId, semAviso, "junto");
      return { status: "junto", turnos: ids.length };
    }
    const texto = mensagemDoAviso({
      loja: loja?.storeName || loja?.name || "loja", nome: pessoa.nome, motivo, turnos,
      link: `${siteDoFireHub()}${caminhoDoLinkPessoal(config.codigo, pessoa)}`,
    });
    const r = await enviarPelaLoja(lojaId, pessoa.telefone!, texto);
    if (!r.ok) console.warn(`[Escala] Aviso de aceite para …${String(pessoa.telefone).slice(-4)} não saiu: ${r.erro}`);
    await registrarAviso(lojaId, ids, r.ok ? "enviado" : "falhou");
    return { status: r.ok ? "enviado" : "falhou", turnos: ids.length };
  } catch (err: any) {
    console.error("[Escala] Aviso de aceite falhou:", err?.message || err);
    return { status: "falhou", turnos: 0 };
  }
}

/**
 * Agenda a mensagem para DEPOIS da resposta (o envio espera o "digitando…"
 * do gateway, até ~13 s — a tela não pode esperar isso para encaixar alguém).
 */
export function avisarDepois(lojaId: string, quem: { tipo: TipoDePessoa; id: string }, motivo: "painel" | "link"): void {
  try {
    after(() => avisarPessoa(lojaId, quem, motivo).then(() => undefined));
  } catch (e: any) {
    // `after` fora de um pedido (script, teste): sem mensagem — o gerente pode pedir pela tela.
    console.warn("[Escala] Aviso de aceite sem after():", e?.message?.slice(0, 120));
  }
}
