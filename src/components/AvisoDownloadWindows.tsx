/**
 * O aviso que o navegador dá ao baixar o Assistente de Impressão.
 *
 * ── Por que esta caixa existe ───────────────────────────────────────────────
 *
 * O instalador não é assinado com certificado de código, então Edge e Chrome
 * mostram "normalmente não é baixado" e o Windows mostra a tela azul "O Windows
 * protegeu o seu PC". O lojista lê aquilo como vírus, para a instalação no meio
 * e liga para o suporte — foi o que aconteceu em 17/09/2026, com o dono dentro
 * da loja do cliente.
 *
 * Enquanto não existe certificado, o caminho honesto é dizer antes o que vai
 * acontecer e qual botão clicar. Quem avisa antes não assusta: o aviso deixa de
 * ser sinal de perigo e vira etapa da instalação.
 *
 * Só aparece na PRIMEIRA instalação de cada loja. As atualizações seguintes o
 * próprio Assistente baixa e aplica sozinho (server.js), sem passar pelo
 * navegador e sem nenhum aviso.
 *
 * Quando o instalador passar a ser assinado, apague este arquivo e as três
 * chamadas dele — o aviso some sozinho.
 */
export default function AvisoDownloadWindows({ compacto = false }: { compacto?: boolean }) {
  return (
    <details
      style={{
        marginTop: 10,
        background: "#FFF7E6",
        border: "1.5px solid #FDE68A",
        borderRadius: 10,
        padding: compacto ? "8px 10px" : "10px 12px",
        fontSize: compacto ? "0.74rem" : "0.78rem",
        color: "#78350F",
        lineHeight: 1.5,
      }}
    >
      <summary style={{ cursor: "pointer", fontWeight: 800, color: "#92400E", listStyle: "revert" }}>
        O Windows vai avisar que o arquivo “não é baixado com frequência” — é normal, veja o que fazer
      </summary>

      <p style={{ margin: "8px 0 0" }}>
        O aviso aparece porque o instalador é novo e poucos computadores baixaram até agora. O arquivo vem do
        site do FireHub e é o mesmo que a sua impressora já usa. São três cliques:
      </p>

      <p style={{ margin: "8px 0 0", fontWeight: 800 }}>1. Na caixa de downloads do navegador</p>
      <ul style={{ margin: "2px 0 0", paddingLeft: 18 }}>
        <li>
          <strong>Edge:</strong> passe o mouse na linha do arquivo, clique nos três pontinhos <strong>(…)</strong> ao
          lado da lixeira → <strong>Manter</strong> → <strong>Mostrar mais</strong> → <strong>Manter mesmo assim</strong>.
        </li>
        <li>
          <strong>Chrome:</strong> clique na seta ao lado do arquivo → <strong>Manter</strong> →{" "}
          <strong>Manter mesmo assim</strong>.
        </li>
      </ul>

      <p style={{ margin: "8px 0 0", fontWeight: 800 }}>2. Ao abrir o instalador</p>
      <p style={{ margin: "2px 0 0" }}>
        Se aparecer a tela azul “O Windows protegeu o seu PC”, clique em <strong>Mais informações</strong> →{" "}
        <strong>Executar assim mesmo</strong>.
      </p>

      <p style={{ margin: "8px 0 0", fontWeight: 800 }}>3. Depois de instalar</p>
      <p style={{ margin: "2px 0 0" }}>
        O Windows pergunta sobre o firewall, porque o Assistente conversa com a impressora pela rede local. Marque{" "}
        <strong>Redes privadas</strong> e clique em <strong>Permitir acesso</strong>.
      </p>

      <p style={{ margin: "8px 0 0" }}>
        Não é preciso desligar o antivírus nem a proteção do Windows. Se o antivírus do computador apagar o arquivo,
        chame o suporte do FireHub.
      </p>
    </details>
  );
}
