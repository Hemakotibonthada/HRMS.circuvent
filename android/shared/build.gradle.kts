// ═══════════════════════════════════════════════════════════════
// SHARED — one implementation of the product, two native apps
// ═══════════════════════════════════════════════════════════════
//
// This module is the "single application" half of a single application built
// in native languages. Everything that decides *what the product does* lives
// here and is compiled twice: to a JVM class file that Android loads, and to a
// native framework that iOS links. Nothing is reimplemented per platform, so
// the two apps cannot disagree about whether a leave request overlaps one that
// already exists.
//
// What is deliberately NOT here is the user interface. A shared UI layer is
// what makes cross-platform apps feel wrong on both platforms — the back
// gesture, the navigation bar, the date picker and the accessibility model all
// differ, and imitating one on the other is exactly what users notice. Android
// draws its screens in Jetpack Compose, iOS in SwiftUI, and both call into
// this.
//
// Targets:
//   androidTarget      the Android app
//   iosArm64           devices
//   iosSimulatorArm64  Apple-silicon simulators
//   jvm                not shipped — it is how this logic is tested on a
//                      machine without Xcode, which is most CI runners and
//                      every Windows workstation
//
// The Apple targets are declared only on a Mac. Kotlin/Native cannot produce
// them anywhere else, and declaring them elsewhere fails configuration rather
// than skipping — which would stop the Android app building at all on the
// machine most of this was written on.

import org.jetbrains.kotlin.gradle.ExperimentalKotlinGradlePluginApi
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.kotlin.multiplatform)
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.serialization)
}

kotlin {
    androidTarget {
        @OptIn(ExperimentalKotlinGradlePluginApi::class)
        compilerOptions {
            jvmTarget.set(JvmTarget.JVM_17)
        }
    }

    jvm()

    val isMac = System.getProperty("os.name").startsWith("Mac", ignoreCase = true)
    if (isMac) {
        listOf(iosArm64(), iosSimulatorArm64()).forEach { target ->
            target.binaries.framework {
                // Swift imports this as `import Shared`.
                baseName = "Shared"
                // Static, because a dynamic framework has to be embedded and
                // signed, and the usual mistakes there are rejected at upload
                // time rather than at build time.
                isStatic = true
            }
        }
    }

    sourceSets {
        commonMain.dependencies {
            implementation(libs.kotlinx.coroutines.core)
            implementation(libs.kotlinx.serialization.json)
            implementation(libs.kotlinx.datetime)
            implementation(libs.ktor.client.core)
            implementation(libs.ktor.client.content.negotiation)
            implementation(libs.ktor.serialization.json)
        }

        commonTest.dependencies {
            implementation(kotlin("test"))
            implementation(libs.kotlinx.coroutines.test)
        }

        androidMain.dependencies {
            implementation(libs.ktor.client.okhttp)
            // The Keystore-backed preference store the token lives in.
            implementation(libs.androidx.security.crypto)
        }

        jvmMain.dependencies {
            implementation(libs.ktor.client.okhttp)
        }
    }
}

android {
    namespace = "com.circuvent.hrms.shared"
    compileSdk = 36

    defaultConfig {
        minSdk = 26
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
