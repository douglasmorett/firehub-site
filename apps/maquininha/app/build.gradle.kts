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

// O SDK da Rede (sdk-3.0-release.aar) chega por e-mail da Rede e NÃO vai ao
// repositório (ver .gitignore e README, "Rede (Itaú)"). Sem ele o flavor
// `rede` compila contra o esqueleto :rede-sdk-stub e o app recusa toda
// cobrança com "SDK da Rede não instalado neste app".
val aarDaRede = file("libs/rede/sdk-3.0-release.aar")

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

    // ------------------------------------------------------------ adquirentes
    //
    // Um APK por adquirente. Não é gosto: cada adquirente homologa e assina o
    // APK dela, e a homologação de cada uma reprova app que cite a concorrente
    // ou que carregue SDK de terminal de terceiros. Um APK único com as quatro
    // dentro não passaria em nenhuma das quatro.
    //
    //  - pagbank: cobra pelo SDK PlugPag (ligação AIDL com o serviço do
    //    PagBank). Único flavor com a dependência do SDK, e o único cujo
    //    applicationId não muda: a homologação PagBank amarra ao packageName.
    //  - stone, cielo, getnet: cobram por deeplink, abrindo o app de pagamento
    //    da própria adquirente. Nosso app não lê cartão nesses três.
    //  - rede: Intent pronta do SDK da Rede (.aar) aberta com
    //    startActivityForResult no app "Pagamentos" da Rede. Também não lê
    //    cartão; usa a mesma ponte de Activity dos deeplinks.
    flavorDimensions += "adquirente"
    productFlavors {
        create("pagbank") {
            dimension = "adquirente"
            // SEM applicationIdSuffix, de propósito: o PagBank amarra a
            // homologação a "br.com.firehub.maquininha" e um pacote diferente
            // simplesmente não cobra.
            buildConfigField("String", "ADQUIRENTE", "\"PAGBANK\"")
            buildConfigField("String", "CAMPO_DE_CREDENCIAIS", "\"\"")
        }
        create("stone") {
            dimension = "adquirente"
            applicationIdSuffix = ".stone"
            buildConfigField("String", "ADQUIRENTE", "\"STONE\"")
            buildConfigField("String", "CAMPO_DE_CREDENCIAIS", "\"\"")
        }
        create("cielo") {
            dimension = "adquirente"
            applicationIdSuffix = ".cielo"
            // Exigências do manual de integração da Cielo Smart: minSdk 24 e
            // targetSdk 29. Vale SÓ para este APK — o PagBank precisa de 23 por
            // causa do SK800 e o app-demo dele usa 34.
            minSdk = 24
            targetSdk = 29
            buildConfigField("String", "ADQUIRENTE", "\"CIELO\"")
            // Nome do campo, na resposta do polling, com clientId/accessToken
            // da Cielo da loja. Só este flavor lê credencial; nos outros o
            // campo é vazio e o nome da Cielo nem entra no APK.
            buildConfigField("String", "CAMPO_DE_CREDENCIAIS", "\"credenciaisCielo\"")
        }
        create("getnet") {
            dimension = "adquirente"
            applicationIdSuffix = ".getnet"
            buildConfigField("String", "ADQUIRENTE", "\"GETNET\"")
            buildConfigField("String", "CAMPO_DE_CREDENCIAIS", "\"\"")
        }
        create("rede") {
            dimension = "adquirente"
            applicationIdSuffix = ".rede"
            // minSdk 23 (o padrão acima) serve: a Laranjinha Smart (Gertec
            // GPOS700) roda Android 6, e o manual da Rede não pede outro.
            buildConfigField("String", "ADQUIRENTE", "\"REDE\"")
            buildConfigField("String", "CAMPO_DE_CREDENCIAIS", "\"\"")
            // Se o .aar estava na pasta quando este APK foi gerado. Falso =
            // APK sem o SDK: cobra nada e diz por quê.
            buildConfigField("boolean", "SDK_DA_REDE_NO_APK", aarDaRede.exists().toString())
        }
    }

    // A ponte de deeplink (Activity transparente + o canal que a liga ao
    // serviço) é a mesma para Stone, Cielo e Getnet e não pode entrar no APK do
    // PagBank, que não a usa. Um diretório compartilhado só pelos três resolve
    // sem módulo extra.
    sourceSets {
        getByName("stone").java.srcDir("src/deeplink/java")
        getByName("cielo").java.srcDir("src/deeplink/java")
        getByName("getnet").java.srcDir("src/deeplink/java")
        getByName("rede").java.srcDir("src/deeplink/java")
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
    //
    // SÓ no flavor pagbank. Os APKs da Stone, Cielo e Getnet não podem levar
    // classe do PlugPag: é SDK de terminal de terceiro para eles, e o código
    // que o usa mora em src/pagbank, que os outros flavors nem compilam.
    "pagbankImplementation"("br.com.uol.pagseguro.plugpagservice.wrapper:wrapper:1.35.0")

    // SDK da Rede, SÓ no flavor rede. Com o .aar na pasta, compila e embarca
    // o de verdade (e o Gson 2.8.5 que o manual da Rede manda declarar junto:
    // o .aar local não traz POM, então ninguém puxa o Gson por ele). Sem o
    // .aar, compila contra o esqueleto, que NÃO vai para o APK (compileOnly).
    if (aarDaRede.exists()) {
        "redeImplementation"(files(aarDaRede))
        "redeImplementation"("com.google.code.gson:gson:2.8.5")
    } else {
        "redeCompileOnly"(project(":rede-sdk-stub"))
    }

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
