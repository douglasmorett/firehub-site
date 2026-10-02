/**
 * O CLIENTE RECONHECIDO PELO TELEFONE: o nome e os endereços em que ESTA loja
 * já entregou para ele.
 *
 * ── Por que existe ──────────────────────────────────────────────────────────
 *
 * Pedido do Douglas pela Showrrascão (02/10/2026): "quando o cliente coloca o
 * telefone, o endereço dele podia ficar salvo; na próxima vez que ele colocar
 * só o telefone, já pergunta se é aquele endereço, ou tem o histórico dos que
 * ele já usou". Até aqui o cardápio só lembrava o cliente NO APARELHO
 * (lib/cliente-lembrado.ts): quem pede de outro celular, ou limpou o
 * navegador, digita tudo de novo — e os 13.380 clientes trazidos do Gama
 * (scripts/importar-clientes-do-gama.mjs) nunca seriam reconhecidos.
 *
 * O cashback e os prêmios continuam atrás do login com senha; aqui só nome e
 * endereço, para a pessoa confirmar em vez de digitar.
 *
 * ── O que sai e o que não sai ───────────────────────────────────────────────
 *
 * A rota é pública por telefone (api/store-customer/reconhecer), então o
 * recorte é apertado, e é decisão do dono do produto que ela exista:
 *   - só pedidos DESTA loja: um lojista não enxerga a clientela de outro, e o
 *     endereço oferecido foi validado para a área DESTA loja;
 *   - só endereços que o próprio cliente deu à loja (site, robô do WhatsApp,
 *     balcão). Pedido de marketplace fica de fora: o iFood manda telefone
 *     mascarado, e o endereço veio por outro caminho;
 *   - só o ponto que o PRÓPRIO cliente confirmou (GPS ou pino); ponto que o
 *     mapa achou para o texto não vira "ponto do cliente" — o checkout acha
 *     de novo, como faz com endereço digitado;
 *   - nada de saldo, histórico de compras, aniversário ou outras lojas.
 *
 * ── O endereço gravado é um texto só ────────────────────────────────────────
 *
 * O pedido guarda `customerAddress` como UMA linha, cada canal no seu formato
 * (ver lib/endereco-impresso quando entrar). Aqui só se lê o que o site e o
 * balcão escrevem ("Rua X, 20 - Bairro (complemento)") e o que o robô escreve
 * ("Rua X, 470, Bairro, Cidade"). O que não casa com esses dois moldes NÃO é
 * chutado: endereço mal lido preenchido na tela é pior que campo vazio.
 *
 * Este arquivo roda no servidor e no navegador (só tipos e funções puras).
 * Teste: scripts/teste-cliente-reconhecido.ts.
 */
import type { PontoDoCliente } from "@/lib/entrega-no-checkout";
import type { EnderecoLembrado } from "@/lib/cliente-lembrado";
import { canalDoPedido } from "@/lib/canal-do-pedido";
import { mesmoTelefone } from "@/lib/telefone";

export type EnderecoReconhecido = EnderecoLembrado & {
  /** O endereço numa linha, para a lista de escolha ("Rua X, 20 - Centro · Ap 201"). */
  texto: string;
  /** Quantas vezes a loja já entregou neste endereço. */
  vezes: number;
  /** O pedido mais recente neste endereço (ISO). */
  ultimaVez: string;
};

export type ClienteReconhecido = {
  /** O nome que ele deu no último pedido desta loja, ou o do cadastro. Vazio = não sabemos. */
  nome: string;
  /** Do mais recente para o mais antigo, sem repetir, no máximo `MAXIMO_DE_ENDERECOS`. */
  enderecos: EnderecoReconhecido[];
};

/** Os campos do pedido que o canal (lib/canal-do-pedido.ts) e a leitura usam. */
export type PedidoParaReconhecer = {
  source?: string | null;
  status?: string | null;
  ifoodOrderId?: string | null;
  ifoodReference?: string | number | null;
  openDeliveryChannel?: string | null;
  openDeliveryOrderId?: string | null;
  tableNumber?: string | number | null;
  customerName?: string | null;
  customerPhone?: string | null;
  customerAddress?: string | null;
  customerLatLng?: unknown;
  deliveryType?: string | null;
  createdAt?: Date | string | null;
};

export const MAXIMO_DE_ENDERECOS = 3;

const texto = (v: unknown, max = 160) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** "107", "54B", "1.234", "nº 30", "S/N", "sem número" — o que cabe no campo Número. */
const NUMERO_RE = /^(?:(?:n[º°o]?\.?|num(?:ero)?\.?|número)\s*)?(?:\d{1,5}(?:\.\d{3})?\s*-?\s*[a-z]?|s\s*\/?\s*n[º°o]?|sem n[uú]mero)$/i;

