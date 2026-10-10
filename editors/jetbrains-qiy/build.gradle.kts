plugins {
    kotlin("jvm") version "1.9.24"
    id("org.jetbrains.intellij") version "1.17.4"
}

group = "dev.qiy"
version = "0.1.0"

repositories {
    mavenCentral()
}

intellij {
    version.set("2024.3")
    type.set("IC")
}

tasks {
    patchPluginXml {
        sinceBuild.set("243")
        untilBuild.set("")
    }
    publishPlugin {
        token.set(providers.environmentVariable("JETBRAINS_MARKETPLACE_TOKEN"))
    }
}
