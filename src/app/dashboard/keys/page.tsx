"use client";

import { useEffect, useState } from "react";
import { dashboardFetch } from "@/lib/dashboard/client";
import { dashboardErrorMessage } from "@/lib/dashboard/errors";
import { track } from "@/lib/analytics";
import { buttonClass } from "@/components/ui/Button";
import CodeBlock from "@/components/docs/CodeBlock";

type KeyInfo = {
  id: string;
  name: string | null;
  plan: string;
  createdAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

type KeysData = { keys: KeyInfo[]; currentKeyId: string };

export default function DashboardKeysPage() {
  const [data, setData] = useState<KeysData | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    const result = await dashboardFetch<KeysData>("/api/dashboard/keys");
    setData(result);
  }

  useEffect(() => {
    let cancelled = false;

    dashboardFetch<KeysData>("/api/dashboard/keys")
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

  async function createKey() {
    setError(null);
    try {
      const created = await dashboardFetch<{ id: string; key: string; plan: string }>(
        "/api/dashboard/keys",
        {
          method: "POST",
          body: JSON.stringify({ name: "Dashboard created key" }),
        },
      );
      setNewKey(created.key);
      // 2026-08-06 growth: api_key_created = the dashboard activation event
      // (a user minting an extra key is past "signed up and left"). The key
      // value itself is never sent — no props on purpose.
      track("api_key_created");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "create_failed");
    }
  }

  async function revokeKey(id: string) {
    if (!confirm("Revoke this API key? This cannot be undone.")) return;

    setError(null);
    try {
      await dashboardFetch(`/api/dashboard/keys/${id}`, { method: "DELETE" });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "revoke_failed");
    }
  }

  if (error && !data) {
    return <p className="text-sm text-block-ink">{dashboardErrorMessage(error)}</p>;
  }

  if (!data) {
    return <p className="text-sm text-brand">Loading API keys...</p>;
  }

  const { keys, currentKeyId } = data;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="dash-title">API keys</h2>
        <p className="mt-1 text-sm text-brand">
          Create and revoke keys in your account. The active session key cannot be revoked here.
        </p>
      </div>

      {error && <p className="text-sm text-block-ink">{dashboardErrorMessage(error)}</p>}

      <div className="table-scroll">
        <table className="fact-table fact-table-fixed">
          <thead>
            <tr>
              <th>Name</th>
              <th>Plan</th>
              <th>Status</th>
              <th>Last used</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {keys.map((key) => (
              <tr key={key.id}>
                <td>
                  <div>{key.name ?? "Unnamed"}</div>
                  <div className="font-mono text-[0.6875rem] font-normal text-brand-lift">
                    {key.id}
                  </div>
                </td>
                <td className="capitalize">{key.plan}</td>
                <td>
                  {key.revokedAt ? (
                    <span className="marker marker-verdict-block">Revoked</span>
                  ) : key.id === currentKeyId ? (
                    <span className="marker marker-live">Active session</span>
                  ) : (
                    <span className="text-brand">Active</span>
                  )}
                </td>
                <td className="text-brand">
                  {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString() : "—"}
                </td>
                <td className="text-right">
                  {!key.revokedAt && key.id !== currentKeyId && (
                    <button
                      type="button"
                      onClick={() => revokeKey(key.id)}
                      className="doc-link text-xs"
                    >
                      Revoke
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {keys.length === 0 && (
              <tr>
                <td colSpan={5} className="text-center text-brand-lift">
                  No API keys found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <button
        type="button"
        onClick={createKey}
        className={buttonClass()}
      >
        Create new key
      </button>

      {newKey && (
        <div className="rounded-[2px] border border-warn-ink bg-paper p-4 text-sm text-warn-ink">
          <p>New API key (copy now — shown once):</p>
          <CodeBlock code={newKey} label="New API key" className="mt-2" />
        </div>
      )}
    </div>
  );
}
