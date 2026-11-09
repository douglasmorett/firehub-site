/** Ilustração do teclado USB com as mesmas posições do teclado da cozinha. */
export default function GuiaDoTeclado() {
  const teclas = [
    ["Num", 0, 0], ["/", 1, 0], ["*", 2, 0], ["⌫", 3, 0],
    ["7", 0, 1], ["8", 1, 1], ["9", 2, 1], ["−", 3, 1],
    ["4", 0, 2], ["5", 1, 2], ["6", 2, 2], ["+", 3, 2],
    ["1", 0, 3], ["2", 1, 3], ["3", 2, 3], ["Enter", 3, 3],
    ["0", 0, 4], ["000", 1, 4], [".", 2, 4],
  ] as const;
  const operacoes = [
    ["+", "Aumentar as comandas"], ["−", "Diminuir as comandas"],
    ["/", "Subir a lista de pedidos"], ["*", "Descer a lista de pedidos"],
  ];
  return (
    <section aria-labelledby="guia-teclado-kds" style={{ display: "flex", flexWrap: "wrap", gap: 28, alignItems: "center", padding: "22px 26px", marginBottom: 28, background: "#1C1917", border: "1px solid #44403C", borderRadius: 16 }}>
      <svg role="img" aria-labelledby="teclado-kds-titulo teclado-kds-desc" viewBox="0 0 260 310" style={{ width: 208, maxWidth: "100%", height: "auto", flexShrink: 0 }}>
        <title id="teclado-kds-titulo">Teclado numérico para o KDS</title>
        <desc id="teclado-kds-desc">Números de 1 a 9 dão pronto na posição indicada no cartão. Mais aumenta as comandas, menos diminui, barra sobe e asterisco desce a lista.</desc>
        <rect x="2" y="2" width="256" height="306" rx="19" fill="#0C0A09" stroke="#57534E" strokeWidth="2" />
        <text x="130" y="26" textAnchor="middle" fill="#A8A29E" fontSize="11" fontWeight="700" letterSpacing="1">TECLADO NUMÉRICO</text>
        {teclas.map(([rotulo, col, linha]) => {
          const destaque = ["+", "−", "/", "*"].includes(rotulo);
          const x = 16 + col * 58, y = 40 + linha * 50;
          const enter = rotulo === "Enter";
          return <g key={`${col}-${linha}`}>
            <rect x={x} y={y} width="52" height={enter ? 94 : 44} rx="7" fill={destaque ? "#7C2D12" : "#292524"} stroke={destaque ? "#FB923C" : "#57534E"} strokeWidth="1.5" />
            <text x={x + 26} y={y + (enter ? 52 : 29)} textAnchor="middle" fill={destaque ? "#FFEDD5" : "#FAFAF9"} fontSize={rotulo.length > 1 ? 13 : 23} fontWeight="700">{rotulo}</text>
          </g>;
        })}
      </svg>
      <div style={{ flex: "1 1 260px", minWidth: 0 }}>
        <h2 id="guia-teclado-kds" style={{ margin: "0 0 8px", color: "#FFF", fontSize: "1.15rem" }}>Controle o KDS pelo teclado numérico</h2>
        <p style={{ margin: "0 0 16px", color: "#D6D3D1", fontSize: ".9rem", lineHeight: 1.6 }}>Abra uma tela do KDS e clique no fundo da lista para usar os atalhos.</p>
        <p style={{ margin: "0 0 14px", color: "#FFF", fontSize: ".9rem" }}><strong style={{ color: "#FDBA74" }}>1–9</strong> · Dar pronto no pedido da posição indicada no cartão.</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: "10px 18px" }}>
          {operacoes.map(([tecla, descricao]) => <div key={tecla} style={{ display: "flex", alignItems: "center", gap: 10, color: "#E7E5E4", fontSize: ".88rem" }}>
            <kbd style={{ display: "inline-grid", placeItems: "center", width: 32, height: 32, flexShrink: 0, border: "1px solid #C2410C", borderRadius: 6, background: "#431407", color: "#FDBA74", fontSize: 20, fontWeight: 800 }}>{tecla}</kbd>
            {descricao}
          </div>)}
        </div>
        <p style={{ margin: "16px 0 0", color: "#A8A29E", fontSize: ".8rem", lineHeight: 1.5 }}>O tamanho das comandas fica salvo neste aparelho para cada tela. Os atalhos ficam suspensos enquanto você usa campos, botões ou janelas.</p>
      </div>
    </section>
  );
}
