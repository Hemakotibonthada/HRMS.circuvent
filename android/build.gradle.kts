// Root build file. Plugins are declared here and applied in :app, which is the
// convention that keeps a single version of each plugin across every module the
// day a second one is added.

plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.android) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.kotlin.serialization) apply false
    alias(libs.plugins.kotlin.multiplatform) apply false
    alias(libs.plugins.android.library) apply false
    // The day a second module was added, which is what the note above
    // anticipated. Both are declared here with a version and applied without
    // one in :desktop — the Kotlin JVM plugin is already on the build
    // classpath via the multiplatform plugin, and asking for it again with a
    // version fails resolution rather than reusing it.
    alias(libs.plugins.kotlin.jvm) apply false
    alias(libs.plugins.compose.multiplatform) apply false
}
