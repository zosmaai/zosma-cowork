interface Props {
  label: string;
}

export function ZosmaLoadingState({ label }: Props) {
  return (
    <div className="workspace-placeholder" role="status" aria-live="polite" aria-label={label}>
      <div className="workspace-placeholder-brand">
        <span className="workspace-placeholder-logo zosma-brand" aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="zosma-brand-mark" src="/zosma-logo.png" alt="" width={42} height={42} />
        </span>
        <span className="workspace-placeholder-name">Zosma Harness</span>
      </div>
      <div className="workspace-placeholder-loading">
        <span className="workspace-placeholder-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        {label}
      </div>
    </div>
  );
}
