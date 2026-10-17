/**
 * App Links do Android: o mesmo link do QR (…/loja/<slug>/motoboy?p=...) abre o
 * app FireHub Entregador direto, sem perguntar com qual app abrir. As duas
 * impressões são a chave de assinatura do Google Play e a chave de upload
 * (Play Console › Integridade do app › Assinatura de apps). O app declara o
 * link em apps/motoboy/app.json (android.intentFilters, autoVerify).
 */
export const dynamic = "force-static";

export function GET() {
  return Response.json(
    [
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
          namespace: "android_app",
          package_name: "br.com.firehub.entregador",
          sha256_cert_fingerprints: [
            "3C:76:C3:5A:0E:B1:E4:6C:91:6E:22:AE:89:72:D2:36:2B:DE:BD:8C:64:00:80:34:3B:95:66:1E:90:F2:95:BB",
            "27:22:DA:7F:E6:F7:0F:38:50:2A:B3:11:E8:A7:7E:88:37:AD:9F:2F:69:6C:97:B5:57:3D:0F:F2:BE:FC:B0:A8",
          ],
        },
      },
    ],
    { headers: { "Cache-Control": "public, max-age=3600" } },
  );
}
