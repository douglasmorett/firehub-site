pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
        // O WrapperPPS nao esta no Maven Central nem no repositorio do Google: o
        // PagBank publica o AAR direto num repositorio Maven hospedado no proprio
        // GitHub. Sem esta linha o Gradle nao acha a dependencia do SDK e o build
        // quebra com "Could not find br.com.uol.pagseguro...".
        maven { setUrl("https://github.com/pagseguro/PlugPagServiceWrapper/raw/master") }
    }
}

rootProject.name = "FireHub Maquininha"
include(":app")

// Simulador dos apps de pagamento da Stone, Cielo e Getnet, para testar os
// flavors de deeplink no emulador, sem maquininha. NÃO vai para loja nenhuma.
include(":simulador")

// Esqueleto do SDK da Rede (pacote rede.smartrede.sdk), compileOnly no flavor
// `rede` enquanto o .aar oficial não está em app/libs/rede/. Não vai para APK.
include(":rede-sdk-stub")
