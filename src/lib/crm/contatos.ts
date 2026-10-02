import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { mesmoTelefone } from "@/lib/telefone";
import { lerOutrosNumerosDoDono } from "@/lib/numeros-do-dono";
import { chaveDoTelefone, jidDoTelefone } from "./telefone";
import { ROTULO_DA_ETAPA, type Etapa } from "./etapas";

/**
 * O CONTATO DO CRM — a pessoa que fala com o FireHub, lead ou lojista.
 *
 * ── O vendedor da loja mora em DOIS lugares, e os dois andam juntos ─────────
 *
 * `User.vendedorId` é o que o billing lê para os 3% (lib/vendedores.ts); o
 * contato tem o seu `vendedorId` porque lead ainda não tem User. Quando o
 * contato tem loja, `atribuirVendedor` grava os dois — e a rota da aba
 * Lojistas faz o caminho inverso (`espelharVendedorDaLoja`). Um só dos lados
 * mudando é exatamente o "o vendedor fala com o cliente e a comissão vai para
 * outro".
 */

export type Autor = {
  tipo: "ADMIN" | "VENDEDOR" | "ROBO" | "SISTEMA";
  id?: string | null;
  nome?: string | null;
};

export const AUTOR_SISTEMA: Autor = { tipo: "SISTEMA", nome: "Sistema" };
export const AUTOR_ROBO: Autor = { tipo: "ROBO", nome: "Robô" };

export async function registrarEvento(
  contatoId: string,
  tipo: string,
  texto: string,
  autor: Autor = AUTOR_SISTEMA,
  dados?: Record<string, unknown>,
): Promise<void> {
  try {
    await prisma.crmEvento.create({
      data: {
        contatoId,
        tipo,
        texto: texto.slice(0, 2000),
        ...(dados ? { dados: dados as Prisma.InputJsonValue } : {}),
        autorTipo: autor.tipo,
        autorId: autor.id || null,
        autorNome: autor.nome || null,
      },
    });
  } catch (err: any) {
    // Linha do tempo é registro, não regra: falhar aqui não desfaz o que a
    // pessoa acabou de fazer.
    console.error(`[CRM] Evento ${tipo} do contato ${contatoId} não gravou: ${err?.message}`);
  }
}

/** A etapa que uma loja já cadastrada ocupa no funil: em teste ou cliente. */
function etapaDaLoja(loja: { trialEndsAt: Date | null; createdAt: Date }): Etapa {
  const fimDoTeste = loja.trialEndsAt ? loja.trialEndsAt.getTime() : loja.createdAt.getTime() + 15 * 86_400_000;
  return fimDoTeste > Date.now() ? "EM_TESTE" : "CLIENTE";
}

const SELECT_DA_LOJA = {
  id: true, name: true, storeName: true, city: true, email: true,
  storePhone: true, notificationPhone: true, vendedorId: true,
  trialEndsAt: true, createdAt: true,
} as const;

/**
 * Os números que a PRÓPRIA loja declarou como dela: o WhatsApp da loja, o do
 * proprietário, o número conectado no robô dela e os "outros números do dono"
 * (Chatbot IA → Alertas). Antes só os dois primeiros contavam, e o dono da
 * Serpa Pizzaria que escreveu do outro celular virou lead (01/10).
 */
export function numerosDaLoja(loja: { storePhone: string | null; notificationPhone: string | null; chatbotConfig?: unknown }): string[] {
  const c = (loja.chatbotConfig && typeof loja.chatbotConfig === "object" ? loja.chatbotConfig : {}) as any;
  return [loja.storePhone, loja.notificationPhone, typeof c.phone === "string" ? c.phone : null, ...lerOutrosNumerosDoDono(c)].filter(
    (n): n is string => !!n,
  );
}

/**
 * A loja deste telefone — dono que escreve para o FireHub pelo celular dele.
 *
 * Confere os números da loja (numerosDaLoja) com a régua de lib/telefone.ts.
 * O SQL só estreita pelos 8 últimos dígitos; quem decide é `mesmoTelefone`,
 * que não deixa DDD diferente passar por igual. Mais de uma loja com o mesmo
 * número (dono de rede) → a mais recente.
 */
