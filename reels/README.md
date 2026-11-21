# Reel Studio

Makes Instagram reels (9:16, 1080×1920 MP4) that teach Punjabi in both scripts.

Each reel shows one saying. A saying has one or more lines, and each line gets its own screen while it is spoken:

- the poet or source at the top
- the line in **Shahmukhi** (written right to left) and **Gurmukhi** (left to right)
- the romanised reading and the English meaning
- an end card with your handle

The reel lasts as long as the recording, so longer pieces of wisdom work too.

Open it at `https://warraich-a.github.io/Claude-personal/reels/` (Chrome on Android works best).

## Making a reel

1. **Pick a saying**, or tap **Add a saying**. Put each line on its own row in each box: row 1 of Shahmukhi goes with row 1 of Gurmukhi, and so on. Saved sayings stay on this phone; **Copy for lines.json** gives you text to add to the shared list.
2. **Pick the sound:**
   - **Upload a recording**: a voice note or video a contributor sent. For sayings with several lines, tap **Time the lines**, press Play, and tap the big button as each line starts. Untimed lines are spread evenly.
   - **Record my voice now**: after a 3-2-1 countdown, tap the big button under the preview as you start each line, then **Finish**.
   - **No sound**: lines are timed automatically; add a voiceover in Instagram later.
3. **Pick a background**, then **Play preview** to check it.
4. **Record reel**. When it's done: **Share…**, **Save video**, and **Copy caption** (both scripts, romanisation, meaning, poet, hashtags).

Get each contributor's OK, in writing, to post their recording on the channel.

## Backgrounds

| Background | What it is |
| --- | --- |
| Phulkari | Generated embroidery: golden darning stitches in bagh-style diamonds on madder-red khaddar. The border stitches itself in at the start. |
| Sarson at dusk | Generated mustard field swaying under an evening sky, with a shisham tree line. |
| Your photo or video | Anything from your phone, darkened so the text stays readable. Your village or fields will often feel more real than anything generated. |

## The shared list: lines.json

`lines.json` holds the sayings everyone sees. Edit it in GitHub's web editor (pencil icon).

```json
{
  "poet": "Waris Shah, Heer",
  "note": "",
  "checked": false,
  "parts": [
    { "shahmukhi": "…", "gurmukhi": "…", "roman": "…", "english": "…" },
    { "shahmukhi": "…", "gurmukhi": "…", "roman": "…", "english": "…" }
  ]
}
```

- Each item in `parts` is one screen of the reel.
- `checked: false` shows a warning in the studio. Set it to `true` only after a fluent reader has compared the saying with a published source.

After editing, reload the studio. Changes show up straight away when you're online.
