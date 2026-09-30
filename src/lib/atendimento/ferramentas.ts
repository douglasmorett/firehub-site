import { prisma } from "@/lib/prisma";
import { mesmoTelefone } from "@/lib/telefone";
import { restartEvolutionInstance } from "@/lib/whatsapp-evolution";
import { registrarEvento, AUTOR_ROBO } from "@/lib/crm/contatos";
import { ANTECEDENCIA_MINIMA_MIN, dataDaAgenda, horaDaAgenda, NOMES_DOS_DIAS, diaDaSemana } from "@/lib/crm/agenda";
import { marcarReuniao, vagasDaEquipe, vendedorLivrePara, HorarioOcupado } from "@/lib/crm/agenda-servidor";
import { estadoDaLojaParaSuporte } from "./estado-da-loja";
import { avisarDono, avisarVendedor } from "./avisos";

/**
 * AS FERRAMENTAS DO ROBÔ DO FIREHUB — o que ele pode consultar e fazer.
 *
 * Regra de segurança que vale para todas: o que é DA LOJA (raio-x, fatura,
 * reiniciar o WhatsApp dela, e-mail de senha) só funciona para contato cuja
 * loja foi reconhecida PELO NÚMERO que está escrevendo (`contato.userId`,
 * gravado por lojaDoTelefone). Dizer "sou o dono da Pizzaria X" de outro
 * número não abre nada — o robô orienta e chama uma pessoa. E a conferência
 * é refeita na hora da ação (`lojaDoNumero`): o vínculo pode ter vindo pelo
 * e-mail no cadastro (`aoCadastrarLoja`), e e-mail qualquer um digita na conversa.
 */

type Contato = {
  id: string; telefone: string | null; nome: string | null; nomeDaLoja: string | null; cidade: string | null; email: string | null;
  userId: string | null; vendedorId: string | null; etapa: string; resumo: string | null;
};

/** As ferramentas que MUDAM alguma coisa — não podem rodar duas vezes numa resposta (robo.ts). */
export const FERRAMENTAS_COM_EFEITO = new Set(["marcar_demonstracao", "chamar_pessoa", "enviar_link_de_senha", "reiniciar_whatsapp_da_loja"]);

/** A loja do contato, se o número que está escrevendo é mesmo o dela (o da loja ou o do proprietário). */
async function lojaDoNumero(contato: Contato) {
  if (!contato.userId || !contato.telefone) return null;
  const loja = await prisma.user.findUnique({
    where: { id: contato.userId },
    select: { id: true, email: true, storePhone: true, notificationPhone: true },
  });
  if (!loja) return null;
  return mesmoTelefone(contato.telefone, loja.storePhone) || mesmoTelefone(contato.telefone, loja.notificationPhone) ? loja : null;
}

/** O vendedor do contato, quando ainda está na equipe: é com ele que a demonstração tem que ser. */
async function vendedorAtivoDoContato(contato: Contato): Promise<string | null> {
  if (!contato.vendedorId) return null;
  const v = await prisma.ambassador.findUnique({ where: { id: contato.vendedorId }, select: { isVendedor: true, active: true } });
  return v?.isVendedor && v.active ? contato.vendedorId : null;
}

export const DECLARACOES = [
  {
    name: "estado_da_loja",
    description: "Raio-x da loja do lojista que está falando: robô do WhatsApp conectado, Assistente de Impressão (última consulta, versão), canais (iFood, 99Food, JotaJá), teste grátis, fatura em aberto (com link), último pedido. Só funciona quando a loja foi reconhecida pelo número.",
    parametersJsonSchema: { type: "object", properties: {} },
  },
  {
    name: "horarios_livres",
    description: "Horários livres da equipe para uma demonstração do FireHub (chamada de vídeo com um especialista), nos próximos dias.",
    parametersJsonSchema: {
      type: "object",
      properties: { dias: { type: "integer", description: "Quantos dias à frente olhar (1 a 10). Padrão 5." } },
    },
  },
  {
    name: "marcar_demonstracao",
    description: "Marca a demonstração no horário que a pessoa ESCOLHEU entre os oferecidos por horarios_livres.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        inicio: { type: "string", description: "O início exatamente como veio em horarios_livres (campo 'inicio', ISO)." },
        nomeDaLoja: { type: "string", description: "Nome do restaurante/loja da pessoa." },
        nome: { type: "string", description: "Nome da pessoa, se ela disse." },
      },
      required: ["inicio"],
    },
  },
  {
    name: "atualizar_contato",
    description: "Guarda o que você descobriu sobre a pessoa. Chame sempre que souber algo novo.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        nome: { type: "string" },
        nomeDaLoja: { type: "string" },
        cidade: { type: "string" },
        email: { type: "string" },
        resumo: { type: "string", description: "Uma ou duas frases: tipo de negócio, por onde vende, o que procura, objeções." },
      },
    },
  },
  {
    name: "enviar_link_de_senha",
    description: "Manda para o E-MAIL da conta da loja o link para criar uma senha nova. Só para lojista reconhecido pelo número.",
    parametersJsonSchema: { type: "object", properties: {} },
  },
  {
    name: "reiniciar_whatsapp_da_loja",
    description: "Reinicia a conexão do robô do WhatsApp DA LOJA sem desconectar (resolve 'Aguardando mensagem' e robô travado). Não pede QR. Só para lojista reconhecido pelo número.",
    parametersJsonSchema: { type: "object", properties: {} },
  },
  {
    name: "chamar_pessoa",
    description: "Passa a conversa para uma pessoa da equipe: o robô para de responder aqui e a equipe é avisada. Use quando pedirem atendente/humano, em reclamação, cancelamento, cobrança contestada, erro que você não resolve ou pergunta fora da base.",
    parametersJsonSchema: {
      type: "object",
      properties: { motivo: { type: "string", description: "Em uma frase, o que a pessoa precisa." } },
      required: ["motivo"],
    },
  },
] as const;

