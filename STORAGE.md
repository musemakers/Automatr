# Where files live & how to keep them on Railway

**Decision: a Railway Volume (files on disk) + MongoDB for metadata only.**

Why not the alternatives
- MongoDB / GridFS / base64: generated videos are multi-MB and images add up; the 16 MB document limit, slower reads, a bigger Atlas bill and no direct streaming (`<video>` seeking) make it the worst fit.
- S3 / Cloudflare R2: the most robust long-term (survives service deletion, works with several server replicas, CDN) but needs a new SDK, keys, upload code in every place that writes a file, and migration of existing URLs. Worth doing later if you scale to >1 replica; not needed now.
- Volume: zero code changes elsewhere (every write already goes through `uploadDirPath` in `middleware/upload.js`), existing `/uploads/...` URLs keep working, and `express.static` already serves them.

## One-time Railway setup
1. Railway -> your service -> **Settings -> Volumes -> Add Volume**, mount path `/data`.
2. **Variables:** remove `UPLOAD_DIR` if it is set to `uploads` (that path is NOT on the volume). Leaving it unset is correct: the app uses `/data/uploads` automatically via `RAILWAY_VOLUME_MOUNT_PATH`.
3. If the log says the folder is not writable, add variable `RAILWAY_RUN_UID=0`.
4. Redeploy. The boot log must show: `File storage: /data/uploads (railway-volume)`. If it instead warns "WITHOUT a persistent volume", the volume is not attached.
5. Turn on **volume backups** (Railway Pro) or periodically download `/data/uploads`.

## What is stored where
| What | Where |
|---|---|
| Uploaded product/logo images, generated images, final MP4s | `/data/uploads/` (volume) |
| Throw-away scratch (trimmed segments, overlays) | OS temp folder, deleted after each run |

## Behaviour you get
- The database stores file NAMES, not absolute paths, so changing the mount path never breaks old files.

## Limits to know
- A volume belongs to one service and one running instance (no horizontal scaling) and is lost if the volume itself is deleted. Size it for growth (a 10s 720p video is a few MB; images ~0.5 MB each) and consider a cleanup job for old files later.
- Files that were written to the container's old ephemeral disk before the volume was attached are already gone on redeploy; nothing to migrate unless you still have them locally (copy them into the volume's `uploads/` folder once, e.g. with `railway shell`).
