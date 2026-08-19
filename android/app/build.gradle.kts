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

/**
 * Release signing credentials, from a local file or from the environment.
 *
 * Never from version control. A signing key in the repository is a key every
 * present and past contributor holds, and for an upload key that means anyone
 * who has ever cloned the project can publish in your name. `keystore.properties`
 * and `*.jks` are both ignored by git; CI passes the same four values as
 * environment variables so no key file ever has to be committed to reach it.
 *
 * Returns null when nothing is configured, and the release build is then left
 * unsigned rather than falling back to the debug key. A debug-signed release
 * installs and runs perfectly, which is precisely why that mistake survives
 * every local test and is only caught by Play, at upload.
 */
fun releaseKeystore(): Properties? {
    val file = rootProject.file("keystore.properties")
    if (file.exists()) {
        val loaded = Properties()
        file.inputStream().use(loaded::load)
        if (!loaded.getProperty("storeFile").isNullOrBlank()) return loaded
    }

    val storeFile = System.getenv("ANDROID_KEYSTORE_FILE")
    val storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
    val keyAlias = System.getenv("ANDROID_KEY_ALIAS")
    val keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
    if (storeFile.isNullOrBlank() || storePassword.isNullOrBlank() ||
        keyAlias.isNullOrBlank() || keyPassword.isNullOrBlank()
    ) {
        return null
    }

    return Properties().apply {
        setProperty("storeFile", storeFile)
        setProperty("storePassword", storePassword)
        setProperty("keyAlias", keyAlias)
        setProperty("keyPassword", keyPassword)
    }
}

android {
    namespace = "com.circuvent.hrms"
    // 36, not 35, because Play requires new apps to target Android 16 from
    // 31 August 2026. An app submitted on 35 after that date is rejected, and
    // the rejection arrives at the end of a review rather than at build time.
    compileSdk = 36

    defaultConfig {
        applicationId = "com.circuvent.hrms"
        // 26 covers about 97% of active devices and is the floor for the
        // Keystore behaviour EncryptedSharedPreferences relies on.
        minSdk = 26
        targetSdk = 36
        // Play rejects a version code it has already seen, and the rejection
        // comes at upload rather than at build time. Every upload needs this
        // raised, including one that only fixes a store listing.
        versionCode = 4
        versionName = "1.2.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        vectorDrawables.useSupportLibrary = true
    }

    signingConfigs {
        val credentials = releaseKeystore()
        if (credentials == null) {
            logger.lifecycle(
                "No release signing configured. `assembleRelease` will produce an " +
                    "unsigned APK, and Play will refuse it. See android/README-release.md."
            )
        } else {
            create("release") {
                storeFile = rootProject.file(credentials.getProperty("storeFile"))
                storePassword = credentials.getProperty("storePassword")
                keyAlias = credentials.getProperty("keyAlias")
                keyPassword = credentials.getProperty("keyPassword")

                // v1 is the old JAR signature, only read by Android 6 and
                // earlier. minSdk is 26, so it buys nothing and costs the
                // Janus vulnerability class that v2's whole-file signature
                // exists to close.
                enableV1Signing = false
                enableV2Signing = true
                enableV3Signing = true
            }
        }
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
            signingConfig = signingConfigs.findByName("release")
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
