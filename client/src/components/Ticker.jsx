import React from 'react';

export default function Ticker({ industry, tickers = [] }) {
  const doubled = [...tickers, ...tickers];

  return (
    <div className="ticker">
      <div className="ticker__label">
        <svg viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 17 9 11l4 4 8-9" /></svg>
        <span>{industry}</span>
      </div>
      <div className="ticker__track-wrap">
        <div className="ticker__track">
          {doubled.map((t, i) => {
            const dir = t.change >= 0 ? 'up' : 'down';
            const arrow = t.change >= 0 ? '▲' : '▼';
            return (
              <div className={`ticker-item ${dir}`} key={`${t.symbol}-${i}`}>
                <strong>{t.symbol}</strong>
                <span>${Number(t.price).toFixed(2)}</span>
                <span className="chg">{arrow} {Math.abs(t.change).toFixed(1)}%</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
