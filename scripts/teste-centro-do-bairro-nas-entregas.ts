/**
 * Teste do centro do bairro pelas entregas da loja (src/lib/rua-das-entregas.ts,
 * `centroDoBairroNasEntregas`), que a roteirização usa quando o mapa só sabe o
 * bairro (src/lib/geocodificacao-servidor.ts, passo 2b).
 *
 * O caso é da Duga Burguer (Rio das Ostras), 30/10/2026: pedido 42 do Jota Já,
 * "Rua 29, qd 46 ... Extensão Serramar", sem coordenada. O dicionário punha o
 * bairro em -22.528,-41.960 (em cima do Recanto); as 73 entregas com GPS/iFood
 * da loja no Extensão do Serramar têm a mediana em -22.5336,-41.9756.
 *
 * Rodar: npx tsx scripts/teste-centro-do-bairro-nas-entregas.ts
 */
import { chaveDoBairro, centroDoBairroNasEntregas, type EntregaComPonto } from "../src/lib/rua-das-entregas";
import { distanciaKm } from "../src/lib/ponto-do-pedido";

let falhas = 0;
function conferir(nome: string, ok: boolean, detalhe: unknown = "") {
  if (!ok) falhas++;
  console.log(`${ok ? "ok  " : "FALHOU"} ${nome}${detalhe !== "" ? ` — ${typeof detalhe === "string" ? detalhe : JSON.stringify(detalhe)}` : ""}`);
}

// ── 1. A chave do nome do bairro ─────────────────────────────────────────
const chaves: [string, string][] = [
  ["Extensão do Serramar", "extensao serramar"],
  ["Extensao Serramar", "extensao serramar"],
  ["Vila Monte Alegre", "monte alegre"],
  ["Jardim", "jardim"],
  ["Recanto dos Paratis", "recanto paratis"],
];
for (const [b, esperado] of chaves) conferir(`chave de "${b}"`, chaveDoBairro(b) === esperado, chaveDoBairro(b));

// ── 2. O centro do bairro ────────────────────────────────────────────────
const em = (bairro: string, lat: number, lng: number, i: number): EntregaComPonto => ({ endereco: `Rua ${i}, 10 - ${bairro}`, bairro, ponto: { lat, lng } });
const entregas: EntregaComPonto[] = [
  // Extensão do Serramar: espalhadas em volta de -22.5336,-41.9756
  em("Extensão do Serramar", -22.5330, -41.9750, 1),
  em("Extensão do Serramar", -22.5340, -41.9760, 2),
  em("Extensão do Serramar", -22.5336, -41.9756, 3),
  em("Extensão do Serramar", -22.5345, -41.9748, 4),
  em("Extensão do Serramar", -22.5328, -41.9765, 5),
  // uma com o ponto do outro lado da cidade (endereço trocado)
  em("Extensão do Serramar", -22.4815, -41.9130, 6),
  // Recanto e Recanto dos Paratis (nome contido, 2,6 km)
  em("Recanto", -22.5307, -41.9681, 7),
  em("Recanto", -22.5300, -41.9675, 8),
  em("Recanto", -22.5310, -41.9685, 9),
  em("Recanto dos Paratis", -22.5539, -41.9870, 10),
  em("Recanto dos Paratis", -22.5540, -41.9872, 11),
  em("Recanto dos Paratis", -22.5538, -41.9868, 12),
  em("Recanto dos Paratis", -22.5541, -41.9871, 13),
  // Serramar com 2 entregas só
  em("Serramar", -22.5315, -41.9756, 14),
  em("Serramar", -22.5317, -41.9758, 15),
];
const DICIONARIO_ANTIGO = { lat: -22.528, lng: -41.96 };

const ext = centroDoBairroNasEntregas("Extensão Serramar", entregas);
conferir("Extensão Serramar (escrito sem 'do'): centro pelas entregas", !!ext && distanciaKm(ext, { lat: -22.5336, lng: -41.9756 }) < 0.15, ext);
conferir("…a entrega do outro lado da cidade não entra", ext?.entregas === 5, ext?.entregas);
conferir("…e fica longe do ponto antigo do dicionário (o Recanto)", !!ext && distanciaKm(ext, DICIONARIO_ANTIGO) > 1.2, ext && distanciaKm(ext, DICIONARIO_ANTIGO).toFixed(2));

const rec = centroDoBairroNasEntregas("Recanto", entregas);
conferir("Recanto: só as do Recanto (não mistura Recanto dos Paratis)", !!rec && rec.entregas === 3 && distanciaKm(rec, { lat: -22.5307, lng: -41.9681 }) < 0.15, rec);

const par = centroDoBairroNasEntregas("Recanto dos Paratis", entregas);
conferir("Recanto dos Paratis: o dele", !!par && distanciaKm(par, { lat: -22.5539, lng: -41.987 }) < 0.15, par);

// Serramar tem 2 entregas com o mesmo nome: vale o parecido (Extensão do Serramar contém Serramar), que está ao lado.
const ser = centroDoBairroNasEntregas("Serramar", entregas);
conferir("Serramar com 2 entregas: usa as de nome parecido, perto", !!ser && distanciaKm(ser, { lat: -22.5315, lng: -41.9756 }) < 0.5, ser);

conferir("Bairro sem entregas: null", centroDoBairroNasEntregas("Âncora", entregas) === null);
conferir("Sem bairro: null", centroDoBairroNasEntregas(null, entregas) === null);
conferir("Menos de 3 entregas: null", centroDoBairroNasEntregas("Centro", [em("Centro", -22.52, -41.94, 1), em("Centro", -22.521, -41.941, 2)]) === null);

// Espalhado demais (a maioria longe da mediana): null.
const espalhadas = [em("Novo", -22.50, -41.90, 1), em("Novo", -22.55, -41.95, 2), em("Novo", -22.60, -42.00, 3), em("Novo", -22.45, -41.85, 4)];
conferir("Bairro espalhado pela cidade: null", centroDoBairroNasEntregas("Novo", espalhadas) === null);

console.log(falhas ? `\n${falhas} FALHA(S)` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
