import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

export const layoutConfig: BaseLayoutProps = {
  nav: {
    title: (
      <div className="flex items-center gap-2">
        <svg
          width="20"
          height="20"
          viewBox="0 0 200 200"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="size-5"
          aria-label="Zosma Cowork logo"
        >
          <defs>
            <linearGradient id="navLogo" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#7c3aed" />
              <stop offset="100%" stopColor="#a78bfa" />
            </linearGradient>
          </defs>
          <rect
            x="20"
            y="20"
            width="160"
            height="160"
            rx="32"
            stroke="url(#navLogo)"
            strokeWidth="3"
            fill="none"
            opacity="0.3"
          />
          <rect
            x="55"
            y="55"
            width="90"
            height="90"
            rx="16"
            stroke="url(#navLogo)"
            strokeWidth="2"
            fill="none"
          />
          <rect
            x="80"
            y="80"
            width="40"
            height="40"
            rx="8"
            fill="url(#navLogo)"
            opacity="0.9"
          />
        </svg>
        <span className="font-semibold text-base">Zosma Cowork</span>
      </div>
    ),
  },
  links: [
    {
      text: "Docs",
      url: "/docs/getting-started",
      active: "nested-url",
    },
    {
      text: "GitHub",
      url: "https://github.com/zosmaai/zosma-cowork",
      external: true,
    },
  ],
};
