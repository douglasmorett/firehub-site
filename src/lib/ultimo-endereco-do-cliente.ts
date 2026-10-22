/**
 * O ENDEREÇO DA ÚLTIMA ENTREGA — o robô oferece em vez de pedir de novo.
 *
 * ── Por que existe ──────────────────────────────────────────────────────────
 *
 * Pizzaria Lapastine, 22/10/2026: cliente que já pediu pelo WhatsApp várias
 * vezes tinha de mandar o endereço (ou a localização) DE NOVO em todo pedido.
 * O robô reconhecia o nome pelo telefone, mas o endereço ficava no pedido
 * antigo sem uso. Os clientes dela não querem cadastro nem login: é só o
 * WhatsApp. Aprovado pelo Douglas no mesmo dia.
 *
 * ── A regra ─────────────────────────────────────────────────────────────────
 *
 *  - De onde: o pedido de ENTREGA mais recente do mesmo telefone (DDD +
 *    número, `mesmoTelefone` — nunca só o final, ver lib/telefone.ts), nas
 *    lojas do robô, nos canais da LOJA (`CANAIS_DA_LOJA`: robô, site, balcão).
 *    iFood, 99, Brendi, Wabiz, Jotajá e afins ficam de fora: o endereço vem no
 *    formato da plataforma ("Comp:", "Ref:", "Brasília/DF - CEP …") e o
 *    telefone, quase sempre, é o 0800 deles — não é o cliente do WhatsApp.
 *  - Não contam: cancelado, rascunho do robô (CRIANDO_IA), retirada e mesa, o
 *    endereço de reserva da localização ("📍 Localização enviada…") e pedido
 *    com mais de `JANELA_DO_ULTIMO_ENDERECO_DIAS` — quem não pede há mais de um
 *    ano pode ter mudado, e a pergunta "é o mesmo?" vira estranha.
 *  - O ponto: só o que veio do CLIENTE (GPS/localização ou pino confirmado),
 *    como o do rascunho (`pontoDoClienteGravado`). Ponto achado pelo mapa não
 *    se herda — pode ter sido o centro do bairro ou uma rua homônima.
 *  - Quem decide se oferece é a cotação da conversa (lib/chatbot-ai.ts): só
 *    endereço que a loja ATENDE hoje, com taxa firme. Fora da área, não achado
 *    ou aproximado: o robô pede o endereço como sempre.
 *
 * Arquivo puro (sem banco): o teste o carrega sozinho
 * (scripts/teste-ultimo-endereco-do-cliente.ts).
 */
import { mesmoTelefone } from "./telefone";
import { CANAIS_DA_LOJA } from "./pedido-do-cliente";
import { ehEnderecoDaLocalizacao, pareceEnderecoEscrito, pontoDoClienteGravado } from "./entrega-do-robo";
import { clienteIndicaOutroLugar, localizacaoNoTexto, semLinhaDaLocalizacao } from "./localizacao-do-whatsapp";

/** Até quantos dias atrás o pedido ainda dá o endereço. */
export const JANELA_DO_ULTIMO_ENDERECO_DIAS = 365;

/** Status cujo endereço não serve: pedido que não aconteceu. */
export const STATUS_SEM_ENDERECO_APROVEITAVEL = ["CANCELADO", "CRIANDO_IA"];

export type PedidoComEndereco = {
  customerPhone?: string | null;
  customerAddress?: string | null;
  customerLatLng?: unknown;
  deliveryType?: string | null;
  status?: string | null;
  source?: string | null;
  createdAt?: Date | string | null;
};

export type UltimoEndereco = {
  endereco: string;
  /** O ponto que o CLIENTE deu naquele pedido (GPS ou pino), se deu. */
  ponto: { lat: number; lng: number } | null;
  quando: Date;
};

/** O endereço da última entrega deste telefone, ou `null` se não há um que sirva. */
export function ultimoEnderecoDoCliente(
  pedidos: readonly PedidoComEndereco[] | null | undefined,
  telefone: string | null | undefined,
  agora: number = Date.now(),
): UltimoEndereco | null {
  const desde = agora - JANELA_DO_ULTIMO_ENDERECO_DIAS * 24 * 60 * 60 * 1000;
  const quando = (p: PedidoComEndereco) => new Date(p.createdAt as any).getTime();
  const validos = (Array.isArray(pedidos) ? pedidos : [])
    .filter((p) => {
      if (!p || !mesmoTelefone(p.customerPhone, telefone)) return false;
      if (!CANAIS_DA_LOJA.includes(String(p.source || "").toUpperCase())) return false;
      if (String(p.deliveryType || "").toUpperCase() !== "DELIVERY") return false;
      if (STATUS_SEM_ENDERECO_APROVEITAVEL.includes(String(p.status || "").toUpperCase())) return false;
      const t = quando(p);
      if (!Number.isFinite(t) || t < desde || t > agora) return false;
      const endereco = String(p.customerAddress || "").trim();
      return endereco.length >= 5 && /[a-zà-ú]{3,}/i.test(endereco) && !ehEnderecoDaLocalizacao(endereco);
    })
    .sort((a, b) => quando(b) - quando(a));
  const ultimo = validos[0];
  if (!ultimo) return null;
  return {
    endereco: String(ultimo.customerAddress).trim(),
    ponto: pontoDoClienteGravado(ultimo.customerLatLng),
    quando: new Date(quando(ultimo)),
  };
}

