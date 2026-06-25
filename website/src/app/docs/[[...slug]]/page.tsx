import { source } from "@/lib/source";
import {
  DocsPage,
  DocsBody,
  DocsDescription,
  DocsTitle,
} from "fumadocs-ui/page";
import { notFound } from "next/navigation";
import { getMDXComponents } from "../../../../mdx-components";

interface PageProps {
  params: Promise<{
    slug?: string[];
  }>;
}

export async function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(props: PageProps) {
  const params = await props.params;
  const page = source.getPage(params.slug);

  if (!page) return {};

  return {
    title: page.data.title as string,
    description: page.data.description as string,
  };
}

export default async function Page(props: PageProps) {
  const params = await props.params;
  const page = source.getPage(params.slug);

  if (!page) notFound();

  const MDX = page.data.body as React.ComponentType<{
    components?: Record<string, unknown>;
  }>;

  return (
    <DocsPage
      toc={page.data.toc as []}
      full={(page.data.full as boolean) ?? false}
    >
      <DocsTitle>{page.data.title as string}</DocsTitle>
      <DocsDescription>{page.data.description as string}</DocsDescription>
      <DocsBody>
        <MDX components={getMDXComponents() as Record<string, unknown>} />
      </DocsBody>
    </DocsPage>
  );
}
