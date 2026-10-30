/**
 * Trava a regra do número de SÓCIO/GERENTE (lib/numeros-do-dono.ts,
 * conferirNovoNumeroDoDono) — a mesma na aba Notificações do robô e na tela do
 * Bill (Configuração › Quem fala com o Bill), as duas gravando por
 * /api/chatbot/config.
 *
 *   npx tsx scripts/teste-novo-numero-do-dono.ts
 */
import { conferirNovoNumeroDoDono, lerOutrosNumerosDoDono } from "../src/lib/numeros-do-dono";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

const loja = { principal: "5522999990000", outros: ["5522988887777"], robo: "5522977776666" };
const motivo = (r: ReturnType<typeof conferirNovoNumeroDoDono>) => (r.ok ? `ok:${r.numero}` : r.motivo);

confere("celular com DDD entra com DDI", motivo(conferirNovoNumeroDoDono("(22) 99123-4567", loja)), "ok:5522991234567");
confere("fixo com DDD entra", motivo(conferirNovoNumeroDoDono("22 2622-1234", loja)), "ok:552226221234");
confere("já com +55 não ganha outro 55", motivo(conferirNovoNumeroDoDono("+55 22 99123-4567", loja)), "ok:5522991234567");
confere("sem DDD é recusado", motivo(conferirNovoNumeroDoDono("99123-4567", loja)), "formato");
confere("vazio é recusado", motivo(conferirNovoNumeroDoDono("", loja)), "formato");
confere("dígito a mais é recusado", motivo(conferirNovoNumeroDoDono("22 991234-56789", loja)), "formato");
confere("número do robô é recusado", motivo(conferirNovoNumeroDoDono("(22) 97777-6666", loja)), "robo");
confere("o principal é repetido", motivo(conferirNovoNumeroDoDono("22999990000", loja)), "repetido");
confere("um dos outros é repetido", motivo(conferirNovoNumeroDoDono("(22) 98888-7777", loja)), "repetido");
confere(
  "quinto número além do principal é recusado",
  motivo(conferirNovoNumeroDoDono("22991234567", { ...loja, outros: ["5522911111111", "5522922222222", "5522933333333", "5522944444444"] })),
  "teto",
);
confere("sem robô conectado não trava", motivo(conferirNovoNumeroDoDono("22991234567", { ...loja, robo: null })), "ok:5522991234567");
// O que a rota grava depois (a mesma limpeza): o número aceito volta igual.
confere("a rota guarda o aceito como veio", lerOutrosNumerosDoDono({ outrosNumerosDoDono: [...loja.outros, "5522991234567"] }), [...loja.outros, "5522991234567"]);

console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo certo");
process.exit(falhas ? 1 : 0);
