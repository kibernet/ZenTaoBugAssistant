plugins {
    id("java")
    id("org.jetbrains.intellij") version "1.17.4"
}

group = "com.zentao.bugassistant"
version = "1.0.0"

repositories {
    maven { url = uri("https://maven.aliyun.com/repository/public") }
    mavenCentral()
}

java {
    sourceCompatibility = JavaVersion.VERSION_11
    targetCompatibility = JavaVersion.VERSION_11
}

intellij {
    version.set("2021.3.3")
    type.set("IC")
    updateSinceUntilBuild.set(false)
}

tasks {
    patchPluginXml {
        sinceBuild.set("211")
    }
    buildSearchableOptions {
        enabled = false
    }
}
