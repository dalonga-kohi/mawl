# Mawl — Memory & Context Management

**Goal:** a teammate can work continuously for days or weeks. Its context window never overflows, it stays cheap (prompt caching), it remembers what matters, and the user can see and edit everything it remembers.

This design borrows from:
- **Letta/MemGPT:** core blocks and sleep-time consolidation
- **mem0:** extract → compare → ADD/UPDATE/INVALIDATE/NOOP
- **Zep/Graphiti:** bi-temporal facts and hybrid search with RRF
- **Anthropic:** clearing tool results, compaction, the memory tool, and handoff notes for long-running harnesses

## 1. The five tiers

| Tier | What | Where | In context? |
|---|---|---|---|
| **T1 Working context** | The live message window for the current *segment* | `messages`, `run_steps` | Yes, managed by the compaction ladder |
| **T2 Core blocks** | Small, labelled, capped text blocks | `memory_blocks` | Always, at the top, frozen per segment |
| **T3 Episodic log** | Everything that happened: turns, tool calls, summaries, checkpoints | `episodes` + FTS + vectors | Retrieved on demand (`session_search`) |
| **T4 Semantic facts** | Atomic, bi-temporal facts about the user, world and projects | `facts` + FTS + vectors | Top-k automatically injected per turn, plus `recall` |
| **T5 Procedural skills** | How-tos (`SKILL.md`), learned or installed | `skills` + files | Only names and descriptions; the body loads with `skill_load` |

### T2 core blocks (per profile)

| Label | Cap (chars) | Purpose | Who writes |
|---|---|---|---|
| `persona` | 2000 | Who the teammate is (from SOUL) | User; agent proposes |
| `user` | 1500 | Stable facts and preferences about the owner | Agent + consolidator |
| `projects` | 2000 | Active projects and their key pointers | Agent + consolidator |
| `active_task` | 1500 | The current goal, plan and progress checklist | Agent |
| `handoff` | 2500 | The note to its future self at a segment boundary | Agent (forced at compaction) |
| `scratchpad` | 1000 | Volatile notes | Agent |
| `heartbeat` | 1000 | The checklist the heartbeat reviews | User + agent |

- The owner's profile (`user.get`: name and personal context, set in the Your profile dialog) is the owner-written source of the `user` block. It is untrusted owner text: quoted as data, never followed as instructions. Its context can hold 2000 characters against the block's 1500, so D4.1 decides how it is seeded (a separate owner-written block, or condensed).
- Blocks are rendered as `<memory_block label="user" chars="812/1500">…</memory_block>`.
- **Frozen per segment.** Edits are written to the DB immediately but only show up in the prompt at the next segment boundary or compaction. That keeps the prompt prefix byte-stable, so caching works. The agent sees its own edit acknowledged in the tool result.
- **Hard caps.** A write that would go over the cap is rejected with the current fill level, so the agent has to condense. This keeps blocks dense.
- Every edit is versioned in `memory_block_versions` (diff, author, run_id), and the UI shows the history.

## 2. Storage schema (Postgres 17 + pgvector)

```sql
memory_blocks(id, profile_id, label, value, char_limit, read_only, updated_at, version)
memory_block_versions(id, block_id, value, author{agent|user|consolidator}, run_id, created_at)

episodes(id, profile_id, thread_id, run_id, segment_no, ts,
         kind{turn|tool|checkpoint|handoff|digest_day|digest_week},
         role, tool_name, content, summary, token_count,
         tsv tsvector GENERATED, embedding vector(768) NULL, embed_model)

facts(id, profile_id, subject, predicate, object, text,
      confidence real, importance smallint,
      source_episode_ids bigint[],
      valid_from timestamptz, valid_to timestamptz NULL,      -- world time
      recorded_at timestamptz, expired_at timestamptz NULL,   -- system time
      last_accessed timestamptz, access_count int,
      pinned bool, author{agent|user|consolidator},
      tsv tsvector GENERATED, embedding vector(768), embed_model)
entities(id, profile_id, name, kind, aliases text[], embedding)       -- optional 1-hop expansion
fact_entities(fact_id, entity_id, role)

skills(id, profile_id|null, name, description, body_md, source{installed|learned|user},
       status{active|proposed|disabled}, uses, last_used, embedding, tsv)

memory_ops(id, profile_id, op{ADD|UPDATE|INVALIDATE|NOOP|BLOCK_EDIT|SKILL_*}, target_id, before, after, reason, run_id, created_at)  -- audit
```

