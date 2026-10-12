// O app próprio de cada loja sai deste mesmo projeto. Tudo o que muda de uma
// loja para outra — nome, ícone, cor, identificador nas lojas, página que abre —
// mora em marcas/<marca>/marca.json. Qual marca montar vem da variável MARCA
// (no EAS, do perfil de build em eas.json); sem ela, a Hakim.
const fs = require("fs");
const path = require("path");

const MARCA = process.env.MARCA || "hakim";
const pasta = path.join(__dirname, "marcas", MARCA);
if (!fs.existsSync(path.join(pasta, "marca.json"))) {
  throw new Error(`Marca "${MARCA}" não existe em apps/loja/marcas/.`);
}
const marca = require(`./marcas/${MARCA}/marca.json`);
const arquivo = (nome) => `./marcas/${MARCA}/${nome}`;

// google-services.json do Firebase: sem ele o Android não recebe aviso com o
// app fechado. No EAS chega como variável de arquivo; no computador, na pasta da marca.
const firebaseLocal = path.join(pasta, "google-services.json");
const googleServicesFile =
  process.env.GOOGLE_SERVICES_JSON || (fs.existsSync(firebaseLocal) ? arquivo("google-services.json") : undefined);

module.exports = () => ({
  expo: {
    name: marca.nome,
    slug: `loja-${marca.id}`,
    version: "1.0.0",
    orientation: "portrait",
    icon: arquivo("icon.png"),
    scheme: marca.esquema,
    userInterfaceStyle: "light",
    runtimeVersion: { policy: "appVersion" },
    ios: {
      bundleIdentifier: marca.bundleId,
      supportsTablet: false,
      icon: arquivo("icon.png"),
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
        // O cardápio usa a localização só para achar o endereço de entrega e
        // a unidade que atende o bairro, quando o cliente toca em "usar minha localização".
        NSLocationWhenInUseUsageDescription:
          "Usamos sua localização só quando você pede, para preencher o endereço de entrega e achar a unidade que atende você.",
      },
    },
    android: {
      package: marca.bundleId,
      adaptiveIcon: {
        backgroundColor: marca.corDoIconeAndroid || marca.cor,
        foregroundImage: arquivo("android-frente.png"),
        backgroundImage: arquivo("android-fundo.png"),
      },
      permissions: ["android.permission.ACCESS_COARSE_LOCATION", "android.permission.ACCESS_FINE_LOCATION"],
      blockedPermissions: [
        "android.permission.ACCESS_BACKGROUND_LOCATION",
        "android.permission.RECORD_AUDIO",
        "android.permission.SYSTEM_ALERT_WINDOW",
        "android.permission.READ_EXTERNAL_STORAGE",
        "android.permission.WRITE_EXTERNAL_STORAGE",
        "android.permission.USE_BIOMETRIC",
        "android.permission.USE_FINGERPRINT",
      ],
      predictiveBackGestureEnabled: false,
      ...(googleServicesFile ? { googleServicesFile } : {}),
    },
    plugins: [
      "expo-router",
      [
        "expo-splash-screen",
        { backgroundColor: marca.cor, image: arquivo("splash.png"), imageWidth: 200 },
      ],
      [
        "expo-notifications",
        { icon: arquivo("notificacao.png"), color: marca.cor, defaultChannel: "pedidos" },
      ],
      "expo-secure-store",
    ],
    experiments: { typedRoutes: true, reactCompiler: true },
    extra: {
      marca,
      ...(marca.easProjectId ? { eas: { projectId: marca.easProjectId } } : {}),
    },
    ...(marca.easProjectId ? { updates: { url: `https://u.expo.dev/${marca.easProjectId}` } } : {}),
  },
});
