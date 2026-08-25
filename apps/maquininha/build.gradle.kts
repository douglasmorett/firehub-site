// Os plugins sao declarados aqui com `apply false` e aplicados em :app. Manter a
// versao num lugar so evita o classico "AGP 8.4 no root, 8.1 no modulo", que no
// Android nao da erro de compilacao: da erro de merge de manifesto, muito mais
// dificil de ler.
plugins {
    id("com.android.application") version "8.4.0" apply false
    id("org.jetbrains.kotlin.android") version "1.9.24" apply false
}
