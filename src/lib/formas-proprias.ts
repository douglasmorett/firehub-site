/**
 * FORMAS DE PAGAMENTO PRÓPRIAS DA LOJA — com o canal onde cada uma vale.
 *
 * Pedido da Pizzaria 17 (Antonio, Macaé, 17/10/2026): aceitar a "Macaíba",
 * a moeda social de Macaé. O Douglas: "coloca uma opção nas formas de
 * pagamento, escolher se está liberado em tudo, em uma coisa só". A loja cria
 * a forma (nome livre) e marca onde ela aparece: Caixa/PDV (balcão), Mesa
 * (fechar a conta), Cardápio do site (pagar na entrega/retirada) e Robô do
 * WhatsApp. Ao criar, só o Caixa/PDV vem marcado.
 *
 * ── Onde mora ───────────────────────────────────────────────────────────────
 *
 * `User.paymentFees.formasProprias` — o mesmo Json das taxas e do liga/desliga
 * das formas (Minha Loja → Formas de Pagamento), como `descontoOnline` e
 * `entregaSoOnline`: não é coluna nova e não precisa de migration. Ninguém
 * percorre as chaves de paymentFees (conferido em 17/10/2026).
 *
 * ── Como o pedido grava ─────────────────────────────────────────────────────
 *
 * O texto da forma leva a MARCA: "Macaíba (forma própria)". É ela que faz a
 * régua do caixa (lib/relatorios/formas-de-pagamento.ts → `formaDoTexto`), a
 * nota fiscal (lib/fiscal-emissao.ts → "99 Outros") e a troca de pagamento
 * reconhecerem a forma SEM ler o cadastro da loja — o caixa de ontem continua
 * lendo certo mesmo se a loja apagar a forma hoje. E a marca vem antes de
 * qualquer outra leitura: "Vale Macaíba" não pode cair no Vale-refeição, nem
 * "Dinheiro social" na gaveta. A comanda tira o parêntese e imprime "Macaíba".
 *
 * A forma própria NUNCA é dinheiro da gaveta: no fechamento ela tem linha
 * própria, com o nome dela, fora da conferência (como o fiado).
 *
 * Puro, sem import: o cardápio, o PDV, as rotas e os testes leem daqui.
 */

export type CanalDaForma = "pdv" | "mesa" | "site" | "robo";
export type CanaisDaForma = Record<CanalDaForma, boolean>;
export type FormaPropria = { id: string; nome: string; ativo: boolean; canais: CanaisDaForma };

export const CANAIS_DA_FORMA: { chave: CanalDaForma; rotulo: string; onde: string }[] = [
  { chave: "pdv", rotulo: "Caixa / PDV (balcão)", onde: "no Caixa/PDV" },
  { chave: "mesa", rotulo: "Mesa / garçom (fechar conta)", onde: "nas mesas" },
  { chave: "site", rotulo: "Cardápio do site (na entrega/retirada)", onde: "no cardápio do site" },
  { chave: "robo", rotulo: "Robô do WhatsApp", onde: "no robô do WhatsApp" },
];

/** Ao criar uma forma nova: só o Caixa/PDV (pedido do Douglas, 17/10/2026). */
export const CANAIS_AO_CRIAR: CanaisDaForma = { pdv: true, mesa: false, site: false, robo: false };

export const MARCA_DA_FORMA_PROPRIA = "(forma própria)";
const REGEX_DA_MARCA = /\s*\(forma pr[oó]pria\)/i;

export const LIMITE_DE_FORMAS = 10;
export const LIMITE_DO_NOME = 30;

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
/** Para comparar nomes: sem acento, sem caixa, espaços juntos. */
export const chaveDoNome = (nome: string) => semAcento(String(nome || "")).toLowerCase().replace(/\s+/g, " ").trim();

