import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Instalar o FireHub Prazos",
  description: "Instale a extensão no Chrome do computador da loja e ative pelo link do e-mail da compra.",
  robots: { index: false, follow: false },
};

/**
 * /prazos/instalar — para onde o botão "1. Instalar" do e-mail da compra manda.
 *
 * Existe para descolar o e-mail do dia em que a Chrome Web Store aprovar a
 * ficha: o e-mail já foi mandado, não dá para trocar o link nele depois. Aqui
 * dá. Enquanto a loja não libera, o caminho pelo arquivo fica disponível
 * dobrado, para quem comprou antes não ficar sem produto. Quando a ficha for
 * aprovada, apague o bloco do arquivo e deixe só o botão.
 */

const LOJA = "https://chromewebstore.google.com/detail/pkkcnkbkacfiojiapodplkbkmdhhnjag";
const ZIP = "https://firehubfood.com.br/downloads/FireHub-Prazos-Extensao.zip";

export default function InstalarPage() {
  const p: React.CSSProperties = { color: "#475569", lineHeight: 1.65, margin: "10px 0 0" };
  return (
    <main style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif", background: "#F8FAFC", minHeight: "100vh", color: "#0F172A", padding: "3rem 1.25rem" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 26 }}>
        <div style={{ width: 34, height: 34, borderRadius: 10, background: "linear-gradient(135deg,#FF5722,#F44336)", display: "grid", placeItems: "center", fontSize: "1.1rem" }}>🔥</div>
        <div style={{ fontWeight: 900, fontSize: "1.05rem" }}>FireHub Prazos</div>
      </div>

      <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 18, padding: "2rem 1.8rem", maxWidth: 560, margin: "0 auto", boxShadow: "0 10px 34px rgba(15,23,42,.07)", textAlign: "center" }}>
        <div style={{ fontSize: "2.6rem", lineHeight: 1 }}>🧩</div>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 900, margin: "12px 0 0" }}>Instale no Chrome do computador da loja</h1>
        <p style={p}>É lá que ela trabalha. Se você está no celular, mande este link para você mesmo e abra no computador.</p>
        <a href={LOJA} target="_blank" rel="noopener" style={{ display: "inline-block", marginTop: 18, background: "linear-gradient(135deg,#FF5722,#E64A19)", color: "#fff", fontWeight: 900, padding: "15px 30px", borderRadius: 12, textDecoration: "none", fontSize: "1.05rem" }}>
          Instalar pela Chrome Web Store
        </a>
        <p style={{ ...p, fontSize: ".95rem" }}>
          Depois volte ao e-mail e clique em <b>2. Ativar minha conta</b>. A extensão entra sozinha.
        </p>

        <details style={{ marginTop: 22, textAlign: "left", background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 12, padding: "12px 14px" }}>
          <summary style={{ cursor: "pointer", fontWeight: 800, color: "#475569" }}>
            A loja disse "item não encontrado"?
          </summary>
          <div style={{ color: "#475569", lineHeight: 1.7, fontSize: ".93rem", marginTop: 10 }}>
            A ficha ainda está em análise no Google. Enquanto isso dá para instalar pelo arquivo:
            <ol style={{ paddingLeft: "1.2rem", margin: "8px 0 0" }}>
              <li><a href={ZIP} style={{ color: "#C2410C", fontWeight: 700 }}>Baixe a extensão</a> e descompacte numa pasta.</li>
              <li>No Chrome, abra <code>chrome://extensions</code>, ligue o <b>Modo do desenvolvedor</b> e clique em <b>Carregar sem compactação</b>, escolhendo a pasta.</li>
              <li>Volte ao e-mail e clique em <b>2. Ativar minha conta</b>.</li>
            </ol>
            <div style={{ marginTop: 8, color: "#64748B" }}>
              Quando a loja liberar, a gente te avisa para trocar pela instalação de um clique — ela se atualiza sozinha.
            </div>
          </div>
        </details>
      </div>

      <div style={{ textAlign: "center", color: "#64748B", fontSize: ".85rem", marginTop: 22 }}>
        Travou? <a href="https://wa.me/5522981118514" target="_blank" rel="noopener" style={{ color: "#15803D", fontWeight: 800 }}>Chama no WhatsApp</a> que a gente instala junto com você.
      </div>
    </main>
  );
}
