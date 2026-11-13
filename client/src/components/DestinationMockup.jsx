import React, { useState } from 'react';
import { getFormat, billboardPresetId } from '../constants/postFormats.js';
import { resolveAssetUrl } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';

/**
 * "Show on destination": draws the creative inside a lightweight mock of the place it will run -
 * a phone feed, a story, a web page, an email, a Google Display slot, a printed flyer, a hoarding,
 * a marketplace listing... Pure HTML/CSS (no image assets), so every placement is covered and the
 * creative is shown at its true shape. The brand name comes from the signed-in workspace; the rest
 * of each mock is neutral placeholder content, so it is only ever an illustration.
 */

const CSS = `
.dm{width:100%;max-width:760px;color:#101828;font-family:var(--font-body,system-ui,sans-serif)}
.dm *{box-sizing:border-box}
.dm img{display:block;width:100%;height:auto}
.dm-tabs{display:flex;gap:6px;justify-content:center;margin-bottom:12px}
.dm-tab{padding:5px 12px;border-radius:999px;border:1px solid rgba(255,255,255,.25);background:transparent;color:rgba(255,255,255,.8);font-size:12.5px;cursor:pointer}
.dm-tab.on{background:#fff;color:#101828;border-color:#fff}
.dm-stage{display:flex;justify-content:center;align-items:flex-start;padding:4px 0 8px}
.dm-note{margin:10px auto 0;text-align:center;font-size:11.5px;color:rgba(255,255,255,.55);max-width:520px}

.dm-phone{width:300px;background:#0b0b0f;border-radius:38px;padding:10px;box-shadow:0 18px 50px rgba(0,0,0,.5)}
.dm-phone__screen{background:#fff;border-radius:29px;overflow:hidden;position:relative}
.dm-phone__bar{height:26px;display:flex;align-items:center;justify-content:space-between;padding:0 18px;font-size:10.5px;font-weight:600;background:inherit}
.dm-phone__notch{position:absolute;left:50%;top:6px;width:70px;height:14px;margin-left:-35px;border-radius:9px;background:#0b0b0f}
.dm-story{background:#111;aspect-ratio:9/16;position:relative}
.dm-story img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.dm-story__top{position:absolute;left:0;right:0;top:0;padding:8px 10px;color:#fff;background:linear-gradient(#0009,#0000);z-index:2}
.dm-story__prog{height:2.5px;border-radius:2px;background:#fff5;margin-bottom:8px;overflow:hidden}
.dm-story__prog i{display:block;width:45%;height:100%;background:#fff}
.dm-story__who{display:flex;gap:8px;align-items:center;font-size:12px;font-weight:600}
.dm-story__bottom{position:absolute;left:10px;right:10px;bottom:12px;z-index:2;display:flex;gap:8px;align-items:center}
.dm-story__reply{flex:1;border:1px solid #fff9;border-radius:999px;padding:8px 12px;color:#fffd;font-size:12px}

.dm-av{width:30px;height:30px;border-radius:50%;background:linear-gradient(135deg,#2E5EFF,#7A4FD6);color:#fff;font-weight:700;font-size:12px;display:flex;align-items:center;justify-content:center;flex:none}
.dm-av.sm{width:24px;height:24px;font-size:10px}
.dm-av.lg{width:64px;height:64px;font-size:22px;border:3px solid #fff}
.dm-card{background:#fff;border:1px solid #e4e7ee;border-radius:10px;overflow:hidden}
.dm-card__h{display:flex;gap:9px;align-items:center;padding:9px 11px}
.dm-card__h b{font-size:12.5px;display:block;line-height:1.2}
.dm-card__h span{font-size:10.5px;color:#667085}
.dm-card__b{padding:8px 11px 11px;font-size:12px;line-height:1.4;color:#344054}
.dm-ico{display:flex;gap:14px;padding:8px 11px 2px;font-size:16px;color:#101828}
.dm-ln{height:7px;border-radius:4px;background:#e4e7ee;margin:6px 0}
.dm-ln.d{background:#cfd4de}

.dm-browser{width:100%;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 18px 50px rgba(0,0,0,.45)}
.dm-browser__bar{background:#eceff4;display:flex;align-items:center;gap:6px;padding:8px 10px}
.dm-browser__bar i{width:9px;height:9px;border-radius:50%;background:#c4cad6}
.dm-browser__url{flex:1;margin-left:8px;background:#fff;border-radius:6px;padding:3px 10px;font-size:11px;color:#667085}
.dm-nav{display:flex;align-items:center;gap:14px;padding:10px 16px;border-bottom:1px solid #eef0f4;font-size:11.5px;color:#475467}
.dm-nav b{margin-right:auto;font-size:13px;color:#101828}
.dm-page{padding:14px 16px}
.dm-cols{display:grid;grid-template-columns:1fr 160px;gap:16px}
.dm-ad{position:relative;background:#f2f4f7;display:inline-block;max-width:100%}
.dm-ad__tag{position:absolute;right:0;top:0;background:#fffc;border-bottom-left-radius:4px;font-size:8.5px;padding:1px 4px;color:#667085;z-index:2;letter-spacing:.04em}

.dm-email{width:100%;max-width:640px;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 18px 50px rgba(0,0,0,.45)}
.dm-email__h{padding:12px 16px;border-bottom:1px solid #eef0f4;font-size:12px}
.dm-email__h b{display:block;font-size:14px;margin-bottom:4px}
.dm-email__body{background:#f4f5f8;padding:16px}
.dm-email__in{background:#fff;max-width:600px;margin:0 auto}
.dm-email__txt{padding:14px 18px}
.dm-btn{display:inline-block;background:#2E5EFF;color:#fff;border-radius:6px;padding:8px 18px;font-size:12px;font-weight:600;margin-top:6px}

.dm-paper{background:#fff;box-shadow:0 14px 40px rgba(0,0,0,.5),0 2px 0 #ddd;position:relative}
.dm-desk{width:100%;padding:34px 20px;border-radius:12px;background:linear-gradient(135deg,#8a6a4a,#a7845f);display:flex;justify-content:center;align-items:center}
.dm-desk .dm-paper{transform:rotate(-2deg)}
.dm-wall{width:100%;padding:34px 20px;border-radius:12px;background:linear-gradient(#d9dde5,#c3c9d4);display:flex;justify-content:center}
.dm-frame{background:#fff;padding:10px;border:6px solid #1d2433;box-shadow:0 14px 40px rgba(0,0,0,.45)}
.dm-standee{display:flex;flex-direction:column;align-items:center}
.dm-standee__top{width:100%;height:10px;background:#9aa3b5;border-radius:3px 3px 0 0}
.dm-standee__base{width:112%;height:14px;background:#4b5468;border-radius:3px;margin-top:-1px}
.dm-sky{width:100%;border-radius:12px;padding:26px 16px 0;background:linear-gradient(#9fd0ff,#e4f2ff 70%,#cdd5df 70%);overflow:hidden}
.dm-board{background:#202634;padding:9px;border-radius:3px;box-shadow:0 8px 20px rgba(0,0,0,.35)}
.dm-pole{width:14px;background:#6b7385;margin:0 auto}
.dm-poles{display:flex;justify-content:space-around;padding:0 18%}
.dm-shelter{display:flex;justify-content:center;gap:0;align-items:flex-end;background:linear-gradient(#cfd8e3,#b4bfcc);border-radius:12px;padding:26px 20px 0}
.dm-shelter__box{background:#1d2433;padding:8px 8px 14px;border-radius:6px 6px 0 0;box-shadow:0 0 30px #fff6 inset}
.dm-grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:2px}
.dm-grid3 div{aspect-ratio:1;background:#e4e7ee}
.dm-cover{background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 18px 50px rgba(0,0,0,.45)}
.dm-listing{display:grid;grid-template-columns:44% 1fr;gap:16px;padding:16px}
.dm-price{font-size:19px;font-weight:600}
.dm-stars{color:#f59e0b;font-size:12px}
.dm-chat{background:#e7dfd3;border-radius:12px;padding:16px;width:100%}
.dm-bubble{background:#fff;border-radius:10px;padding:4px;max-width:78%;margin-left:auto;box-shadow:0 1px 1px #0002}
.dm-bubble .t{padding:6px 8px;font-size:11.5px}
.dm-link{border:1px solid #e4e7ee;border-radius:10px;overflow:hidden;background:#fff}
.dm-link .t{padding:10px 12px;font-size:12px}
.dm-link .t small{color:#667085;display:block;margin-top:2px}
@media (max-width:640px){.dm-cols{grid-template-columns:1fr}.dm-listing{grid-template-columns:1fr}}
`;

