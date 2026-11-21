# Reel Studio

Makes Instagram reels (9:16, 1080×1920 MP4) of Punjabi wisdom in Shahmukhi.

Each reel shows one saying. A saying has one or more lines, and each line gets its own screen while it is spoken:

- the poet or source at the top
- the line in **Shahmukhi**, marked "read right to left"
- the romanised reading and the English meaning
- an end card with your handle

The reel lasts as long as the recording, so longer pieces of wisdom work too.

Open it at `https://warraich-a.github.io/Claude-personal/reels/` (Chrome on Android works best).

## Making a reel

1. **Pick a saying**, or tap **Add a saying**. Put each line on its own row: row 1 of the Shahmukhi goes with row 1 of the romanised and English boxes, and so on. Saved sayings stay on this phone; **Copy for lines.json** gives you text to add to the shared list.
2. **Pick the voice:**
   - **Upload a recording**: a voice note or video a contributor sent. For sayings with several lines, tap **Time the lines**, press Play, and tap the big button as each line starts. Untimed lines are spread evenly.
   - **Record my voice now**: after a 3-2-1 countdown, tap the big button under the preview as you start each line, then **Finish**.
   - **No voice**: lines are timed automatically; add a voiceover in Instagram later.
3. **Pick the music** and its volume under the voice:
   - **Tanpura drone**: a string drone generated in the app, so there is no copyright issue. Set the pitch to suit the reciter (C# suits most men, G# most women).
   - **My music file**: only music you have the rights to. Popular songs get reels muted or removed.
   - **No music**: or add licensed music from Instagram's library when you post.
   Music fades in and out. When recording your voice live, music goes into the video but not out of the speaker.
4. **Pick a background**, then **Play preview** to check it.
4. **Record reel**. When it's done: **Share…**, **Save video**, and **Copy caption** (Shahmukhi, romanisation, meaning, poet, hashtags).

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
    { "shahmukhi": "…", "roman": "…", "english": "…" },
    { "shahmukhi": "…", "roman": "…", "english": "…" }
  ]
}
```

- Each item in `parts` is one screen of the reel.
- `checked: false` shows a warning in the studio. Set it to `true` only after a fluent reader has compared the saying with a published source.

After editing, reload the studio. Changes show up straight away when you're online.
