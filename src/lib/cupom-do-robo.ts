/**
 * Cupom no robô do WhatsApp — que cupom ele pode citar, qual o cliente citou e
 * qual entra no pedido que ele grava.
 *
 * ── Por que existe ──────────────────────────────────────────────────────────
 *
 * Rafa (R&D Pizzaria, 28/09/2026): "quando o robô identificar que o cliente
 * nunca pediu naquele número, oferecer o cupom de primeiro pedido". E: o robô
 * tem que entender os cupons cadastrados quando o cliente quer usar um.
 *
 * Até aqui o robô citava o cupom instantâneo da loja a QUALQUER cliente — na
 * R&D ele é o PRIMEIROPEDIDO 40% —, e o cliente antigo ouvia a promessa que o
 * site recusava. E o pedido que o robô grava nunca levou desconto nenhum: quem
 * fechava pela conversa pagava o preço cheio do que tinha ouvido com 40%.
 *
 * A régua do cupom continua sendo uma só (lib/cupons.ts, `avaliarCupom`), com
 * os fatos do banco (lib/cupons-no-banco.ts) — a mesma do checkout do site.
 * Aqui mora só o que é do robô: o que ele pode anunciar, como se reconhece um
 * código no meio de uma frase e o que pode entrar no pedido.
 *
 * Funções puras. Teste: scripts/teste-cupom-do-robo.ts.
 */
import { cupomDePrimeiroPedido, cupomVenceu, cuponsAnunciaveis, descreverBeneficio, lerCupons, type Cupom } from "./cupons";

