# dsh-arxiv-ml-search

A DeepSeek Harness plugin that searches arXiv for machine-learning papers, so
the agent checks claims against the published record instead of its own memory.

Two tools plus a skill that tells the model how to use them:

- **`arxiv_search`** — keywords, authors, categories, date ranges, sorting and
  paging. Returns truncated abstracts so a ten-result search stays cheap.
- **`arxiv_get`** — full metadata and complete abstracts for specific ids, with
  optional segmenting (`max_chars` + `segment`) for paging through long text.
- **`SKILL.md`** — the claim-checking procedure: restate the claim, run 2-3
  orthogonal queries, read the shortlist properly, report a verdict with ids,
  and never assert anything the returned text does not say.

## What the skill actually changes

The two tools are always in the toolset, so the model *can* reach arXiv without
the skill. What the skill adds is knowing how to search — and that turns out to
be most of the value. Measured on one prompt, run twice in the same workspace,
once with the skill loaded and once without:

| | skill not loaded | skill loaded |
| --- | --- | --- |
| synonym sets (`any_of`) | 0 | 11 distinct, across 36 calls |
| category narrowing (`ml_only`) | 9 | 36 |
| relaxed matches reported to the user | — | 4 |

Without it the model still searches, just blindly: one phrasing per concept, no
narrowing, and no obligation to say when a match was approximate rather than
exact. With it, the answer names which abstracts were actually read and flags
where the evidence is thin.

### It loads without being asked for papers

The skill is meant to fire on any ML question, not only on "find me papers".
Ask a plain engineering question —

> My RL agent gets a set of state features but the reward never makes it rely
> on some of them. How do I increase a specific feature's influence?

— and the model loads the skill and answers from real work: potential-based
reward shaping, curiosity, auxiliary tasks, each with an arXiv id it fetched
rather than recalled.

Getting that to happen took a specific fix. The skill catalog the model reads
carries **name and description only** — `whenToUse` never reaches it, and the
description is truncated past 500 characters — so that one string is the entire
routing signal. An earlier one-liner about "searching arXiv for papers" got
skipped on advice-shaped questions, with the model reasoning "no skill needed,
it's a general question", and then using the tools without any of the rules
above. The description now claims those questions explicitly. Routing is still
a model judgement rather than a guarantee: if the skill gets skipped, the
description is the thing to edit.

No Python and no build step. The arXiv API is a plain HTTP GET returning Atom
XML, so `lib/atom.js` parses exactly the fields we use, and the only thing the
plugin needs from the harness is `@deepseek-ai/dsh-tools`.

**That must stay a peer dependency, never a regular one.** dsh writes
`autoInstallPeers: false` into every profile's `pnpm-workspace.yaml` on purpose:
the harness owns `dsh-tools`, and a plugin that declares it under
`dependencies` makes pnpm install a *second copy* into the profile.
`TOOL_RUNTIME_SCHEDULER` inside that package is a module-local `Symbol()`, so
two copies mean two different symbols, and the whole tool registry breaks — not
just this plugin's tools. The symptom is every tool call in the session, built-in
ones included, failing with:

    Cannot read properties of undefined (reading 'prepare')

Verified working on dsh `0.1.0-rc.8`, in both the headless and web profiles.

## Install

Two lines: add the package to the profile you use, then start it. Nothing to
download by hand and no build step.

    dsh plugin --profile web add dsh-arxiv-ml-search

Without a global dsh install, the same through npx:

    npx @deepseek-ai/dsh dsh plugin --profile web add dsh-arxiv-ml-search
    npx @deepseek-ai/dsh web

Ask a question and the tools are simply there — no flags, no mention of the
plugin:

> Do any papers show RLHF hurting calibration? Cite ids.

Any other profile works the same way; swap `web` for `headless` and it answers
one task on the command line and exits:

    dsh plugin --profile headless add dsh-arxiv-ml-search
    dsh --profile headless "Do any papers show RLHF hurting calibration? Cite ids."

### Installing an unpublished build

