import Link from "next/link";
import type { Metadata } from "next";
import { getAllPosts } from "@/lib/blog";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  // 2026-08-13 [m2]: 接尾辞は layout の template "%s | vet402" が付ける。
  // ここに書くと「Blog — vet402 | vet402」になる。
  title: "Blog",
  description: "Notes on agent-to-agent payments, x402, and trust scoring on Base.",
  path: "/blog",
});

export default function BlogIndexPage() {
  const posts = getAllPosts();

  return (
    <main className="mx-auto max-w-3xl space-y-8 p-8">
      <div className="space-y-2">
        <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">vet402</p>
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900">Blog</h1>
        <p className="text-zinc-600">Notes on agent-to-agent payments, x402, and trust scoring on Base.</p>
      </div>

      <ul className="space-y-6">
        {posts.map((post) => (
          <li key={post.slug} className="rounded-lg border border-zinc-200 bg-white p-5">
            <Link href={`/blog/${post.slug}`} className="text-lg font-semibold text-zinc-900 hover:underline">
              {post.title}
            </Link>
            <p className="mt-1 text-sm text-zinc-500">{post.publishedAt}</p>
            <p className="mt-2 text-sm text-zinc-600">{post.description}</p>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap gap-3 text-sm">
        <Link href="/" className="underline">
          Home
        </Link>
        <Link href="/docs/api" className="underline">
          API reference
        </Link>
      </div>
    </main>
  );
}
