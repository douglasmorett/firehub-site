/**
 * scripts/teste-disparo-oficial.ts — as regras do Disparo oficial
 * (lib/disparo-oficial/regras.ts), sem banco e sem rede.
 *
 *   npx tsx scripts/teste-disparo-oficial.ts
 */
import { createHmac } from "crypto";
import {
  assinaturaConfere,
  conferirTexto,
  corpoParaMeta,
  ehPararPromocoes,
  envioGastaCredito,
  escolherPublico,
  lerErroDaMeta,
  lerPublico,
  lerWebhook,
  lojaLiberada,
  minimoDeDisparos,
  modeloParaMeta,
  nomeDoModelo,
  precoPorDisparo,
  primeiroNome,
  proximoStatus,
  saldoDeDisparos,
  telefoneDaMeta,
  valorDaRecarga,
  diasAntes,
  lerAutomacao,
  sumidosDoMarco,
} from "../src/lib/disparo-oficial/regras";

let falhas = 0;
let total = 0;
const confere = (nome: string, obtido: unknown, esperado: unknown) => {
  total++;
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  if (!ok) console.log(`✗ ${nome} — esperado ${JSON.stringify(esperado)}, veio ${JSON.stringify(obtido)}`);
};

// ── Preço: custo da Meta × (1 + 43%) ─────────────────────────────────────────
confere("preço padrão = R$ 0,46 (custo R$ 0,3217)", precoPorDisparo({}), 0.46);
confere("Meta aumenta para R$ 0,35 → R$ 0,50", precoPorDisparo({ DISPARO_CUSTO_META: "0,35" }), 0.5);
confere("margem 30% exata → R$ 0,42", precoPorDisparo({ DISPARO_MARGEM: "0.30" }), 0.42);
confere("margem zero vale", precoPorDisparo({ DISPARO_MARGEM: "0" }), 0.32);
confere("custo inválido cai no padrão", precoPorDisparo({ DISPARO_CUSTO_META: "abc" }), 0.46);
confere("mínimo de R$ 50 a R$ 0,46 = 109 disparos", minimoDeDisparos(0.46), 109);
confere("1.000 disparos = R$ 460", valorDaRecarga(1000, 0.46), 460);

// ── Telefone ─────────────────────────────────────────────────────────────────
confere("celular com DDD", telefoneDaMeta("(22) 99782-3768"), "5522997823768");
confere("já com 55", telefoneDaMeta("+55 22 99782-3768"), "5522997823768");
confere("celular antigo de 8 dígitos ganha o 9", telefoneDaMeta("2298782376"), "5522998782376");
confere("from da Meta sem o 9 casa com o pedido", telefoneDaMeta("553199999999"), telefoneDaMeta("(31) 99999-9999"));
confere("fixo fica fora", telefoneDaMeta("(22) 2645-1234"), null);
confere("celular de 9 dígitos sem o 9 fica fora", telefoneDaMeta("22 89782 3768"), null);
confere("0800 fica fora", telefoneDaMeta("0800 123 4567"), null);
confere("estrangeiro fica fora", telefoneDaMeta("+1 415 555 1234"), null);
confere("vazio", telefoneDaMeta(""), null);

// ── Nome ─────────────────────────────────────────────────────────────────────
confere("primeiro nome", primeiroNome("maria aparecida"), "Maria");
confere("sem nome", primeiroNome(null), "cliente");
confere("Cliente WhatsApp", primeiroNome("Cliente WhatsApp"), "cliente");
confere("emoji sai", primeiroNome("🍕 Leticia nascimento"), "Leticia");

// ── Saldo ────────────────────────────────────────────────────────────────────
confere("fila gasta", envioGastaCredito({ status: "FILA" }), true);
confere("processando gasta", envioGastaCredito({ status: "PROCESSANDO" }), true);
confere("incerto gasta (pode ter saído)", envioGastaCredito({ status: "INCERTO" }), true);
confere("entregue gasta", envioGastaCredito({ status: "ENTREGUE" }), true);
confere("entregue grátis devolve", envioGastaCredito({ status: "LIDO", gratis: true }), false);
confere("falhou devolve", envioGastaCredito({ status: "FALHOU" }), false);
confere("expirado devolve", envioGastaCredito({ status: "EXPIRADO" }), false);
confere("cancelado devolve", envioGastaCredito({ status: "CANCELADO" }), false);
confere("saldo", saldoDeDisparos(1000, 250), 750);
confere("saldo nunca negativo", saldoDeDisparos(10, 25), 0);