const initials = (name) => (name || 'B').split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const slug = (name) => (name || 'yourbrand').toLowerCase().replace(/[^a-z0-9]+/g, '');

function Av({ name, size }) { return <span className={`dm-av ${size || ''}`}>{initials(name)}</span>; }
function Lines({ n = 3, last = '60%' }) {
  return <>{Array.from({ length: n }).map((_, i) => <div key={i} className="dm-ln" style={{ width: i === n - 1 ? last : '100%' }} />)}</>;
}
function Img({ src, style }) { return <img src={resolveAssetUrl(src)} alt="" style={style} draggable={false} />; }

function Phone({ children, dark }) {
  return (
    <div className="dm-phone">
      <div className="dm-phone__screen" style={dark ? { background: '#000' } : undefined}>
        <span className="dm-phone__notch" />
        <div className="dm-phone__bar" style={dark ? { color: '#fff', background: '#000' } : undefined}><span>9:41</span><span>●●● ▮</span></div>
        {children}
      </div>
    </div>
  );
}

function Browser({ url, children, nav = true, brand }) {
  return (
    <div className="dm-browser">
      <div className="dm-browser__bar"><i /><i /><i /><span className="dm-browser__url">{url}</span></div>
      {nav && <div className="dm-nav"><b>{brand}</b><span>Products</span><span>About</span><span>Contact</span></div>}
      {children}
    </div>
  );
}

