import type { Metadata } from "next";
import MultimarcasClient from "@/app/store/multimarcas/MultimarcasClient";
import { FIREHUB_PLAN } from "@/lib/firehub-billing";

// PRÉVIA da página de venda do Multimarcas, sem login e sem banco (dados de mentira).
export const metadata: Metadata = { title: "Multimarcas — prévia", robots: { index: false, follow: false } };

export default function Page() {
  return (
    <div style={{ background: "#faf8f6", minHeight: "100vh" }}>
      <MultimarcasClient previa={{
        estado: { ativo: false, cobradoEsteMes: false, testeAte: null, emTeste: false, jaTestou: false, isento: false },
        preco: 97,
        diasDeTeste: 7,
        mensalidade: { percentual: FIREHUB_PLAN.PERCENT_RATE, minimo: FIREHUB_PLAN.MIN_MONTHLY, teto: FIREHUB_PLAN.MAX_MONTHLY, lojaExtraMarketplace: FIREHUB_PLAN.EXTRA_STORE_FEE },
      }} />
    </div>
  );
}
