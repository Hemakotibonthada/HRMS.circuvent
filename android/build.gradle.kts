// Root build file. Plugins are declared here and applied in :app, which is the
// convention that keeps a single version of each plugin across every module the
// day a second one is added.

plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.android) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.kotlin.serialization) apply false
}
