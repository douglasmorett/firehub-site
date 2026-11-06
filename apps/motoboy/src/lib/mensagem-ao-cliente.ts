/**
 * O texto que o botão de WhatsApp do entregador já deixa escrito para o cliente.
 *
 * Era "Olá! Sou o entregador da loja e estou a caminho do seu endereço!" — e o
 * cliente respondia "Que loja?" (Vânia, Pizzaria Bom Cheff, 06/11/2026). Agora
 * vai o nome da loja e o número do pedido. Sem a loja (servidor antigo), a
 * frase de antes.
 *
 * CÓPIA de src/lib/app-motoboy/mensagem-ao-cliente.ts do site (que a página web usa):
 * mudar aqui e lá juntos.
 */
export function mensagemAoCliente(p: { cliente?: string | null; loja?: string | null; numero?: string | number | null }): string {
  const loja = String(p.loja || "").trim();
  if (!loja) return "Olá! Sou o entregador da loja e estou a caminho do seu endereço!";
  // Primeiro nome, sem gritar ("JOÃO SILVA" → "João"). "Cliente iFood" e afins não são nome.
  const primeiro = String(p.cliente || "").trim().split(/\s+/)[0] || "";
  const nome = /[a-zà-ÿ]/i.test(primeiro) && !/^cliente$/i.test(primeiro)
    ? primeiro.charAt(0).toUpperCase() + primeiro.slice(1).toLowerCase()
    : "";
  const numero = String(p.numero ?? "").replace(/^#/, "").trim();
  return `${nome ? `Oi, ${nome}!` : "Oi!"} Aqui é o entregador da ${loja}. Seu pedido${numero ? ` #${numero}` : ""} já está a caminho 🛵`;
}
