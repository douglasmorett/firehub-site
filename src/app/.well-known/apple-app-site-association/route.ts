/**
 * Universal Links do iPhone: o QR da comanda e o do painel
 * (https://firehubfood.com.br/loja/<slug>/motoboy?p=...) abrem o app FireHub
 * Entregador quando ele está instalado — lido pela câmera do celular, sem
 * passar pelo leitor de dentro do app. Sem o app, o link segue para a página
 * web do motoboy, como sempre. O app declara o domínio em
 * apps/motoboy/app.json (ios.associatedDomains).
 */
export const dynamic = "force-static";

const APP_DO_ENTREGADOR = "5K9U9AF594.br.com.firehub.entregador";

export function GET() {
  return Response.json(
    {
      applinks: {
        details: [
          {
            appIDs: [APP_DO_ENTREGADOR],
            components: [{ "/": "/loja/*/motoboy", comment: "QR da comanda e do painel da loja" }],
          },
          // iOS 12 e anteriores leem `paths`.
          { appID: APP_DO_ENTREGADOR, paths: ["/loja/*/motoboy"] },
        ],
      },
    },
    { headers: { "Cache-Control": "public, max-age=3600" } },
  );
}
