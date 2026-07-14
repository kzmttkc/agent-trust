"use client";

import { useEffect, useState } from "react";
import { dashboardFetch } from "@/lib/dashboard/client";
import { dashboardErrorMessage } from "@/lib/dashboard/errors";

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
    return <p className="text-sm text-red-600">{dashboardErrorMessage(error)}</p>;
  }

  if (!data) {
    return <p className="text-sm text-zinc-600">Loading lists...</p>;
  }

  const { entries } = data;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">Whitelist / Blacklist</h2>
        <p className="text-sm text-zinc-600">
          Customer-scoped lists apply to your API key. Global blacklist entries are enforced at score time but are not shown here.
        </p>
      </div>

      {error && <p className="text-sm text-red-600">{dashboardErrorMessage(error)}</p>}

      <form onSubmit={addEntry} className="grid gap-3 rounded-xl border border-zinc-200 bg-white p-5 sm:grid-cols-[1fr_auto_auto]">
        <input
          value={wallet}
          onChange={(event) => setWallet(event.target.value)}
          placeholder="0x..."
          className="rounded-md border border-zinc-300 px-3 py-2 font-mono text-sm"
          required
        />
        <select
          value={listType}
          onChange={(event) => setListType(event.target.value as "whitelist" | "blacklist")}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
        >
          <option value="whitelist">Whitelist</option>
          <option value="blacklist">Blacklist</option>
        </select>
        <button type="submit" className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white">
          Add
        </button>
      </form>

      <form onSubmit={importCsv} className="space-y-3 rounded-xl border border-zinc-200 bg-white p-5">
        <h3 className="text-sm font-medium text-zinc-700">CSV import</h3>
        <textarea
          value={csv}
          onChange={(event) => setCsv(event.target.value)}
          placeholder={"wallet,list_type\n0x...,whitelist"}
          rows={4}
          className="w-full rounded-md border border-zinc-300 px-3 py-2 font-mono text-sm"
        />
        <button type="submit" className="rounded-md border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-50">
          Import CSV
        </button>
        {importMessage && <p className="text-sm text-green-700">{importMessage}</p>}
      </form>

      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-zinc-600">
            <tr>
              <th className="px-4 py-3 font-medium">Wallet</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 font-medium" />
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id} className="border-b border-zinc-100">
                <td className="px-4 py-3 font-mono text-xs">{entry.wallet}</td>
                <td className="px-4 py-3 capitalize">{entry.listType}</td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => removeEntry(entry.id)}
                    className="text-xs text-red-600 hover:underline"
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-zinc-500">
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
