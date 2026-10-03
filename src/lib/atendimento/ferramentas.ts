import { prisma } from "@/lib/prisma";
import { mesmoTelefone } from "@/lib/telefone";
import { restartEvolutionInstance } from "@/lib/whatsapp-evolution";
import { registrarEvento, AUTOR_ROBO, lojaDoTelefone, numerosDaLoja } from "@/lib/crm/contatos";
import { estadoDaLojaParaSuporte } from "./estado-da-loja";
import { avisarDono } from "./avisos";
import { criarContaPeloWhatsApp } from "./cadastro";

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
export const FERRAMENTAS_COM_EFEITO = new Set(["chamar_pessoa", "montar_loja", "criar_conta", "enviar_link_de_senha", "reiniciar_whatsapp_da_loja"]);

/*
 * O robô NÃO marca reunião nem demonstração — não há ferramenta de agenda aqui
 * (Douglas, 02/10/2026: "o robô não pode marcar reunião; o vendedor faz contato
 * com cada um lá na carteira"). As ferramentas horarios_livres e
 * marcar_demonstracao, que ficavam desligadas por uma chave, saíram de vez para
 * ninguém religar por engano. Quem quer falar com alguém → chamar_pessoa, e o
 * vendedor da carteira entra em contato pelo portal dele.
 */

/** A loja do contato, se o número que está escrevendo é mesmo o dela (o da loja ou o do proprietário). */
async function lojaDoNumero(contato: Contato) {
  if (!contato.userId || !contato.telefone) return null;
  const loja = await prisma.user.findUnique({
    where: { id: contato.userId },
    select: { id: true, email: true, storePhone: true, notificationPhone: true, chatbotConfig: true },
  });
  if (!loja) return null;
  return numerosDaLoja(loja).some((n) => mesmoTelefone(contato.telefone, n)) ? { id: loja.id, email: loja.email } : null;
}

export const DECLARACOES = [
  {
    name: "estado_da_loja",
    description: "Raio-x da loja do lojista que está falando: robô do WhatsApp conectado, Assistente de Impressão (última consulta, versão), canais (iFood, 99Food, JotaJá), teste grátis, fatura em aberto (com link), último pedido. Só funciona quando a loja foi reconhecida pelo número.",
    parametersJsonSchema: { type: "object", properties: {} },
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
    description: "Passa a conversa para uma pessoa da equipe: o robô para de responder aqui e a equipe é avisada. Só quando: pediram atendente/humano; é decisão da equipe (cobrança contestada, cancelamento, desconto, exceção, reclamação séria); alguém precisa fazer algo na conta por ela; a base e os vídeos não cobrem o assunto; ou você já guiou o passo a passo e não resolveu. Dúvida de como usar o painel NÃO é motivo: responda.",
    parametersJsonSchema: {
      type: "object",
      properties: { motivo: { type: "string", description: "Em uma frase, o que a pessoa precisa." } },
      required: ["motivo"],
    },
  },
  {
    name: "identificar_loja",
    description: "A pessoa diz que JÁ USA o FireHub, mas o número dela não foi reconhecido. Acha a loja pelo e-mail da conta, pelo WhatsApp cadastrado na loja ou pelo nome da loja, e anota na ficha. NÃO libera nada da conta (fatura, raio-x, senha): isso só pelo número cadastrado.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        email: { type: "string", description: "E-mail da conta, se a pessoa disse." },
        telefoneDaLoja: { type: "string", description: "O WhatsApp cadastrado na loja (da loja ou do proprietário), se a pessoa disse." },
        nomeDaLoja: { type: "string", description: "Nome da loja, se a pessoa disse." },
      },
    },
  },
  {
    name: "criar_conta",
    description: "Cria a conta da loja no FireHub pela conversa (começa o teste grátis) e manda para o e-mail o link para a pessoa criar a senha. Só depois de ter todos os dados e de a pessoa CONFIRMAR o e-mail que você repetiu para ela.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        nome: { type: "string", description: "Nome do responsável." },
        nomeDaLoja: { type: "string" },
        cidade: { type: "string", description: "Cidade e estado, ex.: Cabo Frio - RJ." },
        email: { type: "string", description: "O e-mail exatamente como a pessoa confirmou." },
        cpf: { type: "string", description: "CPF do responsável (obrigatório, mesmo com CNPJ)." },
        cnpj: { type: "string", description: "CNPJ da empresa, se tiver. Sem CNPJ a conta fica no CPF." },
        whatsappDaLoja: { type: "string", description: "Só se a pessoa disse que o WhatsApp da loja é outro número que não este." },
        emailConfirmado: { type: "boolean", description: "true só se você repetiu o e-mail e a pessoa confirmou que está certo." },
      },
      required: ["nome", "nomeDaLoja", "cidade", "email", "cpf", "emailConfirmado"],
    },
  },
  {
    name: "montar_loja",
    description: "Passa para a equipe a montagem da loja (lançar o cardápio inteiro, de graça, e configurar bairros, taxas e horários). Use quando tiver o nome da loja e o link do cardápio OU as fotos do cardápio enviadas na conversa. A equipe continua a conversa por aqui.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        linkDoCardapio: { type: "string", description: "O link do cardápio que a loja usa hoje, exatamente como a pessoa mandou. Vazio quando ela mandou fotos." },
        cardapioEmFotos: { type: "boolean", description: "true quando a pessoa mandou fotos do cardápio (físico, impresso) em vez de link." },
        semContaPorEscolha: { type: "boolean", description: "true só se a pessoa ainda não tem conta e DISSE que não quer passar os dados agora. Sem conta e sem isso, crie a conta antes (criar_conta)." },
        nomeDaLoja: { type: "string" },
        cidade: { type: "string" },
        bairros: { type: "string", description: "Bairros atendidos e as taxas, se a pessoa disse." },
        horarios: { type: "string", description: "Dias e horários de funcionamento, se a pessoa disse." },
      },
      required: ["nomeDaLoja"],
    },
  },
] as const;

