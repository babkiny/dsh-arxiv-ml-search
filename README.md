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

No Python and no build step. The arXiv API is a plain HTTP GET returning Atom
XML, so `lib/atom.js` parses exactly the fields we use and the only dependency
is the harness's own `@deepseek-ai/dsh-tools`.

That one is a regular dependency, not a peer: dsh writes
`autoInstallPeers: false` into every profile's `pnpm-workspace.yaml`, so a peer
dependency would never be installed and the plugin would fail to import.

Verified against dsh `0.1.0-rc.7`.

## Install

    dsh plugin --profile web add <path to this directory>

Then list the package in that profile's `dsh.profile.bundles`
(`~/.dsh/profiles/<name>/package.json`). Installing alone is not enough — the
loader composes its tree from `bundles`, not from `dependencies`, so a plugin
that is only installed stays inert.

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

Check the plugin composes into the tree before booting anything:

    dsh --profile web --patch ./dev.cordis.yml --dump-config

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