/** O texto gravado no pedido: "Macaíba (forma própria)". */
export function textoDaFormaPropria(nome: string): string {
  return `${String(nome || "").trim()} ${MARCA_DA_FORMA_PROPRIA}`;
}

/**
 * O texto é UMA forma própria? O resumo do dividido ("Dividido: Dinheiro R$ 20,00
 * + Macaíba (forma própria) R$ 15,00") não é: quem lê o dividido lê as partes.
 */
export function ehFormaPropria(texto: unknown): boolean {
  const t = String(texto ?? "");
  return REGEX_DA_MARCA.test(t) && !/^\s*dividido\s*:/i.test(t);
}

/** "Macaíba (forma própria)" → "Macaíba". Não é forma própria → null. */
export function nomeDaFormaPropria(texto: unknown): string | null {
  if (!ehFormaPropria(texto)) return null;
  const nome = String(texto).replace(REGEX_DA_MARCA, "").replace(/\s+/g, " ").trim();
  return nome || "Forma própria";
}

/** Os nomes que já são formas do sistema: a forma própria não pode se chamar assim. */
const NOMES_DO_SISTEMA = /^(dinheiro|pix|debito|credito|cartao( (de )?(debito|credito))?|vale|voucher|vale[- ]refeicao|vale[- ]alimentacao|fiado|conta funcionario|online|pago online|ifood|99food)$/;

let contador = 0;
function novoId(): string {
  contador = (contador + 1) % 1000;
  return `fp${Date.now().toString(36)}${contador.toString(36)}`;
}

function lerCanais(bruto: any): CanaisDaForma {
  const c = bruto && typeof bruto === "object" ? bruto : {};
  return { pdv: c.pdv === true, mesa: c.mesa === true, site: c.site === true, robo: c.robo === true };
}

/**
 * A lista gravada, lida com tolerância (nome vazio sai, nome repetido fica o
 * primeiro, canais ausentes = desmarcados). Loja sem nada → [].
 */
export function lerFormasProprias(paymentFees: unknown): FormaPropria[] {
  const bruto = (paymentFees as any)?.formasProprias;
  if (!Array.isArray(bruto)) return [];
  const vistas = new Set<string>();
  const saida: FormaPropria[] = [];
  for (const f of bruto) {
    const nome = String(f?.nome ?? "").replace(/[()]/g, "").replace(/\s+/g, " ").trim().slice(0, LIMITE_DO_NOME);
    const chave = chaveDoNome(nome);
    if (!chave || vistas.has(chave)) continue;
    vistas.add(chave);
    saida.push({
      id: typeof f?.id === "string" && f.id ? f.id.slice(0, 40) : `fp-${chave.replace(/[^a-z0-9]+/g, "-")}`,
      nome,
      ativo: f?.ativo !== false,
      canais: lerCanais(f?.canais),
    });
  }
  return saida.slice(0, LIMITE_DE_FORMAS);
}

export type ResultadoDoCadastro = { ok: true; formas: FormaPropria[] } | { ok: false; erro: string };

/**
 * O que a tela mandou salvar, conferido. Recusa (em vez de "consertar" calado)
 * nome vazio, repetido, com parêntese, longo demais ou igual a uma forma do
 * sistema — "Pix" próprio criaria duas linhas de Pix no caixa.
 */
