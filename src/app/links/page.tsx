import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "FireHub e FireCheck — links",
  description: "FireHub: sistema completo para restaurante e delivery. FireCheck: checklist e ponto com IA para qualquer equipe.",
  openGraph: {
    title: "FireHub e FireCheck",
    description: "Sistema para restaurante e checklist com IA para qualquer equipe. Teste grátis.",
    url: "https://firehubfood.com.br/links",
    siteName: "FireHub",
    locale: "pt_BR",
    type: "website",
  },
};

/**
 * /links — o link único da bio do @firehubfood (Douglas, 31/10/2026: "um link
 * só, tipo um Linktree, que lá ele tem o FireHub e o FireCheck para clicar").
 *
 * O mesmo Instagram fala de dois produtos para públicos diferentes: o FireHub
 * é só para dono de restaurante; o FireCheck serve para qualquer equipe
 * (academia, hotel, clínica, loja, frota). Por isso cada cartão diz para quem é,
 * antes do botão.
 */
const UTM = "utm_source=instagram&utm_medium=bio";

const PRODUTOS = [
  {
    logo: "/firehub-flame.png",
    nome: "FireHub",
    para: "Para restaurante e delivery",
    texto: "Pedidos do iFood, WhatsApp e site num quadro só, robô que anota pedido, mesas, KDS e nota fiscal. Tudo incluído por 2% do faturamento, no máximo R$ 400 por mês.",
    botao: "Testar 15 dias grátis",
    url: `/cadastro?${UTM}&utm_campaign=links-firehub`,
    mais: { texto: "Conhecer o FireHub", url: `/?${UTM}&utm_campaign=links-firehub` },
  },
  {
    logo: "/firecheck/logo.png",
    nome: "FireCheck",
    para: "Para qualquer equipe: restaurante, academia, hotel, clínica, loja e frota",
    texto: "Checklist com foto conferida por IA, ponto com selfie e GPS e os avisos no WhatsApp da sua empresa.",
    botao: "Testar 7 dias grátis",
    url: `https://www.firecheckapp.com.br/?${UTM}&utm_campaign=links-firecheck`,
    mais: null,
  },
];

const css = `
.lk{min-height:100vh;background:radial-gradient(700px 500px at 85% -10%,rgba(255,77,0,.28),transparent 60%),#0B0F19;color:#fff;font-family:Inter,system-ui,sans-serif;padding:40px 16px 48px}
.lk-in{max-width:460px;margin:0 auto}
.lk-top{text-align:center;margin-bottom:26px}
.lk-top img{width:84px;height:84px;border-radius:22px;box-shadow:0 16px 40px rgba(255,77,0,.35)}
.lk-top h1{font-size:24px;font-weight:900;margin:14px 0 4px;letter-spacing:-.5px}
.lk-top p{color:#9CA3AF;font-size:15px;margin:0}
.lk-card{background:#141a28;border:1px solid rgba(255,255,255,.08);border-radius:20px;padding:20px;margin-bottom:16px}
.lk-cab{display:flex;align-items:center;gap:12px;margin-bottom:10px}
.lk-cab img{width:48px;height:48px;border-radius:12px}
.lk-cab b{display:block;font-size:20px;font-weight:900}
.lk-cab span{display:block;color:#FF7A38;font-size:13px;font-weight:700;line-height:1.3}
.lk-card p{color:#D1D5DB;font-size:14.5px;line-height:1.5;margin:0 0 16px}
.lk-btn{display:block;text-align:center;background:#FF4D00;color:#fff;font-weight:800;font-size:16px;padding:15px;border-radius:14px;text-decoration:none;box-shadow:0 10px 24px rgba(255,77,0,.35)}
.lk-mais{display:block;text-align:center;color:#E5E7EB;font-weight:700;font-size:14px;padding:12px;text-decoration:none}
.lk-pe{text-align:center;color:#6B7280;font-size:13px;margin-top:20px}
`;

export default function Links() {
  return (
    <main className="lk">
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <div className="lk-in">
        <div className="lk-top">
          <img src="/firehub-flame.png" alt="" />
          <h1>@firehubfood</h1>
          <p>Escolha o que você procura</p>
        </div>
        {PRODUTOS.map((p) => (
          <section className="lk-card" key={p.nome}>
            <div className="lk-cab">
              <img src={p.logo} alt="" />
              <div><b>{p.nome}</b><span>{p.para}</span></div>
            </div>
            <p>{p.texto}</p>
            <a className="lk-btn" href={p.url}>{p.botao} →</a>
            {p.mais && <a className="lk-mais" href={p.mais.url}>{p.mais.texto}</a>}
          </section>
        ))}
        <p className="lk-pe">Sem cartão para testar.</p>
      </div>
    </main>
  );
}
