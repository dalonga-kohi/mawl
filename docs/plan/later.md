# Later (Should/Could from SPEC)

Part of the [Mawl plan](../PLAN.md). Status legend and slice template are there.

Canvas follow-ups beyond DC15 (deploy or share links, which would be `external_post`; importing designs; MCP Apps rendered through the DC4 sandbox) · S1 group chats (teammate requests are D2.14) · S2 Sentinel · S5 voice · S7 cost dashboard · model routing beyond fallbacks · `remote_pc` nodes (another PC running Mawl) · Windows Sandbox or AppContainer for the host shell · Mawl marketplace · WebRTC streaming · remote sandbox providers · macOS and Linux builds. (S3 teach-by-demo is D6.6; S6 relay is D8.2.)

Open note from P1.3b and P1.5: `@mawl/server#test` failed once under the full parallel gate (PGlite suites near `hookTimeout`), and the web suites (shell, command palette, chat hooks) and `@mawl/core` `claude-code/workdir.test.ts` ("different per process", two fresh module imports) time out under heavy machine load; all pass alone (2026-10-21). Find the cause when more PGlite suites are added.

---

