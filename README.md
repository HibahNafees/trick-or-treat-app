# Trick or Treat (Android)

The Trick or Treat game from the Halloween Midterm site, packaged as an Android
app with Capacitor 8. Plain HTML/CSS/JS, no framework, works fully offline.

- `www/`: the app's web files. `js/game.js` and `img/door-inside.webp` are
  unchanged copies from `halloween-midterm/public/`.
- `android/`: the native Android project.

After changing anything in `www/`, run `npm run sync` to copy it into the
Android project, then run the app again from Android Studio (`npm run open`).

Build with **JDK 21**. Android Studio's bundled JDK is Java 25, which this
project's Gradle (8.14) can't run on. In Android Studio set Settings → Build,
Execution, Deployment → Build Tools → Gradle → Gradle JDK to `jbr-21`.

## Release build

Signing details are read from `android/keystore.properties` (git-ignored).
Fill in `storePassword` and `keyPassword` there, then:

    npm run sync
    cd android
    JAVA_HOME=~/Library/Java/JavaVirtualMachines/jbr-21.0.11/Contents/Home ANDROID_HOME=~/Library/Android/sdk ./gradlew assembleRelease

The signed APK is `android/app/build/outputs/apk/release/app-release.apk`.
