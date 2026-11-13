import React from 'react';

export default function NewsCard({ title, desc, source, time, image, url }) {
  const Wrapper = url ? 'a' : 'div';
  const wrapperProps = url
    ? { href: url, target: '_blank', rel: 'noopener noreferrer', className: 'news-card news-card--link' }
    : { className: 'news-card' };

  return (
    <Wrapper {...wrapperProps}>
      {image ? (
        <img className="news-thumb news-thumb--img" src={image} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.nextSibling.style.display = 'block'; }} />
      ) : null}
      <div className="news-thumb" style={image ? { display: 'none' } : undefined} />
      <div>
        <h3>{title}</h3>
        <p>{desc}</p>
        <span className="news-card__meta">
          {source} · {time}
          {url && <span className="news-card__link-hint"> · Read source ↗</span>}
        </span>
      </div>
    </Wrapper>
  );
}
