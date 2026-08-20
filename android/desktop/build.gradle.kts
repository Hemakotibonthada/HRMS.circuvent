// ═══════════════════════════════════════════════════════════════
// DESKTOP — the Windows client
// ═══════════════════════════════════════════════════════════════
//
// A third native app on the same product logic. It compiles `:shared` for the
// JVM, so the rules that decide whether a leave request overlaps, what a day of
// leave costs and how a 401 is recovered from are the same code the Android app
// runs — not a reimplementation that can drift.
//
// Compose for Desktop rather than WinUI or WPF for one reason that matters more
// than taste: the alternative is re-expressing forty screens in XAML, and every
// one of them becomes a second place a rule can be wrong. This way the desktop
// app is a different *interface* to the same application.
//
// It is not, and does not pretend to be, a stretched phone app. The window is
// resizable with a persistent sidebar rather than five tabs, lists are tables
// because a desktop has the width for them, and the keyboard is a first-class
// input.
//
// Packaged with jpackage, via Compose's `packageReleaseMsi`, which produces an
// installer carrying its own Java runtime. Nothing needs to be installed first.

import org.jetbrains.compose.desktop.application.dsl.TargetFormat

plugins {
    id("org.jetbrains.kotlin.jvm")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
    id("org.jetbrains.compose")
}

kotlin {
    // 21, because that is the JDK on the build machine. The Android modules
    // target 17 because Android's toolchain does; nothing links between them
    // at the bytecode level except `:shared`, which is compiled per target.
    jvmToolchain(21)
}

dependencies {
    implementation(project(":shared"))

    implementation(compose.desktop.currentOs)
    implementation(compose.material3)
    implementation(compose.materialIconsExtended)

    implementation(libs.kotlinx.coroutines.core)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.datetime)
    implementation(libs.ktor.client.core)
    implementation(libs.ktor.client.okhttp)
    implementation(libs.ktor.client.content.negotiation)
    implementation(libs.ktor.serialization.json)

    testImplementation(kotlin("test"))
}

compose.desktop {
    application {
        mainClass = "com.circuvent.hrms.desktop.MainKt"

        // The bundled ProGuard (7.2.2) cannot read Java 21 class files — it
        // stops at version 62 — and the toolchain here is 21 because that is
        // the JDK installed on the build machine.
        //
        // Turned off rather than worked around. What it buys is a smaller
        // installer; what it risks is exactly the thing this app leans on,
        // since kotlinx-serialization and Compose both resolve types
        // reflectively and a wrong keep rule fails at runtime on a user's
        // machine rather than in this build. A larger download is the cheaper
        // side of that trade.
        buildTypes.release.proguard {
            isEnabled.set(false)
        }

        nativeDistributions {
            targetFormats(TargetFormat.Msi, TargetFormat.Exe)
            packageName = "Circuvent HR"
            packageVersion = "1.0.0"
            description = "Circuvent HR for Windows"
            vendor = "Circuvent Technologies"

            windows {
                // A stable UUID, so an upgrade replaces the installed product
                // rather than installing a second copy beside it.
                upgradeUuid = "8f2b41c5-6f0a-4a2e-9a1e-6b6a7d1c9e34"
                menuGroup = "Circuvent"
                perUserInstall = true
                dirChooser = true
                shortcut = true
            }
        }
    }
}
