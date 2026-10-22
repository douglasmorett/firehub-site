"use client";
import { useState } from "react";
import { copiarTexto } from "@/lib/copiar-texto";

/**
 * O app FireHub (apps/firehub) nas lojas: um app só, com três entradas — a
 * loja, o garçom e o tablet da mesa. Nulo = ainda não publicado; a tela diz
 * "em breve" e manda usar pelo navegador. Preencher ao publicar.
 */
export const APP_FIREHUB_ANDROID: string | null = null; // https://play.google.com/store/apps/details?id=br.com.firehub.app
export const APP_FIREHUB_IPHONE: string | null = null;

/**
 * Os links para o garçom baixar o app (aba Garçons). Douglas, 22/10/2026:
 * "a gente pode botar o link lá na aba do garçom para baixar o aplicativo.
 * Para quem usa no tablet ajuda muito." O "Copiar mensagem" junta os links das
 * lojas e o link de acesso num texto pronto para o WhatsApp da equipe.
 */
export default function LinksDoAppFireHub({ linkDoGarcom }: { linkDoGarcom: string }) {
  const [copiado, setCopiado] = useState(false);
  const publicado = Boolean(APP_FIREHUB_ANDROID || APP_FIREHUB_IPHONE);

  const botao = (fundo: string, ativo: boolean): React.CSSProperties => ({
    flex: "1 1 160px", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
    padding: "10px 12px", borderRadius: 10, background: ativo ? fundo : "#CBD5E1", color: "#FFFFFF",
    fontWeight: 800, fontSize: 13, textDecoration: "none", fontFamily: "inherit", pointerEvents: ativo ? "auto" : "none",
  });

  async function copiarMensagem() {
    const texto = [
      publicado ? "Baixe o app FireHub e toque em \"Sou garçom\":" : "Acesse o módulo do garçom:",
      ...(APP_FIREHUB_IPHONE ? [`📱 iPhone/iPad: ${APP_FIREHUB_IPHONE}`] : []),
      ...(APP_FIREHUB_ANDROID ? [`🤖 Android: ${APP_FIREHUB_ANDROID}`] : []),
      "",
      `${publicado ? "Ou pelo navegador" : "Link"}: ${linkDoGarcom}`,
      "Entre com o login e a senha que eu te passei.",
    ].join("\n");
    if (!(await copiarTexto(texto))) return;
    setCopiado(true);
    setTimeout(() => setCopiado(false), 3000);
  }

  return (
    <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px dashed #CBD5E1" }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: "#0F172A" }}>📲 App FireHub para o garçom</div>
      <div style={{ fontSize: 12, color: "#64748B", margin: "2px 0 8px", lineHeight: 1.5 }}>
        {publicado
          ? "No celular ou no tablet: baixe o app, toque em \"Sou garçom\" e entre com o mesmo login. A tela fica sempre acesa e abre direto nas mesas."
          : "Em breve na Google Play e na App Store. Enquanto isso, o link acima funciona no navegador do celular e do tablet."}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <a href={APP_FIREHUB_IPHONE || undefined} target="_blank" rel="noopener noreferrer" style={botao("#0F172A", Boolean(APP_FIREHUB_IPHONE))}>
          🍎 App Store {APP_FIREHUB_IPHONE ? "" : "(em breve)"}
        </a>
        <a href={APP_FIREHUB_ANDROID || undefined} target="_blank" rel="noopener noreferrer" style={botao("#15803D", Boolean(APP_FIREHUB_ANDROID))}>
          ▶ Google Play {APP_FIREHUB_ANDROID ? "" : "(em breve)"}
        </a>
      </div>
      <button type="button" onClick={copiarMensagem} style={{
        width: "100%", marginTop: 8, padding: "9px 12px", borderRadius: 10, cursor: "pointer", fontFamily: "inherit",
        border: "1.5px solid #CBD5E1", background: copiado ? "#0F766E" : "#fff", color: copiado ? "#fff" : "#334155", fontWeight: 800, fontSize: 13,
      }}>
        {copiado ? "Mensagem copiada! Cole no WhatsApp da equipe" : "Copiar mensagem para a equipe"}
      </button>
    </div>
  );
}
