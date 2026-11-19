/**
 * Domínio próprio de loja → slug do cardápio (sem o "www."). Loja nova entra
 * aqui e no Coolify (Domains do app), com o DNS dela apontando para o servidor.
 *
 * Mora aqui (e não só no proxy.ts) porque o cardápio também precisa saber: a
 * canônica de /loja/<slug> aponta para o domínio da loja, que é o endereço que
 * ela divulga e quer ver no Google.
 */
export const DOMINIOS_DE_LOJA: Record<string, string> = {
  // Luiz Carlos, 09/10/2026: "redirecionar pro site" o domínio do Registro.br.
  "divinosburger.com.br": "divinos-burger",
  // Karen (PasteLê e Annalu), 26/10/2026: domínio direto no sistema, mantendo o TXT de verificação do Facebook no Registro.br.
  "pasteledocarioca.com.br": "pastel-do-carioca-yg9c",
  "annalupizzaria.com.br": "annalu-pizzas",
};

/** O endereço público do cardápio: o domínio da loja, se ela tem um; senão firehubfood.com.br/loja/<slug>. */
export function enderecoDoCardapio(slug: string): string {
  const dominio = Object.keys(DOMINIOS_DE_LOJA).find((d) => DOMINIOS_DE_LOJA[d] === slug);
  return dominio ? `https://${dominio}` : `https://firehubfood.com.br/loja/${encodeURIComponent(slug)}`;
}
