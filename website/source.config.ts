import { remarkHeading } from "fumadocs-core/mdx-plugins";
import { defineConfig, defineDocs } from "fumadocs-mdx/config";

export const docs = defineDocs({
  // MDX content lives in website/content/ — keeps it isolated from
  // internal planning docs in docs/plans/ at the repo root.
  dir: "./content",
});

export default defineConfig({
  mdxOptions: {
    remarkPlugins: [remarkHeading],
  },
});
