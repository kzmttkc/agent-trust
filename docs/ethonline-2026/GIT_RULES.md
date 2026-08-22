# ETHOnline 2026 — git rules (Continuity Track boundary)

1. **2026-09-03**: tag `pre-ethonline-2026` on `main` (scheduled; everything reachable from it is pre-existing).
2. **2026-09-04 onward**: all work on branch `ethonline-2026`, cut from the tag.
3. Commit prefix fixed: `ethonline:` — examples:
   - `ethonline: feat(sdk): payOrRefuse — ALLOW時のみx402支払い・非ALLOWは署名前拒否`
   - `ethonline: feat(mcp): pay_if_trusted tool wired to payOrRefuse (BLOCK cannot reach payment)`
   - `ethonline: demo(agent): two-scenario runner + decisions feed source=agent-demo`
4. One commit = one purpose. Any edit to a pre-existing file → append to `CHANGED_FILES.md` in the same commit.
5. Submission: `git merge --no-ff ethonline-2026` into `main`; the merge commit is the boundary evidence.
   `git log --oneline pre-ethonline-2026..ethonline-2026` must read as the complete list of hackathon work.