Only needed when you are working on the plugin itself. `dsh plugin add` is a
thin wrapper over pnpm, so it takes a directory, a tarball or a git URL wherever
a package name would go:

    dsh plugin --profile web add ../dsh-arxiv-ml-search          # a working copy
    dsh plugin --profile web add ./dsh-arxiv-ml-search-0.1.0.tgz  # a local pack

Installing from the registry needs none of this.

### If the plugin does not show up

Loading needs the package listed in `dsh.profile.bundles`
(`~/.dsh/profiles/<name>/package.json`), not just in `dependencies`. Normally
`dsh plugin add` appends it for you: after pnpm succeeds it walks the
dependencies and adds every package that declares `dsh.bundle`.

The catch is that the reconcile step only runs when pnpm exits **zero**. An
unrelated blocked build script elsewhere in the profile — `ERR_PNPM_IGNORED_BUILDS`
is the usual one — aborts the command first, so the package installs but never
joins the layer stack and the plugin stays silently inert. Check the manifest
after installing and add the entry by hand if it is missing:

    "dsh": { "profile": { "bundles": [ "...", "dsh-arxiv-ml-search" ] } }

Confirm what actually composes, without booting anything:

    dsh --profile web --dump-config

## Develop

    pnpm install                      # needed once: tests/plugin.test.js loads index.js
    node --test                       # unit tests, offline, against saved feeds
    node scripts/smoke.mjs "rlhf"     # live check against the real API
    node scripts/smoke.mjs --refresh-fixtures

Dev-load without installing, via `dev.cordis.yml` in this directory:

    - insert:
        - id: dsh-arxiv-ml-search
          name: file:///C:/absolute/path/to/dsh-arxiv-ml-search/index.js

    dsh --profile headless --patch ./dev.cordis.yml "Do any papers show RLHF hurting calibration?"

Two things bite here:

- The path must be **absolute**; a relative one resolves against the harness
  installation, not your working directory.
- On Windows it must additionally be a **`file://` URL**. A bare `C:/...` makes
  the ESM loader fail with `ERR_UNSUPPORTED_ESM_URL_SCHEME` (`Received protocol
  'c:'`), because it reads the drive letter as a URL scheme.

Check the overlay composes into the tree before booting anything:

    dsh --profile headless --patch ./dev.cordis.yml --dump-config

Use the overlay for iterating on the source; use a real install (above) for
anything you actually want to keep.

## Layout

    index.js          host plugin: tool + skill registration only
    lib/query.js      builds search_query and request URLs
    lib/atom.js       Atom feed -> paper records
    lib/segment.js    truncation and segmentation (text budget)
    lib/format.js     paper records -> tool output and chat rendering
    lib/http.js       fetch: User-Agent, rate limit, timeout, one retry
    lib/arxiv.js      orchestration, testable with an injected fetch
    tests/            node:test suites; fixtures are real captured feeds

Every deterministic step lives in `lib/` so the tests run without the harness
and without the network. `lib/http.js` is the only impure module, and it takes
`fetchImpl` as an option for exactly that reason.

## Config

Set in the profile entry for this plugin:

| key | default | meaning |
| --- | --- | --- |
| `categories` | the ML set | categories used by `ml_only` |
| `abstractChars` | 350 | abstract budget per search result |
| `limit` | 10 | default page size |
| `contact` | — | contact address added to the User-Agent |
| `timeoutMs` | 20000 | per-request timeout |

## Notes on the arXiv API

- Requests are spaced at least three seconds apart and carry an identifying
  User-Agent, as arXiv asks of API clients. The limiter is process-wide.
- Search covers metadata and abstracts, not full text. A claim that turns on
  experimental detail needs the paper itself — the skill says so explicitly.
- arXiv is preprints. Absence of a result is not evidence of absence.

## Query syntax

Plain text becomes a phrase clause. Anything containing a field prefix or a
boolean operator is passed through to the API unchanged:

    abs:"reward hacking" ANDNOT abs:"reinforcement learning from human feedback"
    (ti:"scaling laws" OR ti:"scaling law") AND cat:cs.LG

Generated with [dsh-plugin-starter](https://github.com/ciceroyang/dsh-plugin-starter).
