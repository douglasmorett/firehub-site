/**
 * "Finalizar pedido manualmente": a loja termina o pedido que o robô do
 * WhatsApp deixou montado (status CRIANDO_IA) quando passou a conversa para a
 * equipe.
 *
 * ── Por que existe ──────────────────────────────────────────────────────────
 *
 * Divinos Burger, 25/09/2026, 20h34: o robô lançou os itens, o nome, o
 * pagamento e o endereço ("Rua do forno, travessa pantanal, nº 130, Jardim
 * Esperança"), não achou o endereço no mapa e chamou um atendente. O pedido
 * ficou em "IA criando…" e a loja só tinha como tirá-lo de lá ARRASTANDO o
 * cartão — sem completar o que faltava, sem número do dia e com a hora de
 * quando o robô abriu o rascunho. A finalização aqui faz o que o robô faz no
 * fechamento (lib/chatbot-ai.ts, syncAiOrderToDatabase): número do dia, o
 * pedido "nasce agora", comanda na fila.
 *
 * Regras puras (sem banco): quem grava é api/store/orders/[id]/finalizar-rascunho.
 * Teste: scripts/teste-finalizar-rascunho.ts.
 */
import { lerValorDigitado } from "./cadastro-da-entrega";

export type TipoDaFinalizacao = "DELIVERY" | "RETIRADA";

export type Finalizacao = {
  tipo: TipoDaFinalizacao;
  customerName: string;
  /** Vazio = mantém o do rascunho. */
  customerPhone: string;
  customerAddress: string;
  /** Já 0 na retirada. */
  taxa: number;
  paymentMethod: string;
  /** Só em dinheiro; null nas outras formas. */
  troco: number | null;
  observacao: string;
};

/** O mesmo teto da rota de pedido do site e da correção de taxa. */
export const TETO_DA_TAXA = 300;

const RETIRADAS = ["PICKUP", "TAKEOUT", "RETIRADA", "BALCAO", "BALCÃO"];

const texto = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** "5", "5,5", "R$ 5,50" → 5.5; vazio ou lixo → NaN (lerValorDigitado, a mesma leitura da tela de faixas). */
export function numeroDigitado(v: unknown): number {
  const n = lerValorDigitado(v);
  return n == null ? NaN : n;
}

const centavos = (n: number) => Math.round(n * 100) / 100;

export function pagaEmDinheiro(forma: unknown): boolean {
  return /dinheiro|esp[eé]cie|cash/i.test(String(forma || ""));
}

export function ehRetirada(tipo: unknown): boolean {
  return RETIRADAS.includes(String(tipo || "").trim().toUpperCase());
}

/**
 * O que a loja mandou, conferido. Devolve a primeira falta em português — é
 * ela que aparece na janela, ao lado do campo.
 */
export function lerFinalizacao(corpo: any): { ok: true; dados: Finalizacao } | { ok: false; erro: string; campo: string } {
  const tipo: TipoDaFinalizacao = ehRetirada(corpo?.tipo) ? "RETIRADA" : "DELIVERY";
  const customerName = texto(corpo?.customerName, 80);
  if (customerName.length < 2) return { ok: false, erro: "Informe o nome do cliente.", campo: "customerName" };

  const customerAddress = texto(corpo?.customerAddress, 300);
  if (tipo === "DELIVERY" && customerAddress.length < 6) {
    return { ok: false, erro: "Informe o endereço de entrega (rua, número e bairro).", campo: "customerAddress" };
  }

  let taxa = 0;
  if (tipo === "DELIVERY") {
    taxa = numeroDigitado(corpo?.taxa);
    if (!Number.isFinite(taxa) || taxa < 0 || taxa > TETO_DA_TAXA) {
      return { ok: false, erro: "Informe a taxa de entrega (0 se for grátis).", campo: "taxa" };
    }
    taxa = centavos(taxa);
  }

  const paymentMethod = texto(corpo?.paymentMethod, 60);
  if (!paymentMethod) return { ok: false, erro: "Escolha a forma de pagamento.", campo: "paymentMethod" };

  let troco: number | null = null;
  if (pagaEmDinheiro(paymentMethod)) {
    const t = numeroDigitado(corpo?.troco);
    if (Number.isFinite(t) && t > 0) troco = centavos(t);
  }

  return {
    ok: true,
    dados: {
      tipo,
      customerName,
      customerPhone: texto(corpo?.customerPhone, 30),
      customerAddress,
      taxa,
      paymentMethod,
      troco,
      observacao: texto(corpo?.observacao, 300),
    },
  };
}

