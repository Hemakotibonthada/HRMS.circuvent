import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

/**
 * The API host, resolved at build time.
 *
 * Read from `apiBaseUrl` in local.properties, or the API_BASE_URL environment
 * variable, or the default below. It is a BuildConfig field rather than a
 * runtime lookup so that a release build cannot be repointed at a staging
 * database by anything a device can change.
 *
 * The React Native app this replaces refused to start when the base URL was
 * unset, on the grounds that a build silently aimed at the wrong API looks
 * like it works right up until somebody's clock-in reaches the wrong database.
 * The same rule applies here, one layer earlier: a debug build gets the
 * emulator's route to the host machine, and a release build must be told.
 */
fun apiBaseUrl(default: String): String {
    val local = rootProject.file("local.properties")
    if (local.exists()) {
        val properties = Properties()
        local.inputStream().use(properties::load)
        properties.getProperty("apiBaseUrl")?.takeIf { it.isNotBlank() }?.let { return it }
    }
    return System.getenv("API_BASE_URL")?.takeIf { it.isNotBlank() } ?: default
}

android {
    namespace = "com.circuvent.hrms"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.circuvent.hrms"
        // 26 covers about 97% of active devices and is the floor for the
        // Keystore behaviour EncryptedSharedPreferences relies on.
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        vectorDrawables.useSupportLibrary = true
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
            // 10.0.2.2 is the emulator's route to the host machine. `localhost`
            // inside an emulator is the emulator.
            buildConfigField("String", "API_BASE_URL", "\"${apiBaseUrl("http://10.0.2.2:3002")}\"")
            // Cleartext is permitted in debug only, and only so the emulator can
            // reach a dev server on http. The release manifest forbids it.
            manifestPlaceholders["usesCleartextTraffic"] = "true"
        }

        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            buildConfigField("String", "API_BASE_URL", "\"${apiBaseUrl("https://hrms.circuvent.com")}\"")
            manifestPlaceholders["usesCleartextTraffic"] = "false"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    packaging {
        resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
    }
}

dependencies {
    // The shared module: one implementation of the product, compiled here
    // for Android and, on a Mac, into the framework the iOS app links.
    implementation(project(":shared"))
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.activity.compose)

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.material.icons)
    implementation(libs.androidx.navigation.compose)

    implementation(libs.androidx.security.crypto)
    implementation(libs.androidx.biometric)
    // Forces a modern androidx.fragment over the 1.2.5 that biometric 1.1.0
    // drags in. Fragment 1.2.5's FragmentActivity.startActivityForResult
    // rejects any request code that does not fit in 16 bits, while
    // androidx.activity 1.9's ActivityResultRegistry allocates codes across
    // the full int range — so the first permission request from a
    // FragmentActivity threw "Can only use lower 16 bits for requestCode".
    //
    // MainActivity has to be a FragmentActivity because BiometricPrompt hosts
    // an invisible fragment, so the two cannot simply be kept apart: tapping
    // "Clock in" asked for location, and the app reported that it did not work.
    implementation(libs.androidx.fragment)
    // Passkeys. Credential Manager is the only supported way to reach a
    // platform authenticator on Android 14+, and the play-services artifact is
    // what backs it on devices with Google Play.
    implementation(libs.androidx.credentials)
    implementation(libs.androidx.credentials.play.services)
    // Custom Tabs for SSO. A WebView would work and must not be used: it gives
    // the app access to the credentials typed into the identity provider, which
    // is exactly what federating the sign-in was meant to avoid, and identity
    // providers increasingly refuse to render in one.
    implementation(libs.androidx.browser)
    implementation(libs.play.services.location)

    implementation(libs.okhttp)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.android)

    debugImplementation(libs.androidx.compose.ui.tooling)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
}
