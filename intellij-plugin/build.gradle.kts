plugins {
    id("java")
    id("org.jetbrains.intellij") version "1.17.4"
}

group = "com.zentao.bugassistant"
version = "1.1.0"

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
        sinceBuild.set("213")
    }
    buildSearchableOptions {
        enabled = false
    }
}

val sourceSets = extensions.getByType<org.gradle.api.tasks.SourceSetContainer>()
val parserSelfTest by tasks.registering(JavaExec::class) {
    dependsOn(tasks.named("testClasses"))
    classpath = sourceSets["test"].runtimeClasspath
    mainClass.set("com.zentao.bugassistant.ZenTaoParserSelfTest")
}

tasks.named<org.jetbrains.intellij.tasks.InitializeIntelliJPluginTask>("initializeIntelliJPlugin") {
    selfUpdateCheck.set(false)
}

tasks.named("check") {
    dependsOn(parserSelfTest)
}
