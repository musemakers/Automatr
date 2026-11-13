# Automatr - Modified Files (this session)

Drop each file into the matching path in your project, overwriting the existing one, then restart server + client.

## server/src/services/ai/providers/seedream.js
Fixes the Ark "size" 400 error - upscales any requested image size below
Seedream 4.5/5.0 Lite's 3.68-megapixel minimum, preserving the exact aspect
ratio, and clamps to Ark's 4096px-per-side max.

## server/src/services/ai/designService.js
Two independent fixes:
1. Brand-color hex codes (e.g. "#15181C, #2E3339") were leaking into the
   image as literal rendered text. The prompt now explicitly tells the
   model these are palette guidance only, never text to draw.
2. saveGeneratedImage() calls now pass the format's target ratio through
   (see next file) and are awaited (the function became async).

## server/src/utils/saveGeneratedImage.js
New crop-to-ratio step: every generated image is center-cropped to the
platform format's exact declared ratio (e.g. Instagram Feed's 4:5) before
saving, regardless of what raw dimensions the provider actually returned.
Fixes Seedream images rendering with visible borders/empty space instead
of filling the frame edge-to-edge. Only ever crops, never upscales or
distorts.

## server/src/controllers/posts.controller.js
Updated the modifyImage (image edit/regenerate) call site to match the
new saveGeneratedImage(image, ratio) signature.

## client/src/pages/GenerateMedia.jsx
"Generate Media" pre-fills from whatever post was last active in
WorkflowContext. Added a banner + "Start from scratch" button so
returning users can explicitly clear the carried-over brief instead of
silently continuing it.

## client/src/pages/GenerateDesigns.jsx
Choosing a copy direction used to immediately auto-trigger the first
(paid) image generation call, before the Typography toggle below it was
ever seen. Now:
- Selecting a direction no longer auto-generates images.
- Typography and Reference-creative settings are shown and editable first.
- A new "Generate images" button (with a live cost estimate) triggers the
  actual generation once you're ready - so headline/text choices are
  locked in before the first generation call, not after.
