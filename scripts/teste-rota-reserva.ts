/**
 * Quando o roteador principal cai, a distância vem do reserva — não da linha
 * reta (que é mais curta que a rua e deixaria a entrega mais barata).
 *
 *   npx tsx scripts/teste-rota-reserva.ts
 *
 * Rede de verdade (os dois OSRM públicos); o cache em banco fica desligado.
 * Par da Deeds Delivery (Londrina), medido em 25/09/2026: 3.195,8 m nos dois.
 */
process.env.DATABASE_URL = "postgresql://u:p@localhost:5432/x";
process.env.OSRM_URL = "https://osrm-que-nao-existe.invalid";

(async () => {
  const { distanciaPorRotaKm } = await import("../src/lib/distancia-por-rota");
  const loja = { lat: -23.2770249, lng: -51.1595687 };
  const cliente = { lat: -23.3002, lng: -51.1543 };
  const km = await distanciaPorRotaKm(loja, cliente);
  const ok = km !== null && Math.abs(km - 3.2) <= 0.02;
  console.log(`${ok ? "✅" : "❌"} principal fora do ar → reserva mede ${km} km (esperado 3,2 km pela rua)`);
  process.exit(ok ? 0 : 1);
})();
