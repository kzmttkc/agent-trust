"use client";

import { useEffect, useState } from "react";
import { dashboardFetch } from "@/lib/dashboard/client";
import { dashboardErrorMessage } from "@/lib/dashboard/errors";
import { buttonClass } from "@/components/ui/Button";

type Entry = {
  id: string;
  apiKeyId: string | null;
  wallet: string;
  listType: "whitelist" | "blacklist";
  createdAt: string | null;
};

export default function DashboardListsPage() {
  const [data, setData] = useState<{ entries: Entry[] } | null>(null);
  const [wallet, setWallet] = useState("");
  const [listType, setListType] = useState<"whitelist" | "blacklist">("whitelist");
  const [csv, setCsv] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [importMessage, setImportMessage] = useState<string | null>(null);

  async function load() {
    const result = await dashboardFetch<{ entries: Entry[] }>("/api/dashboard/lists");
    setData(result);
  }

  useEffect(() => {
    let cancelled = false;

    dashboardFetch<{ entries: Entry[] }>("/api/dashboard/lists")
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "load_failed");
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function addEntry(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    try {
      await dashboardFetch("/api/dashboard/lists", {
        method: "POST",
        body: JSON.stringify({ wallet, listType }),
      });
      setWallet("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "add_failed");
    }
  }

  async function importCsv(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setImportMessage(null);

    try {
      const result = await dashboardFetch<{ imported: number; skipped: number }>(
        "/api/dashboard/lists",
        {
          method: "PUT",
          body: JSON.stringify({ csv }),
        },
      );
      setCsv("");
      await load();
      setImportMessage(
        result.skipped > 0
          ? `${result.imported}件登録しました（${result.skipped}件はスキップしました）`
          : `${result.imported}件登録しました`,
      );
      setTimeout(() => setImportMessage(null), 6000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "import_failed");
    }
  }

  async function removeEntry(id: string) {
    setError(null);
    try {
      await dashboardFetch(`/api/dashboard/lists/${id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "delete_failed");
    }
  }

  if (error && !data) {
    return <p className="text-sm text-block-ink">{dashboardErrorMessage(error)}</p>;
  }

  if (!data) {
    return <p className="text-sm text-brand">Loading lists...</p>;
  }

  const { entries } = data;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="dash-title">Whitelist / Blacklist</h2>
        <p className="mt-1 text-sm text-brand">
          Customer-scoped lists apply to your API key. Global blacklist entries are enforced at score time but are not shown here.
        </p>
      </div>

      {error && <p className="text-sm text-block-ink">{dashboardErrorMessage(error)}</p>}

      <form onSubmit={addEntry} className="panel grid gap-3 sm:grid-cols-[1fr_auto_auto]">
        <input
          value={wallet}
          onChange={(event) => setWallet(event.target.value)}
          placeholder="0x..."
          className="rounded-[2px] border border-brand-lift bg-paper px-3 py-2 font-mono text-sm text-brand-deep placeholder:text-brand-lift"
          required
        />
        <select
          value={listType}
          onChange={(event) => setListType(event.target.value as "whitelist" | "blacklist")}
          className="rounded-[2px] border border-brand-lift bg-paper px-3 py-2 text-sm text-brand-deep"
        >
          <option value="whitelist">Whitelist</option>
          <option value="blacklist">Blacklist</option>
        </select>
        <button type="submit" className={buttonClass()}>
          Add
        </button>
      </form>

      <form onSubmit={importCsv} className="panel space-y-3">
        <h3 className="doc-caption">CSV import</h3>
        <textarea
          value={csv}
          onChange={(event) => setCsv(event.target.value)}
          placeholder={"wallet,list_type\n0x...,whitelist"}
          rows={4}
          className="w-full rounded-[2px] border border-brand-lift bg-paper px-3 py-2 font-mono text-sm text-brand-deep placeholder:text-brand-lift"
        />
        <button type="submit" className={buttonClass({ variant: "secondary" })}>
          Import CSV
        </button>
        {importMessage && <p className="text-sm text-brand-deep">{importMessage}</p>}
      </form>

      <div className="table-scroll">
        <table className="fact-table fact-table-fixed">
          <thead>
            <tr>
              <th>Wallet</th>
              <th>Type</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td className="font-mono text-xs font-normal">{entry.wallet}</td>
                <td className="capitalize">{entry.listType}</td>
                <td className="text-right">
                  <button
                    type="button"
                    onClick={() => removeEntry(entry.id)}
                    className="doc-link text-xs"
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr>
                <td colSpan={3} className="text-center text-brand-lift">
                  No list entries yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
