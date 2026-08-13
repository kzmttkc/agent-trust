import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { isValidAddress } from "@/lib/chain/client";
import TrackView from "@/components/site/TrackView";
import { buttonClass } from "@/components/ui/Button";

/**
 * /payee — the entry point for the working demo.
 *
 * 2026-08-13: this route did not exist. `/payee/[address]` was reachable only
 * if you already had an address to type into the URL bar, so the one live,
 * public, no-account-needed surface the product has had no front door — and the
 * approved LP pins a "Verify a payee now" CTA to exactly this path.
 *
 * The form is a plain GET with `action="/payee"`, so it submits and lands on a
 * profile with JavaScript disabled — same discipline as the rest of the public
 * surface. The redirect happens on the server, from the query string.
 */

/**
 * 試せる実アドレス（2026-08-13 UX監査R1 [C3]）。
 *
 * 出典は src/lib/benchmark/dataset.ts の KNOWN_GOOD — 公開情報で帰属が判明
 * している、長く動いているアドレス。3件に絞っているのは、入口の紙面で
 * 一覧を作るのが目的ではなく「1つ踏めば製品が見える」ことが目的だから。
 * 説明文は dataset.ts の source / reason をそのまま短くしたもので、
 * 新しい主張は足していない。
 */
const SAMPLE_PAYEES = [
  {
    address: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
    note: "ENS primary name on-chain: vitalik.eth",
  },
  {
    address: "0xde0b295669a9fd93d5f28d9ec85e40f4cb697bae",
    note: "Ethereum Foundation, publicly documented since 2015",
  },
  {
    address: "0xf977814e90da44bfa03b6295a0616a897441acec",
    note: "Binance cold wallet, from their 2022 proof-of-reserves disclosure",
  },
];

export const metadata: Metadata = {
  title: "Verify a payee",
  description:
    "Look up any Base wallet address: the signature-proven identity claim on file, if there is one, and a live payee score.",
};