/**
 * A conversa já tratou de endereço? Então o endereço antigo não entra: o
 * cliente escreveu um (mesmo que fora das últimas mensagens que a cotação lê),
 * mandou a localização, ou disse que é em outro lugar ("mudei de endereço").
 */
export function conversaJaTemEndereco(falasDoCliente: readonly string[]): boolean {
  return falasDoCliente.some((fala) => {
    const t = String(fala || "");
    if (localizacaoNoTexto(t)) return true;
    if (clienteIndicaOutroLugar(t)) return true;
    return pareceEnderecoEscrito(semLinhaDaLocalizacao(t));
  });
}

/**
 * O endereço salvo pode ser oferecido? Só o que fecha sem pergunta: a loja
 * ATENDE hoje, com taxa, e sem pedir a localização (ponto aproximado). FORA,
 * não achado ou sem bairro: o cliente nem fica sabendo que havia um endereço
 * salvo, e o robô pede o endereço como sempre.
 */
export function enderecoSalvoFechaSemPergunta(
  veredito: { resultado: string; taxa?: number | null } | null | undefined,
  pedirLocalizacao: string | null,
): boolean {
  return veredito?.resultado === "ATENDE" && veredito.taxa != null && pedirLocalizacao === null;
}

/**
 * O bloco do contexto da conversa quando a loja atende o endereço salvo.
 * `tempoMin` só quando a loja tem prazo cadastrado (lib/fatos-da-loja.ts).
 */
export function blocoDoUltimoEndereco(e: { endereco: string; quando: Date; taxa: number; tempoMin?: number | null }): string {
  const taxa = `R$ ${e.taxa.toFixed(2).replace(".", ",")}`;
  const data = e.quando.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  return `
🏠 ENDEREÇO DA ÚLTIMA ENTREGA DESTE CLIENTE (conferido pelo sistema agora):
- Endereço: "${e.endereco}" (pedido de ${data})
- RESULTADO: ✅ A LOJA ATENDE ESSE ENDEREÇO HOJE. Taxa de entrega: ${taxa}${e.tempoMin ? ` (${e.tempoMin} min)` : ""}.
- Esta conversa ainda NÃO tem endereço. Na hora do endereço de um pedido de ENTREGA, NÃO peça rua, bairro nem localização: pergunte antes, numa frase, se é o mesmo: "Entrego no mesmo endereço da última vez: ${e.endereco}? (taxa ${taxa})"
- Confirmou? Use EXATAMENTE este endereço no campo "address" da tag PEDIDO_IA e EXATAMENTE esta taxa no resumo e no "deliveryFee". Não peça a localização.
- Disse que não é, ou mandou outro endereço ou a localização? Vale o NOVO: peça rua, número e bairro como sempre e não ofereça este de novo. Retirada no balcão não usa endereço.
`;
}

// ── A COTAÇÃO DO ENDEREÇO SALVO, UMA VEZ POR CONVERSA ──────────────────────
//
// A cotação da conversa roda a cada mensagem. Para o endereço que o cliente
// digita ela é refeita porque o texto muda; o salvo não muda, e refazer a
// medida (mapa, roteador) a cada "sim", "pix" e "obrigado" seria chamada à
// toa. Guarda por 20 minutos — o tempo de uma conversa de pedido. Só guarda o
// que decidiu (ATENDE/FORA): "não sei" pode ser o mapa fora do ar.

export const VALIDADE_DA_COTACAO_GUARDADA_MS = 20 * 60 * 1000;
const TETO_DA_MEMORIA = 2000;
const memoriaDaCotacao = new Map<string, { em: number; valor: unknown }>();

export async function cotacaoGuardada<T>(
  chave: string,
  calcular: () => Promise<T>,
  guardar: (valor: T) => boolean,
  agora: number = Date.now(),
): Promise<T> {
  const guardada = memoriaDaCotacao.get(chave);
  if (guardada && agora - guardada.em < VALIDADE_DA_COTACAO_GUARDADA_MS) return guardada.valor as T;
  const valor = await calcular();
  if (guardar(valor)) {
    memoriaDaCotacao.delete(chave);
    memoriaDaCotacao.set(chave, { em: agora, valor });
    // A mais antiga sai primeiro (o Map guarda a ordem de entrada).
    while (memoriaDaCotacao.size > TETO_DA_MEMORIA) {
      const maisAntiga = memoriaDaCotacao.keys().next().value;
      if (maisAntiga === undefined) break;
      memoriaDaCotacao.delete(maisAntiga);
    }
  }
  return valor;
}
