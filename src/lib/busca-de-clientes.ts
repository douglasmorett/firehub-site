/**
 * A BUSCA DE CLIENTES NO BALCÃO: o atendente começa a digitar o telefone (ou
 * o nome) e a tela oferece os clientes da loja com número parecido, para
 * clicar e copiar — nome, telefone e o último endereço de entrega.
 *
 * O Douglas mostrou o Gama Delivery fazendo isso (02/10/2026, Showrrascão):
 * "começa a digitar o número e ele já oferece o cliente que tem número
 * parecido; você só clica e copia; se quiser editar, é só editar".
 *
 * ── De onde vêm os clientes ─────────────────────────────────────────────────
 *
 *   1. Pedidos DESTA loja (CustomerOrder): quem já pediu aqui, por qualquer
 *      canal, com o nome e o endereço que deu da última vez.
 *   2. Cadastros ligados a esta loja (StoreCustomer.lojaDeOrigemId): a base
 *      que a loja trouxe de outro sistema (scripts/importar-clientes-do-gama
 *      .mjs) — 13.380 nomes da Showrrascão que ainda não têm pedido aqui.
 *
 * StoreCustomer é uma tabela única da plataforma (telefone único, sem loja):
 * buscar nela por prefixo sem o vínculo mostraria a clientela de TODAS as
 * lojas a qualquer lojista logado. Por isso o prefixo só vale nos pedidos da
 * loja e nos cadastros ligados a ela; o cadastro solto só aparece quando o
 * atendente digitou o número INTEIRO (é o mesmo que o robô faz ao chamar o
 * cliente pelo nome).
 *
 * A consulta no banco é grosseira (o que o SQL consegue com o telefone gravado
 * de qualquer jeito — "(22) 99276-1161", "5522992761161", "22992761161"); o
 * refino, a junção e a ordem são aqui, testados sem banco
 * (scripts/teste-busca-de-clientes.ts).
 */
import { lerEnderecoGravado, textoDoEndereco } from "@/lib/cliente-reconhecido";
import type { EnderecoLembrado } from "@/lib/cliente-lembrado";

export type ConsultaDeClientes = {
  /** Os dígitos digitados (prefixo do telefone), ou "" quando a busca é por nome. */
  digitos: string;
  /** O nome digitado (duas letras ou mais), ou "" quando a busca é por telefone. */
  nome: string;
};

export type ClienteSugerido = {
  nome: string;
  /** DDD + número, só dígitos (é o que vai para o campo). */
  telefone: string;
  /** "(22) 99276-1161", para a lista. */
  telefoneBonito: string;
  /** O endereço da entrega mais recente, separado quando deu para ler. */
  endereco: (EnderecoLembrado & { texto: string }) | null;
  /** O endereço como foi gravado, para o campo livre do balcão quando não deu para separar. */
  enderecoTexto: string;
  /** Quantos pedidos nesta loja (0 = só o cadastro). */
  pedidos: number;
  ultimoPedido: string | null;
};

export type PedidoParaBusca = {
  customerName?: string | null;
  customerPhone?: string | null;
  customerAddress?: string | null;
  customerLatLng?: unknown;
  deliveryType?: string | null;
  createdAt?: Date | string | null;
};

export type CadastroParaBusca = {
  name?: string | null;
  phone?: string | null;
  address?: string | null;
};

export const MINIMO_DE_DIGITOS = 3;
export const MINIMO_DE_LETRAS = 2;
export const MAXIMO_DE_SUGESTOES = 8;

const texto = (v: unknown, max = 120) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** DDD + número, só dígitos, sem o 55 do país; "" quando não parece telefone. */
export function digitosNacionais(bruto: unknown): string {
  let d = String(bruto ?? "").replace(/\D/g, "");
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) d = d.slice(2);
  // 0800 e afins (telefone mascarado do iFood) não são de ninguém.
  if (d.startsWith("0800") || d.length < 8) return "";
  return d;
}

