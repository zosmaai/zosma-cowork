import Link from "next/link";
import { HomeLayout } from "fumadocs-ui/layouts/home";
import { layoutConfig } from "@/app/layout.config";

export default function HomePage() {
  return (
    <HomeLayout {...layoutConfig}>
      {/* Hero */}
      <section className="flex flex-col items-center justify-center px-4 pt-24 pb-16 sm:pt-32 sm:pb-20">
        <div className="flex flex-col items-center gap-6 max-w-3xl text-center">
          <svg
            width="96"
            height="96"
            viewBox="0 0 200 200"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-label="Zosma Cowork logo"
          >
            <defs>
              <linearGradient id="heroLogo" x1="0" y1="0" x2="1" y2="1">
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
              stroke="url(#heroLogo)"
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
              stroke="url(#heroLogo)"
              strokeWidth="2"
              fill="none"
            />
            <rect
              x="80"
              y="80"
              width="40"
              height="40"
              rx="8"
              fill="url(#heroLogo)"
              opacity="0.9"
            />
          </svg>

          <div className="flex flex-col gap-4">
            <h1 className="text-5xl font-bold tracking-tight sm:text-6xl lg:text-7xl">
              Zosma Cowork
            </h1>
            <p className="text-lg sm:text-xl text-muted-foreground max-w-xl mx-auto leading-relaxed">
              Your desktop AI coworker. Powered by pi-mono — sessions, tools, and
              20+ LLM providers in one native app.
            </p>
          </div>

          <div className="flex flex-wrap gap-4 justify-center pt-2">
            <Link
              href="/docs/getting-started"
              className="inline-flex items-center justify-center rounded-lg bg-primary text-primary-foreground px-6 py-3 text-sm font-medium hover:opacity-90 transition-all"
            >
              Get Started
            </Link>
            <Link
              href="https://github.com/zosmaai/zosma-cowork"
              className="inline-flex items-center justify-center rounded-lg border border-border bg-card text-card-foreground px-6 py-3 text-sm font-medium hover:bg-accent transition-colors"
            >
              <svg
                className="w-4 h-4 mr-2"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-label="GitHub"
              >
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
              </svg>
              GitHub
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border px-4 py-8 mt-auto">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <span>Zosma Cowork — {new Date().getFullYear()} Zosma AI</span>
          <div className="flex items-center gap-6">
            <Link
              href="/docs/getting-started"
              className="hover:text-foreground transition-colors"
            >
              Docs
            </Link>
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
