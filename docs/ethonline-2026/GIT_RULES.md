# ETHOnline 2026 — git rules (Continuity Track boundary)

Operating plan: [`ROADMAP.md`](./ROADMAP.md). Follow that file; these rules are the git subset.

1. **2026-09-03**: tag `pre-ethonline-2026` on `main` (scheduled; everything reachable from it is pre-existing).
2. **2026-09-04 onward**: all work on branch `ethonline-2026`, cut from the tag.
3. Commit prefix fixed: `ethonline:` — examples:
   - `ethonline: feat(sdk): payOrRefuse — ALLOW時のみx402支払い・非ALLOWは署名前拒否`
   - `ethonline: feat(mcp): pay_if_trusted tool wired to payOrRefuse (BLOCK cannot reach payment)`
   - `ethonline: demo(agent): two-scenario runner + decisions feed source=agent-demo`
4. One commit = one purpose. Any edit to a pre-existing file → append to `CHANGED_FILES.md` in the same commit.
5. Submission: `git merge --no-ff ethonline-2026` into `main`; the merge commit is the boundary evidence.
   `git log --oneline pre-ethonline-2026..ethonline-2026` must read as the complete list of hackathon work.

## README の扱い（2026-08-22 確定）

`README_CONTINUITY_SECTION.md` は **会期中は README.md に入れない**。予定を公開 README に
詳細に書くと、後から「最初から決めてあっただけ」と読まれうるため。

1. 9/4 以降、実装が進むたびに `README_CONTINUITY_SECTION.md` の "Built during the window"
   を**実際にできたものだけ**に更新する（未着手項目は書かない）。
2. 提出直前（実装が固まった時点）で、完成した内容だけを過去形にして README.md へ移す。
3. 「Existed before the window」と「Boundary definition」は 9/3 のタグ時点で確定しているので、
   移すときも書き換えない。