// ---- social ----------------------------------------------------------------------------------
const ICONS = '♡   💬   ➤';

function InstagramPost({ src, brand, caption }) {
  return (
    <Phone>
      <div style={{ padding: '4px 0 0' }}>
        <div className="dm-card__h"><Av name={brand} /><div><b>{slug(brand)}</b><span>Sponsored</span></div></div>
        <Img src={src} />
        <div className="dm-ico">{ICONS}</div>
        <div className="dm-card__b"><b>{slug(brand)}</b> {caption ? caption.slice(0, 110) : ''}{caption && caption.length > 110 ? '… more' : ''}<Lines n={caption ? 0 : 2} /></div>
      </div>
    </Phone>
  );
}
function InstagramGrid({ src, brand }) {
  return (
    <Phone>
      <div style={{ padding: '6px 14px 10px' }}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          <Av name={brand} size="lg" />
          <div style={{ fontSize: 11, display: 'flex', gap: 16, textAlign: 'center' }}><span><b>48</b><br />posts</span><span><b>12k</b><br />followers</span><span><b>310</b><br />following</span></div>
        </div>
        <p style={{ fontSize: 12, fontWeight: 600, margin: '8px 0 10px' }}>{brand}</p>
      </div>
      <div className="dm-grid3">
        <div style={{ position: 'relative', overflow: 'hidden' }}><img src={resolveAssetUrl(src)} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} /></div>
        {Array.from({ length: 8 }).map((_, i) => <div key={i} />)}
      </div>
    </Phone>
  );
}
function Story({ src, brand, platform }) {
  return (
    <Phone dark>
      <div className="dm-story">
        <Img src={src} />
        <div className="dm-story__top">
          <div className="dm-story__prog"><i /></div>
          <div className="dm-story__who"><Av name={brand} size="sm" />{slug(brand)} <span style={{ fontWeight: 400, opacity: .8 }}>· {platform === 'Snapchat' ? 'Ad' : 'Sponsored'}</span></div>
        </div>
        <div className="dm-story__bottom"><span className="dm-story__reply">Send message</span><span style={{ color: '#fff', fontSize: 18 }}>♡</span></div>
      </div>
    </Phone>
  );
}
function FeedCard({ src, brand, caption, platform }) {
  const wide = platform === 'LinkedIn' || platform === 'Facebook' || platform === 'X';
  return (
    <div className="dm-card" style={{ width: wide ? 480 : 360, maxWidth: '100%', boxShadow: '0 18px 50px rgba(0,0,0,.45)' }}>
      <div className="dm-card__h">
        <Av name={brand} />
        <div><b>{brand}{platform === 'X' ? <span style={{ fontWeight: 400 }}> @{slug(brand)}</span> : null}</b><span>{platform === 'LinkedIn' ? '12,480 followers · Promoted' : platform === 'X' ? 'Promoted' : 'Sponsored · 🌐'}</span></div>
      </div>
      <div className="dm-card__b" style={{ paddingTop: 0 }}>{caption ? caption.slice(0, 160) : <Lines n={2} />}</div>
      <Img src={src} />
      <div className="dm-ico" style={{ fontSize: 13, color: '#475467', gap: 20 }}>
        {platform === 'LinkedIn' ? '👍 Like   💬 Comment   ↻ Repost   ➤ Send' : platform === 'X' ? '💬   ↻   ♡   📊   ⬆' : '👍 Like   💬 Comment   ➤ Share'}
      </div>
      <div style={{ height: 8 }} />
    </div>
  );
}
function PinCard({ src, brand, caption }) {
  return (
    <div style={{ width: 260, background: '#fff', borderRadius: 18, overflow: 'hidden', boxShadow: '0 18px 50px rgba(0,0,0,.45)' }}>
      <Img src={src} />
      <div style={{ padding: '10px 12px 14px', fontSize: 12.5 }}><b>{caption ? caption.slice(0, 60) : brand}</b><div style={{ display: 'flex', gap: 7, alignItems: 'center', marginTop: 8, fontSize: 11 }}><Av name={brand} size="sm" />{brand}</div></div>
    </div>
  );
}
function YouTubeThumb({ src, brand, caption }) {
  return (
    <div style={{ width: 400, maxWidth: '100%', background: '#fff', borderRadius: 12, overflow: 'hidden', boxShadow: '0 18px 50px rgba(0,0,0,.45)' }}>
      <div style={{ position: 'relative' }}><Img src={src} /><span style={{ position: 'absolute', right: 8, bottom: 8, background: '#000c', color: '#fff', fontSize: 11, padding: '1px 5px', borderRadius: 4 }}>3:42</span></div>
      <div style={{ display: 'flex', gap: 10, padding: 12 }}><Av name={brand} /><div style={{ fontSize: 13 }}><b>{caption ? caption.slice(0, 70) : 'Your video title appears here'}</b><div style={{ fontSize: 11.5, color: '#667085', marginTop: 3 }}>{brand} · 12K views · 2 days ago</div></div></div>
    </div>
  );
}
function ProfileCover({ src, brand, platform }) {
  const round = platform === 'YouTube' ? 'dm-av lg' : 'dm-av lg';
  return (
    <div className="dm-cover" style={{ maxWidth: 640 }}>
      <Img src={src} />
      <div style={{ padding: '0 18px 16px', marginTop: -28, display: 'flex', gap: 14, alignItems: 'flex-end' }}>
        <span className={round}>{initials(brand)}</span>
        <div style={{ paddingBottom: 4 }}><b style={{ fontSize: 16 }}>{brand}</b><div style={{ fontSize: 12, color: '#667085' }}>{platform} · 12K followers</div></div>
      </div>
      <div style={{ padding: '0 18px 16px' }}><Lines n={2} last="40%" /></div>
    </div>
  );
}

