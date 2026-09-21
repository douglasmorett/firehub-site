/**
 * O CPF/CNPJ que o cliente pede "na nota".
 *
 * ── O que é ─────────────────────────────────────────────────────────────────
 *
 * No balcão o cliente pede o CPF na nota. Até aqui o lançamento de venda não
 * tinha onde guardar isso: o atendente escrevia na observação do pedido — que
 * nem sai impressa em pedido de balcão (o Assistente só imprime `notes` dentro
 * do bloco ENTREGA) — ou não escrevia em lugar nenhum.
 *
 * O documento vai para `CustomerOrder.customerCpfCnpj`, a MESMA coluna que a
 * emissão fiscal já lê (lib/fiscal-automatico.ts e a rota store/fiscal/emitir).
 * Ou seja: além de sair na comanda, o balcão passa a chegar na NFC-e com o
 * destinatário preenchido, sem ninguém redigitar.
 *
 * ── Por que ele entra pelo NOME DO CLIENTE na comanda ───────────────────────
 *
 * Mesmo motivo do pager (lib/pager.ts, leia o cabeçalho de lá): quem imprime é
 * o Assistente instalado no PC da loja, e cada loja está na versão do dia em
 * que instalou. Campo novo no papel só apareceria nas lojas atualizadas — o
 * lojista digitaria o CPF e não sairia nada na maioria delas.
 *
 * Pelo nome funciona em TODA versão hoje, sem ninguém atualizar nada. O
 * documento vai TAMBÉM em campo próprio no payload (`customerCpfCnpj`), então
 * no dia em que o Assistente passar a imprimir a linha dedicada é só ele ler
 * dali — e `nomeComDocumento` sai de cena sem mexer em mais nada.
 *
 * ── Por que valida ──────────────────────────────────────────────────────────
 *
 * Porque este mesmo valor é o destinatário da nota fiscal. Um número digitado
 * errado não dá erro nenhum na hora da venda: dá REJEIÇÃO da SEFAZ depois, com
 * a fila esperando o cupom. Melhor recusar na tela, onde o cliente ainda está
 * na frente do atendente para repetir o número.
 */

import { documentoValido } from "@/lib/fiscal-validacao";

/** Como o número é escrito em qualquer lugar que o mostre. */
export const ETIQUETA_CPF = "CPF";
export const ETIQUETA_CNPJ = "CNPJ";

/**
 * Tira máscara e espaço. NÃO valida — é só a forma de guardar.
 *
 * Mantém letras porque o CNPJ alfanumérico (vigente desde julho/2026) tem 12
 * posições de letras/números antes dos dois dígitos verificadores; jogar fora
 * as letras transformaria um CNPJ válido num número de 2 dígitos.
 */
export function normalizarDocumento(bruto: unknown): string {
  return String(bruto ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
}

/** Já dá para saber o que o lojista está digitando? 11 = CPF, 14 = CNPJ. */
export function tipoDoDocumento(bruto: unknown): "CPF" | "CNPJ" | null {
  const d = normalizarDocumento(bruto);
  if (d.length === 11) return "CPF";
  if (d.length === 14) return "CNPJ";
  return null;
}

/**
 * O documento pronto para gravar, ou null quando não há.
 *
 * Devolve `null` tanto para campo vazio quanto para número inválido: quem
 * precisa diferenciar os dois casos (a tela e a API) usa `problemaDoDocumento`.
 */
export function lerDocumentoDoCliente(bruto: unknown): string | null {
  const d = normalizarDocumento(bruto);
  if (!d) return null;
  return documentoValido(d) ? d : null;
}

/**
 * O que está errado com o que foi digitado, em português, ou null se está bom.
 *
 * Campo vazio é `null`: o CPF na nota é OPCIONAL, e a venda de quem não pediu
 * não pode travar por causa de um campo que ninguém preencheu.
 */
export function problemaDoDocumento(bruto: unknown): string | null {
  const d = normalizarDocumento(bruto);
  if (!d) return null;
  if (d.length !== 11 && d.length !== 14) {
    return "CPF tem 11 dígitos e CNPJ tem 14. Confira o número digitado.";
  }
  if (!documentoValido(d)) {
    return d.length === 11
      ? "Este CPF não existe: os dígitos verificadores não batem."
      : "Este CNPJ não existe: os dígitos verificadores não batem.";
  }
  return null;
}

/** "12345678900" → "123.456.789-00". Número fora do padrão volta como veio. */
export function formatarDocumento(bruto: unknown): string {
  const d = normalizarDocumento(bruto);
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  return d;
}

/**
 * A máscara enquanto o lojista DIGITA, sem atrapalhar quem ainda não terminou.
 *
 * Aplica o desenho de CPF até 11 caracteres e o de CNPJ daí em diante — é a
 * única forma de mascarar um campo que aceita os dois sem exigir que a pessoa
 * escolha antes qual vai digitar.
 */
export function mascararDocumentoDigitado(bruto: unknown): string {
  const d = normalizarDocumento(bruto).slice(0, 14);
  if (d.length <= 11) {
    return d
      .replace(/^(\d{3})(\d)/, "$1.$2")
      .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
      .replace(/^(\d{3})\.(\d{3})\.(\d{3})(\d)/, "$1.$2.$3-$4");
  }
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}${d.length > 12 ? "-" + d.slice(12) : ""}`;
}

/** "CPF 123.456.789-00" — o jeito como o documento aparece no papel. */
export function etiquetaDoDocumento(bruto: unknown): string {
  const d = lerDocumentoDoCliente(bruto);
  if (!d) return "";
  return `${d.length === 11 ? ETIQUETA_CPF : ETIQUETA_CNPJ} ${formatarDocumento(d)}`;
}

/**
 * O nome que vai para a COMANDA, com o documento embutido.
 *
 * "João" + CPF          → "João · CPF 123.456.789-00"
 * "PAGER 12" + CPF      → "PAGER 12 · CPF 123.456.789-00"
 * "Balcão" + CPF        → "CPF 123.456.789-00"   (o rótulo genérico dá lugar)
 * sem documento         → o nome, intacto
 *
 * Recebe o nome JÁ passado por `nomeComPager`: os dois moram na mesma linha do
 * papel e a ordem importa — primeiro quem a loja chama (nome/pager), depois o
 * documento, que é para o cliente conferir.
 */
export function nomeComDocumento(nome: string | null | undefined, documento: unknown): string {
  const etiqueta = etiquetaDoDocumento(documento);
  const base = (nome || "").trim();
  if (!etiqueta) return base;
  if (!base || ehRotuloGenerico(base)) return etiqueta;
  return `${base} · ${etiqueta}`;
}

/** Os nomes que o sistema inventa quando ninguém digitou um de verdade. */
function ehRotuloGenerico(nome: string): boolean {
  const n = nome.toLowerCase();
  return n === "balcão" || n === "balcao" || n === "cliente" || n === "consumidor";
}