// ── Status fora de ordem ─────────────────────────────────────────────────────
confere("read antes do delivered", proximoStatus(proximoStatus("ENVIADO", "read"), "delivered"), "LIDO");
confere("failed depois de entregue não desentrega", proximoStatus("ENTREGUE", "failed"), "ENTREGUE");
confere("failed no enviado", proximoStatus("ENVIADO", "failed"), "FALHOU");
confere("delivered atrasado tira do expirado", proximoStatus("EXPIRADO", "delivered"), "ENTREGUE");
confere("sent não tira do expirado", proximoStatus("EXPIRADO", "sent"), "EXPIRADO");
confere("cancelado fica", proximoStatus("CANCELADO", "delivered"), "CANCELADO");
confere("sent no processando", proximoStatus("PROCESSANDO", "sent"), "ENVIADO");

// ── Erros da Meta ────────────────────────────────────────────────────────────
confere("131049 não para a campanha", lerErroDaMeta(131049).pararCampanha, false);
confere("130429 tenta de novo", lerErroDaMeta(130429).tentarDeNovo, true);
confere("190 para a campanha", lerErroDaMeta(190).pararCampanha, true);
confere("131048 spam para", lerErroDaMeta(131048).pararCampanha, true);
confere("desconhecido leva o título", lerErroDaMeta(999999, "Algo").motivo, "Meta: Algo (999999)");

// ── Texto do modelo ──────────────────────────────────────────────────────────
confere("texto bom", conferirTexto("Oi {nome}! Hoje tem pizza em dobro aqui na loja."), null);
confere("{nome} no começo", typeof conferirTexto("{nome}, hoje tem pizza em dobro aqui!"), "string");
confere("{nome} no fim", typeof conferirTexto("Hoje tem pizza em dobro, {nome}!"), "string");
confere("variável estranha", typeof conferirTexto("Oi {cliente}, hoje tem pizza em dobro!"), "string");
confere("chave dupla", typeof conferirTexto("Oi {{1}}, hoje tem pizza em dobro!"), "string");
confere("curto demais", typeof conferirTexto("Oi"), "string");
confere("corpo com {{1}}", corpoParaMeta("Oi {nome}, tudo bem? {NOME}!"), { corpo: "Oi {{1}}, tudo bem? {{1}}!", usaNome: true });
const m = modeloParaMeta({ nome: "fh_x", texto: "Oi {nome}, promoção hoje na loja!", botaoPedir: true, nomeDaLoja: "Hakim Centro" });
confere("modelo é marketing", m.category, "MARKETING");
confere("modelo tem exemplo do nome", (m.components[0] as any).example, { body_text: [["Maria"]] });
confere("botões: pedir e parar", (m.components[2] as any).buttons.map((b: any) => b.text), ["Quero pedir", "Parar promoções"]);
confere("sem botão pedir, parar fica", (modeloParaMeta({ nome: "x", texto: "Promoção de hoje aqui!", botaoPedir: false, nomeDaLoja: "L" }).components[2] as any).buttons.length, 1);
confere("sem {nome}, sem exemplo", "example" in (modeloParaMeta({ nome: "x", texto: "Promoção de hoje aqui!", botaoPedir: false, nomeDaLoja: "L" }).components[0] as any), false);
confere("rodapé até 60", (m.components[1] as any).text.length <= 60, true);
confere("nome do modelo", /^fh_quinta_da_pizza_[a-z0-9]+$/.test(nomeDoModelo("Quinta da Pízza!", 1760000000000)), true);

confere("FLAGGED não mexe no modelo", lerWebhook({ object: "whatsapp_business_account", entry: [{ id: "W", changes: [{ field: "message_template_status_update", value: { event: "FLAGGED", message_template_id: 9 } }] }] }).modelos.length, 0);
confere("REINSTATED volta a aprovado", lerWebhook({ object: "whatsapp_business_account", entry: [{ id: "W", changes: [{ field: "message_template_status_update", value: { event: "REINSTATED", message_template_id: 9 } }] }] }).modelos[0]?.status, "APROVADO");

