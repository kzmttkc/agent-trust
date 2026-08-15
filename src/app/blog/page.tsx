import Link from "next/link";
import type { Metadata } from "next";
import { getAllPosts } from "@/lib/blog";
import { SITE_URL } from "@/lib/site-url";

export const metadata: Metadata = {
  // 2026-08-13 [m2]: 接尾辞は layout の template "%s | vet402" が付ける。
  // ここに書くと「Blog — vet402 | vet402」になる。
  title: "Blog",
  description: "Notes on agent-to-agent payments, x402, and trust scoring on Base.",
  alternates: { canonical: `${SITE_URL}/blog` },
};

export default function BlogIndexPage() {
  const posts = getAllPosts();

  return (
    <main className="px-4 pt-8 pb-4 sm:px-6 md:px-8 md:pt-12">
      <article className="sheet">
        <div className="doc-head">
          <div className="doc-head-col">
            <span>Independent Measurement</span>
            <span>Notes: agent-to-agent payments, x402</span>
            <span>
              Entries: <span className="text-signal">{posts.length}</span>
            </span>
          </div>
          <div className="doc-head-col">
            <span>vet402</span>
            <span>Building in public</span>
            <span>Trust scoring on Base</span>
          </div>
        </div>

        <h1 className="doc-title mt-10">Blog</h1>
        <div className="rule-double mx-auto mt-6 w-full max-w-[34ch]" />

        <div className="mt-8 flex flex-col gap-1 sm:flex-row sm:gap-0">
          <p className="shrink-0 text-brand-deep sm:w-[10ch]">Abstract</p>
          <p className="min-w-0 max-w-[62ch] text-brand">
            Notes on agent-to-agent payments, x402, and trust scoring on Base.
          </p>
        </div>

        <div className="mt-10 divide-y divide-hair border-t border-brand-deep">
          {posts.map((post) => (
            <Link
              key={post.slug}
              href={`/blog/${post.slug}`}
              className="group block py-5"
            >
              <p className="text-[0.8125rem] text-brand-lift">{post.publishedAt}</p>
              <p className="mt-1 font-[family-name:var(--font-display)] font-semibold text-brand-deep underline decoration-brand-mist decoration-1 underline-offset-[0.22em] group-hover:decoration-brand-deep">
                {post.title}
              </p>
              <p className="mt-2 max-w-[64ch] text-brand">{post.description}</p>
            </Link>
          ))}
        </div>

        <p className="mt-8 text-[0.8125rem]">
          <Link href="/" className="doc-link">
            Home
          </Link>
          <span aria-hidden="true" className="mx-2 text-brand-lift">
            ·
          </span>
          <Link href="/docs/api" className="doc-link">
            API reference
          </Link>
        </p>
      </article>
    </main>
  );
}
