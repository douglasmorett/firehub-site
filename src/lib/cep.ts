/**
 * O CEP NO CHECKOUT: o cliente digita o CEP e a rua e o bairro se preenchem,
 * como no CardápioWeb (ajuda.cardapioweb.com, "Áreas de entrega": "o cliente
 * digita o endereço ou só o CEP").
 *
 * Por que ajuda a taxa: o nome que vem do CEP é o dos Correios — a grafia
 * oficial da rua, que é a que o mapa conhece. "R do forno" digitado vira "Rua
 * do Forno"; o bairro vem escrito como a cidade escreve. É o "outro meio" além
 * de apontar a casa num mapa, que muito cliente não sabe fazer (25/09/2026).
 *
 * A consulta sai do NAVEGADOR do cliente direto para o ViaCEP (gratuito, sem
 * chave, com CORS): não gasta o servidor nem a fila do mapa, e o limite do
 * ViaCEP é por quem pergunta. O CSP do site já libera `connect-src https:`.
 *
 * O CEP só preenche: quem decide a taxa continua sendo a cotação
 * (/api/delivery-fee) com a rua, o número e o bairro que ficaram na tela.
 */

export type EnderecoDoCep = { rua: string; bairro: string; cidade: string; uf: string };

export type ConsultaDoCep =
  | { ok: true; endereco: EnderecoDoCep }
  | { ok: false; motivo: "incompleto" | "nao-existe" | "falhou" };

/** Só os dígitos, no máximo 8. */
export function digitosDoCep(v: unknown): string {
  return String(v ?? "").replace(/\D/g, "").slice(0, 8);
}

/** "28900000" → "28900-000", à medida que o cliente digita. */
export function cepFormatado(v: unknown): string {
  const d = digitosDoCep(v);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

const texto = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** A resposta do ViaCEP. `{ erro: true }` (ou "true", como ele manda às vezes) é CEP que não existe. */
export function lerRespostaDoViaCep(d: unknown): EnderecoDoCep | null {
  if (!d || typeof d !== "object") return null;
  const r = d as Record<string, unknown>;
  if (r.erro === true || r.erro === "true") return null;
  const cidade = texto(r.localidade);
  if (!cidade) return null;
  return { rua: texto(r.logradouro), bairro: texto(r.bairro), cidade, uf: texto(r.uf).toUpperCase() };
}

/** "CABO FRIO", "Cabo Frio - RJ", "Cabo Frio/RJ" → "cabo frio". */
export function cidadeComparavel(v: unknown): string {
  return String(v ?? "")
    .split(/\s[-–]\s|\/|,/)[0]
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * A frase que fica embaixo do campo depois da consulta. Vazia quando o CEP
 * preencheu rua e bairro da cidade da loja — aí não há o que dizer.
 */
export function avisoDoCep(c: ConsultaDoCep, cidadeDaLoja?: string | null): string {
  if (!c.ok) {
    if (c.motivo === "incompleto") return "";
    return c.motivo === "nao-existe"
      ? "CEP não encontrado. Confira os números ou preencha a rua e o bairro."
      : "Não consegui consultar o CEP agora. Preencha a rua e o bairro.";
  }
  const e = c.endereco;
  const outraCidade = cidadeDaLoja && cidadeComparavel(cidadeDaLoja) && cidadeComparavel(e.cidade) !== cidadeComparavel(cidadeDaLoja);
  if (outraCidade) return `Esse CEP é de ${e.cidade}${e.uf ? `-${e.uf}` : ""}. Confira se é o endereço da entrega.`;
  // Cidade pequena tem um CEP só, sem rua nem bairro.
  if (!e.rua && !e.bairro) return "Esse CEP é da cidade toda: preencha a rua e o bairro.";
  if (!e.rua) return "Preencha a rua — o CEP só trouxe o bairro.";
  if (!e.bairro) return "Preencha o bairro — o CEP só trouxe a rua.";
  return "";
}

/** Pergunta ao ViaCEP. Nunca lança: o CEP é ajuda, não obrigação. */
export async function buscarCep(
  cep: unknown,
  opcoes: { fetch?: typeof fetch; prazoMs?: number } = {},
): Promise<ConsultaDoCep> {
  const d = digitosDoCep(cep);
  if (d.length !== 8) return { ok: false, motivo: "incompleto" };
  const f = opcoes.fetch ?? fetch;
  const controle = typeof AbortController !== "undefined" ? new AbortController() : null;
  const relogio = controle ? setTimeout(() => controle.abort(), opcoes.prazoMs ?? 6000) : null;
  try {
    const r = await f(`https://viacep.com.br/ws/${d}/json/`, controle ? { signal: controle.signal } : undefined);
    // 400 é CEP mal formado; o que não existe volta 200 com { erro: true }.
    if (r.status === 400) return { ok: false, motivo: "nao-existe" };
    if (!r.ok) return { ok: false, motivo: "falhou" };
    const endereco = lerRespostaDoViaCep(await r.json().catch(() => null));
    return endereco ? { ok: true, endereco } : { ok: false, motivo: "nao-existe" };
  } catch {
    return { ok: false, motivo: "falhou" };
  } finally {
    if (relogio) clearTimeout(relogio);
  }
}