const soDaLoja = { erro: "A loja não foi reconhecida por este número. Oriente com a base e, se precisar mexer na conta, chame uma pessoa." };

function quandoPorExtenso(inicio: Date): string {
  const data = dataDaAgenda(inicio);
  const [, m, d] = data.split("-");
  return `${NOMES_DOS_DIAS[diaDaSemana(data)].toLowerCase()} ${d}/${m} às ${horaDaAgenda(inicio)}`;
}

export async function executarFerramenta(nome: string, args: any, contato: Contato): Promise<Record<string, unknown>> {
  switch (nome) {
    case "estado_da_loja": {
      const loja = await lojaDoNumero(contato);
      if (!loja) return soDaLoja;
      const estado = await estadoDaLojaParaSuporte(loja.id, { aoVivo: true });
      return estado ? { ...estado } : { erro: "Loja não encontrada." };
    }

    case "horarios_livres": {
      const dias = Math.max(1, Math.min(Number(args?.dias) || 5, 10));
      const doContato = await vendedorAtivoDoContato(contato);
      const vagas = await vagasDaEquipe({ dias, ...(doContato ? { vendedorIds: [doContato] } : {}) });
      // Um horário conta uma vez, mesmo com dois vendedores livres nele.
      const porInicio = new Map<number, Date>();
      for (const v of vagas) for (const h of v.vagas) porInicio.set(h.inicio.getTime(), h.inicio);
      const lista = [...porInicio.values()].sort((a, b) => a.getTime() - b.getTime()).slice(0, 12);
      if (lista.length === 0) return { horarios: [], aviso: "Sem horário livre nos próximos dias. Chame uma pessoa para combinar." };
      return { horarios: lista.map((i) => ({ inicio: i.toISOString(), quando: quandoPorExtenso(i) })), duracao: "cerca de 45 minutos, por chamada de vídeo" };
    }

    case "marcar_demonstracao": {
      const inicio = new Date(String(args?.inicio || ""));
      if (Number.isNaN(inicio.getTime())) return { erro: "Horário inválido. Use o 'inicio' que veio em horarios_livres." };
      if (inicio.getTime() < Date.now() + ANTECEDENCIA_MINIMA_MIN * 60_000) return { erro: "Esse horário já passou ou está em cima da hora. Ofereça outro." };
      // Uma demonstração por lead: pedir de novo (ou o modelo repetir a chamada)
      // devolve a que já está marcada em vez de pôr uma segunda na agenda.
      const jaMarcada = await prisma.agendaReuniao.findFirst({
        where: { contatoId: contato.id, tipo: "DEMONSTRACAO", status: "MARCADA", inicio: { gt: new Date() } },
        orderBy: { inicio: "asc" },
      });
      if (jaMarcada) {
        const v = await prisma.ambassador.findUnique({ where: { id: jaMarcada.vendedorId }, select: { name: true } });
        return {
          ok: true, jaEstavaMarcada: true, quando: quandoPorExtenso(jaMarcada.inicio), comQuem: v?.name || "um especialista da equipe",
          aviso: "A pessoa JÁ tem esta demonstração marcada. Confirme este horário; se ela quiser trocar, use chamar_pessoa.",
        };
      }
      if (args?.nomeDaLoja || args?.nome) {
        await prisma.crmContato.update({
          where: { id: contato.id },
          data: {
            ...(args.nomeDaLoja ? { nomeDaLoja: String(args.nomeDaLoja).slice(0, 120) } : {}),
            ...(args.nome && !contato.nome ? { nome: String(args.nome).slice(0, 120) } : {}),
          },
        });
      }
      const doContato = await vendedorAtivoDoContato(contato);
      const vendedorId = await vendedorLivrePara(inicio, doContato, !!doContato);
      if (!vendedorId) return { erro: "Esse horário acabou de ser ocupado. Chame horarios_livres de novo e ofereça outro." };
      const vendedor = await prisma.ambassador.findUnique({ where: { id: vendedorId }, select: { name: true } });
      try {
        const reuniao = await marcarReuniao({ vendedorId, contatoId: contato.id, tipo: "DEMONSTRACAO", inicio, fim: new Date(inicio.getTime() + 45 * 60_000), local: "Chamada de vídeo" }, AUTOR_ROBO);
        const quando = quandoPorExtenso(inicio);
        void avisarVendedor(
          vendedorId,
          `📅 Demonstração marcada pelo robô na sua agenda: ${quando}, com ${args?.nomeDaLoja || contato.nomeDaLoja || contato.nome || "um lead"}.\nVeja o contato em https://firehubfood.com.br/vendedor?aba=conversas&contato=${contato.id}`,
        ).then((ok) => (ok ? prisma.agendaReuniao.update({ where: { id: reuniao.id }, data: { avisoVendedorEm: new Date() } }) : null)).catch(() => null);
        return { ok: true, quando, comQuem: vendedor?.name || "um especialista da equipe", aviso: "Diga que o especialista vai chamar por aqui no horário com o link da chamada." };
      } catch (err: any) {
        if (err instanceof HorarioOcupado) return { erro: "Esse horário acabou de ser ocupado. Ofereça outro." };
        throw err;
      }
    }

    case "atualizar_contato": {
      const dados: Record<string, string> = {};
      for (const campo of ["nome", "nomeDaLoja", "cidade", "email", "resumo"] as const) {
        const v = typeof args?.[campo] === "string" ? args[campo].trim() : "";
        if (v) dados[campo] = campo === "email" ? v.toLowerCase().slice(0, 160) : v.slice(0, campo === "resumo" ? 600 : 120);
      }
      if (Object.keys(dados).length === 0) return { ok: true };
      await prisma.crmContato.update({ where: { id: contato.id }, data: dados });
      return { ok: true };
    }

    case "enviar_link_de_senha": {
      const loja = await lojaDoNumero(contato);
      if (!loja) return soDaLoja;
      if (!loja.email) return { erro: "A conta não tem e-mail." };
      // Pela própria rota do "Esqueci a senha": uma regra só para o e-mail e o token.
      const porta = process.env.PORT || "3000";
      const r = await fetch(`http://127.0.0.1:${porta}/api/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: loja.email }),
        signal: AbortSignal.timeout(20000),
      }).catch(() => null);
      if (!r?.ok) return { erro: "Não consegui disparar o e-mail agora. Oriente a usar firehubfood.com.br/esqueci-senha." };
      const [usuario, dominio] = loja.email.split("@");
      return { ok: true, email: `${usuario.slice(0, 2)}***@${dominio}` };
    }

    case "reiniciar_whatsapp_da_loja": {
      const loja = await lojaDoNumero(contato);
      if (!loja) return soDaLoja;
      const ok = await restartEvolutionInstance(loja.id).catch(() => false);
      await registrarEvento(contato.id, "ROBO", ok ? "Reiniciou a conexão do WhatsApp da loja." : "Tentou reiniciar o WhatsApp da loja e o gateway recusou.", AUTOR_ROBO);
      return ok ? { ok: true, aviso: "Peça para testar mandando um 'oi' de outro celular em 1 minuto." } : { erro: "O reinício não funcionou. Chame uma pessoa." };
    }

    case "chamar_pessoa": {
      const motivo = String(args?.motivo || "Pediu para falar com uma pessoa.").slice(0, 300);
      await chamarPessoa(contato, motivo);
      return { ok: true, aviso: "Avise que uma pessoa da equipe vai responder por aqui em breve. Não continue o atendimento." };
    }

    default:
      return { erro: `Ferramenta desconhecida: ${nome}` };
  }
}

/** Para o robô na conversa e avisa quem precisa agir. Usada também pela trava de respostas. */
export async function chamarPessoa(contato: Pick<Contato, "id" | "nome" | "nomeDaLoja" | "vendedorId" | "userId">, motivo: string) {
  await prisma.crmContato.update({ where: { id: contato.id }, data: { aguardandoHumanoDesde: new Date() } });
  await registrarEvento(contato.id, "ROBO", `Chamou uma pessoa: ${motivo}`, AUTOR_ROBO);
  const quem = contato.nomeDaLoja || contato.nome || "Um contato";
  const texto = `🙋 ${quem} precisa de uma pessoa no WhatsApp do FireHub.\nMotivo: ${motivo}\nResponda em https://firehubfood.com.br/admin?aba=atendimento&contato=${contato.id}`;
  void avisarDono(texto).catch(() => null);
  if (contato.vendedorId) {
    void avisarVendedor(contato.vendedorId, `🙋 ${quem} (seu contato) pediu uma pessoa: ${motivo}\nResponda em https://firehubfood.com.br/vendedor?aba=conversas&contato=${contato.id}`).catch(() => null);
  }
}
