import React, { useEffect, useRef, useState } from 'react';
import { downloadFile, downloadVideoAsGif, resolveAssetUrl } from '../api/client.js';

/**
 * Download button for a video with two choices: MP4 or GIF. The GIF is made on the server (ffmpeg), so a small
 * loader shows on the button while it is built, then the file downloads.
 * `className` styles the button; `children` is its content (idle). `up` opens the menu above the button.
 */
export default function VideoDownloadMenu({ url, baseName = 'automatr-video', className = '', children, disabled, up = false, align = 'right', ariaLabel = 'Download video' }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const box = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  async function pick(kind) {
    setOpen(false);
    setError('');
    setBusy(kind);
    try {
      if (kind === 'gif') await downloadVideoAsGif(url, baseName);
      else await downloadFile(resolveAssetUrl(url), `${String(baseName).replace(/\.[a-z0-9]+$/i, '')}.mp4`);
    } catch {
      setError(kind === 'gif' ? 'Could not make the GIF. Try the MP4 instead.' : 'Could not download. Try again.');
    } finally {
      setBusy('');
    }
  }

  const item = { display: 'block', width: '100%', textAlign: 'left', padding: '9px 14px', background: 'none', border: 0, cursor: 'pointer', font: 'inherit', fontSize: 13.5, color: '#1b1f2a', whiteSpace: 'nowrap' };
  return (
    <span ref={box} style={{ position: 'relative', display: 'inline-block' }}>
      <button type="button" className={className} disabled={disabled || Boolean(busy)} aria-label={ariaLabel} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {busy ? <><span className="spinner" style={{ width: 14, height: 14 }} /><span>{busy === 'gif' ? 'Making GIF…' : 'Downloading…'}</span></> : children}
      </button>
      {open && (
        <div role="menu" style={{ position: 'absolute', [align]: 0, [up ? 'bottom' : 'top']: 'calc(100% + 6px)', zIndex: 30, minWidth: 170, background: '#fff', borderRadius: 10, boxShadow: '0 8px 28px rgba(20,24,40,.18)', border: '1px solid #e4e7ee', padding: '4px 0' }}>
          <button type="button" role="menuitem" style={item} onClick={() => pick('mp4')}>MP4 video</button>
          <button type="button" role="menuitem" style={item} onClick={() => pick('gif')}>GIF animation</button>
        </div>
      )}
      {error && <span role="alert" className="hint" style={{ position: 'absolute', [align]: 0, top: '100%', whiteSpace: 'nowrap', marginTop: 4 }}>{error}</span>}
    </span>
  );
}