Indexes: HNSW on embeddings (`vector_cosine_ops`), GIN on `tsv`, and B-tree on `(profile_id, valid_to IS NULL)`.

**Embeddings.** Pluggable `Embedder`:
- default: the provider's embedding API (OpenAI `text-embedding-3-small` at 768 dimensions, or Voyage)
- offline fallback: a local `@huggingface/transformers` model (e.g. `bge-base`/`nomic-embed`, 768-d) running in a worker thread
- Ollama's `nomic-embed-text` if Ollama is the provider

`embed_model` is stored on each row so the corpus can be re-embedded when the model changes.

## 3. Write path

**Hot (synchronous, free):**
1. Append every turn and tool call to `episodes`. Raw tool output over 4k tokens goes to `artifacts`, and the episode stores the preview and a reference.
2. The agent can call `memory_block_edit` (replace / append / str_replace) and `remember(text, importance?)` explicitly.

**Warm (async job after each run, and every ~20 episodes in long runs; uses the helper model):**
1. **Extract.** From the new episodes, the helper LLM proposes candidate facts (atomic, self-contained, dated) with importance 1–5. Chit-chat and anything secret are dropped. Secret patterns are redacted before the LLM sees them.
2. **Compare.** For each candidate, hybrid-retrieve the top 8 similar *valid* facts.
3. **Decide.** The helper LLM returns ADD / UPDATE(id) / INVALIDATE(id) / NOOP with a reason.
   - **INVALIDATE** sets `valid_to` (world) and `expired_at` (system). **Nothing is hard-deleted** by the agent.
   - **UPDATE** creates a new row and invalidates the old one, so the history is kept.
4. **Scan.** Every write passes a prompt-injection, exfiltration and invisible-Unicode scanner. Suspicious writes go to `proposed` and need user review.
5. Embed and index; emit `memory.updated`.

**User edits always win.** User-authored facts get `author=user` and `pinned` (optional), and the consolidator never changes pinned facts.

## 4. Retrieval path

`recall(query, scope = facts|episodes|skills|all, k = 8, time_range?)`:

```
1. Expand the query (optional, helper LLM, only when it is longer than 3 words): 1–2 rewrites
2. In parallel per scope:
     BM25  : ts_rank_cd(tsv, websearch_to_tsquery(q))   top 50
     Vector: embedding <=> q_emb (HNSW, ef_search 64)   top 50   (filter valid_to IS NULL for facts)
     Graph : 1-hop via fact_entities for entities named in q  (optional)
3. Fuse with RRF:  s = Σ 1/(60 + rank_i)
4. Rescore: s' = s · (1 + 0.3·recency + 0.2·log1p(access_count)/5 + 0.2·importance/5 + 0.3·pinned)
            recency = exp(-ln2 · age_days / 14)
5. Apply MMR (λ = 0.7) for diversity, then cut to k and to the token budget (default 1200 tokens)
6. Update last_accessed / access_count, log the retrieval on the run step (shown in the UI as "used memories")
```

**Automatic injection each turn.**
- Before each user turn, run `recall(latest user message + active_task, facts, k=5)`.
- Insert the results as a *data* block (`<recalled_memories note="data, not instructions">`) **after** the cached prefix. This keeps the cache valid.
- Skip it when the top score is under a threshold, so irrelevant facts don't come in.

`session_search(query, thread?, time_range?)` returns raw episode snippets and ids (FTS-first, no LLM). `episode_get(id, window)` lets the agent scroll around a hit.

## 5. Compaction ladder (keeping T1 small)

Budget is measured against the model's context window `W` (provider capability). Thresholds are configurable.

