import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/mail";
import { registrarEvento, AUTOR_ROBO } from "@/lib/crm/contatos";
import { telefoneParaExibir } from "@/lib/crm/telefone";

/**
 * O CADASTRO PELO WHATSAPP — o robô do FireHub cria a conta da loja na conversa.
 *
 * A conta nasce pela MESMA rota do site (/api/register): CPF conferido, uma
 * conta por documento e por e-mail, teste grátis, vínculo com o CRM e com o
 * vendedor (aoCadastrarLoja). Duas cópias dessa regra divergiriam.
 *
 * A senha nunca passa pelo WhatsApp. A conta nasce com uma senha aleatória que
 * ninguém conhece, e a pessoa cria a dela pelo link que vai para o E-MAIL — o
 * mesmo token da tela /redefinir-senha, mas com 3 dias (o "esqueci a senha"
 * vale 1 hora, curto demais para quem acabou de conhecer o sistema) e com um
 * texto de boas-vindas, não de "você pediu para redefinir".
 */

const VALIDADE_DO_LINK_MS = 3 * 24 * 60 * 60_000;
const APP_URL = (process.env.NEXTAUTH_URL || "").startsWith("http") ? process.env.NEXTAUTH_URL!.replace(/\/$/, "") : "https://firehubfood.com.br";

type Contato = { id: string; telefone: string | null; jid?: string | null; userId: string | null };

export type DadosDoCadastro = {
  nome: string; nomeDaLoja: string; cidade: string; email: string; cpf: string; cnpj?: string; whatsappDaLoja?: string;
};

const mascararEmail = (email: string) => {
  const [usuario, dominio] = email.split("@");
  return `${usuario.slice(0, 2)}***@${dominio}`;
};

