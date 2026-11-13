import React, { useEffect, useMemo, useRef } from 'react';
import Lottie from 'lottie-react';
import panelGraphic from '../../assets/panel-graphic.json';

/**
 * The decorative graphic under the main button in the right-hand panel (Automatr prototype 4, "Frame 34").
 * It plays once, the first time it is mostly in view, and then rests on its last frame - it never loops and
 * never restarts (not on button presses, nor when the person comes back to the screen).
 */
export default function PanelArt() {
  const lottieRef = useRef(null);
  const boxRef = useRef(null);
  const played = useRef(false);
  // lottie-web mutates the data it is given, so every instance gets its own copy
  const data = useMemo(() => JSON.parse(JSON.stringify(panelGraphic)), []);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return undefined;
    const still = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    function play() {
      const anim = lottieRef.current;
      if (played.current || !anim) return;
      played.current = true;
      if (still) anim.goToAndStop(Math.max(0, (anim.getDuration?.(true) || 120) - 1), true);
      else anim.goToAndPlay(0, true);
    }
    if (!('IntersectionObserver' in window)) { play(); return undefined; }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting && e.intersectionRatio >= 0.6) { play(); io.disconnect(); } });
    }, { threshold: [0, 0.6, 1] });
    io.observe(box);
    return () => io.disconnect();
  }, []);

  return (
    <div className="panel-art panel-art--lottie" ref={boxRef} aria-hidden="true">
      <Lottie
        lottieRef={lottieRef}
        animationData={data}
        loop={false}
        autoplay={false}
        rendererSettings={{ preserveAspectRatio: 'xMidYMid slice' }}
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  );
}
