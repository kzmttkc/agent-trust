import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { getAllPosts, getPostBySlug } from "@/lib/blog";
import { SITE_URL } from "@/lib/site-url";
import { safeJsonLd } from "@/lib/util/json-ld";
import { breadcrumbJsonLd } from "@/lib/seo";

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
      siteName: "vet402",
      publishedTime: post.publishedAt,
      modifiedTime: post.updatedAt,
    },
    // 2026-08-14: twitter を未設定のままだと layout 既定（LP の題名）が出る。
    twitter: {
      card: "summary_large_image",
      title: post.title,
      description: post.description,
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
    // 2026-08-14: author/image は BlogPosting の推奨フィールド。author は
    // 擬名運用なので発行主体の Organization を充てる（新しい主張は足さない）。
    // image はファイル規約の og 画像（RFC 第1頁の組版）をそのまま指す。
    author: { "@type": "Organization", name: "vet402", url: SITE_URL },
    image: `${SITE_URL}/opengraph-image.png`,
    mainEntityOfPage: { "@type": "WebPage", "@id": `${SITE_URL}/blog/${post.slug}` },
    publisher: { "@type": "Organization", name: "vet402", url: SITE_URL },
    url: `${SITE_URL}/blog/${post.slug}`,
  };
  const breadcrumb = breadcrumbJsonLd([
    { name: "Home", path: "/" },
    { name: "Blog", path: "/blog" },
    { name: post.title, path: `/blog/${post.slug}` },
  ]);

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-8">
      <script
        type="application/ld+json"
        nonce={nonce}
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: safeJsonLd(breadcrumb) }}
      />
      <script
        type="application/ld+json"
        nonce={nonce}
        // Browsers blank the reflected `nonce` attribute right after the
        // element is inserted (a CSP anti-exfiltration measure), which
        // otherwise trips a harmless React hydration-mismatch warning here.
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: safeJsonLd(jsonLd) }}
      />

      <div className="space-y-2">
        <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">vet402</p>
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900">{post.title}</h1>
        <p className="text-sm text-zinc-500">
          Published {post.publishedAt}
          {post.updatedAt !== post.publishedAt ? ` · Updated ${post.updatedAt}` : ""}
        </p>
      </div>

      {post.editorsNote ? (
        <p className="text-sm italic text-zinc-500">{post.editorsNote}</p>
      ) : null}

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
