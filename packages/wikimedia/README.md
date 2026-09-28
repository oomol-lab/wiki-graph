# wiki-graph-wikimedia

Runtime-neutral Wikimedia domain engine shared by `wiki-graph-core` and the
hosted `wg-wikimedia` service. It owns Wikimedia request/response parsing,
resolution, disambiguation prompts and result validation. Runtime-specific
SQLite, PostgreSQL, local scheduling and cluster coordination are injected.
