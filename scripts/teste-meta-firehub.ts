/**
 * O StartTrial do FireHub pela API de Conversões (lib/meta-firehub): o corpo
 * do evento, os hashes, os cookies e o que acontece sem token.
 *
 *   npx tsx scripts/teste-meta-firehub.ts
 */
import { createHash } from "node:crypto";
import { avisarMetaTrialIniciado, cookiesDoMeta, corpoDosEventosDoTrial, idsDosEventosDoTrial } from "../src/lib/meta-firehub";
import { confere, terminar, verdade } from "./nfce-teste-apoio";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

console.log("— ids e cookies —");
confere("ids repetem o id da loja", idsDosEventosDoTrial("abc"), { startTrial: "starttrial:abc", completeRegistration: "completeregistration:abc" });
confere(
  "cookies _fbp/_fbc lidos do cabeçalho; outros ignorados",
  cookiesDoMeta("a=1; _fbp=fb.1.1700000000000.123456; _fbc=fb.1.1700000000000.AbC-xyz_9; b=2"),
  { fbp: "fb.1.1700000000000.123456", fbc: "fb.1.1700000000000.AbC-xyz_9" }
);
confere("cookie torto não vai", cookiesDoMeta("_fbp=lixo; _fbc="), { fbp: null, fbc: null });

console.log("\n— o corpo do evento —");
const agora = new Date("2026-10-10T12:00:00-03:00");
const corpo: any = corpoDosEventosDoTrial({
  userId: "loja1",
  nome: "Maria da Silva",
  email: " Maria@Exemplo.com ",
  telefone: "(22) 99999-8888",
  cidade: "Rio das Ostras",
  origem: "website",
  fbp: "fb.1.1.2",
  fbc: "fb.1.1.3",
  ip: "200.1.2.3",
  userAgent: "Mozilla/5.0",
  agora,
});
confere("dois eventos no site: StartTrial e CompleteRegistration", corpo.data.map((e: any) => e.event_name), ["StartTrial", "CompleteRegistration"]);
confere("event_id igual ao do navegador", corpo.data.map((e: any) => e.event_id), ["starttrial:loja1", "completeregistration:loja1"]);
confere("action_source website com a URL do cadastro", [corpo.data[0].action_source, corpo.data[0].event_source_url], ["website", "https://firehubfood.com.br/cadastro"]);
confere("event_time em segundos", corpo.data[0].event_time, Math.floor(agora.getTime() / 1000));
const ud = corpo.data[0].user_data;
confere("telefone com 55 e só dígitos, em hash", ud.ph, [sha("5522999998888")]);
confere("e-mail minúsculo e sem espaços, em hash", ud.em, [sha("maria@exemplo.com")]);
confere("nome e sobrenome separados", [ud.fn, ud.ln], [[sha("maria")], [sha("silva")]]);
confere("cidade e país", [ud.ct, ud.country], [[sha("rio das ostras")], [sha("br")]]);
confere("cookies, IP e user-agent passam sem hash", [ud.fbp, ud.fbc, ud.client_ip_address, ud.client_user_agent], ["fb.1.1.2", "fb.1.1.3", "200.1.2.3", "Mozilla/5.0"]);
confere("StartTrial leva moeda e valor zero", corpo.data[0].custom_data, { currency: "BRL", value: 0, predicted_ltv: 0 });

const chat: any = corpoDosEventosDoTrial({ userId: "loja2", telefone: "21988887777", origem: "chat", agora });
confere("cadastro pelo WhatsApp: só StartTrial, action_source chat, sem URL", [chat.data.length, chat.data[0].action_source, "event_source_url" in chat.data[0]], [1, "chat", false]);
verdade("sem e-mail nem nome, só o telefone vai", Object.keys(chat.data[0].user_data).sort().join(",") === "country,ph");
confere("código de teste do Gerenciador de Eventos", (corpoDosEventosDoTrial({ userId: "x", origem: "chat", testEventCode: "TEST123" }) as any).test_event_code, "TEST123");

console.log("\n— sem token —");
avisarMetaTrialIniciado({ userId: "loja3", origem: "chat" }, {}).then((r) => {
  confere("sem META_FIREHUB_CAPI_TOKEN: não manda e diz por quê", r, { ok: false, motivo: "sem token" });
  terminar();
});
