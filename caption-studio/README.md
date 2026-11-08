# Caption Studio

A local, private captioning studio for your videos. Drop in a video, get styled
animated captions, burn them into a new file. Nothing is uploaded anywhere — the
server runs on your machine and `ffmpeg` does the rendering.

![stack: node + ffmpeg](https://img.shields.io/badge/stack-node%20%2B%20ffmpeg-informational)

## Run it

It is one file. Take `caption-studio.mjs` anywhere — nothing else needs to come
with it — and run:

```bash
node caption-studio.mjs
```

Or, since it is executable:

```bash
./caption-studio.mjs
```

Then open <http://127.0.0.1:4321>. `PORT`, `HOST` and `CAPTION_STUDIO_WORK` are
all configurable via environment variables.

The same app also runs from the source tree, which is what you want while
editing it:

```bash
node server.mjs
```

Requirements:

- **Node 20+** — no npm install, the server has zero dependencies.
- **ffmpeg + ffprobe** on your `PATH` — does the burn-in (`brew install ffmpeg`,
  `apt install ffmpeg`, or <https://ffmpeg.org/download.html>).
- **Optional: the Whisper CLI** for one-click auto-captions:
  `pip install -U openai-whisper`. Without it, import an `.srt`/`.vtt` or type
  the cues yourself — everything else works the same.

## What it does

**Captions**

- Auto-caption from the audio with local Whisper (if installed), including
  automatic language detection.
- Import `.srt`, `.vtt`, or a plain text script (spread evenly over the video).
- Type and time cues by hand: set a cue's start to the playhead, split a cue,
  preview a single cue, drag the timeline.
- Re-split everything into *n*-word chunks for the short-form caption look, with
  timings divided proportionally.

**Style**

- Eight starting presets (Clean, Pop, Sing-along, Bar, Neon, Headline, Typed,
  Centre), each a normal starting point you then edit.
- Any font installed on your machine, or drop in a `.ttf`/`.otf`/`.woff2` —
  it is used both in the browser preview and in the exported video.
- Text, outline, highlight and box colours; outline and shadow width; solid box,
  outline, or plain text backing; bold/italic/underline/ALL CAPS; size and
  letter tracking as a share of frame height, so the look holds at any resolution.
- Nine-point placement grid with independent side and edge padding, plus a
  maximum line length.

**Animation** — none, fade, slide (up/down/left/right), pop, bounce, blur in,
zoom out, typewriter, word-by-word, and karaoke word highlighting. Speed is
adjustable, and a cue can override the project-wide animation.

**Languages** — captions are rendered through libass, so every script ffmpeg can
draw works: Latin, Cyrillic, Greek, CJK, Arabic and Hebrew (right-to-left
shaping handled), Devanagari and the other Indic scripts, Thai, Khmer, Burmese,
Amharic, and emoji. Line wrapping and capitalisation are locale-aware and use
`Intl.Segmenter`, so Japanese, Chinese and Thai — which have no spaces — break at
real word boundaries rather than mid-word.

> One caveat worth knowing: libass can only draw glyphs a font on your machine
> actually has. If a language renders as boxes, install a font that covers it
> (the Noto family covers nearly everything) or add the font file in the UI.

**Export** — burn-in to MP4 (H.264/AAC) or WebM (VP9/Opus) with a progress bar,
or download the captions as a sidecar `.srt` or a fully-styled `.ass`. Projects
save to JSON so you can reopen a style and a caption set later.

## How it works

```
browser  ──PUT /api/upload──▶  .work/media/<id>.mp4
  │                                   │
  │ live preview (DOM + CSS           │
  │ animations mirroring the ASS)     │
  │                                   ▼
  └──POST /api/render──▶  lib/ass.mjs ──▶ subs.ass ──▶ ffmpeg -vf ass=… ──▶ MP4
```

`lib/ass.mjs` is the single source of truth for how a caption looks: the server
imports it to build the subtitle file, and the browser imports the very same
module over HTTP for line wrapping, so the preview and the export agree on where
lines break.

### The single file

`caption-studio.mjs` is generated — it is `server.mjs` with `public/` and
`lib/ass.mjs` embedded as strings. Edit the source files, never the bundle, and
rebuild:

```bash
node build.mjs
```

The bundle holds exactly one copy of the caption engine: the browser is served
`lib/ass.mjs` as text, and the server imports that same text as a module through
a `data:` URL.

Working files live in `~/.caption-studio` by default (uploads in `media/`, added
fonts in `fonts/`, renders in `jobs/`), so a file you run from your Downloads
folder does not scatter videos next to itself. Set `CAPTION_STUDIO_WORK` to move
it. Delete that directory any time to reclaim the space.

## Keyboard

| Key | Action |
| --- | --- |
| `Space` | Play / pause |
| `←` / `→` | Nudge 0.2s |
| `Shift` + `←` / `→` | Nudge 1s |

## Notes

The server binds to `127.0.0.1` and has no authentication, because it is meant
to serve exactly one person: you, on your own machine. Don't expose the port to
a network you don't trust.

## Where this fits in SupoClip

This is a standalone, local-first tool, not part of the clip pipeline. SupoClip's
backend already renders word-synced subtitles for generated clips
(`backend/src/caption_templates.py`, `emoji_captions.py`, `font_registry.py`, and
the fonts in `backend/fonts/`). Caption Studio is for the other case: a video you
already have, that you want to caption and style by hand, without running the
stack or sending the file anywhere.

If the two should converge — one caption style vocabulary shared by the pipeline
and this editor — that is a deliberate piece of work, not something this
directory assumes.

## Licence

AGPL-3.0-only, same as the rest of SupoClip. See [`../LICENSE`](../LICENSE).
