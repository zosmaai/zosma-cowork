import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import Image from "next/image";

export const layoutConfig: BaseLayoutProps = {
  nav: {
    title: (
      <div className="flex items-center gap-2.5">
        <Image
          src="/logo.png"
          alt=""
          width={26}
          height={26}
          className="rounded-md flex-shrink-0"
          aria-hidden="true"
        />
        <span
          className="font-semibold text-[15px] tracking-tight"
          style={{ fontFamily: "var(--font-chakra-petch), var(--font-display)" }}
        >
          Zosma Cowork
        </span>
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
      text: "README",
      url: "https://github.com/zosmaai/zosma-cowork#readme",
      external: true,
    },
    {
      text: "GitHub",
      url: "https://github.com/zosmaai/zosma-cowork",
      external: true,
    },
  ],
};
