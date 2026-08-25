import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// A chave de assinatura fica fora do repositorio. O PagBank amarra a homologacao
// ao packageName + assinatura: se a chave mudar, o app deixa de ser o mesmo app
// para eles e a atualizacao e recusada. Quem for gerar release cria o arquivo
// keystore.properties ao lado do build.gradle.kts da raiz (ver README).
val arquivoDeAssinatura = rootProject.file("keystore.properties")
val dadosDaAssinatura = Properties().apply {
    if (arquivoDeAssinatura.exists()) arquivoDeAssinatura.inputStream().use { load(it) }
}

android {
    namespace = "br.com.firehub.maquininha"
    compileSdk = 34

    defaultConfig {
        applicationId = "br.com.firehub.maquininha"

        // 23 nao e escolha: o AAR do WrapperPPS 1.35.0 declara
        // minSdkVersion="23" no proprio manifesto, e o SK800 (o terminal de
        // totem) roda Android 6, que e exatamente a API 23. Baixar disso nao
        // compila; subir disso deixa o SK800 de fora.
        minSdk = 23

        // CONFERIR ANTES DE SUBMETER A HOMOLOGACAO. O "Guia de boas praticas
        // SmartPOS" do PagBank escreve targetSdkVersion(23), mas o app-demo
        // oficial publicado por eles usa 34. Os dois nao podem estar certos.
        // Ficamos em 34 porque e a implementacao de referencia e a mais recente,
        // e porque 23 faria o Android tratar o app como legado. Se o contato de
        // integracoes disser que a analise exige 23, mudar aqui e reconferir o
        // servico em primeiro plano, que muda de regra entre uma API e outra.
        targetSdk = 34

        // Tem que ser unico e sempre crescente: o portal do PagBank recusa
        // upload com versionCode repetido ou menor que o ja publicado.
        versionCode = 1
        versionName = "1.0.0"

        // O mesmo texto vai no parametro ?versao= do polling, para o painel do
        // FireHub mostrar qual versao esta rodando em cada balcao sem ninguem
        // precisar ir ate a loja olhar.
        buildConfigField("String", "VERSAO_DO_APP", "\"1.0.0\"")

        // Nao ha teste instrumentado neste app: qualquer teste de verdade
        // depende do terminal de debug fisico, entao um runner declarado aqui so
        // daria a falsa impressao de que existe cobertura.
    }

    signingConfigs {
        if (dadosDaAssinatura.isNotEmpty()) {
            create("release") {
                storeFile = file(dadosDaAssinatura.getProperty("storeFile"))
                storePassword = dadosDaAssinatura.getProperty("storePassword")
                keyAlias = dadosDaAssinatura.getProperty("keyAlias")
                keyPassword = dadosDaAssinatura.getProperty("keyPassword")

                // O guia de homologacao exige as DUAS assinaturas. V2 sozinho e
                // o padrao do Gradle moderno e passa despercebido ate a analise
                // devolver o APK.
                enableV1Signing = true
                enableV2Signing = true
            }
        }
    }

    buildTypes {
        release {
            // Sem minify. O WrapperPPS conversa com o servico do PagBank por
            // AIDL e por reflexao em parte do caminho; ofuscar as classes do
            // wrapper quebra a chamada em runtime, e o erro so aparece com o
            // cartao na maquininha. O app tem duas telas e um servico: o que se
            // ganharia em tamanho nao paga o risco.
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")

            // Explicito de proposito: a analise do PagBank reprova APK release
            // com debuggable ou allowBackup ligados. allowBackup fica desligado
            // no manifesto, que e onde ele mora.
            isDebuggable = false

            if (dadosDaAssinatura.isNotEmpty()) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
        debug {
            // Sufixo no applicationId permitiria instalar debug e release lado a
            // lado, mas o servico do PagBank so autoriza o pacote homologado.
            // Um applicationId diferente simplesmente nao cobra. Por isso NAO ha
            // applicationIdSuffix aqui.
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        buildConfig = true
        // viewBinding fica desligado de proposito: as telas sao tres e usam
        // findViewById. Uma dependencia a menos e um gerador de codigo a menos
        // entre o que esta escrito aqui e o que roda no balcao.
    }

    packaging {
        resources.excludes += setOf("META-INF/*.kotlin_module", "META-INF/DEPENDENCIES")
    }
}

dependencies {
    // O SDK de pagamento. 1.35.0 e a ultima versao publicada no repositorio
    // Maven do PagBank; a pagina de integracao do portal ainda manda usar
    // 1.27.2, que esta desatualizada.
    //
    // ATENCAO: o POM deste artefato e vazio, gerado por install:install-file, e
    // nao declara nenhuma dependencia transitiva. As classes de asyncplugpag
    // referenciam io.reactivex.* (RxJava 2 e RxAndroid 2) sem declarar. Este app
    // usa SOMENTE os metodos sincronos dentro da propria thread de trabalho, e
    // por isso nao carrega essas classes nem precisa declarar RxJava. Se algum
    // dia alguem trocar doPayment por doAsyncPayment aqui, tem que adicionar
    // io.reactivex.rxjava2:rxjava e :rxandroid junto, senao o app compila e
    // estoura NoClassDefFoundError na hora de cobrar.
    implementation("br.com.uol.pagseguro.plugpagservice.wrapper:wrapper:1.35.0")

    implementation("androidx.appcompat:appcompat:1.6.1")
    implementation("androidx.core:core-ktx:1.12.0")

    // EncryptedSharedPreferences. Versao 1.0.0 (estavel) de proposito: a API
    // dela e MasterKeys.getOrCreate + EncryptedSharedPreferences.create com o
    // alias em String. As 1.1.0-alpha trocam isso por MasterKey.Builder, com
    // assinatura incompativel, e alpha em app que fica preso no balcao de
    // cliente e problema que ninguem vai estar por perto para resolver.
    implementation("androidx.security:security-crypto:1.0.0")

    // Nao ha OkHttp, Retrofit, Gson nem Moshi. O app faz duas chamadas HTTP e le
    // dois JSONs pequenos: HttpURLConnection e org.json ja vem no Android, e
    // cada SDK de terceiro a menos e uma pergunta a menos na homologacao.
}
