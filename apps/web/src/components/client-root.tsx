"use client";

import { useEffect } from "react";
import { MotionConfig } from "motion/react";

/**
 * App-wide client concerns: Motion honours prefers-reduced-motion, and the
 * Liquid-Glass refraction (SVG displacement in backdrop-filter) is switched on
 * only where it renders correctly (Chromium); elsewhere glass stays a plain blur.
 */
export function ClientRoot({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const brands = (navigator as Navigator & { userAgentData?: { brands: { brand: string }[] } }).userAgentData?.brands;
    if (brands?.some((b) => b.brand === "Chromium")) document.documentElement.dataset.refract = "";
  }, []);

  return (
    <MotionConfig reducedMotion="user">
      <svg aria-hidden="true" width="0" height="0" className="absolute">
        <filter id="fg-refract" x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.006 0.011" numOctaves="2" seed="11" result="noise" />
          <feGaussianBlur in="noise" stdDeviation="2.5" result="soft" />
          <feDisplacementMap in="SourceGraphic" in2="soft" scale="16" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </svg>
      {children}
    </MotionConfig>
  );
}
