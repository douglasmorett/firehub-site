import type { Metadata } from "next";
import PreviaDoMenu from "./PreviaDoMenu";

export const metadata: Metadata = { title: "Multimarcas no painel — prévia", robots: { index: false, follow: false } };

export default function Page() {
  return <PreviaDoMenu />;
}