// ── Público ──────────────────────────────────────────────────────────────────
const agora = new Date("2026-10-12T20:00:00Z").getTime();
const dia = 24 * 60 * 60 * 1000;
const pedidos = [
  { customerPhone: "22997823768", customerName: "Leticia", createdAt: new Date(agora - 2 * dia) },
  { customerPhone: "(22) 99782-3768", customerName: "Leticia Nascimento", createdAt: new Date(agora - 40 * dia) },
  { customerPhone: "22988887777", customerName: "João", createdAt: new Date(agora - 60 * dia) },
  { customerPhone: "2226451234", customerName: "Fixo", createdAt: new Date(agora - 1 * dia) },
  { customerPhone: "22911112222", customerName: "Parou", createdAt: new Date(agora - 1 * dia) },
];
const sairam = new Set(["5522911112222"]);
confere("todos: um por telefone, sem fixo e sem descadastrado", escolherPublico(pedidos, { tipo: "TODOS" }, sairam, agora).map((c) => c.telefone).sort(), ["5522988887777", "5522997823768"]);
confere("nome mais recente", escolherPublico(pedidos, { tipo: "TODOS" }, sairam, agora).find((c) => c.telefone === "5522997823768")?.nome, "Leticia");
confere("sumidos há 30 dias", escolherPublico(pedidos, { tipo: "SUMIDOS", dias: 30 }, sairam, agora).map((c) => c.telefone), ["5522988887777"]);
confere("recentes 30 dias", escolherPublico(pedidos, { tipo: "RECENTES", dias: 30 }, sairam, agora).map((c) => c.telefone), ["5522997823768"]);
confere("lerPublico limita dias", lerPublico({ tipo: "SUMIDOS", dias: 9999 }), { tipo: "SUMIDOS", dias: 365 });
confere("lerPublico padrão", lerPublico({}), { tipo: "TODOS" });
confere("teste: um número", escolherPublico(pedidos, lerPublico({ tipo: "TESTE", telefone: "(22) 98888-7777" }), sairam, agora).map((c) => c.telefone), ["5522988887777"]);
confere("teste: número inválido = ninguém", escolherPublico(pedidos, lerPublico({ tipo: "TESTE", telefone: "123" }), sairam, agora).length, 0);
confere("teste: descadastrado = ninguém", escolherPublico(pedidos, lerPublico({ tipo: "TESTE", telefone: "22911112222" }), sairam, agora).length, 0);

// ── Webhook ──────────────────────────────────────────────────────────────────
const corpo = {
  object: "whatsapp_business_account",
  entry: [
    {
      id: "WABA1",
      changes: [
        {
          field: "messages",
          value: {
            metadata: { phone_number_id: "PN1" },
            statuses: [
              { id: "wamid.A", status: "delivered", timestamp: "1760300000", pricing: { billable: true, category: "marketing" } },
              { id: "wamid.B", status: "failed", timestamp: "1760300001", errors: [{ code: 131049, title: "limit" }] },
              { id: "wamid.C", status: "read", timestamp: "1760300002", pricing: { billable: false } },
            ],
            messages: [
              { from: "5522997823768", timestamp: "1760300010", type: "button", button: { text: "Parar promoções", payload: "Parar promoções" } },
              { from: "5522988887777", timestamp: "1760300011", type: "button", button: { text: "Quero pedir" } },
              { from: "5522977776666", timestamp: "1760300012", type: "text", text: { body: "parar promocoes" } },
            ],
          },
        },
        { field: "message_template_status_update", value: { event: "APPROVED", message_template_id: 123, message_template_name: "fh_x", reason: "NONE" } },
        { field: "phone_number_quality_update", value: { display_phone_number: "55 22 99782-3768", event: "UPGRADE", current_limit: "TIER_1K" } },
      ],
    },
  ],
};
const w = lerWebhook(corpo);
confere("três status", w.status.map((s) => s.status), ["delivered", "failed", "read"]);
confere("erro do failed", [w.status[1].erroCodigo, w.status[1].erroTitulo], [131049, "limit"]);
confere("billable false = grátis", w.status.map((s) => s.gratis), [false, false, true]);
confere("respostas", w.respostas.map((r) => [r.telefone, r.parar]), [["5522997823768", true], ["5522988887777", false], ["5522977776666", true]]);
confere("modelo aprovado", w.modelos, [{ metaTemplateId: "123", nome: "fh_x", status: "APROVADO" }]);
confere("limite do número", w.numeros[0], { wabaId: "WABA1", numero: "5522997823768", qualidade: "UPGRADE", limite: "TIER_1K" });
confere("objeto errado ignora", lerWebhook({ object: "page" }).status.length, 0);
confere("Parar com ponto", ehPararPromocoes("Parar promoções."), true);
confere("frase com parar no meio não é", ehPararPromocoes("quero parar de pedir pizza"), false);

