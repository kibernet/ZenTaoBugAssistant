import org.jetbrains.intellij.platform.gradle.TestFrameworkType

plugins {
    id("java")
    id("org.jetbrains.intellij.platform") version "2.16.0"
}

group = "com.zentao.bugassistant"
version = "1.0.0"

repositories {
    maven { url = uri("https://maven.aliyun.com/repository/public") }
    mavenCentral()
    intellijPlatform {
        defaultRepositories()
    }
}

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(17))
    }
}

dependencies {
    intellijPlatform {
        intellijIdeaCommunity("2025.1.7")
        testFramework(TestFrameworkType.Platform)
    }
}

intellijPlatform {
    buildSearchableOptions = false

    pluginConfiguration {
        ideaVersion {
            sinceBuild = "241"
        }
    }
}