// ---- web & Google Ads ------------------------------------------------------------------------
function WebHero({ src, brand, mobile }) {
  if (mobile) {
    return (
      <Phone>
        <div className="dm-nav" style={{ padding: '8px 12px' }}><b>{brand}</b><span>☰</span></div>
        <Img src={src} />
        <div className="dm-page"><Lines n={3} /><span className="dm-btn">Learn more</span></div>
      </Phone>
    );
  }
  return (
    <Browser url={`www.${slug(brand)}.com`} brand={brand}>
      <Img src={src} />
      <div className="dm-page"><div className="dm-ln d" style={{ width: '40%', height: 12 }} /><Lines n={3} last="70%" /></div>
    </Browser>
  );
}
function BlogHeader({ src, brand }) {
  return (
    <Browser url={`www.${slug(brand)}.com/blog/your-article`} brand={brand}>
      <div className="dm-page" style={{ maxWidth: 560, margin: '0 auto' }}>
        <div className="dm-ln d" style={{ width: '70%', height: 14 }} />
        <div style={{ fontSize: 11, color: '#667085', margin: '6px 0 10px' }}>By {brand} · 5 min read</div>
        <Img src={src} />
        <div style={{ height: 8 }} /><Lines n={5} />
      </div>
    </Browser>
  );
}
function LinkPreview({ src, brand, caption }) {
  return (
    <div className="dm-chat" style={{ maxWidth: 420 }}>
      <div className="dm-bubble" style={{ padding: 4, maxWidth: '88%' }}>
        <div className="dm-link"><Img src={src} /><div className="t"><b>{caption ? caption.slice(0, 60) : brand}</b><small>{slug(brand)}.com</small></div></div>
        <div className="t" style={{ color: '#1d4ed8' }}>https://www.{slug(brand)}.com</div>
      </div>
    </div>
  );
}
function TileGrid({ src, brand }) {
  return (
    <Browser url={`www.${slug(brand)}.com/shop`} brand={brand}>
      <div className="dm-page" style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="dm-card">{i === 1 ? <Img src={src} /> : <div style={{ aspectRatio: '1', background: '#eef0f4' }} />}<div style={{ padding: 8 }}><Lines n={2} last="50%" /></div></div>
        ))}
      </div>
    </Browser>
  );
}
function PromoStrip({ src, brand }) {
  return (
    <div className="dm-browser"><div className="dm-browser__bar"><i /><i /><i /><span className="dm-browser__url">www.{slug(brand)}.com</span></div>
      <Img src={src} />
      <div className="dm-nav"><b>{brand}</b><span>Products</span><span>About</span><span>Contact</span></div>
      <div className="dm-page"><Lines n={4} /></div>
    </div>
  );
}

