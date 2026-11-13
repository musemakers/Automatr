import React from 'react';
import logoLight from '../assets/logo.svg'; // white wordmark - for dark surfaces (sidebar, login panel)
import logoInk from '../assets/logo-ink.svg'; // same logo in ink - for light surfaces

// The AUTOMATr wordmark (blue "O" with sparkles). Single source for every place the brand is shown.
export default function BrandLogo({ tone = 'light', className = '', ...rest }) {
  return (
    <img
      className={`brand__logo ${className}`.trim()}
      src={tone === 'dark' ? logoInk : logoLight}
      alt="AUTOMATr"
      width="184"
      height="26"
      draggable={false}
      {...rest}
    />
  );
}