export function validarFormasProprias(bruto: unknown): ResultadoDoCadastro {
  if (bruto == null) return { ok: true, formas: [] };
  if (!Array.isArray(bruto)) return { ok: false, erro: "Formas de pagamento próprias em formato inválido." };
  if (bruto.length > LIMITE_DE_FORMAS) return { ok: false, erro: `No máximo ${LIMITE_DE_FORMAS} formas de pagamento próprias.` };
  const vistas = new Set<string>();
  const formas: FormaPropria[] = [];
  for (const f of bruto) {
    const nome = String((f as any)?.nome ?? "").replace(/\s+/g, " ").trim();
    if (!nome) return { ok: false, erro: "Dê um nome para cada forma de pagamento própria." };
    if (/[()]/.test(nome)) return { ok: false, erro: `O nome "${nome}" não pode ter parênteses.` };
    if (nome.length > LIMITE_DO_NOME) return { ok: false, erro: `O nome "${nome}" passa de ${LIMITE_DO_NOME} letras.` };
    const chave = chaveDoNome(nome);
    if (NOMES_DO_SISTEMA.test(chave)) return { ok: false, erro: `"${nome}" já é uma forma do sistema. Use o liga/desliga dela acima.` };
    if (vistas.has(chave)) return { ok: false, erro: `A forma "${nome}" está repetida.` };
    vistas.add(chave);
    const id = typeof (f as any)?.id === "string" && (f as any).id ? String((f as any).id).slice(0, 40) : novoId();
    formas.push({ id, nome, ativo: (f as any)?.ativo !== false, canais: lerCanais((f as any)?.canais) });
  }
  return { ok: true, formas };
}

/** As formas próprias LIGADAS e marcadas neste canal — o que a tela oferece. */
export function formasNoCanal(paymentFees: unknown, canal: CanalDaForma): FormaPropria[] {
  return lerFormasProprias(paymentFees).filter((f) => f.ativo && f.canais[canal]);
}

/** Os textos para gravar ("Macaíba (forma própria)") das formas deste canal. */
export function textosNoCanal(paymentFees: unknown, canal: CanalDaForma): string[] {
  return formasNoCanal(paymentFees, canal).map((f) => textoDaFormaPropria(f.nome));
}

const ondeDoCanal = (canal: CanalDaForma) => CANAIS_DA_FORMA.find((c) => c.chave === canal)?.onde || "aqui";

/**
 * A trava do SERVIDOR: algum destes textos é forma própria que não vale neste
 * canal (apagada, desligada ou desmarcada)? Devolve a frase da recusa, ou null.
 * Texto que não é forma própria não é assunto daqui.
 */
export function problemaDaFormaPropria(paymentFees: unknown, textos: unknown[], canal: CanalDaForma): string | null {
  const cadastro = lerFormasProprias(paymentFees);
  for (const texto of textos) {
    const nome = nomeDaFormaPropria(texto);
    if (!nome) continue;
    const forma = cadastro.find((f) => chaveDoNome(f.nome) === chaveDoNome(nome));
    if (!forma) return `A forma de pagamento "${nome}" não existe mais nesta loja. Escolha outra.`;
    if (!forma.ativo) return `A forma de pagamento "${nome}" está desligada nesta loja. Escolha outra.`;
    if (!forma.canais[canal]) return `A forma de pagamento "${nome}" não é aceita ${ondeDoCanal(canal)}. Escolha outra (a loja libera em Minha Loja → Formas de Pagamento).`;
  }
  return null;
}

/**
 * O que o cliente (ou o robô) escreveu é o NOME de uma forma própria deste
 * canal? "macaiba", "Macaíba", "MACAIBA" → "Macaíba (forma própria)". O texto
 * já marcado também vale. Nada casando → null (o texto segue como veio).
 */
export function formaPropriaPeloNome(paymentFees: unknown, texto: unknown, canal: CanalDaForma): string | null {
  const bruto = String(texto ?? "").trim();
  if (!bruto) return null;
  const nome = nomeDaFormaPropria(bruto) ?? bruto.replace(/\s*\([^)]*\)/g, "").trim();
  const chave = chaveDoNome(nome);
  const forma = formasNoCanal(paymentFees, canal).find((f) => chaveDoNome(f.nome) === chave);
  return forma ? textoDaFormaPropria(forma.nome) : null;
}

/** O nome bonito para a tela: "Macaíba (forma própria)" → "Macaíba"; outro texto volta igual. */
export function rotuloDaForma(texto: string): string {
  return nomeDaFormaPropria(texto) ?? texto;
}