/**
 * O telefone como a consulta precisa dele: só dígitos, sem o 55 do país.
 * Menos de 10 dígitos (DDD + número) não identifica ninguém → "".
 */
export function telefoneParaReconhecer(bruto: unknown): string {
  let d = String(bruto ?? "").replace(/\D/g, "");
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) d = d.slice(2);
  return d.length >= 10 && d.length <= 11 ? d : "";
}

/** O ponto gravado no pedido, se foi o PRÓPRIO cliente que o deu (GPS ou pino). */
export function pontoConfirmadoPeloCliente(gravado: unknown): PontoDoCliente | null {
  if (!gravado || typeof gravado !== "object") return null;
  const p = gravado as { lat?: unknown; lng?: unknown; origem?: unknown };
  if (p.origem !== "gps" && p.origem !== "pino") return null;
  const lat = Number(p.lat);
  const lng = Number(p.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  // (0,0) e grau inteiro são ponto de enchimento, nunca uma casa.
  if (Number.isInteger(lat) || Number.isInteger(lng)) return null;
  return { lat, lng, origem: p.origem };
}

/**
 * Lê o `customerAddress` de um pedido nas duas formas que a própria plataforma
 * escreve. Devolve null quando não tem certeza.
 *
 *   Site/balcão  "Rua das Casuarinas, 20 - Âncora (Apartamento 201)"
 *   Robô         "Rua Paranaíba, 470, Operário, Rio das Ostras"
 */
export function lerEnderecoGravado(bruto: unknown, pontoGravado?: unknown): EnderecoLembrado | null {
  let t = texto(bruto, 400);
  if (!t) return null;

  // CEP em qualquer lugar ("CEP 28890-000", "28890000" só com o rótulo).
  let cep = "";
  const mCep = t.match(/\bCEP[:\s]*(\d{5})-?(\d{3})\b/i) ?? t.match(/\b(\d{5})-(\d{3})\b/);
  if (mCep) {
    cep = `${mCep[1]}-${mCep[2]}`;
    t = texto(t.replace(mCep[0], " "));
  }

  // O site põe o complemento entre parênteses no fim.
  let complemento = "";
  const mComp = t.match(/\s*\(([^()]*)\)\s*$/);
  if (mComp) {
    complemento = texto(mComp[1]);
    t = texto(t.slice(0, mComp.index));
  }

  const partesComTraco = t.split(/\s+[-–—]\s+/).map((p) => p.trim()).filter(Boolean);

  // ── Site e balcão: "Rua, número - Bairro" ─────────────────────────────
  if (partesComTraco.length === 2) {
    const [ruaENumero, bairro] = partesComTraco;
    const virgula = ruaENumero.lastIndexOf(",");
    if (virgula > 0) {
      const rua = texto(ruaENumero.slice(0, virgula));
      const numero = texto(ruaENumero.slice(virgula + 1), 20);
      if (rua.length >= 3 && NUMERO_RE.test(numero) && bairro.length >= 2 && !/,/.test(bairro)) {
        return { rua, numero, bairro: texto(bairro, 80), complemento, cep, ponto: pontoConfirmadoPeloCliente(pontoGravado) };
      }
    }
    return null;
  }

  // ── Robô: "Rua, número, Bairro, Cidade" ───────────────────────────────
  if (partesComTraco.length === 1 && !complemento) {
    const virgulas = t.split(",").map((p) => p.trim()).filter(Boolean);
    if (virgulas.length >= 3 && virgulas.length <= 4) {
      const [rua, numero, bairro] = virgulas;
      if (rua.length >= 3 && NUMERO_RE.test(numero) && bairro.length >= 2) {
        return { rua: texto(rua), numero: texto(numero, 20), bairro: texto(bairro, 80), complemento: "", cep, ponto: pontoConfirmadoPeloCliente(pontoGravado) };
      }
    }
  }

  return null;
}

/** Para comparar dois endereços: sem acento, sem pontuação, caixa baixa. */
function chaveDoEndereco(e: { rua: string; numero: string; bairro: string }): string {
  const limpa = (s: string) =>
    s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return `${limpa(e.rua)}|${limpa(e.numero)}|${limpa(e.bairro)}`;
}

/** O mesmo endereço (rua, número e bairro), ignorando acento, caixa e pontuação. */
export function mesmoEndereco(
  a: { rua: string; numero: string; bairro: string } | null | undefined,
  b: { rua: string; numero: string; bairro: string } | null | undefined,
): boolean {
  if (!a || !b || !a.rua.trim() || !b.rua.trim()) return false;
  return chaveDoEndereco(a) === chaveDoEndereco(b);
}

/** "Rua das Casuarinas, 20 - Âncora · Apartamento 201" */
export function textoDoEndereco(e: { rua: string; numero: string; bairro: string; complemento?: string }): string {
  const base = `${e.rua}, ${e.numero}${e.bairro ? ` - ${e.bairro}` : ""}`;
  return e.complemento ? `${base} · ${e.complemento}` : base;
}

const instante = (d: Date | string | null | undefined): number => {
  const n = d instanceof Date ? d.getTime() : d ? new Date(d).getTime() : NaN;
  return Number.isFinite(n) ? n : 0;
};

/** Pedido que entra na conta: deste telefone, dado pelo cliente à loja, não cancelado nem rascunho. */
function pedidoConta(p: PedidoParaReconhecer, telefone: string): boolean {
  if (!mesmoTelefone(p.customerPhone, telefone)) return false;
  const status = String(p.status || "").toUpperCase();
  if (status === "CANCELADO" || status === "CRIANDO_IA") return false;
  const canal = canalDoPedido(p);
  if (canal.ehMarketplace || canal.chave === "MESA" || canal.chave === "DESCONHECIDO") return false;
  return true;
}

/**
 * Os endereços em que a loja já entregou para este telefone: do mais recente
 * para o mais antigo, o mesmo endereço contado uma vez (com o complemento e o
 * ponto da entrega mais recente), no máximo `MAXIMO_DE_ENDERECOS`.
 */
export function enderecosDoCliente(pedidos: readonly PedidoParaReconhecer[], telefone: string): EnderecoReconhecido[] {
  const tel = telefoneParaReconhecer(telefone);
  if (!tel) return [];
  const ordenados = [...pedidos]
    .filter((p) => pedidoConta(p, tel) && String(p.deliveryType || "DELIVERY").toUpperCase() === "DELIVERY")
    .sort((a, b) => instante(b.createdAt) - instante(a.createdAt));

  const porChave = new Map<string, EnderecoReconhecido>();
  for (const p of ordenados) {
    const e = lerEnderecoGravado(p.customerAddress, p.customerLatLng);
    if (!e) continue;
    const chave = chaveDoEndereco(e);
    const existente = porChave.get(chave);
    if (existente) {
      existente.vezes++;
      // O mais recente já está lá; um pedido antigo só completa o que faltava.
      if (!existente.complemento && e.complemento) existente.complemento = e.complemento;
      if (!existente.cep && e.cep) existente.cep = e.cep;
      if (!existente.ponto && e.ponto) existente.ponto = e.ponto;
      existente.texto = textoDoEndereco(existente);
      continue;
    }
    porChave.set(chave, {
      ...e,
      texto: textoDoEndereco(e),
      vezes: 1,
      ultimaVez: new Date(instante(p.createdAt) || Date.now()).toISOString(),
    });
  }
  return [...porChave.values()].slice(0, MAXIMO_DE_ENDERECOS);
}

/**
 * O nome pelo qual chamar o cliente: o que ele mesmo deu no pedido mais
 * recente desta loja; sem pedido, o do cadastro (site, robô ou importação).
 */
export function nomeDoCliente(
  pedidos: readonly PedidoParaReconhecer[],
  telefone: string,
  nomeDoCadastro?: string | null,
): string {
  const tel = telefoneParaReconhecer(telefone);
  if (!tel) return "";
  const doPedido = [...pedidos]
    .filter((p) => pedidoConta(p, tel) && texto(p.customerName, 80).length >= 2)
    .sort((a, b) => instante(b.createdAt) - instante(a.createdAt))[0];
  const nome = texto(doPedido?.customerName, 80) || texto(nomeDoCadastro, 80);
  // "Cliente" e afins são o que o robô/balcão gravam quando não sabem o nome.
  if (/^(cliente|consumidor|sem nome|nao informado|não informado)$/i.test(nome)) return "";
  return nome;
}

/** Monta a resposta da rota; null quando não há nada para preencher. */
export function reconhecerCliente(
  pedidos: readonly PedidoParaReconhecer[],
  telefone: string,
  nomeDoCadastro?: string | null,
): ClienteReconhecido | null {
  const nome = nomeDoCliente(pedidos, telefone, nomeDoCadastro);
  const enderecos = enderecosDoCliente(pedidos, telefone);
  if (!nome && enderecos.length === 0) return null;
  return { nome, enderecos };
}

/** O primeiro nome, para a saudação ("Olá, Maria!"). */
export function primeiroNome(nome: string): string {
  return texto(nome, 80).split(" ")[0] || "";
}
