import { source } from "@/lib/source";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import type { ReactNode } from "react";
import { layoutConfig } from "@/app/layout.config";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout {...layoutConfig} tree={source.getPageTree()}>
      {children}
    </DocsLayout>
  );
}