const soDaLoja = { erro: "A loja não foi reconhecida por este número. Oriente com a base e, se precisar mexer na conta, chame uma pessoa." };

export async function executarFerramenta(nome: string, args: any, contato: Contato): Promise<Record<string, unknown>> {
  switch (nome) {
    case "estado_da_loja": {
      const loja = await lojaDoNumero(contato);
      if (!loja) return soDaLoja;
      const estado = await estadoDaLojaParaSuporte(loja.id, { aoVivo: true });
      return estado ? { ...estado } : { erro: "Loja não encontrada." };
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

    case "identificar_loja": {
      if (await lojaDoNumero(contato)) return { ok: true, aviso: "Este número já é da loja dele: siga no modo suporte." };
      const email = String(args?.email || "").trim().toLowerCase();
      const telefone = String(args?.telefoneDaLoja || "").trim();
      const nome = String(args?.nomeDaLoja || "").trim();
      const SELECT = { id: true, storeName: true, name: true, city: true, slug: true } as const;
      let lojas: { id: string; storeName: string | null; name: string | null; city: string | null; slug: string | null }[] = [];
      if (email) lojas = await prisma.user.findMany({ where: { role: "FRANCHISEE", email: { equals: email, mode: "insensitive" } }, select: SELECT, take: 3 });
      if (lojas.length === 0 && telefone) {
        const l = await lojaDoTelefone(telefone);
        if (l) lojas = await prisma.user.findMany({ where: { id: l.id }, select: SELECT });
      }
      if (lojas.length === 0 && nome.length >= 3) {
        lojas = await prisma.user.findMany({ where: { role: "FRANCHISEE", storeName: { contains: nome, mode: "insensitive" } }, select: SELECT, take: 5 });
      }
      if (lojas.length === 0) return { achou: false, aviso: "Não achei a loja. Peça o e-mail da conta ou o WhatsApp cadastrado na loja; se ainda assim não achar, use chamar_pessoa." };
      if (lojas.length > 1) {
        return { achou: false, opcoes: lojas.map((l) => `${l.storeName || l.name}${l.city ? ` (${l.city})` : ""}`), aviso: "Mais de uma loja com esse nome: pergunte a cidade ou o e-mail da conta." };
      }
      const loja = lojas[0];
      await prisma.crmContato.update({
        where: { id: contato.id },
        data: { nomeDaLoja: loja.storeName || loja.name, ...(!contato.cidade && loja.city ? { cidade: loja.city } : {}) },
      });
      // Só a anotação: o vínculo de verdade (userId, vendedor, etapa) vem do NÚMERO,
      // senão qualquer um que dissesse "sou da loja X" entrava na carteira dela.
      await registrarEvento(
        contato.id, "CADASTRO",
        `Diz ser da loja ${loja.storeName || loja.name} (firehubfood.com.br/loja/${loja.slug}). Este número não está cadastrado na loja — confirmar antes de mexer na conta.`,
        AUTOR_ROBO, { lojaInformada: loja.id },
      );
      return {
        ok: true, loja: loja.storeName || loja.name,
        aviso: "Atenda como SUPORTE: o passo a passo da base e dos vídeos vale igual para ele; só não mostre nem mexa em dados da conta (fatura, pedidos, senha, reiniciar). Resolva a dúvida primeiro. Depois, explique curto que para o atendimento reconhecer este número é só cadastrá-lo no painel: Minha Loja → WhatsApp do proprietário (se ainda estiver vazio) ou Chatbot IA → Notificações → 'Outras pessoas que recebem os alertas'. chamar_pessoa só se alguém precisar fazer algo na conta por ele.",
      };
    }

    case "criar_conta": {
      // O e-mail errado prende a conta (o link da senha vai para ele): sem a confirmação, não cria.
      if (args?.emailConfirmado !== true) return { erro: "Repita o e-mail para a pessoa e peça para confirmar antes de criar a conta." };
      const atual = await prisma.crmContato.findUnique({ where: { id: contato.id }, select: { userId: true, jid: true } });
      return criarContaPeloWhatsApp({ ...contato, userId: atual?.userId ?? contato.userId, jid: atual?.jid }, {
        nome: String(args?.nome || ""), nomeDaLoja: String(args?.nomeDaLoja || ""), cidade: String(args?.cidade || ""),
        email: String(args?.email || ""), cpf: String(args?.cpf || ""), cnpj: args?.cnpj ? String(args.cnpj) : undefined,
        whatsappDaLoja: args?.whatsappDaLoja ? String(args.whatsappDaLoja) : undefined,
      });
    }

    case "montar_loja": {
      const link = String(args?.linkDoCardapio || "").trim().slice(0, 500);
      const nomeDaLoja = String(args?.nomeDaLoja || "").trim().slice(0, 120);
      const ehLink = /^(https?:\/\/)?[\w-]+(\.[\w-]+)+\S*$/i.test(link);
      // "Mandou foto" é conferido na conversa, não na palavra do modelo: a equipe abre o WhatsApp esperando as fotos.
      const fotos = args?.cardapioEmFotos === true
        ? await prisma.crmMensagem.count({ where: { contatoId: contato.id, direcao: "ENTRADA", tipo: "IMAGEM" } })
        : 0;
      if (!ehLink && fotos === 0) return { erro: "Falta o cardápio: peça o link (o endereço que o cliente abre para pedir) ou fotos do cardápio." };
      if (!nomeDaLoja) return { erro: "Falta o nome da loja. Pergunte antes." };
      // Passar a montagem cala o robô (chama pessoa). Feito antes da conta, a
      // pessoa mandava os dados que o próprio robô tinha pedido e ficava sem
      // resposta (teste de 02/10). Conta primeiro, a não ser que ela recuse.
      if (!contato.userId && args?.semContaPorEscolha !== true) {
        return { erro: "Ainda sem conta. Guarde o cardápio (já está na conversa) e peça os dados para criar a conta agora; depois de criar_conta, use montar_loja. Só passe sem conta se a pessoa disser que não quer passar os dados." };
      }
      // A equipe já foi chamada para esta montagem hoje: não manda o aviso de novo.
      const jaPedida = await prisma.crmEvento.findFirst({
        where: { contatoId: contato.id, texto: { startsWith: "Chamou uma pessoa: Montar a loja" }, criadoEm: { gte: new Date(Date.now() - 24 * 60 * 60_000) } },
        select: { id: true },
      });
      if (jaPedida) return { ok: true, jaEstavaPedida: true, aviso: "A equipe já recebeu este pedido de montagem. Diga, curto, que ela continua por aqui." };
      const cidade = String(args?.cidade || "").trim().slice(0, 120);
      await prisma.crmContato.update({
        where: { id: contato.id },
        data: { nomeDaLoja, ...(cidade ? { cidade } : {}) },
      });
      const conta = contato.userId ? await prisma.user.findUnique({ where: { id: contato.userId }, select: { slug: true, email: true } }) : null;
      const detalhes = [
        `Montar a loja ${nomeDaLoja}${cidade ? ` (${cidade})` : ""}.`,
        conta ? `Conta: firehubfood.com.br/loja/${conta.slug} (${conta.email})` : "Ainda sem conta no FireHub.",
        ehLink ? `Cardápio: ${link}` : "",
        fotos ? `Cardápio em ${fotos} foto(s) na conversa — ver no WhatsApp do FireHub.` : "",
        args?.bairros ? `Bairros/taxas: ${String(args.bairros).slice(0, 400)}` : "",
        args?.horarios ? `Horários: ${String(args.horarios).slice(0, 300)}` : "",
      ].filter(Boolean).join("\n");
      await chamarPessoa({ ...contato, nomeDaLoja }, detalhes);
      return { ok: true, aviso: "Diga, curto, que a equipe já recebeu o cardápio e continua por aqui para deixar a loja pronta. Não continue o atendimento." };
    }

    default:
      return { erro: `Ferramenta desconhecida: ${nome}` };
  }
}

/**
 * Para o robô na conversa e avisa o dono. Usada também pela trava de respostas.
 * O vendedor não é avisado: a conversa aparece no portal dele, no filtro
 * "Pediram pessoa" (lib/atendimento/avisos.ts).
 */
export async function chamarPessoa(contato: Pick<Contato, "id" | "nome" | "nomeDaLoja" | "vendedorId" | "userId">, motivo: string) {
  await prisma.crmContato.update({ where: { id: contato.id }, data: { aguardandoHumanoDesde: new Date() } });
  await registrarEvento(contato.id, "ROBO", `Chamou uma pessoa: ${motivo}`, AUTOR_ROBO);
  const quem = contato.nomeDaLoja || contato.nome || "Um contato";
  const texto = `🙋 ${quem} precisa de uma pessoa no WhatsApp do FireHub.\nMotivo: ${motivo}\nResponda em https://firehubfood.com.br/admin?aba=atendimento&contato=${contato.id}`;
  void avisarDono(texto).catch(() => null);
}
