# Reel Studio

Makes Instagram reels (9:16, 1080×1920 MP4) that teach Punjabi in both scripts.

Each reel shows one line:

1. The poet's name.
2. The line writes itself in **Shahmukhi**, right to left, then in **Gurmukhi**, left to right.
3. The romanised reading appears.
4. While you read aloud, the **same word lights up in all three**, so viewers link the sound to the letters.
5. The English meaning, then an end card with your handle.

Open it at `https://warraich-a.github.io/Claude-personal/reels/` (Chrome on Android works best).

## Making a reel

1. Pick a line, a background and a reading pace.
2. Tap **Play preview** to watch it without recording.
3. Tap **Record reel**. After a 3-2-1 countdown, read each word as it turns gold. The cue text under the preview is only for you and is not in the video.
4. Tap **Share…** to send it to Instagram, or **Save video**. A caption with both scripts, the romanisation, meaning and hashtags is ready to copy.

No voice? Untick **Record my voice** and add a voiceover inside Instagram later.

## Backgrounds

| Background | What it is |
| --- | --- |
| Phulkari | Generated embroidery: golden darning stitches in bagh-style diamonds on madder-red khaddar. The border stitches itself in at the start. |
| Sarson at dusk | Generated mustard field swaying under an evening sky, with a shisham tree line. |
| Your photo or video | Anything from your phone, darkened so the text stays readable. Your village or fields will often feel more real than anything generated. |

## Adding and checking lines

Lines live in `lines.json`. Edit it in GitHub's web editor (pencil icon).

- `shahmukhi`, `gurmukhi` and `roman` must have **the same number of words in the same order**. The studio highlights word 1 in all three, then word 2, and so on. If the counts differ, it warns you and turns highlighting off.
- Keep punctuation attached to the word before it (`کتاباں،`, `ਕਿਤਾਬਾਂ,`) so it doesn't count as a word.
- `checked: false` shows a warning in the studio. Set it to `true` only after a fluent reader has compared the line with a published source.
- `poet` appears at the top of the reel; `english` appears near the end.

After editing, reload the studio. Changes show up straight away when you're online.