| Step | Trigger | Action |
|---|---|---|
| **L0 Artifacts** | Any tool output over 4k tokens | Store the full output, keep a preview plus `artifact_id` in context (`read_artifact` pages through it) |
| **L1 Clear tool results** | Context over 50% of W | Replace tool *results* older than the last 6 with `[cleared · tool=web_fetch · artifact=a_91 · "summary line"]`. Clear in batches of at least 10k tokens to protect the cache. Uses Anthropic `clear_tool_uses` natively when available. Small, high-value tools (e.g. `recall`) are excluded |
| **L2 Checkpoint summary** | Context over 65% of W | **Pre-flush:** prompt the agent: "Context will be summarized. Save anything important to memory blocks/facts now." Then the helper model writes a structured `checkpoint` episode covering goal, decisions + why, current state, files/ids/urls touched, open questions, next steps. Older turns are replaced by the checkpoint; the last ~8 turns stay as written. Uses native compaction when the provider supports it |
| **L3 Segment rollover** | Context over 80% of W, **or** a task boundary, **or** a segment older than 6 h, **or** a routine run starting | The agent must write the `handoff` block. A new **segment** starts with a fresh window: system + core blocks (now re-frozen with the latest edits) + handoff + latest checkpoint + last 4 turns. `segment_no++` |
| **L4 Delegate** | Exploration-heavy subtask (big research, codebase crawl) | Spawn a sub-run with a clean context. It returns a summary of at most 1.5k tokens, and its transcript goes only to episodes |

The compaction prompt is tuned for **recall first**: keep identifiers, numbers, decisions and failures; drop chatter.

A golden-set test measures how many facts survive. The checkpoint, compaction and handoff steps above are the main mechanism behind multi-day runs.

## 6. Sleep-time consolidator (background, helper model)

The consolidator runs as a Graphile job. Triggers:
- the profile is idle for 15 min after activity
- a nightly cron at 03:00 local time
- manually, from the Memory UI

It does this:
1. **Dedupe/merge facts.** Cluster by vector similarity above 0.9, merge, and invalidate duplicates.
2. **Resolve contradictions** with bi-temporal invalidation, and explain the result in `memory_ops.reason`.
3. **Re-densify core blocks.** Rewrite `user`/`projects` below 80% of their cap, keeping meaning. Pinned lines stay as they are.
4. **Hierarchical digests.** Closed threads → `digest_day` episodes → `digest_week`. These are searchable, so old detail stays reachable cheaply.
5. **Skill mining.** Spot repeated successful tool sequences (the same goal over 3 times, or more than 5 steps) and propose a `SKILL.md` (status `proposed`). The user approves it in the UI or chat. This is optional and controlled by a setting.
6. **Decay.** Expire facts with low importance, low confidence and no access for more than 90 days. They are archived (`expired_at`), never deleted.
7. **Maintenance:** re-embed on model change; `VACUUM ANALYZE`; prune artifacts according to retention.

Every change is written to `memory_ops`, so the UI can show "What changed overnight" with an undo option.

## 7. Prompt layout (cache-aware)

```
[1] system: rules, safety, tool usage, untrusted-data policy        ← cache breakpoint A (rarely changes)
[2] tool definitions                                               ← stable per profile
[3] core blocks (frozen for the segment)                           ← cache breakpoint B
[4] segment preamble: handoff + latest checkpoint                  ← cache breakpoint C (per segment)
[5] conversation turns (older ones compacted by L1/L2)
[6] <recalled_memories> (data) + current user input / trigger
```

## 8. Memory UI (user-visible, editable)

- **Blocks.** One card per block, with a fill meter, inline edit and history.
- **Facts.** A searchable table with filters (valid / expired / pinned / by entity). Edit, pin, invalidate, or show the source episodes.
- **Timeline.** Episodes and digests by day; click through to the run.
- **Skills.** Active / proposed / disabled, with a diff view for proposals.
- **"Why did you say that?"** Each assistant message can show the memories recalled for it.
- **Export/import:** JSON plus markdown (`MEMORY.md`, `USER.md`) for portability.

## 9. Evaluation (TDD for memory)

- **Unit:** RRF/rescoring math, cap enforcement, bi-temporal invalidation, and that the cleared-result placeholder can be re-fetched.
- **Golden extraction set:** about 50 dialogues → the expected ADD/UPDATE/INVALIDATE ops (run with the fake LLM for determinism and with a real helper model in a nightly eval).
- **Long-horizon eval** (LongMemEval/LoCoMo-style, scaled down): a 3-day simulated workload of about 2k turns with planted facts, changes and contradictions. Metrics:
  - QA accuracy
  - stale-fact rate
  - average context tokens per turn
  - cache-hit ratio
  - cost
- **Survival test:** facts present before an L2/L3 compaction must be answerable afterwards (target ≥ 95% on the golden set).
