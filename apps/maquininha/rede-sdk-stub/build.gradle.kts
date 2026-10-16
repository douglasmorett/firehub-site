// Esqueleto do SDK da Rede (sdk-3.0-release.aar, pacote rede.smartrede.sdk).
//
// Existe só para o flavor `rede` COMPILAR enquanto o .aar oficial não chega
// (ele vem por e-mail da Rede, DevSmartRede@userede.com.br). Entra como
// compileOnly: NENHUMA classe daqui vai para o APK. Sem o .aar, o app sobe,
// percebe que o SDK não está no APK e recusa com "SDK da Rede não instalado
// neste app" — sem crash.
//
// Quando o .aar existir em app/libs/rede/sdk-3.0-release.aar, o app compila
// contra ELE e este módulo deixa de ser usado (ver app/build.gradle.kts). As
// assinaturas aqui seguem o "Manual de Integração App3" do portal
// https://portaldodesenvolvedor.docs.apiary.io/ ; o que o manual não diz
// (tipo de retorno de alguns getters) o cobrador lê por reflexão, para não
// depender deste palpite em tempo de execução.
plugins {
    id("com.android.library")
}

android {
    namespace = "rede.smartrede.sdk"
    compileSdk = 34

    defaultConfig {
        minSdk = 23
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