export async function criarContaPeloWhatsApp(contato: Contato, d: DadosDoCadastro): Promise<Record<string, unknown>> {
  if (contato.userId) return { erro: "Este contato já tem conta no FireHub. Não crie outra: trate como suporte." };

  const email = String(d.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { erro: "E-mail inválido. Peça de novo." };
  for (const [campo, valor] of [["nome", d.nome], ["nome da loja", d.nomeDaLoja], ["cidade", d.cidade], ["CPF", d.cpf]] as const) {
    if (!String(valor || "").trim()) return { erro: `Falta ${campo}. Pergunte antes.` };
  }
  const cnpj = String(d.cnpj || "").replace(/\D/g, "");
  // O WhatsApp da loja é o número que está conversando, a não ser que digam outro:
  // é por ele que o atendimento reconhece a loja depois (suporte, raio-x).
  const whatsapp = String(d.whatsappDaLoja || "").replace(/\D/g, "") || telefoneParaExibir(contato.telefone || contato.jid).replace(/\D/g, "");

  const porta = process.env.PORT || "3000";
  const r = await fetch(`http://127.0.0.1:${porta}/api/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: d.nome.trim().slice(0, 120),
      storeName: d.nomeDaLoja.trim().slice(0, 120),
      city: d.cidade.trim().slice(0, 120),
      email,
      password: crypto.randomBytes(24).toString("base64url"),
      phone: whatsapp || null,
      cpf: d.cpf,
      cnpj: cnpj || undefined,
      semCnpj: !cnpj,
      comoConheceu: "WhatsApp do FireHub (robô)",
    }),
    signal: AbortSignal.timeout(30000),
  }).catch(() => null);
  if (!r) return { erro: "Não consegui criar a conta agora. Chame uma pessoa." };
  const resposta = await r.json().catch(() => ({}));
  // CPF inválido, CPF/CNPJ ou e-mail que já têm conta: o texto da rota vai para o modelo explicar.
  if (!r.ok || !resposta?.userId) return { erro: resposta?.error || `O cadastro respondeu ${r.status}.` };

  const userId: string = resposta.userId;
  const token = crypto.randomBytes(32).toString("hex");
  await prisma.user.update({ where: { id: userId }, data: { resetToken: token, resetTokenExp: new Date(Date.now() + VALIDADE_DO_LINK_MS) } });

  // aoCadastrarLoja liga pelo telefone ou pelo e-mail; com outro número ou um
  // contato antigo com o mesmo e-mail, esta conversa ficaria sem a loja.
  await prisma.crmContato.updateMany({ where: { id: contato.id, userId: null }, data: { userId, etapa: "EM_TESTE" } });
  await registrarEvento(contato.id, "CADASTRO", `O robô criou a conta da loja ${resposta.storeName} pelo WhatsApp (${mascararEmail(email)}).`, AUTOR_ROBO, { userId });

  const email_ = await sendEmail({
    to: email,
    subject: "🔥 Sua loja no FireHub está criada — falta só a senha",
    html: emailDeBoasVindas(d.nome.trim().split(/\s+/)[0], resposta.storeName, `${APP_URL}/redefinir-senha?token=${token}`, `${APP_URL}/loja/${resposta.slug}`),
  }).catch((err: any) => ({ success: false, error: err?.message }));
  // Na ficha, para quem assumir a conversa (a montagem chama pessoa logo depois e o aviso dela não fala do e-mail).
  if (!email_.success) await registrarEvento(contato.id, "CADASTRO", `O e-mail para criar a senha NÃO saiu (${email}). Mandar o acesso à mão.`, AUTOR_ROBO, { userId });

  return {
    ok: true,
    email: mascararEmail(email),
    emailEnviado: !!email_.success,
    cardapio: `firehubfood.com.br/loja/${resposta.slug}`,
    painel: "firehubfood.com.br/login",
    aviso: email_.success
      ? "Diga que a conta foi criada e o teste grátis começou; que chegou no e-mail o link para criar a senha (vale 3 dias, olhar o spam). Depois ofereça montar a loja: é só mandar o link do cardápio que usa hoje."
      : "A conta foi criada, mas o e-mail não saiu. Diga que a conta está criada e use chamar_pessoa para a equipe mandar o acesso.",
  };
}

const escapar = (s: string) => String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function emailDeBoasVindas(nomeDigitado: string, lojaDigitada: string, linkDaSenha: string, linkDoCardapio: string): string {
  // Nome e loja vêm digitados na conversa: escapados antes de entrar no HTML.
  const primeiroNome = escapar(nomeDigitado);
  const loja = escapar(lojaDigitada);
  return `
    <div style="font-family: Inter, sans-serif; max-width: 520px; margin: 0 auto; background: #fff; border-radius: 16px; overflow: hidden; border: 1px solid #E2E8F0;">
      <div style="background: linear-gradient(135deg, #DC2626, #B91C1C); padding: 32px; text-align: center;">
        <h1 style="color: #fff; font-size: 1.8rem; font-weight: 800; margin: 0;">🔥 FIRE<span style="font-weight: 400;">HUB</span></h1>
      </div>
      <div style="padding: 36px 32px;">
        <h2 style="color: #1E293B; font-size: 1.2rem; margin: 0 0 12px;">Bem-vindo, ${primeiroNome || "lojista"}!</h2>
        <p style="color: #475569; font-size: 0.95rem; line-height: 1.6; margin: 0 0 24px;">
          A conta da <strong>${loja}</strong> foi criada pelo nosso WhatsApp e o seu teste grátis já começou.
          Falta só criar a sua senha para entrar no painel.
        </p>
        <div style="text-align: center; margin: 28px 0;">
          <a href="${linkDaSenha}" style="display: inline-block; background: #DC2626; color: #fff; text-decoration: none; padding: 14px 32px; border-radius: 12px; font-weight: 700;">Criar minha senha</a>
        </div>
        <p style="color: #64748B; font-size: 0.88rem; line-height: 1.6; margin: 0;">
          O endereço do seu cardápio: <a href="${linkDoCardapio}" style="color: #DC2626;">${linkDoCardapio.replace(/^https?:\/\//, "")}</a><br>
          Quer a loja montada por nós? Mande no WhatsApp o link do cardápio que você usa hoje.
        </p>
        <p style="color: #94A3B8; font-size: 0.8rem; margin: 24px 0 0; text-align: center;">O link para criar a senha vale por 3 dias.</p>
      </div>
    </div>`;
}