export default async function PayeeIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ address?: string | string[] }>;
}) {
  const raw = (await searchParams).address;
  const submitted = (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? "";

  if (submitted && isValidAddress(submitted)) {
    redirect(`/payee/${submitted.toLowerCase()}`);
  }
  const invalid = submitted.length > 0;

  return (
    <main className="px-4 pt-8 pb-4 sm:px-6 md:px-8 md:pt-12">
      <TrackView event="payee_lookup_view" />
      <article className="sheet">
        <div className="doc-head">
          <div className="doc-head-col">
            <span>Verified Payee</span>
            {/* 2026-08-13 [M5]: "Level: L0 identity claim" をやめた。LP §2 の
                L0 は Liveness で、同じ記号が別の意味で2箇所にあった。 */}
            <span>Claim: wallet control by signature</span>
          </div>
          <div className="doc-head-col">
            <span>vet402</span>
            <span>
              {/* この頁のシアン1点。鍵が要らないという事実。 */}
              Access: <span className="text-signal">no account required</span>
            </span>
          </div>
        </div>

        <h1 className="doc-title mt-8">Verify a payee</h1>
        <p className="mx-auto mt-3 max-w-[56ch] text-center text-brand-lift">
          Who controls this wallet, and what did the record say the last time we looked?
        </p>
        <div className="rule-double mx-auto mt-6 w-full max-w-[34ch]" />

        <form method="get" action="/payee" className="mt-10">
          <label htmlFor="address" className="doc-caption block">
            Base wallet address
          </label>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row">
            <input
              id="address"
              name="address"
              type="text"
              inputMode="text"
              autoComplete="off"
              spellCheck={false}
              defaultValue={submitted}
              placeholder="0x0000000000000000000000000000000000000000"
              aria-describedby={invalid ? "address-error" : "address-hint"}
              aria-invalid={invalid || undefined}
              // 2026-08-13 アクセシビリティ監査 [E3]: バリデーション失敗後、
              // document.activeElement が BODY に落ちていた。role="alert" で
              // 読み上げは出るのに、直す対象の入力欄まではヘッダから Tab を
              // 打ち直すしかない。JS を足さずに済ませるため、失敗して再描画
              // された時だけ autofocus を付ける（正常時は付かないので、
              // 初回訪問でモバイルのキーボードが勝手に開くことはない）。
              autoFocus={invalid}
              // 枠線は brand-lift (#55688c・白地 5.61:1)。入力欄の唯一の境界表現
              // なので WCAG 1.4.11 の 3:1 が要る（2026-08-12 の是正と同じ理由）。
              className="min-w-0 flex-1 rounded-[2px] border border-brand-lift bg-paper px-3 py-2.5 text-[0.8125rem] text-brand-deep placeholder:text-brand-lift"
            />
            <button type="submit" className={buttonClass({ size: "md", className: "shrink-0" })}>
              Verify
            </button>
          </div>

          {invalid ? (
            <p id="address-error" role="alert" className="mt-3 text-[0.8125rem] text-brand-deep">
              That is not a Base address. An address is <code>0x</code> followed by 40 hexadecimal
              characters &mdash; 42 characters in total. You entered {submitted.length}.
            </p>
          ) : (
            <p id="address-hint" className="doc-note mt-3">
              Any Base address works. Nothing is stored by looking one up.
            </p>
          )}
        </form>

        {/* 2026-08-13 UX監査R1 [C3]: この画面はウォレットを持っていない読者には
            行き止まりだった — 空欄と Verify ボタンだけで、試せるアドレスが1つも
            無い。皮肉なことに、でたらめを入れてエラーを出した先の画面にだけ
            実例（0x + 40桁）と説明が出ていた。踏める実アドレスを最初から置く。
            アドレスは src/lib/benchmark/dataset.ts の known-good エントリ
            （公開情報で帰属が判明しているもの）で、順位表にも同じものが載る。 */}
        <div className="dashbox mt-6">
          {/* .doc-caption は line-height:1 なので、375px で2行に折れると行が
              重なって見える。1行に収まる長さにしてある。 */}
          <p className="doc-caption">Try one of these</p>
          <ul className="mt-3 space-y-2 text-[0.8125rem]">
            {SAMPLE_PAYEES.map((sample) => (
              <li key={sample.address} className="flex flex-col gap-0.5">
                <Link href={`/payee/${sample.address}`} className="doc-link break-all">
                  {sample.address}
                </Link>
                <span className="text-brand-lift">{sample.note}</span>
              </li>
            ))}
          </ul>
          <p className="doc-note mt-4">
            These are publicly attributed addresses from our own benchmark set, not customer
            traffic.{" "}
            <Link href="/leaderboard" className="doc-link">
              The register of recently verified subjects
            </Link>{" "}
            lists every address we have scored in the last 30 days.
          </p>
        </div>

        <h2 className="sec-head">
          <span className="sec-no">1.</span>
          <span>What the page reports</span>
        </h2>
        <div className="mt-6 space-y-5">
          <div className="flex gap-4">
            <span className="w-[4ch] shrink-0 text-brand-lift">1.1</span>
            <p className="min-w-0 max-w-[64ch] text-brand">
              <strong>The identity claim, if one exists.</strong> A payee proves control of the
              wallet by signing a message. Verification proves control and nothing else &mdash; it
              is not an endorsement.
            </p>
          </div>
          <div className="flex gap-4">
            <span className="w-[4ch] shrink-0 text-brand-lift">1.2</span>
            <p className="min-w-0 max-w-[64ch] text-brand">
              <strong>A live score, computed on the request.</strong> Read from public on-chain
              state, and computed independently of whether an identity claim was filed.
            </p>
          </div>
        </div>

        <h2 className="sec-head">
          <span className="sec-no">2.</span>
          <span>Claiming a wallet you control</span>
        </h2>
        <p className="doc-p">
          POST a signed claim to <code className="text-brand-deep">/api/v1/payees/verify</code>.
          Free, no API key, signature required. The result is a public page at{" "}
          <code className="break-all text-brand-deep">/payee/&lt;address&gt;</code> and an SVG badge
          you can embed.
        </p>
        <p className="mt-6">
          <Link href="/docs/api" className="doc-link">
            API reference
          </Link>
          <span aria-hidden="true" className="mx-2 text-brand-lift">·</span>
          <Link href="/accuracy" className="doc-link">
            Methodology and measured accuracy
          </Link>
        </p>
      </article>
    </main>
  );
}
