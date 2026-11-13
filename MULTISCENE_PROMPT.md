# Multi-scene Video - prompt pack

## 1. What the reference ad is (22s, 9:16, ~720x1280)
| Time | Scene | How it is made |
|---|---|---|
| 0-4s | Product hero: pen standing on a desk beside a laptop, warm light. Headline "9-5 Office / Looks / but make it drameyetic" | Image model makes the desk; the exact product is pasted on top; video model adds light/depth motion; text added by code |
| 4-17s | Five close-up looks (Wing Mode - Monday, Twin Wing - Tuesday, Soft low line - Wednesday, Smokey Slay - Thursday, Graphic Drama - Friday). Different hair/outfit/background each, slow push-in, flash transition between | One still per look (image model) -> short motion clip (video model) -> title + day label added by code |
| 17-22s | End card: logo, SHOP NOW pill, URL, "Available On" + marketplace logos | Pure code (logos pasted untouched), fade-in |

Reference observations that shaped the design: text stays crisp and exactly spelled in every frame (so it must be composited, never generated); packaging stays identical (so the product is composited); every look is a separate generation (one clip cannot change person/hair/outfit between cuts).

## 2. Duration rule (Seedance limit)
The finished reel is capped at ONE Seedance generation: **10s** on the 1.0 models, **12s** on 1.5 Pro (`maxClipSeconds()` in `providers/seedance.js`). Fixed split: hero 2.0s + end card 2.0s + the rest shared by the looks (4 looks = 1.5s each; 5 looks = 1.2s each). Each scene clip is requested at Seedance's shortest length (5s / 4s) and trimmed to its slot. The ~22s original would need a longer cap; raise it by changing `maxClipSeconds()`.

## 3. Master storyboard prompt (sent to the text model)
Lives in `server/src/constants/multiSceneVideo.js` as `STORYBOARD_SYSTEM_PROMPT`. `{{TOKENS}}` are filled from the form.

```
You are a senior creative director and storyboard artist for short-form vertical beauty / lifestyle advertising. You plan a multi-scene "showcase reel" that will be produced by separate tools: an image model makes one still per scene, a video model animates each still for about a second, and software adds all text, the exact product shot and the end card. You only WRITE; you never describe text rendering.

REEL STRUCTURE (fixed)
1. HERO scene - a lifestyle setting where the product sits as the hero (e.g. on a desk beside a laptop, on a vanity). The product itself is added by software, so describe ONLY the empty setting with a clear, uncluttered spot for the product on the right-of-centre third, softly lit. Add a three-part headline: a small KICKER, a big TITLE, and a one-line SUBLINE.
2. LOOK scenes - exactly {{LOOK_COUNT}} scenes. Each is a different close-up beauty portrait of a model wearing one distinct look built around the product's benefit. Vary hair, outfit colour, background and mood between looks so each cut feels new; keep framing consistent (head-and-shoulders, face centred, eyes toward camera). Each look has a short TITLE (2-3 words, e.g. "Wing Mode") and a LABEL (the day / occasion / mood that ties the set together, e.g. "Monday"). Order them as a progression (calm -> bold, or day -> night).
3. END CARD - assembled by software from the brand's own logo and links. You only supply the CTA wording and the URL text given to you.

BRIEF
Product: {{PRODUCT}}
Campaign idea / theme: {{THEME}}
Audience & market: {{AUDIENCE}}
Tone: {{TONE}}
Look labels to use (in order, if provided): {{LABELS}}
Extra notes: {{NOTES}}

HARD RULES
- Every "stillPrompt" is a complete, self-contained photographic prompt: subject, age range, skin tone appropriate to the audience, hair, outfit, expression, background, lens/lighting, mood. Natural, premium editorial quality. No brand names, no text of any kind in the image.
- Every "motionPrompt" is ONE sentence (max 30 words) describing only small, natural movement of what is already in the still: a slow push-in, a slight head turn, a blink, hair or fabric drifting, light flicker, steam rising. No new objects, no scene changes, no text.
- The product's packaging, label and printing must never be described, altered or reinterpreted by any prompt. The hero stillPrompt must not contain the product at all.
- Do not mention colours as hex codes. Do not put any wording that should appear on screen inside a stillPrompt or motionPrompt.
- On-screen copy is short: kicker <= 3 words, title <= 3 words, subline <= 7 words, look title <= 3 words, label <= 2 words, CTA <= 3 words.
- Do NOT plan durations. Timing is decided by software.

OUTPUT - return ONLY valid JSON, no markdown fences, in exactly this shape:
{
  "hero": { "kicker": "", "title": "", "subline": "", "stillPrompt": "", "motionPrompt": "" },
  "looks": [ { "title": "", "label": "", "stillPrompt": "", "motionPrompt": "" } ],
  "endCard": { "cta": "", "urlText": "" }
}
"looks" must contain exactly {{LOOK_COUNT}} items.
```

