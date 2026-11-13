import React, { useEffect, useState } from 'react';
import {
  platformsFor, sizesForPlatform, catalogPlatformOf, customFormatId, parseCustomId, isValidCustomSize, CUSTOM_MIN, CUSTOM_MAX
} from '../../constants/postFormats.js';
import '../../styles/size-picker.css';

export const ORIGINAL_ID = 'original';

/**
 * The one size picker used by every flow: first dropdown = platform / channel, second = the sizes for it.
 *
 * props
 *   mode            'image' | 'video'   which size list to show (video has its own shorter list)
 *   platform        picker platform name ('' = nothing chosen yet), see platformsFor(mode)
 *   formatId        chosen size id ('' = none). Image ids are format ids (custom ones are `custom_<W>x<H>`),
 *                   video ids are `v:<platform>:<label>`. ORIGINAL_ID ('original') = keep the original size.
 *   onChange        ({ platform, formatId, w, h, label }) on every change. formatId is '' and w/h are null
 *                   while a Custom size is incomplete or out of range.
 *   originalDims    { w, h } real pixel size of the uploaded creative
 *   allowOriginal   adds "Keep original size (W × H px)" to the platform dropdown
 *   showSecondOnlyAfterPlatform  (default true) the size dropdown only appears once a platform is chosen
 *   disabledIds     size ids that cannot be picked (e.g. already used in another row)
 *   extraSizes      [{ id, label, platform, group }] extra placements (carousel / video) listed in the same size dropdown
 *                   under their platform, in their own group. `platform` is a picker platform name.
 *   idPrefix        prefix for element ids / labels when several pickers are on one page
 *   className       extra class on the wrapper
 */
export default function SizePicker({
  mode = 'image', platform = '', formatId = '', onChange, originalDims = null, allowOriginal = false,
  showSecondOnlyAfterPlatform = true, disabledIds = [], extraSizes = [], idPrefix = 'size', className = ''
}) {
  const platforms = platformsFor(mode);
  const isOriginal = formatId === ORIGINAL_ID || platform === ORIGINAL_ID;
  const activePlatform = isOriginal ? ORIGINAL_ID : platform || catalogPlatformOf(formatId) || '';
  const customParsed = parseCustomId(formatId);
  const [cw, setCw] = useState(customParsed ? String(customParsed.w) : '');
  const [ch, setCh] = useState(customParsed ? String(customParsed.h) : '');
  useEffect(() => {
    const c = parseCustomId(formatId);
    if (c) { setCw(String(c.w)); setCh(String(c.h)); }
  }, [formatId]);

  const sizes = sizesForPlatform(activePlatform, mode);
  const extras = extraSizes.filter((x) => x.platform === activePlatform);
  const allSizes = [...sizes, ...extras];
  const originalLabel = originalDims ? `Keep original size (${originalDims.w} × ${originalDims.h} px)` : 'Keep original size';
  const emit = (p, id, w, h, label) => onChange?.({ platform: p, formatId: id, w: w ?? null, h: h ?? null, label: label || '' });

  function pickPlatform(p) {
    if (p === ORIGINAL_ID) { emit(ORIGINAL_ID, ORIGINAL_ID, originalDims?.w, originalDims?.h, originalLabel); return; }
    if (p === 'Custom') { setCw(''); setCh(''); emit('Custom', '', null, null, ''); return; }
    const first = sizesForPlatform(p, mode).find((s) => !disabledIds.includes(s.id));
    if (first) emit(p, first.id, first.w, first.h, first.label);
    else emit(p, '', null, null, '');
  }
  function pickSize(id) {
    const s = allSizes.find((x) => x.id === id);
    if (s) emit(activePlatform, s.id, s.w ?? null, s.h ?? null, s.label);
  }
  function editCustom(nextW, nextH) {
    setCw(nextW); setCh(nextH);
    const w = Math.round(+nextW), h = Math.round(+nextH);
    if (nextW !== '' && nextH !== '' && isValidCustomSize(w, h)) emit('Custom', customFormatId(w, h), w, h, `${w} × ${h} px`);
    else emit('Custom', '', null, null, '');
  }
  const customInvalid = activePlatform === 'Custom' && (cw !== '' || ch !== '') && !(cw !== '' && ch !== '' && isValidCustomSize(Math.round(+cw), Math.round(+ch)));

  const showSecond = activePlatform && activePlatform !== ORIGINAL_ID && (activePlatform === 'Custom' || allSizes.length > 0 || !showSecondOnlyAfterPlatform);

  return (
    <div className={`sp ${className}`.trim()}>
      <select
        id={`${idPrefix}-platform`}
        className="sa-select"
        aria-label="Platform or channel"
        value={activePlatform}
        onChange={(e) => pickPlatform(e.target.value)}
      >
        <option value="" disabled>Select a platform</option>
        {allowOriginal && <option value={ORIGINAL_ID}>{originalLabel}</option>}
        {platforms.map((p) => <option key={p} value={p}>{p}</option>)}
      </select>

      {showSecond && activePlatform !== 'Custom' && (
        <select
          id={`${idPrefix}-size`}
          className="sa-select"
          aria-label="Size"
          value={allSizes.some((s) => s.id === formatId) ? formatId : ''}
          onChange={(e) => pickSize(e.target.value)}
        >
          <option value="" disabled>Select a size</option>
          {sizes.map((s) => (
            <option key={s.id} value={s.id} disabled={disabledIds.includes(s.id) && s.id !== formatId}>
              {mode === 'video' || /\d\s*[×x]\s*\d/.test(s.label) ? s.label : `${s.label} (${s.w} × ${s.h} px)`}
            </option>
          ))}
          {extras.length > 0 && (
            <optgroup label="Carousel and video">
              {extras.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
            </optgroup>
          )}
        </select>
      )}

      {activePlatform === 'Custom' && (
        <div className="sp-custom">
          <div className="sp-custom__row">
            <input type="number" className="sp-input" min={CUSTOM_MIN} max={CUSTOM_MAX} step="1" inputMode="numeric" placeholder="Width" aria-label="Width in pixels" aria-invalid={customInvalid || undefined} value={cw} onChange={(e) => editCustom(e.target.value, ch)} />
            <span aria-hidden="true">{'×'}</span>
            <input type="number" className="sp-input" min={CUSTOM_MIN} max={CUSTOM_MAX} step="1" inputMode="numeric" placeholder="Height" aria-label="Height in pixels" aria-invalid={customInvalid || undefined} value={ch} onChange={(e) => editCustom(cw, e.target.value)} />
            <span className="sp-custom__unit">px</span>
          </div>
          <p className={`sp-note ${customInvalid ? 'is-error' : ''}`.trim()} role={customInvalid ? 'alert' : undefined}>
            Enter a width and height in pixels ({CUSTOM_MIN} to {CUSTOM_MAX}).
          </p>
        </div>
      )}
    </div>
  );
}