// ── Assinatura ───────────────────────────────────────────────────────────────
const hmac = (s: string, c: string) => createHmac("sha256", s).update(c, "utf8").digest("hex");
const cru = JSON.stringify(corpo);
confere("assinatura certa", assinaturaConfere(cru, "sha256=" + hmac("seg", cru), "seg", hmac), true);
confere("assinatura errada", assinaturaConfere(cru, "sha256=" + hmac("outro", cru), "seg", hmac), false);
confere("sem segredo recusa", assinaturaConfere(cru, "sha256=x", "", hmac), false);
confere("sem cabeçalho recusa", assinaturaConfere(cru, null, "seg", hmac), false);


// ── Recuperação automática (7, 15 e 30 dias) ────────────────────────────────
confere("diasAntes vira o mês", diasAntes("2026-10-05", 7), "2026-09-28");
confere("diasAntes vira o ano", diasAntes("2026-01-10", 15), "2025-12-26");
const dataSP = (d: Date) => new Date(d.getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10); // fuso -03
const em = (dia: string, hora = "15:00") => new Date(`${dia}T${hora}:00-03:00`);
const ped = [
  { customerPhone: "22911110001", customerName: "Sete", createdAt: em("2026-10-06") },
  { customerPhone: "22911110002", customerName: "Voltou", createdAt: em("2026-10-06") },
  { customerPhone: "22911110002", customerName: "Voltou", createdAt: em("2026-10-11") },
  { customerPhone: "22911110003", customerName: "Oito", createdAt: em("2026-10-05") },
  { customerPhone: "22911110004", customerName: "Parou", createdAt: em("2026-10-06") },
  { customerPhone: "22911110005", customerName: "Meia-noite", createdAt: em("2026-10-06", "23:50") },
  { customerPhone: "22911110006", customerName: "Quinze", createdAt: em("2026-09-28") },
];
const foraAuto = new Set(["5522911110004"]);
confere(
  "7 dias: só quem tem o ÚLTIMO pedido em 06/10 (sem quem voltou, sem descadastro)",
  sumidosDoMarco(ped, 7, "2026-10-13", dataSP, foraAuto).map((c) => c.nome).sort(),
  ["Meia-noite", "Sete"]
);
confere("15 dias", sumidosDoMarco(ped, 15, "2026-10-13", dataSP, foraAuto).map((c) => c.nome), ["Quinze"]);
confere("ninguém em 30", sumidosDoMarco(ped, 30, "2026-10-13", dataSP, foraAuto).length, 0);
confere("amanhã o de 8 dias não entra no 7", sumidosDoMarco(ped, 7, "2026-10-14", dataSP, foraAuto).map((c) => c.nome), []);
confere("lerAutomacao vazio: tudo desligado", lerAutomacao(null).marcos["7"], { ligado: false, modeloId: null });
confere("lerAutomacao lê o marco", lerAutomacao({ marcos: { "15": { ligado: true, modeloId: "m1" } }, ultimoDia: "2026-10-13" }).marcos["15"], { ligado: true, modeloId: "m1" });

// ── Liberação ────────────────────────────────────────────────────────────────
confere("lista vazia: ninguém", lojaLiberada("a", ""), false);
confere("na lista", lojaLiberada("b", "a, b"), true);
confere("fora da lista", lojaLiberada("c", "a,b"), false);
confere("todas", lojaLiberada("z", "TODAS"), true);

if (falhas) {
  console.error(`\n${falhas} de ${total} falharam`);
  process.exit(1);
}
console.log(`${total} ok, 0 falharam`);
