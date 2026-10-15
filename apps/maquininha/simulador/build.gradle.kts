// Simulador dos apps de pagamento das adquirentes de deeplink (Stone, Cielo,
// Getnet). Registra os mesmos deeplinks que o app de pagamento de cada uma e
// devolve a resposta no formato de cada uma, com botões Aprovar / Recusar /
// Cancelar. Existe para rodar no emulador junto do flavor stone/cielo/getnet.
//
// NUNCA instalar numa maquininha de verdade: ele responderia no lugar do app
// de pagamento da adquirente.
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "br.com.firehub.simuladoradquirente"
    compileSdk = 34

    defaultConfig {
        applicationId = "br.com.firehub.simuladoradquirente"
        minSdk = 23
        targetSdk = 34
        versionCode = 1
        versionName = "1.0.0"
    }

    buildTypes {
        release { isMinifyEnabled = false }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}
