import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/mail";
import { montarPacoteDoContador, zipDoPacote } from "@/lib/contador-pacote";
import { getStartOfDayUTC, getEndOfDayUTC } from "@/lib/timezone";
import { lerConfigDoContador } from "@/app/api/store/fiscal/contador/route";
import { FUSO_PADRAO } from "@/lib/contador-agenda";

/**
 * /src/lib/contador-envio.ts
 *
 * Manda o pacote fiscal para o contador — a mesma peça usada pelo botão
 * "Enviar agora" e pelo envio automático mensal.
 *
 * Uma peça só de propósito: se o teste manual funciona e o automático falha
 * (ou vice-versa), o lojista não tem como saber qual dos dois é o que vale.
 */

export type ResultadoDoEnvio = {
  ok: boolean;
  mensagem: string;
  periodo?: { de: string; ate: string };
  resumo?: { notas: number; valorDasNotas: number; pedidosSemNota: number };
};

const dinheiro = (v: number) => `R$ ${Number(v || 0).toFixed(2).replace(".", ",")}`;
const dataBr = (iso: string) => iso.split("-").reverse().join("/");

export async function enviarPacoteParaContador(
  lojaId: string,
  periodo: { de: string; ate: string }
): Promise<ResultadoDoEnvio> {
  const loja = await prisma.user.findUnique({
    where: { id: lojaId },
    select: { fiscalConfig: true, storeName: true, name: true, email: true, storeTimezone: true },
  });
  if (!loja) return { ok: false, mensagem: "Loja não encontrada." };

  const fiscalConfig = (loja.fiscalConfig as any) || {};
  const cfg = lerConfigDoContador(fiscalConfig);
  if (!cfg.email) return { ok: false, mensagem: "Nenhum e-mail de contador cadastrado." };

  const fuso = loja.storeTimezone || FUSO_PADRAO;
  const pacote = await montarPacoteDoContador(lojaId, periodo, {
    inicio: getStartOfDayUTC(periodo.de, fuso),
    fim: getEndOfDayUTC(periodo.ate, fuso),
  });

  const nomeDaLoja = loja.storeName || loja.name || "Loja";
  const zip = zipDoPacote(pacote);

  const r = pacote.resumo;
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;color:#1e293b">
      <h2 style="margin:0 0 4px">Pacote fiscal — ${nomeDaLoja}</h2>
      <p style="margin:0 0 16px;color:#64748b">Período de ${dataBr(periodo.de)} a ${dataBr(periodo.ate)}</p>
      <table style="border-collapse:collapse;width:100%;font-size:14px">
        <tr><td style="padding:6px 0">Notas autorizadas</td><td style="text-align:right;font-weight:700">${r.notas}</td></tr>
        <tr><td style="padding:6px 0">Valor das notas</td><td style="text-align:right;font-weight:700">${dinheiro(r.valorDasNotas)}</td></tr>
        <tr><td style="padding:6px 0;color:#b45309">Pedidos sem nota</td><td style="text-align:right;font-weight:700;color:#b45309">${r.pedidosSemNota} · ${dinheiro(r.valorSemNota)}</td></tr>
      </table>
      <p style="margin:16px 0 0;font-size:14px">
        O anexo traz os XMLs em <code>xml/</code>, a relação das notas em
        <code>relacao-de-notas.csv</code> e os pedidos sem nota em
        <code>vendas-sem-nota.csv</code>.
      </p>
      ${r.notasDeTesteIgnoradas > 0 ? `<p style="margin:12px 0 0;padding:10px;background:#fffbeb;border-left:4px solid #d97706;font-size:13px;color:#78350f">${r.notasDeTesteIgnoradas} nota(s) do período foram emitidas em <b>homologação</b> (teste) e ficaram de fora — elas não têm valor fiscal.</p>` : ""}
      ${r.xmlsQueNaoBaixaram > 0 ? `<p style="margin:12px 0 0;padding:10px;background:#fef2f2;border-left:4px solid #dc2626;font-size:13px;color:#7f1d1d">${r.xmlsQueNaoBaixaram} XML(s) não puderam ser baixados do provedor. As notas existem e estão na relação.</p>` : ""}
      <p style="margin:20px 0 0;font-size:12px;color:#94a3b8">Enviado automaticamente pelo FireHub.</p>
    </div>`;

  const anexo = {
    filename: `fiscal-${periodo.de}_a_${periodo.ate}.zip`,
    content: zip,
    contentType: "application/zip",
  };
  const assunto = `Pacote fiscal ${dataBr(periodo.de)} a ${dataBr(periodo.ate)} — ${nomeDaLoja}`;

  const envio = await sendEmail({ to: cfg.email, subject: assunto, html, attachments: [anexo] });

  // A cópia para o lojista é o que permite a ele conferir que chegou. Falha
  // nela não invalida o envio ao contador, que é o que importa.
  if (envio.success && cfg.copiaParaLoja && loja.email && loja.email !== cfg.email) {
    await sendEmail({ to: loja.email, subject: `[cópia] ${assunto}`, html, attachments: [anexo] }).catch(() => null);
  }

  const resultado = envio.success
    ? `Enviado para ${cfg.email} (${r.notas} nota(s)).`
    : `Falhou: ${envio.error || "erro desconhecido"}`;

  await prisma.user.update({
    where: { id: lojaId },
    data: {
      fiscalConfig: {
        ...fiscalConfig,
        contador: { ...cfg, ultimoEnvioEm: new Date().toISOString(), ultimoEnvioResultado: resultado },
      },
    },
  });

  return {
    ok: envio.success,
    mensagem: resultado,
    periodo,
    resumo: { notas: r.notas, valorDasNotas: r.valorDasNotas, pedidosSemNota: r.pedidosSemNota },
  };
}
