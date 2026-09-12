/**
 * O endereço do cardápio da loja: `firehubfood.com.br/loja/<slug>`.
 *
 * ── Por que o slug precisa acompanhar o nome ────────────────────────────────
 *
 * O slug nascia no cadastro e ficava congelado para sempre. Quem errava o nome
 * ali — e muita gente erra — ficava com o link errado no cardápio, no QR, no
 * WhatsApp e na comanda, sem jeito de consertar sozinho.
 *
 * O caso que forçou isto: a loja do Lucas entrou como
 * "65.584.171 LUCAS PIMENTA MARINHO MACHADO", porque o CNPJ dele é MEI e a
 * consulta devolveu a RAZÃO SOCIAL (que num MEI é o número + o nome da pessoa)
 * no lugar do nome fantasia. O cardápio dele ficou em
 * `/loja/65-584-171-lucas-pimenta-marinho-machado`.
 *
 * ── Link antigo não pode morrer ─────────────────────────────────────────────
 *
 * Trocar o slug quebraria QR já impresso em comanda, link no perfil do
 * Instagram, print salvo no WhatsApp do cliente. Por isso o anterior é
 * guardado em `User.slugsAntigos` e a página do cardápio redireciona: o
 * endereço velho continua levando ao lugar certo, para sempre.
 */

const MAX = 60;

/** Texto vira endereço: sem acento, sem maiúscula, sem símbolo. */
export function slugDoNome(nome: string | null | undefined): string {
  return String(nome || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX)
    .replace(/-+$/g, "");
}

/**
 * O nome da loja a partir do que a consulta do CNPJ devolveu.
 *
 * A ORDEM IMPORTA e era o contrário: `nome_fantasia || razao_social || digitado`.
 * Num MEI o nome fantasia costuma vir vazio e a razão social é o número do CNPJ
 * seguido do nome da pessoa — então a loja nascia batizada com o nome do dono.
 *
 * Agora o que a pessoa DIGITOU vence a razão social: ela acabou de escrever o
 * nome do negócio dela numa caixa que pergunta exatamente isso. A razão social
 * fica como último recurso, para quem não digitou nada.
 */
export function nomeDaLojaPeloCnpj(
  cnpj: { nome_fantasia?: string | null; razao_social?: string | null } | null | undefined,
  digitadoPelaPessoa?: string | null,
): string {
  const fantasia = String(cnpj?.nome_fantasia || "").trim();
  if (fantasia) return fantasia;
  const digitado = String(digitadoPelaPessoa || "").trim();
  if (digitado) return digitado;
  return String(cnpj?.razao_social || "").trim();
}

/**
 * A razão social parece ser o nome de uma PESSOA e não de um negócio?
 *
 * MEI vem como "65.584.171 LUCAS PIMENTA MARINHO MACHADO" ou
 * "12345678900 MARIA DA SILVA". Serve para a tela avisar, não para bloquear:
 * existe empresa que se chama pelo nome do dono de propósito.
 */
export function pareceNomeDePessoa(texto: string | null | undefined): boolean {
  const t = String(texto || "").trim();
  if (!t) return false;
  // Começa com o número do CNPJ/CPF — a marca registrada do MEI.
  if (/^\d[\d.\-/]{6,}/.test(t)) return true;
  // Sem nenhuma palavra de negócio e com cara de nome completo.
  if (/\b(ltda|me\b|eireli|s\.?a\.?|comercio|comércio|restaurante|lanchonete|pizzaria|burguer|burger|food|bar\b|cafe|café|padaria|mercado)\b/i.test(t)) return false;
  const palavras = t.split(/\s+/).filter(Boolean);
  return palavras.length >= 3 && palavras.every((p) => /^[A-Za-zÀ-ÿ']+$/.test(p));
}

/**
 * O slug ATUAL de uma loja cujo endereço antigo alguém acessou.
 *
 * Devolve `null` quando o endereço não pertence a ninguém — aí é 404 mesmo.
 * Consulta só quando o slug direto não achou nada, então não custa nada no
 * caminho normal.
 *
 * O `prisma` chega por parâmetro para este arquivo continuar sem banco: ele
 * é importado por tela de cliente também.
 */
export async function slugAtualDeUmAntigo(
  prisma: { user: { findFirst: (args: any) => Promise<{ slug: string | null } | null> } },
  slugPedido: string,
): Promise<string | null> {
  const alvo = String(slugPedido || "").trim();
  if (!alvo) return null;
  try {
    const dona = await prisma.user.findFirst({
      where: { slugsAntigos: { array_contains: alvo } },
      select: { slug: true },
    });
    return dona?.slug && dona.slug !== alvo ? dona.slug : null;
  } catch {
    // Coluna ainda não existe no banco (container velho): sem redirecionamento,
    // que é exatamente como era antes. Nunca derruba a página.
    return null;
  }
}

/** Os slugs que esta loja já teve. Link antigo continua valendo por causa deles. */
export function slugsAntigosDaLoja(bruto: unknown): string[] {
  const lista = Array.isArray(bruto) ? bruto : [];
  return lista.map((s) => String(s || "").trim()).filter(Boolean);
}

/**
 * O slug novo depois de uma troca de nome, com o histórico atualizado.
 *
 * Devolve `null` quando nada muda — nome igual, ou o slug calculado é o mesmo
 * que já está em uso. Sem isso, salvar a tela de configurações sem mexer no
 * nome empurraria o mesmo slug para o histórico a cada clique.
 */
export function slugAposRenomear(
  nomeNovo: string | null | undefined,
  slugAtual: string | null | undefined,
  slugsAntigos: unknown,
): { slug: string; slugsAntigos: string[] } | null {
  const novo = slugDoNome(nomeNovo);
  if (!novo) return null;
  const atual = String(slugAtual || "").trim();
  if (novo === atual) return null;

  const historico = slugsAntigosDaLoja(slugsAntigos);
  if (atual && !historico.includes(atual)) historico.push(atual);
  // O slug novo sai do histórico: ele é o atual agora, e ficar nos dois lugares
  // faria a página redirecionar para si mesma.
  const limpo = historico.filter((s) => s !== novo).slice(-20);
  return { slug: novo, slugsAntigos: limpo };
}