function px(f) {
  const m = String(f.px || '').match(/(\d+)x(\d+)/);
  return m ? { w: +m[1], h: +m[2] } : null;
}
function AdSlot({ src, size, scale = 1 }) {
  return (
    <span className="dm-ad" style={{ width: size.w * scale }}>
      <span className="dm-ad__tag">Ad</span>
      <img src={resolveAssetUrl(src)} alt="" style={{ width: size.w * scale, height: size.h * scale, objectFit: 'cover' }} />
    </span>
  );
}
function GoogleDisplay({ src, brand, f }) {
  const size = px(f) || { w: 300, h: 250 };
  const ratio = size.w / size.h;
  const responsive = /responsive/.test(f.id);
  const body = <div><div className="dm-ln d" style={{ width: '65%', height: 13 }} /><div style={{ height: 6 }} /><Lines n={4} /></div>;
  if (ratio > 3.5 && !responsive) {
    const scale = Math.min(1, 520 / size.w);
    return (
      <Browser url="www.news-site.com/article" brand="Daily News">
        <div style={{ padding: '10px 16px 0', textAlign: 'center' }}><AdSlot src={src} size={size} scale={scale} /></div>
        <div className="dm-page">{body}<div style={{ height: 8 }} /><Lines n={4} /></div>
      </Browser>
    );
  }
  if (ratio < 0.6) {
    const scale = Math.min(1, 300 / size.h, 150 / size.w * 1.2);
    return (
      <Browser url="www.news-site.com/article" brand="Daily News">
        <div className="dm-page dm-cols">
          <div>{body}<div style={{ height: 8 }} /><Lines n={7} /></div>
          <div style={{ textAlign: 'center' }}><AdSlot src={src} size={size} scale={scale} /></div>
        </div>
      </Browser>
    );
  }
  const scale = Math.min(1, 340 / size.w);
  return (
    <Browser url="www.news-site.com/article" brand="Daily News">
      <div className="dm-page">{body}
        <div style={{ textAlign: 'center', margin: '12px 0' }}><AdSlot src={src} size={size} scale={responsive ? Math.min(1, 380 / size.w) : scale} /></div>
        <Lines n={5} />
      </div>
    </Browser>
  );
}

