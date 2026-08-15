import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { getAllPosts, getPostBySlug } from "@/lib/blog";
import { SITE_URL } from "@/lib/site-url";
import { safeJsonLd } from "@/lib/util/json-ld";

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
    // 2026-08-13 UX監査2巡目 [m2]: ここで " — vet402" を足したうえに、
    // layout の template "%s | vet402" が更に足していたので、タブは
    // 「… — vet402 | vet402」になっていた。接尾辞は template の1本だけにする。
    title: post.title,
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

  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.description,
    datePublished: post.publishedAt,
    dateModified: post.updatedAt,
    mainEntityOfPage: { "@type": "WebPage", "@id": `${SITE_URL}/blog/${post.slug}` },
    publisher: { "@type": "Organization", name: "vet402", url: SITE_URL },
    url: `${SITE_URL}/blog/${post.slug}`,
  };

  return (
    <main className="px-4 pt-8 pb-4 sm:px-6 md:px-8 md:pt-12">
      <script
        type="application/ld+json"
        nonce={nonce}
        // Browsers blank the reflected `nonce` attribute right after the
        // element is inserted (a CSP anti-exfiltration measure), which
        // otherwise trips a harmless React hydration-mismatch warning here.
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: safeJsonLd(jsonLd) }}
      />

      <article className="sheet">
        <div className="doc-head">
          <div className="doc-head-col">
            <span>Independent Measurement</span>
            <span>Blog post</span>
            <span>Published: {post.publishedAt}</span>
          </div>
          <div className="doc-head-col">
            <span>vet402</span>
            <span>Building in public</span>
            {post.updatedAt !== post.publishedAt ? <span>Updated: {post.updatedAt}</span> : null}
          </div>
        </div>

        <h1 className="doc-title mt-10">{post.title}</h1>
        <div className="rule-double mx-auto mt-6 w-full max-w-[34ch]" />

        {post.editorsNote ? (
          <p className="doc-note mx-auto mt-6 max-w-[64ch] text-center italic">
            {post.editorsNote}
          </p>
        ) : null}

        <div className="mx-auto mt-8 max-w-[64ch] space-y-4">
          {post.body.map((paragraph, i) => (
            <p key={i} className="text-brand">
              {paragraph}
            </p>
          ))}
        </div>

        <p className="rule-single mt-10 pt-6 text-[0.8125rem]">
          <Link href="/blog" className="doc-link">
            All posts
          </Link>
          <span aria-hidden="true" className="mx-2 text-brand-lift">
            ·
          </span>
          <Link href="/docs/api" className="doc-link">
            API reference
          </Link>
          <span aria-hidden="true" className="mx-2 text-brand-lift">
            ·
          </span>
          <Link href="/signup" className="doc-link">
            Get an API key
          </Link>
        </p>
      </article>
    </main>
  );
}
