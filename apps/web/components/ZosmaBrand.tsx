interface ZosmaBrandProps {
  className?: string;
}

export function ZosmaBrand({ className }: ZosmaBrandProps) {
  return (
    <span
      className={`zosma-brand${className ? ` ${className}` : ""}`}
      aria-label="zosma.ai"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className="zosma-brand-mark"
        src="/zosma-logo.png"
        alt=""
        width={28}
        height={28}
      />
      <span className="zosma-brand-name">zosma.ai</span>
    </span>
  );
}