/**
 * O total com a taxa nova. O robô já compôs itens, descontos e frete grátis no
 * `totalAmount`; aqui só se troca a taxa dele pela que a loja decidiu.
 */
export function totalComATaxa(totalAntes: unknown, taxaAntes: unknown, taxaNova: number): number {
  const total = Number(totalAntes) || 0;
  const antes = Number(taxaAntes) || 0;
  return centavos(Math.max(0, total - antes) + taxaNova);
}

/**
 * O status do pedido finalizado: o MESMO do fechamento pelo robô
 * (syncAiOrderToDatabase) — aceito direto só com o aceite automático do robô
 * ligado; senão entra em "Novos" como qualquer pedido.
 */
export function statusDaFinalizacao(chatbotConfig: unknown): "ACEITO" | "NOVO" {
  const c: any = chatbotConfig && typeof chatbotConfig === "object" ? chatbotConfig : {};
  return c.autoAcceptOrders === true ? "ACEITO" : "NOVO";
}

// ── "AGUARDANDO A LOJA" ─────────────────────────────────────────────────────
//
// Regra do dono (25/09/2026): pedido do robô cujo endereço o mapa não
// confirmou NÃO entra sozinho na produção — "melhor do que botar pra dentro".
// O robô segura o rascunho, chama a equipe e marca o motivo aqui; o painel de
// pedidos abre o aviso "Pedido do WhatsApp esperando você" com Aceitar (e
// conferir a taxa) ou Não aceitar. A marca mora na observação do rascunho,
// que o robô reescreve a cada turno — e, depois de chamar a equipe, ele cala.

export const MARCA_AGUARDANDO_LOJA = "🙋 AGUARDANDO A LOJA";
const MARCA_NO_INICIO = /^🙋 AGUARDANDO A LOJA: [^·\n]*(· )?/;

/** A observação com a marca na frente (trocando a que já houver). */
export function marcarAguardandoLoja(notas: unknown, motivo: string): string {
  const resto = String(notas || "").replace(MARCA_NO_INICIO, "").trim();
  const porque = String(motivo || "").replace(/[·\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
  return `${MARCA_AGUARDANDO_LOJA}: ${porque}${resto ? ` · ${resto}` : ""}`;
}

/** Este rascunho está esperando a loja? O motivo, ou null. */
export function motivoDeAguardarLoja(pedido: { status?: unknown; notes?: unknown } | null | undefined): string | null {
  if (!pedido || String(pedido.status || "").toUpperCase() !== "CRIANDO_IA") return null;
  const m = String(pedido.notes || "").match(/^🙋 AGUARDANDO A LOJA: ([^·\n]*)/);
  return m ? m[1].trim() : null;
}

const PREFIXO_DO_RASCUNHO = /^🤖 Pedido (sendo montado pela IA no WhatsApp|finalizado via IA pelo WhatsApp)/;

/**
 * A observação do pedido depois da finalização: o que o robô anotou (entrega,
 * frete grátis, obs. do cliente) continua; o cabeçalho "sendo montado" vira
 * quem finalizou; a observação da loja e as notas da entrega vêm no fim.
 */
export function notasDaFinalizacao(notasAntes: unknown, quem: string, observacao: string, extras: string[] = []): string {
  // A marca "aguardando a loja" sai: finalizar é justamente a loja respondendo.
  const antes = String(notasAntes || "").replace(MARCA_NO_INICIO, "").trim();
  const semCabecalho = antes.replace(PREFIXO_DO_RASCUNHO, "").replace(/^\s*·\s*/, "").trim();
  const partes = [
    `🤖 Montado pela IA no WhatsApp · 🧑‍💼 Finalizado à mão por ${quem}`,
    semCabecalho,
    ...extras.map((e) => e.trim()),
    observacao ? `Obs. da loja: ${observacao}` : "",
  ].filter(Boolean);
  return partes.join(" · ");
}