/** "(22) 99276-1161" / "(22) 2764-1161"; o que não é DDD+número sai como veio. */
export function telefoneBonito(digitos: string): string {
  const d = digitosNacionais(digitos) || String(digitos || "").replace(/\D/g, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return d;
}

/** O que o atendente digitou vira busca por telefone (dígitos) ou por nome (letras). */
export function lerConsulta(bruto: unknown): ConsultaDeClientes | null {
  const t = texto(bruto, 60);
  if (!t) return null;
  const digitos = t.replace(/\D/g, "");
  const letras = t.replace(/[^\p{L}]/gu, "");
  if (digitos.length >= MINIMO_DE_DIGITOS && letras.length === 0) {
    // Número inteiro colado com o país ("5522992761161"): tira o 55. Em
    // prefixo curto o 55 fica — é também o DDD de Santa Maria e região.
    const semPais = digitos.length >= 12 && digitos.startsWith("55") ? digitos.slice(2) : digitos;
    return { digitos: semPais.slice(0, 11), nome: "" };
  }
  if (letras.length >= MINIMO_DE_LETRAS && digitos.length === 0) return { digitos: "", nome: t };
  return null;
}

/** O telefone nacional casa com o prefixo digitado: desde o DDD, ou só o número (sem DDD). */
export function telefoneCasa(telefoneNacional: string, digitos: string): boolean {
  if (!telefoneNacional || !digitos) return false;
  if (telefoneNacional.startsWith(digitos)) return true;
  // Sem o DDD: "99276" acha "22992761161". Com o 9 na frente ou sem ele.
  const local = telefoneNacional.length >= 10 ? telefoneNacional.slice(2) : telefoneNacional;
  if (local.startsWith(digitos)) return true;
  if (local.length === 9 && local.startsWith("9") && local.slice(1).startsWith(digitos)) return true;
  return false;
}

export function nomeCasa(nome: string, procurado: string): boolean {
  const a = semAcento(texto(nome));
  const b = semAcento(texto(procurado));
  return Boolean(a) && Boolean(b) && a.includes(b);
}

const instante = (d: Date | string | null | undefined): number => {
  const n = d instanceof Date ? d.getTime() : d ? new Date(d).getTime() : NaN;
  return Number.isFinite(n) ? n : 0;
};

const NOME_GENERICO = /^(cliente|consumidor|balc[aã]o|mesa\b.*|sem nome|n[aã]o informado|func\. .*)$/i;

/**
 * Junta pedidos e cadastros num cliente por telefone, filtra pela consulta e
 * ordena: quem pediu mais recentemente primeiro; cadastro sem pedido no fim,
 * por nome.
 */
export function sugerirClientes(
  consulta: ConsultaDeClientes,
  pedidos: readonly PedidoParaBusca[],
  cadastros: readonly CadastroParaBusca[],
): ClienteSugerido[] {
  const porTelefone = new Map<string, ClienteSugerido & { _em: number }>();

  const ordenados = [...pedidos].sort((a, b) => instante(b.createdAt) - instante(a.createdAt));
  for (const p of ordenados) {
    const tel = digitosNacionais(p.customerPhone);
    if (!tel) continue;
    const nome = texto(p.customerName, 80);
    const nomeVale = nome.length >= 2 && !NOME_GENERICO.test(nome);
    const ehEntrega = String(p.deliveryType || "").toUpperCase() === "DELIVERY";
    const enderecoBruto = ehEntrega ? texto(p.customerAddress, 200) : "";
    const lido = enderecoBruto ? lerEnderecoGravado(enderecoBruto, p.customerLatLng) : null;
    const atual = porTelefone.get(tel);
    if (atual) {
      atual.pedidos++;
      // O mais recente já está lá; os antigos só completam o que faltava.
      if (!atual.nome && nomeVale) atual.nome = nome;
      if (!atual.enderecoTexto && enderecoBruto) {
        atual.enderecoTexto = enderecoBruto;
        atual.endereco = lido ? { ...lido, texto: textoDoEndereco(lido) } : null;
      }
      continue;
    }
    porTelefone.set(tel, {
      nome: nomeVale ? nome : "",
      telefone: tel,
      telefoneBonito: telefoneBonito(tel),
      endereco: lido ? { ...lido, texto: textoDoEndereco(lido) } : null,
      enderecoTexto: enderecoBruto,
      pedidos: 1,
      ultimoPedido: new Date(instante(p.createdAt) || Date.now()).toISOString(),
      _em: instante(p.createdAt),
    });
  }

  for (const c of cadastros) {
    const tel = digitosNacionais(c.phone);
    if (!tel) continue;
    const nome = texto(c.name, 80);
    const atual = porTelefone.get(tel);
    if (atual) {
      if (!atual.nome && nome.length >= 2) atual.nome = nome;
      continue;
    }
    const enderecoBruto = texto(c.address, 200);
    const lido = enderecoBruto ? lerEnderecoGravado(enderecoBruto) : null;
    porTelefone.set(tel, {
      nome: nome.length >= 2 ? nome : "",
      telefone: tel,
      telefoneBonito: telefoneBonito(tel),
      endereco: lido ? { ...lido, texto: textoDoEndereco(lido) } : null,
      enderecoTexto: enderecoBruto,
      pedidos: 0,
      ultimoPedido: null,
      _em: 0,
    });
  }

  return [...porTelefone.values()]
    .filter((c) => (consulta.digitos ? telefoneCasa(c.telefone, consulta.digitos) : nomeCasa(c.nome, consulta.nome)))
    // Quem pediu mais recente primeiro; cadastros sem pedido por nome, e os sem nome por último.
    .sort((a, b) => b._em - a._em || Number(!a.nome) - Number(!b.nome) || a.nome.localeCompare(b.nome, "pt-BR"))
    .slice(0, MAXIMO_DE_SUGESTOES)
    .map(({ _em, ...c }) => c);
}

/**
 * O que vai para os campos do balcão quando o atendente clica numa sugestão.
 * O balcão guarda "Rua e número" num campo livre e o bairro num select (loja
 * por bairros) ou no fim do texto (loja por km) — lib/… venda-presencial.
 */
export function preencherBalcao(
  c: ClienteSugerido,
  bairrosDaLoja: readonly { name: string }[],
): { nome: string; telefone: string; endereco: string; bairro: string } {
  const porBairros = bairrosDaLoja.length > 0;
  if (!c.endereco) {
    // Texto que não deu para separar vai inteiro para o campo livre.
    return { nome: c.nome, telefone: telefoneBonito(c.telefone), endereco: c.enderecoTexto, bairro: "" };
  }
  const e = c.endereco;
  const ruaENumero = `${e.rua}, ${e.numero}${e.complemento ? ` (${e.complemento})` : ""}`;
  if (porBairros) {
    const alvo = semAcento(e.bairro);
    const daLista = bairrosDaLoja.find((b) => semAcento(b.name) === alvo)?.name || "";
    // Bairro fora da lista: fica no texto para o atendente ver e escolher.
    return { nome: c.nome, telefone: telefoneBonito(c.telefone), endereco: daLista ? ruaENumero : `${ruaENumero} - ${e.bairro}`, bairro: daLista };
  }
  return { nome: c.nome, telefone: telefoneBonito(c.telefone), endereco: e.bairro ? `${ruaENumero} - ${e.bairro}` : ruaENumero, bairro: "" };
}