// ---- email -----------------------------------------------------------------------------------
function EmailView({ src, brand, f, phone }) {
  const head = <div className="dm-email__h"><b>A message from {brand}</b>{brand} &lt;hello@{slug(brand)}.com&gt; · to me</div>;
  const content = (
    <div className="dm-email__body" style={phone ? { padding: 8 } : undefined}>
      <div className="dm-email__in">
        <Img src={src} />
        <div className="dm-email__txt"><div className="dm-ln d" style={{ width: '60%', height: 12 }} /><Lines n={4} /><span className="dm-btn">Shop now</span></div>
      </div>
    </div>
  );
  if (phone) return <Phone>{head}{content}</Phone>;
  return <div className="dm-email">{head}{content}</div>;
}

// ---- print, outdoor, marketplaces ------------------------------------------------------------
function Paper({ src, f, width }) {
  return (
    <div className="dm-desk"><div className="dm-paper" style={{ width }}><Img src={src} /></div></div>
  );
}
function Poster({ src }) {
  return <div className="dm-wall"><div className="dm-frame" style={{ width: 230 }}><Img src={src} /></div></div>;
}
function Rollup({ src }) {
  return (
    <div className="dm-wall" style={{ paddingBottom: 26 }}>
      <div className="dm-standee" style={{ width: 170 }}><div className="dm-standee__top" /><div style={{ boxShadow: '0 14px 30px rgba(0,0,0,.4)', width: '100%' }}><Img src={src} /></div><div className="dm-standee__base" /></div>
    </div>
  );
}
function Hoarding({ src }) {
  return (
    <div className="dm-sky">
      <div className="dm-board" style={{ maxWidth: 560, margin: '0 auto' }}><Img src={src} /></div>
      <div className="dm-poles" style={{ maxWidth: 560, margin: '0 auto' }}><div className="dm-pole" style={{ height: 90 }} /><div className="dm-pole" style={{ height: 90 }} /></div>
    </div>
  );
}
function BusShelter({ src }) {
  return (
    <div className="dm-shelter"><div className="dm-shelter__box" style={{ width: 210 }}><Img src={src} /></div></div>
  );
}
function MarketplaceListing({ src, brand, f }) {
  const amazon = f.platform === 'Amazon';
  return (
    <Browser url={amazon ? 'www.amazon.in/dp/B0EXAMPLE' : 'www.flipkart.com/product'} brand={amazon ? 'amazon' : 'Flipkart'}>
      <div className="dm-listing">
        <div style={{ border: '1px solid #eef0f4' }}><Img src={src} /></div>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>{brand} — Product name goes here</div>
          <div className="dm-stars">★★★★☆ <span style={{ color: '#0e7490' }}>1,284 ratings</span></div>
          <div className="dm-price" style={{ margin: '8px 0' }}>₹1,499 <small style={{ color: '#667085', fontSize: 12, textDecoration: 'line-through' }}>₹1,999</small></div>
          <Lines n={5} />
          <span className="dm-btn" style={{ background: amazon ? '#ffd814' : '#fb641b', color: amazon ? '#111' : '#fff' }}>{amazon ? 'Add to cart' : 'Buy now'}</span>
        </div>
      </div>
    </Browser>
  );
}
function MarketplaceBanner({ src, f, brand }) {
  const amazon = f.platform === 'Amazon';
  const store = /store/.test(f.id);
  return (
    <Browser url={amazon ? (store ? `www.amazon.in/stores/${slug(brand)}` : 'www.amazon.in/dp/B0EXAMPLE') : `www.flipkart.com/${slug(brand)}-store`} brand={amazon ? 'amazon' : 'Flipkart'}>
      <Img src={src} />
      <div className="dm-page" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10 }}>
        {[0, 1, 2, 3].map((i) => <div key={i} className="dm-card"><div style={{ aspectRatio: '1', background: '#eef0f4' }} /><div style={{ padding: 6 }}><Lines n={2} last="50%" /></div></div>)}
      </div>
    </Browser>
  );
}
function GenericBrowser({ src, brand }) {
  return <Browser url={`www.${slug(brand)}.com`} brand={brand}><div className="dm-page"><Img src={src} /></div></Browser>;
}

