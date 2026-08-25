import bcrypt from "bcryptjs";

/**
 * /src/lib/motoboy-senha.ts
 *
 * Senha do app do entregador — guardada como hash, conferida em um lugar só.
 *
 * O app do motoboy é uma página pública (/loja/[slug]/motoboy) que não passa
 * pelo NextAuth. A senha era gravada em texto puro, valia "123456" para quem
 * nunca trocou, e a listagem do painel devolvia o valor no JSON. Quem abrisse a
 * aba de rede do navegador — ou alcançasse a rota — lia a senha de todos os
 * entregadores da loja, e com ela vê endereço, telefone e nome dos clientes.
 *
 * A migração é feita no acesso: senha antiga em texto puro é conferida como
 * está e regravada como hash na mesma requisição. Ninguém precisa ser avisado,
 * e nenhum entregador fica trancado para fora.
 */

/**
 * O padrão continua valendo para quem ainda não trocou.
 *
 * Tirá-lo de uma vez trancaria entregador para fora no meio do turno — foi
 * exatamente esse tipo de quebra que derrubou a correção anterior de
 * multi-tenant e obrigou a reverter tudo. O que sai daqui é a resposta
 * `mustChangePassword`, para a tela cobrar a troca de quem ainda usa.
 */
export const SENHA_PADRAO = "123456";

/** Hash bcrypt tem prefixo reconhecível. O que não tem é senha legada, em texto puro. */
export function ehHash(valor: string | null | undefined): boolean {
  return !!valor && /^\$2[aby]\$/.test(valor);
}

export interface ConferenciaDeSenha {
  ok: boolean;
  /** Preenchido quando a senha gravada ainda era texto puro e precisa ser regravada. */
  hashParaGravar?: string;
  /** O entregador entrou com a senha padrão e deveria trocá-la. */
  ehPadrao: boolean;
}

/**
 * Confere a senha informada contra o que está no banco, aceitando os dois
 * formatos que convivem hoje: hash bcrypt e texto puro legado.
 */
export async function conferirSenha(
  guardada: string | null | undefined,
  informada: string
): Promise<ConferenciaDeSenha> {
  // Sem senha no cadastro, vale a padrão — e ela já entra hasheada.
  if (!guardada) {
    if (informada !== SENHA_PADRAO) return { ok: false, ehPadrao: false };
    return { ok: true, hashParaGravar: await hashDeSenha(informada), ehPadrao: true };
  }

  if (ehHash(guardada)) {
    const ok = await bcrypt.compare(informada, guardada);
    return { ok, ehPadrao: ok && informada === SENHA_PADRAO };
  }

  // Senha legada, em texto puro: confere como está e regrava como hash.
  const ok = guardada === informada;
  if (!ok) return { ok: false, ehPadrao: false };
  return { ok: true, hashParaGravar: await hashDeSenha(informada), ehPadrao: informada === SENHA_PADRAO };
}

export function hashDeSenha(senha: string): Promise<string> {
  return bcrypt.hash(senha, 10);
}

/**
 * Se o entregador ainda está na senha padrão — para o painel poder avisar o
 * lojista sem nunca mostrar a senha em si.
 *
 * Custa um bcrypt.compare por entregador. A lista de uma loja tem dezenas de
 * linhas, não milhares.
 */
export async function estaNaSenhaPadrao(guardada: string | null | undefined): Promise<boolean> {
  if (!guardada) return true;
  if (ehHash(guardada)) return bcrypt.compare(SENHA_PADRAO, guardada);
  return guardada === SENHA_PADRAO;
}
