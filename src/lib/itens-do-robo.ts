/**
 * /src/lib/itens-do-robo.ts
 *
 * Os itens que a IA do WhatsApp escreveu, casados com o cardápio da loja — com
 * o preço do cadastro, nunca o do modelo.
 *
 * Era um bloco dentro de syncAiOrderToDatabase (chatbot-ai.ts). Saiu para cá,
 * sem mudar a lógica, quando o acréscimo em pedido que está na cozinha
 * (lib/acrescimo-servidor.ts) precisou cobrar exatamente como o pedido normal:
 * duas cópias da regra de preço iam divergir no primeiro conserto de uma delas.
 */
import { precoMinimoDoProduto } from "./preco-combo";

/** Normaliza para comparar nome: sem acento, sem pontuação, espaço único. */
export const chaveDeNome = (s: string) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export type ItemCasado = {
  menuProductId: string;
  name: string;
  quantity: number;
  price: number;
};

export function casarItensComCardapio(itens: any[], storeProducts: any[]): ItemCasado[] {
  return (itens || [])
    .map((it: any) => {
      const pedido = chaveDeNome(it.name);
      if (!pedido) return null;

      // ── COMO O PRODUTO É RECONHECIDO ────────────────────────────────────
      //
      // Antes era substring nos DOIS sentidos: bastava um nome conter o outro.
      // Com isso "Pastel de Carne" casava com "Pastel de Carne com Catupiry" —
      // e o pedido saía com o item errado, no preço errado. Pior: a ordem do
      // cardápio decidia quem ganhava, então o mesmo pedido dava resultado
      // diferente conforme o cadastro da loja.
      //
      // Agora: nome exato; senão, o candidato que CONTÉM o pedido inteiro —
      // e apenas se houver um único candidato. Dois ou mais é ambiguidade real
      // ("pastel" com vinte sabores), e aí não se adivinha: o item é recusado
      // e a loja confere na tela em vez de mandar a coisa errada para a cozinha.
      const exato = storeProducts.filter((sp) => chaveDeNome(sp.name) === pedido);
      let candidatos = exato;
      if (candidatos.length === 0) {
        candidatos = storeProducts.filter((sp) => {
          const nome = chaveDeNome(sp.name);
          return nome.startsWith(pedido + " ") || nome.includes(" " + pedido + " ") || nome.endsWith(" " + pedido);
        });
      }
      const matchedProduct = candidatos.length === 1 ? candidatos[0] : exato[0];

      // GUILHOTINA ANTI-ALUCINAÇÃO: produto que não existe (ou nome ambíguo)
      // não entra no pedido.
      if (!matchedProduct) {
        console.warn(
          `[Chatbot AI] item "${it.name}" descartado: ${candidatos.length === 0 ? "não existe no cardápio" : candidatos.length + " produtos com esse nome (ambíguo)"}.`
        );
        return null;
      }

      // ── PREÇO: NUNCA O QUE A IA ESCREVEU ────────────────────────────────
      //
      // O valor sai sempre do cadastro. Mas "o preço do cadastro" não é só
      // `price`: em produto cujo valor mora nas opções (o "Nugget" da Hakim tem
      // base R$ 0,00 e custa 9,90 / 19,90 / 39,80 conforme a escolha), a base é
      // zero — e em 01/08/2026 saiu um Nugget lançado por R$ 0,00.
      //
      // A correção anterior cobrava o MÍNIMO do produto, o que parou o R$ 0,00
      // mas criou outro rombo: cliente que escolhia a opção cara pagava o preço
      // da barata. Agora as escolhas que a IA anotou são casadas com os itens
      // dos grupos e somadas de verdade; o mínimo continua como piso, para o
      // caso de a IA não ter registrado escolha nenhuma.
      const escolhas: string[] = Array.isArray(it.options)
        ? it.options.map((o: any) => (typeof o === "string" ? o : o?.name)).filter(Boolean)
        : [];

      let somaDasOpcoes = 0;
      const naoCasadas: string[] = [];
      for (const escolha of escolhas) {
        const chave = chaveDeNome(escolha);
        if (!chave) continue;
        let achou = false;
        for (const grupo of (matchedProduct as any).comboGroups || []) {
          const item = (grupo.items || []).find(
            (gi: any) => chaveDeNome(gi?.menuProduct?.name) === chave
          );
          if (item) {
            somaDasOpcoes += Number(item.additionalPrice) || 0;
            achou = true;
            break;
          }
        }
        if (!achou) naoCasadas.push(escolha);
      }
      if (naoCasadas.length > 0) {
        console.warn(
          `[Chatbot AI] opções sem correspondência em "${matchedProduct.name}": ${naoCasadas.join(", ")} — não cobradas.`
        );
      }

      const precoMinimo = precoMinimoDoProduto(matchedProduct as any);
      const comEscolhas = (Number(matchedProduct.price) || 0) + somaDasOpcoes;
      const realPrice = Math.round(Math.max(comEscolhas, precoMinimo) * 100) / 100;

      if (realPrice !== (Number(matchedProduct.price) || 0)) {
        console.warn(
          `[Chatbot AI] "${matchedProduct.name}": base R$ ${matchedProduct.price}, opções R$ ${somaDasOpcoes.toFixed(2)}, mínimo R$ ${precoMinimo.toFixed(2)} — lançado por R$ ${realPrice.toFixed(2)}.`
        );
      }

      // Quantidade também é da casa, não da IA: teto para o modelo não lançar
      // 9999 unidades por engano de leitura.
      const quantity = Math.min(200, Math.max(1, parseInt(it.quantity) || 1));

      return {
        menuProductId: matchedProduct.id,
        name: escolhas.length > 0 ? `${matchedProduct.name} (${escolhas.join(", ")})` : matchedProduct.name,
        quantity,
        price: realPrice,
      };
    })
    .filter(Boolean) as ItemCasado[]; // Remove os nulls (itens alucinados)
}
