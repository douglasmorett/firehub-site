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