// ---- routing: format -> mock -----------------------------------------------------------------
function pick(f, view, ctx) {
  const { src, brand, caption } = ctx;
  const id = f.id;
  const p = f.platform;
  if (/_story/.test(id) || id === 'whatsapp_status' || id === 'snapchat_ad') return <Story src={src} brand={brand} platform={p} />;
  if (['facebook_cover', 'linkedin_banner', 'x_header', 'youtube_channel_banner'].includes(id)) return <ProfileCover src={src} brand={brand} platform={p} />;
  if (p === 'Instagram') return view === 'grid' ? <InstagramGrid src={src} brand={brand} /> : <InstagramPost src={src} brand={brand} caption={caption} />;
  if (['Facebook', 'LinkedIn', 'X'].includes(p)) return <FeedCard src={src} brand={brand} caption={caption} platform={p} />;
  if (p === 'Pinterest') return <PinCard src={src} brand={brand} caption={caption} />;
  if (p === 'YouTube') return <YouTubeThumb src={src} brand={brand} caption={caption} />;
  if (id === 'whatsapp_share') return <LinkPreview src={src} brand={brand} caption={caption} />;
  if (id === 'web_og_image') return <LinkPreview src={src} brand={brand} caption={caption} />;
  if (id === 'web_blog_header') return <BlogHeader src={src} brand={brand} />;
  if (id === 'web_square_tile') return <TileGrid src={src} brand={brand} />;
  if (id === 'web_strip') return <PromoStrip src={src} brand={brand} />;
  if (p === 'Website') return <WebHero src={src} brand={brand} mobile={view === 'phone' || id === 'web_hero_mobile'} />;
  if (p === 'Google Ads') return <GoogleDisplay src={src} brand={brand} f={f} />;
  if (p === 'Email') return <EmailView src={src} brand={brand} f={f} phone={view === 'phone'} />;
  if (id === 'print_a3_poster') return <Poster src={src} />;
  if (id === 'print_rollup') return <Rollup src={src} />;
  if (p === 'Print') return <Paper src={src} f={f} width={/landscape/.test(id) ? 420 : id === 'print_dl_flyer' ? 170 : 260} />;
  if (billboardPresetId(id)) return <Hoarding src={src} />;
  if (p === 'Outdoor') return <BusShelter src={src} />;
  if (p === 'Amazon' || p === 'Flipkart') {
    return /main|portrait|product/.test(id) && !/banner|aplus|store|sponsored/.test(id)
      ? <MarketplaceListing src={src} brand={brand} f={f} />
      : <MarketplaceBanner src={src} f={f} brand={brand} />;
  }
  return <GenericBrowser src={src} brand={brand} />;
}

// Which extra views a placement has (first is the default).
function viewsFor(f) {
  const id = f.id;
  const p = f.platform;
  if (p === 'Instagram' && !/_story/.test(id)) return [{ key: 'post', label: 'In feed' }, { key: 'grid', label: 'On profile' }];
  if (p === 'Website' && !['web_blog_header', 'web_og_image', 'web_square_tile', 'web_strip', 'web_hero_mobile'].includes(id)) return [{ key: 'desktop', label: 'Desktop' }, { key: 'phone', label: 'Phone' }];
  if (p === 'Email') return [{ key: 'desktop', label: 'Desktop' }, { key: 'phone', label: 'Phone' }];
  return [];
}

export function canMockup(formatId) {
  return Boolean(formatId);
}

export default function DestinationMockup({ formatId, src, caption }) {
  const { user, customer } = useAuth();
  const brand = user?.company?.name || customer?.name || 'Your brand';
  const f = getFormat(formatId);
  const views = viewsFor(f);
  const [view, setView] = useState(views[0]?.key);
  const current = views.some((v) => v.key === view) ? view : views[0]?.key;

  return (
    <div className="dm">
      <style>{CSS}</style>
      {views.length > 0 && (
        <div className="dm-tabs">
          {views.map((v) => (
            <button key={v.key} type="button" className={`dm-tab ${current === v.key ? 'on' : ''}`} onClick={() => setView(v.key)}>{v.label}</button>
          ))}
        </div>
      )}
      <div className="dm-stage">{pick(f, current, { src, brand, caption })}</div>
      <p className="dm-note">Illustration of {f.platform} · {f.label}. Your creative is shown at its real shape; everything around it is placeholder.</p>
    </div>
  );
}
