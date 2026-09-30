# kotlinx.serialization: the generated v2 models and our own @Serializable types keep their
# serializers (the library's consumer rules cover the runtime; these cover companion lookups).
-keepattributes *Annotation*, InnerClasses
-keepclassmembers @kotlinx.serialization.Serializable class ** {
    *** Companion;
    kotlinx.serialization.KSerializer serializer(...);
}
-keep,includedescriptorclasses class app.musix.api.models.**$$serializer { *; }
-keepclassmembers class app.musix.api.models.** { *** Companion; }
# navigation routes are @Serializable objects/classes looked up by name
-keep @kotlinx.serialization.Serializable class ru.musixai.app.ui.** { *; }
-dontwarn org.slf4j.**
