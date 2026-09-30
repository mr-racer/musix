"""«Поток» (stream spec §3): candidate sources → learned ranker → policy → reasons.

Pure logic lives here — outcome definitions, the feature function, the policy — and is
shared, not copied, by the online path (`contexts/stream`), the nightly training job and
`tools/recsys-eval`. That sharing is what makes serving match training."""
