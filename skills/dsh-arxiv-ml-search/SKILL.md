# dsh-arxiv-ml-search — check ML claims against the arXiv record

Turn a claim about machine learning into a literature check backed by real
papers, instead of answering from memory.

## When to use

- Someone asserts something about ML/DL/RL — "X beats Y", "method Z doesn't
  scale", "nobody has tried A" — and the answer should rest on published work.
- Someone asks what is new on a topic, or who works on it.
- You are about to cite a paper. Look it up first; do not recall it.

## Tools

- `arxiv_search` — find candidates. Returns truncated abstracts.
- `arxiv_get` — full abstract and metadata for specific ids, with optional
  segmenting for long text (`max_chars` + `segment`, `segments_total` tells you
  how many parts there are).

## Procedure

1. **Restate the claim** as something a paper could confirm or refute. Note what
   evidence would count each way.
2. **Write 2-3 orthogonal queries.** Papers name the same idea differently
   ("chain of thought" / "step-by-step reasoning" / "scratchpad"). One query is
   almost never enough, and finding nothing with one phrasing proves nothing.
3. **Search narrow, then widen.** Start with `field: "abstract"` and
   `ml_only: true`; if there are too few hits, drop the category filter, then
   fall back to `field: "all"`. For "what is new", use `sort: "submitted"` with
   a `from` date rather than relevance.
4. **Read the shortlist properly.** Pick the 3-5 most on-point ids and call
   `arxiv_get`. The search abstract is cut off; the full one often reverses the
   impression the title gave.
5. **Report a verdict**: supported / contradicted / mixed / no evidence found.
   Cite arXiv ids for every point. Say which papers you actually read.

## Hard rules

- Never invent an arXiv id, title, author, or number. Every id you cite must
  have come back from a tool call in this conversation.
- Never state a result that is not in the text a tool returned. Abstracts are
  not full papers: if the claim depends on experimental detail, say that
  confirming it needs the paper itself.
- "No matching papers" is a real finding — report it as absence of evidence
  found, not as evidence of absence, and say which queries you tried.
- Say when a search skews recent: the tool sees preprints, so an established
  result may sit in a venue rather than on arXiv.
- Distinguish "a paper claims X" from "X is established". A single preprint is
  one group's claim.

## Query syntax notes

Plain text goes in as a phrase. To express anything more, write arXiv syntax
directly in `query` and it is passed through:

    abs:"reward hacking" ANDNOT abs:"reinforcement learning from human feedback"
    (ti:"scaling laws" OR ti:"scaling law") AND cat:cs.LG