/** Maiúsculas, sem acento, só letras e números separados por um espaço. */
function palavras(texto: unknown): string[] {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

/** O código sem espaço nem pontuação: "PRIMEIRO PEDIDO" e "primeiropedido" são o mesmo. */
export function codigoCompacto(code: unknown): string {
  return palavras(code).join("");
}

/**
 * O cupom da loja que o cliente escreveu, se escreveu algum.
 *
 * Casa por PALAVRAS inteiras, juntando até 6 seguidas: "quero usar o
 * primeiro pedido" acha PRIMEIROPEDIDO, "cupom rd10" acha RD10, "CLIENTE
 * INATIVO A 7 DIAS" casa com o código de mesmo nome. Nunca dentro de uma
 * palavra: "pizzard10" não é o RD10. Código de menos de 3 caracteres não
 * se procura — "10" casaria com qualquer quantidade.
 *
 * Mensagens mais novas primeiro: se o cliente trocou de cupom, vale o último.
 *
 * Código colado feito de palavras comuns (PRIMEIROPEDIDO) escrito SEPARADO só
 * conta se a mensagem fala de cupom: "é o meu primeiro pedido aí" é conversa,
 * "tenho o cupom primeiro pedido" é o cupom. Código cadastrado com espaço
 * ("CLIENTE INATIVO A 7 DIAS") casa direto — ninguém escreve isso à toa.
 */
export function cupomCitadoPeloCliente(textosDoCliente: unknown[], cupons: unknown): Cupom | null {
  const porCodigo = new Map<string, Cupom>();
  for (const c of lerCupons(cupons)) {
    const k = codigoCompacto(c.code);
    if (c.active && k.length >= 3 && !porCodigo.has(k)) porCodigo.set(k, c);
  }
  if (porCodigo.size === 0) return null;
  for (const texto of [...(textosDoCliente || [])].reverse()) {
    const p = palavras(texto);
    const falaDeCupom = p.some((w) => /^(CUPOM|CUPON|CUPONS|CODIGO|DESCONTO|VOUCHER)$/.test(w));
    for (let i = 0; i < p.length; i++) {
      let junto = "";
      for (let j = i; j < Math.min(p.length, i + 6); j++) {
        junto += p[j];
        const achado = porCodigo.get(junto);
        if (!achado) continue;
        const escritoSeparado = j > i;
        const codigoTemEspaco = palavras(achado.code).length > 1;
        if (escritoSeparado && !codigoTemEspaco && !falaDeCupom) continue;
        return achado;
      }
    }
  }
  return null;
}

export type CuponsDoRobo = {
  /** Os que ele pode citar a qualquer cliente (públicos, sem regra de primeiro pedido). */
  publicos: Cupom[];
  /** O de primeiro pedido, ativo e no prazo — só para quem nunca pediu. */
  primeiroPedido: Cupom | null;
};

/**
 * O que o robô pode anunciar. O cupom instantâneo da tela do robô entra como
 * público — a não ser que seja o de primeiro pedido cadastrado na loja (o da
 * R&D é): aí ele segue a regra de primeiro pedido e só vale para cliente novo.
 */
export function cuponsDoRobo(storeCoupons: unknown, chatbotConfig: unknown, hojeDaLoja: string): CuponsDoRobo {
  const publicos = cuponsAnunciaveis(storeCoupons, hojeDaLoja);
  const primeiro = cupomDePrimeiroPedido(storeCoupons);
  const primeiroPedido = primeiro && !cupomVenceu(primeiro, hojeDaLoja) ? primeiro : null;

  const cfg: any = chatbotConfig && typeof chatbotConfig === "object" ? chatbotConfig : {};
  const instantaneo = cfg.instantCouponEnabled === true ? String(cfg.instantCouponCode || "").trim() : "";
  if (instantaneo) {
    const k = codigoCompacto(instantaneo);
    const jaEsta = publicos.some((c) => codigoCompacto(c.code) === k) || (primeiro && codigoCompacto(primeiro.code) === k);
    if (!jaEsta) {
      const cadastrado = lerCupons(storeCoupons).find((c) => codigoCompacto(c.code) === k);
      if (cadastrado) {
        // Cadastrado mas não público (ou vencido): público só se estiver valendo.
        if (cadastrado.active && !cadastrado.primeiroPedido && !cupomVenceu(cadastrado, hojeDaLoja)) publicos.push(cadastrado);
      }
      // Não cadastrado em Cupons: o checkout do site não o conhece e o pedido
      // do robô não teria como aplicá-lo. Citar seria prometer o que não sai.
    }
  }
  return { publicos, primeiroPedido };
}

/** "PRIMEIROPEDIDO (40% de desconto)". */
export function nomeDoCupom(c: Cupom): string {
  return `${c.code} (${descreverBeneficio(c)})`;
}

/**
 * Qual cupom tentar no pedido que o robô grava, em ordem. O servidor avalia
 * cada um com `avaliarCupom` e fica com o primeiro que vale.
 *
 * 1. o que a tag pediu — só se for um que o robô pode dar: público, o de
 *    primeiro pedido, ou um que o PRÓPRIO CLIENTE escreveu na conversa. Cupom
 *    estratégico (recuperação de inativo) que o modelo tirasse do nada não
 *    entra: esse só vale para quem recebeu o código;
 * 2. o que o cliente escreveu, mesmo que o modelo esqueça de pôr na tag;
 * 3. o de primeiro pedido, sozinho — como o site, que o aplica sem o cliente
 *    digitar nada. `avaliarCupom` recusa se o telefone já pediu.
 */
export function cuponsParaTentar(opcoes: {
  cupons: unknown;
  daTag: unknown;
  citado: Cupom | null;
  doRobo: CuponsDoRobo;
}): Cupom[] {
  const todos = lerCupons(opcoes.cupons);
  const porCodigo = (code: unknown) => {
    const k = codigoCompacto(code);
    return k ? todos.find((c) => codigoCompacto(c.code) === k) || null : null;
  };
  const podeDar = new Set(
    [...opcoes.doRobo.publicos, opcoes.doRobo.primeiroPedido, opcoes.citado]
      .filter(Boolean)
      .map((c) => codigoCompacto((c as Cupom).code))
  );
  const fila: Cupom[] = [];
  const pedido = porCodigo(opcoes.daTag);
  if (pedido && podeDar.has(codigoCompacto(pedido.code))) fila.push(pedido);
  if (opcoes.citado) fila.push(opcoes.citado);
  if (opcoes.doRobo.primeiroPedido) fila.push(opcoes.doRobo.primeiroPedido);
  const vistos = new Set<string>();
  return fila.filter((c) => {
    const k = codigoCompacto(c.code);
    if (vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
}

const reais = (n: number) => `R$ ${n.toFixed(2).replace(".", ",")}`;

/**
 * A linha que o sistema acrescenta à resposta do modelo depois de gravar —
 * ou "" quando não há o que dizer. Mesma ideia da correção da taxa: o cliente
 * lê o total que vai pagar junto da confirmação, não na porta de casa.
 *
 *  - cupom aplicado e o modelo escreveu outro total → a linha com o total certo;
 *  - cupom que o cliente pediu e não vale → o motivo;
 *  - no rascunho, só quando a mensagem fala de total (ou de cupom, na recusa):
 *    "anotado, mais alguma coisa?" não ganha linha a cada item.
 */
export function mensagemDoCupom(
  gravado: {
    total: number;
    cupom?: { code: string; desconto: number; freteGratis: boolean } | null;
    cupomRecusado?: string | null;
    totalDitoPelaIa?: number | null;
  },
  textoDoModelo: string,
  finalizado: boolean
): string {
  const texto = String(textoDoModelo || "");
  if (gravado.cupomRecusado) {
    return finalizado || /cupom/i.test(texto) ? `\n\nℹ️ ${gravado.cupomRecusado}` : "";
  }
  const c = gravado.cupom;
  if (!c) return "";
  const dito = gravado.totalDitoPelaIa;
  if (dito != null && Math.abs(dito - gravado.total) < 0.01) return "";
  if (!finalizado && !/total/i.test(texto)) return "";
  return c.freteGratis
    ? `\n\n🎟️ Cupom ${c.code}: entrega grátis, e o total fica ${reais(gravado.total)}.`
    : `\n\n🎟️ Cupom ${c.code} aplicado (-${reais(c.desconto)}): o total fica ${reais(gravado.total)}.`;
}

/**
 * O parágrafo da conversa (vai DEPOIS da linha "ESTA CONVERSA" do prompt:
 * depende do cliente). `clienteNovo` null = não se sabe o telefone.
 */
export function cupomDesteClienteParaOPrompt(opcoes: {
  doRobo: CuponsDoRobo;
  clienteNovo: boolean | null;
  citado: Cupom | null;
  /** O veredito do citado para este cliente (motivo da recusa, quando recusa). */
  recusaDoCitado: string | null;
}): string {
  const { doRobo, clienteNovo, citado, recusaDoCitado } = opcoes;
  const linhas: string[] = [];
  const primeiro = doRobo.primeiroPedido;

  if (primeiro && clienteNovo === true) {
    linhas.push(
      `- ESTE CLIENTE NUNCA PEDIU NESTA LOJA: ele tem direito ao cupom de primeiro pedido ${nomeDoCupom(primeiro)}` +
        (primeiro.minOrderValue > 0 ? `, em pedidos a partir de R$ ${primeiro.minOrderValue.toFixed(2).replace(".", ",")}` : "") +
        `. Se você ainda não falou dele nesta conversa, conte na sua próxima resposta, numa frase curta e animada (ex.: "Como é seu primeiro pedido aqui, você ganha ${descreverBeneficio(primeiro)} com o cupom ${primeiro.code} 🎉"). Uma vez só — não repita a cada mensagem.` +
        ` O desconto entra SOZINHO no pedido que você anotar: mostre a linha "Cupom ${primeiro.code}: -R$ X" no resumo e o total já com o desconto.`
    );
  } else if (primeiro && clienteNovo === false) {
    linhas.push(
      `- Este cliente JÁ PEDIU nesta loja: o cupom de primeiro pedido (${primeiro.code}) NÃO vale para ele. Não ofereça. Se ele perguntar, diga com gentileza que é só para o primeiro pedido.`
    );
  }

  if (citado) {
    if (recusaDoCitado) {
      linhas.push(`- O cliente citou o cupom ${citado.code}, que existe, mas NÃO vale para ele agora: ${recusaDoCitado} Diga isso com gentileza; não aplique.`);
    } else {
      linhas.push(
        `- O cliente citou o cupom ${nomeDoCupom(citado)}` +
          (citado.minOrderValue > 0 ? `, válido a partir de R$ ${citado.minOrderValue.toFixed(2).replace(".", ",")} em itens` : "") +
          `. Ele existe e vale: confirme e aplique — ponha "couponCode": "${citado.code}" na tag PEDIDO_IA e mostre o desconto no resumo.`
      );
    }
  }

  if (linhas.length === 0) return "";
  return `CUPOM DESTE CLIENTE (o sistema confere de novo ao gravar — o total que vale é o gravado):\n${linhas.join("\n")}`;
}
