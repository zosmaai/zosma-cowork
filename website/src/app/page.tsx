import Link from "next/link";
import Image from "next/image";
import { HomeLayout } from "fumadocs-ui/layouts/home";
import { layoutConfig } from "@/app/layout.config";

export default function HomePage() {
  return (
    <HomeLayout {...layoutConfig}>
      {/* ── Hero ── */}
      <section className="aurora-bg relative flex flex-col items-center text-center px-4 pt-20 pb-12 sm:pt-28 sm:pb-16">
        {/* Content */}
        <div className="relative z-10 flex flex-col items-center gap-6 max-w-2xl">
          {/* Logo mark */}
          <Image
            src="/logo.png"
            alt="Zosma Cowork"
            width={64}
            height={64}
            className="rounded-xl"
            priority
          />

          {/* Headline */}
          <h1
            className="text-4xl sm:text-5xl font-bold leading-tight text-foreground"
            style={{
              fontFamily: "var(--font-chakra-petch), var(--font-display)",
              letterSpacing: "-0.02em",
              textWrap: "balance",
            }}
          >
            Your desktop AI coworker.
          </h1>

          {/* Sub */}
          <p
            className="text-base sm:text-lg text-muted-foreground leading-relaxed max-w-lg"
            style={{ maxWidth: "58ch" }}
          >
            Sessions tied to your folders. Streaming responses, tool-call
            timelines, and 20+ LLM providers in one native desktop app — no
            terminal required.
          </p>

          {/* CTAs */}
          <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
            <Link
              href="/docs/getting-started"
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground px-5 py-2.5 text-sm font-semibold hover:opacity-90 transition-opacity"
              style={{ fontFamily: "var(--font-chakra-petch)" }}
            >
              Read the docs
            </Link>
            <a
              href="https://github.com/zosmaai/zosma-cowork"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-5 py-2.5 text-sm font-medium text-foreground hover:bg-accent transition-colors"
            >
              <GitHubIcon />
              View on GitHub
            </a>
            <a
              href="https://github.com/zosmaai/zosma-cowork#readme"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-5 py-2.5 text-sm font-medium text-foreground hover:bg-accent transition-colors"
            >
              <BookIcon />
              README
            </a>
          </div>

          {/* Localized README links */}
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 pt-0.5">
            <span className="text-xs text-muted-foreground/60">README in:</span>
            {README_LANGS.map(({ lang, href, label }) => (
              <a
                key={lang}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                aria-label={`README in ${lang}`}
              >
                {label}
              </a>
            ))}
          </div>
        </div>

        {/* App screenshot */}
        <div className="relative z-10 mt-12 w-full max-w-4xl">
          <div className="brand-frame">
            <Image
              src="/app-screenshot.png"
              alt="Zosma Cowork — session view showing a multi-turn chat with code generation"
              width={1500}
              height={940}
              className="w-full h-auto block"
              priority
            />
          </div>
        </div>
      </section>

      {/* ── Feature strip ── */}
      <section className="px-4 py-16 sm:py-20">
        <div className="max-w-4xl mx-auto">
          <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-border">
            <Feature
              label="Per-session workspaces"
              body="Every session is bound to a folder. The agent knows where it is. Context stays where you left it."
            />
            <Feature
              label="20+ LLM providers"
              body="OpenAI, Anthropic, Google, Groq, Mistral, DeepSeek. Your API keys. Switch providers mid-session."
            />
            <Feature
              label="pi extensions"
              body="Community skills and tools connect via a subprocess protocol. Install them, or write your own."
            />
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-border px-4 py-7">
        <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <span style={{ fontFamily: "var(--font-chakra-petch)" }}>
            Zosma Cowork — {new Date().getFullYear()} Zosma AI
          </span>
          <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
            <Link
              href="/docs/getting-started"
              className="hover:text-foreground transition-colors"
            >
              Docs
            </Link>
            <a
              href="https://github.com/zosmaai/zosma-cowork#readme"
              className="hover:text-foreground transition-colors"
              target="_blank"
              rel="noopener noreferrer"
            >
              README
            </a>
            <a
              href="https://github.com/zosmaai/zosma-cowork"
              className="hover:text-foreground transition-colors"
              target="_blank"
              rel="noopener noreferrer"
            >
              GitHub
            </a>
            <a
              href="https://zosma.ai"
              className="hover:text-foreground transition-colors"
              target="_blank"
              rel="noopener noreferrer"
            >
              Zosma AI
            </a>
          </div>
        </div>
      </footer>
    </HomeLayout>
  );
}

/* ── Sub-components ── */

function Feature({ label, body }: { label: string; body: string }) {
  return (
    <div className="px-4 sm:px-6 py-8 sm:first:pl-0 sm:last:pr-0">
      <p
        className="text-sm font-semibold text-primary mb-2"
        style={{ fontFamily: "var(--font-chakra-petch)" }}
      >
        {label}
      </p>
      <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
    </div>
  );
}

function GitHubIcon() {
  return (
    <svg
      className="size-4"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}

function BookIcon() {
  return (
    <svg
      className="size-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  );
}

/* ── Data ── */

const README_LANGS = [
  { lang: "English",    label: "EN", href: "https://github.com/zosmaai/zosma-cowork/blob/main/README.md" },
  { lang: "Chinese",    label: "中文", href: "https://github.com/zosmaai/zosma-cowork/blob/main/README.zh.md" },
  { lang: "Spanish",    label: "ES", href: "https://github.com/zosmaai/zosma-cowork/blob/main/README.es.md" },
  { lang: "Japanese",   label: "日本語", href: "https://github.com/zosmaai/zosma-cowork/blob/main/README.ja.md" },
  { lang: "German",     label: "DE", href: "https://github.com/zosmaai/zosma-cowork/blob/main/README.de.md" },
  { lang: "French",     label: "FR", href: "https://github.com/zosmaai/zosma-cowork/blob/main/README.fr.md" },
  { lang: "Portuguese", label: "PT", href: "https://github.com/zosmaai/zosma-cowork/blob/main/README.pt.md" },
  { lang: "Russian",    label: "RU", href: "https://github.com/zosmaai/zosma-cowork/blob/main/README.ru.md" },
  { lang: "Korean",     label: "한국어", href: "https://github.com/zosmaai/zosma-cowork/blob/main/README.ko.md" },
  { lang: "Hindi",      label: "हिंदी", href: "https://github.com/zosmaai/zosma-cowork/blob/main/README.hi.md" },
];
