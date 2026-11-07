"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion, useDragControls, type PanInfo } from "motion/react";

const spring = { type: "spring", stiffness: 420, damping: 40, mass: 0.9 } as const;

/**
 * Bottom drawer for phones: the `peek` part always shows (mode switch, timeline), the rest slides
 * up on a drag of the handle or a tap. Reports its visible height so map controls can sit above it.
 */
export function MobileSheet({
  peek,
  children,
  label,
  onPeekHeight,
}: {
  peek: React.ReactNode;
  children: React.ReactNode;
  label: string;
  onPeekHeight: (px: number) => void;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const peekRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [dims, setDims] = useState({ sheet: 0, peek: 0 });
  // first placement jumps into position; later changes spring
  const [placed, setPlaced] = useState(false);
  const controls = useDragControls();

  useLayoutEffect(() => {
    const sheet = sheetRef.current;
    const pk = peekRef.current;
    if (!sheet || !pk) return;
    const measure = () => setDims({ sheet: sheet.offsetHeight, peek: pk.offsetTop + pk.offsetHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(sheet);
    ro.observe(pk);
    const raf = requestAnimationFrame(() => setPlaced(true));
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, []);

  useEffect(() => onPeekHeight(dims.peek + 8), [dims.peek, onPeekHeight]);

  const closedY = Math.max(0, dims.sheet - dims.peek);
  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y < -40 || info.velocity.y < -400) setOpen(true);
    else if (info.offset.y > 40 || info.velocity.y > 400) setOpen(false);
  };

  return (
    <motion.section
      ref={sheetRef}
      aria-label={label}
      className="glass absolute inset-x-2 bottom-2 z-20 flex max-h-[82dvh] flex-col rounded-[26px] pb-[env(safe-area-inset-bottom)]"
      initial={false}
      style={{ visibility: dims.sheet ? "visible" : "hidden" }}
      animate={{ y: open ? 0 : closedY }}
      transition={placed ? spring : { duration: 0 }}
      drag="y"
      dragControls={controls}
      dragListener={false}
      dragConstraints={{ top: 0, bottom: closedY }}
      dragElastic={0.06}
      dragMomentum={false}
      onDragEnd={onDragEnd}
    >
      <div ref={peekRef} className="shrink-0 px-4 pb-3">
        {/* only the handle strip drags, so the slider and buttons below keep their own gestures */}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          onPointerDown={(e) => controls.start(e)}
          aria-expanded={open}
          aria-label={open ? "Paneli küçült" : "Paneli genişlet"}
          className="-mx-4 flex h-7 w-[calc(100%+2rem)] cursor-grab touch-none items-center justify-center active:cursor-grabbing"
        >
          <motion.span
            className="block h-1 w-10 rounded-full bg-white/30"
            animate={{ width: open ? 28 : 40 }}
            transition={spring}
          />
        </button>
        {peek}
      </div>
      <div
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-line px-4 pb-4 pt-4"
        inert={!open}
      >
        {children}
      </div>
    </motion.section>
  );
}
