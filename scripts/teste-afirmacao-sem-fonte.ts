/**
 * A rede contra serviço inventado pelo robô (lib/afirmacao-sem-fonte.ts).
 *
 *   npx tsx scripts/teste-afirmacao-sem-fonte.ts
 *
 * O caso é o da R&D Pizzaria em 27/09/2026: o robô disse que a loja tinha
 * rodízio, e a palavra não existe em lugar nenhum dos dados dela.
 */
import { servicosSemFonte } from "../src/lib/afirmacao-sem-fonte";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

const RD = "R&D Pizzaria e Delivery\nRua Tal, 100 - Bairro da Luz\nPizza Calabresa G ... R$ 49,90\nCoca-Cola 2L ... R$ 14,00";

// ── O caso da R&D ──
confere("R&D com salão: 'temos rodízio' sem fonte é pego", servicosSemFonte("Temos rodízio sim, às sextas! 🍕", RD), ["rodízio"]);
confere("sem acento também", servicosSemFonte("temos rodizio de pizza", RD), ["rodízio"]);
confere("R&D com salão: 'não temos rodízio' também é palpite", servicosSemFonte("Não temos rodízio não", RD), ["rodízio"]);

// ── Com fonte, pode ──
confere("rodízio no cardápio: pode falar", servicosSemFonte("Temos rodízio sim!", RD + "\nRodízio de Pizza (por pessoa) ... R$ 59,90"), []);
confere("rodízio nas instruções do lojista: pode falar", servicosSemFonte("O rodízio é sexta e sábado", RD + "\nTemos rodízio às sextas e sábados das 19h às 23h"), []);
confere("estacionamento escrito pelo lojista: pode", servicosSemFonte("Temos estacionamento na frente", "Loja X\nTemos estacionamento próprio"), []);

// ── Só delivery pode negar ──
confere("só delivery, negando: é fato", servicosSemFonte("Não trabalhamos com rodízio, somos só delivery 🛵", RD, { soDelivery: true }), []);
confere("só delivery, AFIRMANDO: pega", servicosSemFonte("Temos rodízio aos domingos!", RD, { soDelivery: true }), ["rodízio"]);

// ── Outros serviços ──
confere("buffet", servicosSemFonte("Nosso buffet abre ao meio-dia", RD), ["buffet"]);
confere("reserva de mesa", servicosSemFonte("Pode reservar sim, é só me passar o horário", RD), ["reserva"]);
confere("música ao vivo e espaço kids juntos", servicosSemFonte("Sexta tem música ao vivo e espaço kids!", RD), ["música ao vivo", "espaço kids"]);
confere("wi-fi", servicosSemFonte("Temos Wi-Fi liberado", RD), ["wi-fi"]);

// ── Não pode pegar o que é normal ──
confere("resposta comum de pedido: nada", servicosSemFonte("Show! Anotei 1 Pizza Calabresa G, 49,90 reais. Me passa o endereço?", RD), []);
confere("'reservado' não é reserva", servicosSemFonte("Seu pedido está reservado aqui, já vai para a cozinha", RD), []);
confere("palavra dentro de outra não conta ('rodizionário')", servicosSemFonte("isso é rodizionario", RD), []);

if (falhas > 0) {
  console.log(`\n❌ ${falhas} falha(s)`);
  process.exit(1);
}
console.log("\n✅ tudo certo");
