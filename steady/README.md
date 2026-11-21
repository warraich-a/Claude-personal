# Steady

Hand someone your phone. Dots drift wherever they tilt it. When they hold it still, the dots settle into a message. Shake it for the next one.

A plain HTML/JS progressive web app, with no build step and no dependencies.

## Sensors used

| Sensor / API | What it does here |
| --- | --- |
| Accelerometer (`devicemotion`) | Tilt moves the dots, stillness forms the message, two quick jolts count as a shake |
| Vibration | A short tap when a message lands (Android only; iOS has no web vibration) |
| Screen Wake Lock | Stops the screen dimming while someone holds it still |

On a computer, the mouse stands in for the sensor. Move it to tilt, stop moving to settle, and double-click or press Space for the next message.

Nothing is recorded or sent anywhere. Custom messages are kept in the phone's local storage.

## Hosting (GitHub Pages)

Phone browsers only allow motion sensors on HTTPS pages.

1. Make the repository public (Pages on private repos needs a paid plan).
2. Repo **Settings → Pages → Build and deployment**: Source "Deploy from a branch", choose the branch and `/ (root)`.
3. Open `https://<user>.github.io/<repo>/steady/` on your phone.
4. Install it: Android Chrome → menu → *Add to Home screen* / *Install app*; iPhone Safari → Share → *Add to Home Screen*.

On iPhone, tap a language button and allow motion access when asked. If you denied it, the permission resets after you close and reopen the app.

## Punjabi mode

Pick **ਪੰਜਾਬੀ · پنجابی** on the start screen. Each line forms in one script; while the phone stays still, the same dots flow into the other script and back every few seconds. Underneath: a romanised reading, the English meaning, and the poet. Lines alternate which script leads.

The lines live in `punjabi.json`. Each entry has `shahmukhi`, `gurmukhi`, `roman`, `english`, `poet`, an optional `note`, and `checked`. Lines show a **Not yet checked** badge until `checked` is `true`, so set it only after a fluent reader has compared the line with a published source. You can edit the file in GitHub's web editor; no code changes needed.

A **Listen** button appears only on phones with a Punjabi (`pa`) text-to-speech voice installed, and it reads the Gurmukhi. Recorded audio by a real speaker would be better and is the obvious next step.

Fonts (Noto Nastaliq Urdu, Noto Sans Gurmukhi) load from Google Fonts on first use, then work offline.

## Editing messages

English mode only. Tap **Messages**. One message per line; add an author after two dashes: `Be kind -- Mum`.

## Tuning

The thresholds are in the `T` object at the top of `app.js`. If a message never appears for someone with shaky hands, raise `jitterRange`. If shakes trigger too easily, raise `shakeDelta`.

After changing any file, bump `VERSION` in `sw.js` so installed copies pick up the update.
