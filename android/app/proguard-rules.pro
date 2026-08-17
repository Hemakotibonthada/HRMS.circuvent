# kotlinx.serialization keeps its generated serializers by annotation; R8 needs
# telling that the companion objects and the @Serializable classes are reachable
# through reflection or they are stripped and every response fails to parse in
# release only — which is the worst place to find out.
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**

-keepclassmembers class kotlinx.serialization.json.** {
    *** Companion;
}
-keepclasseswithmembers class kotlinx.serialization.json.** {
    kotlinx.serialization.KSerializer serializer(...);
}

-if @kotlinx.serialization.Serializable class **
-keepclassmembers class <1> {
    static <1>$Companion Companion;
    static **$* *;
}
-keepclassmembers class **$* implements kotlinx.serialization.internal.GeneratedSerializer {
    *** INSTANCE;
    kotlinx.serialization.KSerializer serializer(...);
}

# OkHttp's optional platform integrations are absent at runtime; the warnings
# are expected rather than a sign of a missing dependency.
-dontwarn okhttp3.internal.platform.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**
