"use client";

import { useEffect } from "react";
import { motion, useReducedMotion, useSpring, useTransform } from "motion/react";

/**
 * Spring-driven number (React Bits "Counter" feel): the value glides to its target instead of
 * snapping, and lands exactly. Reduced motion jumps straight to the value.
 */
export function AnimatedNumber({
  value,
  digits = 0,
  className,
}: {
  value: number;
  digits?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const spring = useSpring(value, { stiffness: 140, damping: 26, mass: 0.6 });
  const text = useTransform(spring, (v) =>
    v.toLocaleString("tr-TR", { minimumFractionDigits: digits, maximumFractionDigits: digits }),
  );

  useEffect(() => {
    if (reduce) spring.jump(value);
    else spring.set(value);
  }, [value, reduce, spring]);

  return (
    <span className={`tabular-nums ${className ?? ""}`}>
      <motion.span aria-hidden="true">{text}</motion.span>
      <span className="sr-only">
        {value.toLocaleString("tr-TR", { minimumFractionDigits: digits, maximumFractionDigits: digits })}
      </span>
    </span>
  );
}
