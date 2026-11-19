# Trick or Treat (Android)

The Trick or Treat game from the Halloween Midterm site, packaged as an Android
app with Capacitor 8. Plain HTML/CSS/JS, no framework, works fully offline.

- `www/`: the app's web files. `js/game.js` and `img/door-inside.webp` are
  unchanged copies from `halloween-midterm/public/`.
- `android/`: the native Android project.

After changing anything in `www/`, run `npm run sync` to copy it into the
Android project, then run the app again from Android Studio (`npm run open`).

Needs Android Studio (its bundled JDK 21 is used for the build).