export async function lojaDoTelefone(telefone: string | null | undefined) {
  const chave = chaveDoTelefone(telefone);
  if (!chave || chave.length < 8) return null;
  const final = chave.slice(-8);
  try {
    const candidatas = await prisma.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "User"
      WHERE "role" = 'FRANCHISEE'
        AND (regexp_replace(COALESCE("storePhone", ''), '[^0-9]', '', 'g') LIKE ${"%" + final}
          OR regexp_replace(COALESCE("notificationPhone", ''), '[^0-9]', '', 'g') LIKE ${"%" + final}
          OR regexp_replace(COALESCE("chatbotConfig"->>'phone', ''), '[^0-9]', '', 'g') LIKE ${"%" + final}
          -- A lista vira uma tira de dígitos: o LIKE só estreita, mesmoTelefone confere número a número.
          OR regexp_replace(COALESCE("chatbotConfig"->>'outrosNumerosDoDono', ''), '[^0-9]', '', 'g') LIKE ${"%" + final + "%"})
      ORDER BY "createdAt" DESC
      LIMIT 10
    `;
    if (candidatas.length === 0) return null;
    const lojas = await prisma.user.findMany({
      where: { id: { in: candidatas.map((c) => c.id) } },
      select: { ...SELECT_DA_LOJA, chatbotConfig: true },
      orderBy: { createdAt: "desc" },
    });
    const achada = lojas.find((l) => numerosDaLoja(l).some((n) => mesmoTelefone(n, chave)));
    if (!achada) return null;
    // A config do robô só serviu para conferir os números: não sai daqui.
    const { chatbotConfig: _config, ...loja } = achada;
    return loja;
  } catch (err: any) {
    console.error(`[CRM] Busca da loja pelo telefone falhou: ${err?.message}`);
    return null;
  }
}

/** Acha pelo telefone (chave) ou, sem telefone, pelo endereço da conversa. */
export async function acharContato(entrada: { telefone?: string | null; jid?: string | null }) {
  const chave = chaveDoTelefone(entrada.telefone);
  const ou: Prisma.CrmContatoWhereInput[] = [];
  if (chave) ou.push({ telefone: chave });
  if (entrada.jid) ou.push({ jid: entrada.jid });
  if (ou.length === 0) return null;
  return prisma.crmContato.findFirst({ where: { OR: ou }, orderBy: { criadoEm: "asc" } });
}

/**
 * O contato de uma conversa do WhatsApp: acha ou cria.
 *
 * Contato novo cujo número é de uma loja cadastrada já nasce vinculado a ela,
 * com o vendedor dela e a etapa certa — o dono da Pizzaria X escrevendo para
 * pedir suporte não é "lead novo".
 */
export async function contatoDaConversa(entrada: { telefone: string | null; jid: string; nome?: string | null }) {
  const existente = await acharContato(entrada);
  if (existente) {
    const mudar: Prisma.CrmContatoUpdateInput = {};
    // A conversa pode mudar de endereço (o WhatsApp migra contatos para LID):
    // responde-se sempre no último que falou.
    if (entrada.jid && existente.jid !== entrada.jid) mudar.jid = entrada.jid;
    const chave = chaveDoTelefone(entrada.telefone);
    if (chave && !existente.telefone) mudar.telefone = chave;
    if (!existente.nome && entrada.nome) mudar.nome = entrada.nome.slice(0, 120);
    let atual = existente;
    if (Object.keys(mudar).length > 0) {
      try {
        atual = await prisma.crmContato.update({ where: { id: existente.id }, data: mudar });
      } catch {
        /* segue com o que já tinha */
      }
    }
    // Contato que nasceu como lead pode ser de uma loja que só depois cadastrou
    // este número (outros números do dono, WhatsApp da loja trocado): confere de
    // novo a cada mensagem enquanto não tem loja. É uma consulta só.
    if (!atual.userId) {
      const loja = await lojaDoTelefone(entrada.telefone || atual.telefone);
      if (loja) {
        try {
          await vincularLoja(atual.id, loja.id, AUTOR_SISTEMA);
          return (await prisma.crmContato.findUnique({ where: { id: atual.id } })) || atual;
        } catch {
          /* segue sem a loja */
        }
      }
    }
    return atual;
  }

  const chave = chaveDoTelefone(entrada.telefone);
  const loja = await lojaDoTelefone(entrada.telefone);
  try {
    const criado = await prisma.crmContato.create({
      data: {
        telefone: chave,
        jid: entrada.jid,
        nome: (entrada.nome || loja?.name || "").slice(0, 120) || null,
        origem: "WHATSAPP",
        etapa: loja ? etapaDaLoja(loja) : "NOVO",
        ...(loja
          ? {
              userId: loja.id,
              nomeDaLoja: loja.storeName,
              cidade: loja.city,
              email: loja.email,
              vendedorId: loja.vendedorId,
              vendedorAtribuidoEm: loja.vendedorId ? new Date() : null,
            }
          : {}),
      },
    });
    if (loja) await registrarEvento(criado.id, "CADASTRO", `Número de uma loja cadastrada: ${loja.storeName || loja.name}.`);
    return criado;
  } catch (err: any) {
    // Duas mensagens do mesmo número ao mesmo tempo: a outra criou primeiro.
    if (err?.code === "P2002") {
      const outro = await acharContato(entrada);
      if (outro) return outro;
    }
    throw err;
  }
}

/** O número é de uma loja que não está na carteira de quem tentou cadastrar. */
export class ContatoDeOutraCarteira extends Error {}

/**
 * Contato cadastrado à mão (admin ou vendedor). Número repetido devolve o que
 * já existe — quem chama decide se o vendedor pode usar (tem que ser DELE).
 *
 * Número de loja cadastrada: o vendedor só cadastra se a loja já é da carteira
 * dele. Sem essa trava, bastava o telefone público de uma loja sem vendedor
 * para ele se pôr na carteira dela e passar a receber os 3%. A carteira da loja
 * só muda por aqui quando é o admin que cadastra.
 */
export async function criarContatoManual(
  dados: {
    telefone?: string | null; nome?: string | null; nomeDaLoja?: string | null; cidade?: string | null;
    email?: string | null; origem?: string | null; notas?: string | null; vendedorId?: string | null;
  },
  autor: Autor,
): Promise<{ contato: Awaited<ReturnType<typeof acharContato>>; jaExistia: boolean }> {
  const chave = chaveDoTelefone(dados.telefone);
  if (chave) {
    const existente = await acharContato({ telefone: chave });
    if (existente) return { contato: existente, jaExistia: true };
  }
  const loja = chave ? await lojaDoTelefone(chave) : null;
  if (loja && autor.tipo === "VENDEDOR" && loja.vendedorId !== autor.id) {
    throw new ContatoDeOutraCarteira("Esse número é de uma loja cadastrada que não está na sua carteira. Peça ao admin para passá-la para você.");
  }
  // O vendedor da loja, quando ela já tem um, vale mais que o escolhido no formulário:
  // contato e carteira da loja não podem ficar com vendedores diferentes.
  const vendedorId = autor.tipo === "VENDEDOR" ? autor.id : loja?.vendedorId || dados.vendedorId || null;
  const contato = await prisma.crmContato.create({
    data: {
      telefone: chave,
      jid: jidDoTelefone(dados.telefone),
      nome: dados.nome?.trim().slice(0, 120) || loja?.name || null,
      nomeDaLoja: dados.nomeDaLoja?.trim().slice(0, 120) || loja?.storeName || null,
      cidade: dados.cidade?.trim().slice(0, 80) || loja?.city || null,
      email: dados.email?.trim().toLowerCase().slice(0, 160) || loja?.email || null,
      origem: dados.origem || "MANUAL",
      etapa: loja ? etapaDaLoja(loja) : "NOVO",
      notas: dados.notas?.trim().slice(0, 4000) || null,
      userId: loja?.id || null,
      vendedorId,
      vendedorAtribuidoEm: vendedorId ? new Date() : null,
    },
  });
  await registrarEvento(contato.id, "CADASTRO", "Contato cadastrado à mão.", autor);
  if (loja && !loja.vendedorId && vendedorId && autor.tipo === "ADMIN") await gravarVendedorNaLoja(loja.id, vendedorId);
  return { contato, jaExistia: false };
}

async function gravarVendedorNaLoja(userId: string, vendedorId: string | null, jaAtendido = false) {
  const agora = new Date();
  await prisma.user.update({
    where: { id: userId },
    data: vendedorId
      ? {
          vendedorId,
          vendedorStatus: jaAtendido ? "ATENDIDO" : "AGUARDANDO",
          vendedorAtribuidoEm: agora,
          vendedorAtendidoEm: jaAtendido ? agora : null,
        }
      : { vendedorId: null, vendedorStatus: null, vendedorAtribuidoEm: null, vendedorAtendidoEm: null },
  });
}

/**
 * Põe o contato com um vendedor (ou tira). Contato com loja muda a carteira da
 * loja junto — é a carteira que paga os 3%.
 */
export async function atribuirVendedor(contatoId: string, vendedorId: string | null, autor: Autor) {
  const contato = await prisma.crmContato.findUnique({ where: { id: contatoId } });
  if (!contato) throw new Error("Contato não encontrado.");
  if (contato.vendedorId === vendedorId) return contato;

  let nomeDoVendedor = "ninguém";
  if (vendedorId) {
    const v = await prisma.ambassador.findUnique({ where: { id: vendedorId }, select: { name: true, isVendedor: true, active: true } });
    if (!v?.isVendedor || !v.active) throw new Error("Vendedor não encontrado ou inativo.");
    nomeDoVendedor = v.name;
  }

  const atualizado = await prisma.crmContato.update({
    where: { id: contatoId },
    data: {
      vendedorId,
      vendedorAtribuidoEm: vendedorId ? new Date() : null,
      // O relógio do "tempo até o primeiro contato" recomeça com o vendedor novo.
      primeiroContatoEm: null,
    },
  });
  if (contato.userId) {
    try {
      await gravarVendedorNaLoja(contato.userId, vendedorId);
    } catch (err: any) {
      console.error(`[CRM] Carteira da loja ${contato.userId} não acompanhou o vendedor: ${err?.message}`);
    }
  }
  await registrarEvento(contatoId, "VENDEDOR", vendedorId ? `Passou para ${nomeDoVendedor}.` : "Saiu da carteira do vendedor.", autor, { vendedorId });
  return atualizado;
}

/**
 * Caminho inverso: a aba Lojistas trocou o vendedor da loja.
 *
 * O filtro é explícito sobre o nulo: `NOT: { vendedorId }` vira
 * `NOT ("vendedorId" = $1)` no SQL, que é NULO para contato sem vendedor — e
 * justamente esse (o que veio do "Trazer as lojas") ficaria para trás.
 */
export async function espelharVendedorDaLoja(userId: string, vendedorId: string | null): Promise<void> {
  try {
    await prisma.crmContato.updateMany({
      where: vendedorId
        ? { userId, OR: [{ vendedorId: null }, { vendedorId: { not: vendedorId } }] }
        : { userId, vendedorId: { not: null } },
      data: { vendedorId, vendedorAtribuidoEm: vendedorId ? new Date() : null, primeiroContatoEm: null },
    });
  } catch (err: any) {
    // Sem as tabelas do CRM (boot falhou) a aba Lojistas continua funcionando.
    console.error(`[CRM] Espelho do vendedor da loja ${userId} falhou: ${err?.message}`);
  }
}

/** O vendedor saiu da equipe: os contatos dele voltam para "sem vendedor", como as lojas. */
export async function soltarContatosDoVendedor(vendedorId: string): Promise<void> {
  try {
    await prisma.crmContato.updateMany({
      where: { vendedorId },
      data: { vendedorId: null, vendedorAtribuidoEm: null, primeiroContatoEm: null },
    });
  } catch (err: any) {
    console.error(`[CRM] Contatos do vendedor ${vendedorId} não foram soltos: ${err?.message}`);
  }
}

export async function mudarEtapa(contatoId: string, etapa: Etapa, autor: Autor, motivoPerda?: string | null) {
  const contato = await prisma.crmContato.findUnique({ where: { id: contatoId }, select: { etapa: true } });
  if (!contato) throw new Error("Contato não encontrado.");
  if (contato.etapa === etapa && etapa !== "PERDIDO") return;
  await prisma.crmContato.update({
    where: { id: contatoId },
    data: { etapa, motivoPerda: etapa === "PERDIDO" ? (motivoPerda || "").slice(0, 300) || null : null },
  });
  await registrarEvento(
    contatoId,
    "ETAPA",
    `${ROTULO_DA_ETAPA[contato.etapa as Etapa] || contato.etapa} → ${ROTULO_DA_ETAPA[etapa]}${etapa === "PERDIDO" && motivoPerda ? ` (${motivoPerda})` : ""}.`,
    autor,
    { de: contato.etapa, para: etapa },
  );
}

/**
 * A loja acabou de se cadastrar em /cadastro: o lead vira "em teste" e, se um
 * vendedor cuidava dele, a loja já nasce na carteira desse vendedor — é o que
 * faz os 3% caírem para quem fez a demonstração sem ninguém lembrar de
 * atribuir à mão. Nunca lança: o cadastro não pode falhar por causa do CRM.
 */
export async function aoCadastrarLoja(loja: {
  id: string; storePhone: string | null; email: string; storeName: string | null; name: string | null; city: string | null;
}): Promise<void> {
  try {
    const chave = chaveDoTelefone(loja.storePhone);
    const ou: Prisma.CrmContatoWhereInput[] = [];
    if (chave) ou.push({ telefone: chave });
    if (loja.email) ou.push({ email: { equals: loja.email, mode: "insensitive" } });
    if (ou.length === 0) return;
    const contato = await prisma.crmContato.findFirst({ where: { OR: ou, userId: null }, orderBy: { criadoEm: "asc" } });

    if (!contato) {
      const novo = await prisma.crmContato.create({
        data: {
          telefone: chave && !(await acharContato({ telefone: chave })) ? chave : null,
          jid: jidDoTelefone(loja.storePhone),
          nome: loja.name,
          nomeDaLoja: loja.storeName,
          cidade: loja.city,
          email: loja.email,
          origem: "CADASTRO",
          etapa: "EM_TESTE",
          userId: loja.id,
        },
      });
      await registrarEvento(novo.id, "CADASTRO", "Cadastrou a loja no site e começou o teste grátis.");
      return;
    }

    await prisma.crmContato.update({
      where: { id: contato.id },
      data: {
        userId: loja.id,
        etapa: contato.etapa === "CLIENTE" ? "CLIENTE" : "EM_TESTE",
        nomeDaLoja: contato.nomeDaLoja || loja.storeName,
        cidade: contato.cidade || loja.city,
        email: contato.email || loja.email,
        nome: contato.nome || loja.name,
      },
    });
    if (contato.vendedorId) {
      const v = await prisma.ambassador.findUnique({ where: { id: contato.vendedorId }, select: { isVendedor: true, active: true } });
      if (v?.isVendedor && v.active) await gravarVendedorNaLoja(loja.id, contato.vendedorId, !!contato.primeiroContatoEm);
    }
    await registrarEvento(contato.id, "CADASTRO", `Cadastrou a loja ${loja.storeName || ""} e começou o teste grátis.`.replace("  ", " "), AUTOR_SISTEMA, { userId: loja.id });
  } catch (err: any) {
    console.error(`[CRM] Vínculo do cadastro ${loja.id} com o CRM falhou: ${err?.message}`);
  }
}

/**
 * Liga (ou desliga) o contato a uma loja à mão — o dono que escreveu de um
 * número que não é o cadastrado. O vendedor passa para o lado que não tem:
 * loja sem vendedor herda o do contato; contato sem vendedor herda o da loja.
 */
export async function vincularLoja(contatoId: string, userId: string | null, autor: Autor) {
  const contato = await prisma.crmContato.findUnique({ where: { id: contatoId } });
  if (!contato) throw new Error("Contato não encontrado.");
  if (!userId) {
    await prisma.crmContato.update({ where: { id: contatoId }, data: { userId: null } });
    await registrarEvento(contatoId, "CADASTRO", "Desvinculado da loja.", autor);
    return;
  }
  const loja = await prisma.user.findUnique({ where: { id: userId }, select: SELECT_DA_LOJA });
  if (!loja) throw new Error("Loja não encontrada.");
  await prisma.crmContato.update({
    where: { id: contatoId },
    data: {
      userId: loja.id,
      nomeDaLoja: contato.nomeDaLoja || loja.storeName,
      cidade: contato.cidade || loja.city,
      email: contato.email || loja.email,
      etapa: contato.etapa === "PERDIDO" || contato.etapa === "NOVO" || contato.etapa === "CONVERSANDO" || contato.etapa === "DEMO_MARCADA" ? etapaDaLoja(loja) : contato.etapa,
      ...(!contato.vendedorId && loja.vendedorId ? { vendedorId: loja.vendedorId, vendedorAtribuidoEm: new Date() } : {}),
    },
  });
  if (contato.vendedorId && !loja.vendedorId) await gravarVendedorNaLoja(loja.id, contato.vendedorId, !!contato.primeiroContatoEm);
  await registrarEvento(contatoId, "CADASTRO", `Vinculado à loja ${loja.storeName || loja.name}.`, autor, { userId: loja.id });
}

/**
 * Traz as lojas já cadastradas para o CRM (botão do admin). Cada loja vira um
 * contato com o vendedor e a data em que ele a recebeu — o desempenho da
 * equipe e a distribuição passam a enxergar a carteira de hoje, e não só quem
 * escreveu para o WhatsApp do FireHub depois do CRM existir.
 *
 * Repetir não duplica: loja que já tem contato fica como está; número que já é
 * contato (o dono escreveu antes) só ganha o vínculo com a loja.
 */
export async function importarLojasParaOCrm(autor: Autor): Promise<{ criados: number; ligados: number; jaEstavam: number }> {
  const lojas = await prisma.user.findMany({
    where: { role: "FRANCHISEE" },
    select: {
      ...SELECT_DA_LOJA,
      vendedorStatus: true, vendedorAtribuidoEm: true, vendedorAtendidoEm: true,
    },
    orderBy: { createdAt: "asc" },
  });
  const comContato = new Set(
    (await prisma.crmContato.findMany({ where: { userId: { not: null } }, select: { userId: true } })).map((c) => c.userId),
  );

  let criados = 0;
  let ligados = 0;
  let jaEstavam = 0;
  for (const loja of lojas) {
    if (comContato.has(loja.id)) { jaEstavam++; continue; }
    // O WhatsApp do Proprietário primeiro: é quem decide, e é o número que o sistema já usa para falar com o dono.
    const telefone = loja.notificationPhone || loja.storePhone;
    const chave = chaveDoTelefone(telefone);
    const existente = chave ? await prisma.crmContato.findUnique({ where: { telefone: chave } }) : null;
    if (existente && !existente.userId) {
      await prisma.crmContato.update({
        where: { id: existente.id },
        data: {
          userId: loja.id,
          nomeDaLoja: existente.nomeDaLoja || loja.storeName,
          cidade: existente.cidade || loja.city,
          email: existente.email || loja.email,
          ...(!existente.vendedorId && loja.vendedorId ? { vendedorId: loja.vendedorId, vendedorAtribuidoEm: loja.vendedorAtribuidoEm || new Date() } : {}),
        },
      });
      await registrarEvento(existente.id, "CADASTRO", `Ligado à loja ${loja.storeName || loja.name}.`, autor);
      ligados++;
      continue;
    }
    const contato = await prisma.crmContato.create({
      data: {
        // Número já usado por outro contato (dono de duas lojas): fica só com o endereço.
        telefone: existente ? null : chave,
        jid: jidDoTelefone(telefone),
        nome: loja.name,
        nomeDaLoja: loja.storeName,
        cidade: loja.city,
        email: loja.email,
        origem: "CADASTRO",
        etapa: etapaDaLoja(loja),
        userId: loja.id,
        vendedorId: loja.vendedorId,
        vendedorAtribuidoEm: loja.vendedorId ? loja.vendedorAtribuidoEm || new Date() : null,
        primeiroContatoEm: loja.vendedorId && loja.vendedorStatus === "ATENDIDO" ? loja.vendedorAtendidoEm || loja.vendedorAtribuidoEm : null,
        criadoEm: loja.createdAt,
      },
    });
    await registrarEvento(contato.id, "CADASTRO", "Loja trazida para o CRM.", autor);
    criados++;
  }
  return { criados, ligados, jaEstavam };
}
