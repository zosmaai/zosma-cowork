"use client";

import { useEffect, useState } from "react";

/**
 * pi-tui's Loader frames (packages/pi-tui src/components/loader.ts): a braille
 * spinner stepped every 80ms. Used wherever the UI is waiting on the agent so
 * the web app reads the same as pi's sidebar chat instead of a circular arc.
 */
export const PI_LOADER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const PI_LOADER_INTERVAL_MS = 80;

export function PiLoader({ size = 14, className = "" }: { size?: number; className?: string }) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const id = setInterval(
      () => setFrame((current) => (current + 1) % PI_LOADER_FRAMES.length),
      PI_LOADER_INTERVAL_MS,
    );
    return () => clearInterval(id);
  }, []);

  return (
    <span
      data-pi-loader
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center leading-none ${className}`}
      style={{ fontSize: size }}
    >
      {PI_LOADER_FRAMES[frame]}
    </span>
  );
}