## 4. Filled example for the reference-style ad
Form values: Product = Infinite black kajal - Idea = One kajal, five work-week looks, from 9-5 office to Friday night - Audience = Working women 22-35, India - Tone = Confident, playful, premium - Looks = 4 (labels Monday, Tuesday, Wednesday, Thursday) - Website = www.yourbrand.in

Expected storyboard (this is what the writer returns; every field is editable before generating):
```json
{
  "hero": {
    "kicker": "9-5 Office", "title": "Looks", "subline": "but make it drameyetic",
    "stillPrompt": "Moody warm-lit office desk at dusk, open laptop showing a blurred spreadsheet on the left, small potted plant, ceramic mug, bookshelf softly out of focus, shallow depth of field, a clear empty standing spot on the right third of the frame, premium editorial photography.",
    "motionPrompt": "Slow gentle push-in while warm light flickers across the desk and the plant leaves sway very slightly."
  },
  "looks": [
    { "title": "Wing Mode", "label": "Monday", "stillPrompt": "Head-and-shoulders portrait of an Indian woman in her late 20s, sleek low bun, crisp white blazer over white shirt, sharp black winged liner, glossy skin, calm confident gaze to camera, dark navy studio backdrop, soft key light, premium editorial photography.", "motionPrompt": "Slow push-in as she turns her head a few degrees toward camera and blinks softly." },
    { "title": "Twin Wing", "label": "Tuesday", "stillPrompt": "Head-and-shoulders portrait of an Indian woman in her late 20s, high ponytail, burgundy knit top, double graphic wing liner, warm smile, dark studio backdrop, soft key light, premium editorial photography.", "motionPrompt": "Slow push-in with a subtle head tilt and a gentle blink; ponytail sways slightly." },
    { "title": "Soft Low Line", "label": "Wednesday", "stillPrompt": "Head-and-shoulders portrait of an Indian woman in her mid 20s, side braid, small bindi, jhumka earrings, lavender kurta, soft smudged lower-lash kajal, natural glow, dark studio backdrop, soft light, premium editorial photography.", "motionPrompt": "Slow push-in as she looks up toward camera and blinks; earrings sway slightly." },
    { "title": "Smokey Slay", "label": "Thursday", "stillPrompt": "Head-and-shoulders portrait of an Indian woman in her late 20s, loose waves, cream blazer over navy top, silver choker, deep smoky kajal eyes, moody low-key lighting, dark backdrop, premium editorial photography.", "motionPrompt": "Slow push-in with a slow blink and a slight chin lift; hair waves drift." }
  ],
  "endCard": { "cta": "Shop now", "urlText": "www.yourbrand.in" }
}
```
Per-scene guards appended automatically by the code (not by the writer): every scene image gets "no text / logos / watermarks, keep the lower third calm"; every motion prompt gets "subtle motion only, same face/makeup/outfit, no text, no audio"; the hero motion also gets the "product is a fixed rigid object" lock.

## 5. Setup notes
- Needs `ffmpeg` on the server (`ffmpeg-static` is already an optionalDependency, or set `FFMPEG_PATH`).
- On-screen text is drawn from system fonts. On a minimal Linux host install fontconfig + a sans and a serif family, or set `REEL_FONT_SANS` / `REEL_FONT_SERIF`.
- Uses the existing image (Seedream), video (Seedance) and text (Claude, falling back to auto) providers; no new keys.
- Cost: one image + one 4-5s clip per hero/look scene (e.g. 5 scenes = 5 images + 5 clips).
