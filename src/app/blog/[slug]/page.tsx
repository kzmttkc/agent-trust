import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getAllPosts, getPostBySlug } from "@/lib/blog";

const SITE_URL = "https://agent-trust-tawny.vercel.app";

export function generateStaticParams() {
  return getAllPosts().map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) return {};

  return {
    title: `${post.title} — Vouch`,
    description: post.description,
    alternates: { canonical: `${SITE_URL}/blog/${post.slug}` },
    openGraph: {
      type: "article",
      title: post.title,
      description: post.description,
      url: `${SITE_URL}/blog/${post.slug}`,
      publishedTime: post.publishedAt,
      modifiedTime: post.updatedAt,
    },
  };
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) notFound();

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.description,
    datePublished: post.publishedAt,
    dateModified: post.updatedAt,
    mainEntityOfPage: { "@type": "WebPage", "@id": `${SITE_URL}/blog/${post.slug}` },
    publisher: { "@type": "Organization", name: "Vouch", url: SITE_URL },
    url: `${SITE_URL}/blog/${post.slug}`,
  };

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <div className="space-y-2">
        <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">Vouch</p>
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900">{post.title}</h1>
        <p className="text-sm text-zinc-500">
          Published {post.publishedAt}
          {post.updatedAt !== post.publishedAt ? ` · Updated ${post.updatedAt}` : ""}
        </p>
      </div>

      <article className="space-y-4 text-zinc-700 leading-relaxed">
        {post.body.map((paragraph, i) => (
          <p key={i}>{paragraph}</p>
        ))}
      </article>

      <div className="flex flex-wrap gap-3 border-t border-zinc-200 pt-6 text-sm">
        <Link href="/blog" className="underline">
          All posts
        </Link>
        <Link href="/docs/api" className="underline">
          API reference
        </Link>
        <Link href="/signup" className="underline">
          Get an API key
        </Link>
      </div>
    </main>
  );
}
