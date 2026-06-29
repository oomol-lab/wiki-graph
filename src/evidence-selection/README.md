# Evidence Selection

`evidence-selection` owns the shared evidence positioning protocol used by
Reading Graph and Knowledge Graph builders.

The module accepts plain source sentence candidates and model-generated
evidence selections, then resolves them to sentence IDs. It does not know about
reader chunks, wikilink relations, entities, mentions, triples, `.sdpub`
archives, or WikiGraph URIs.

## Public Protocol

New prompts should ask the model to return:

```json
{
  "sentence_id": "S1",
  "quote": "exact short source quote"
}
```

`sentence_id` is the model's primary selection. `quote` is copied from the
visible source text and is used to validate or correct sentence drift. Callers
are responsible for mapping external sentence labels such as `S1` back to their
own sentence IDs.

The module also retains the older anchor resolver because existing retry
responses and tests still exercise that shape. New prompts should prefer the
selection protocol above.

## Responsibilities

- Normalize evidence text according to the shared surface-normalization
  contract.
- Score exact, normalized, and fuzzy quote matches against candidate sentences.
- Resolve `sentence_id + quote` selections to sentence IDs.
- Return ranked candidates when a quote is ambiguous or low confidence.
- Provide prompt fragments and JSON-shape snippets that callers can embed.

## Boundary Rules

- Callers pass source sentences as plain text plus caller-owned sentence IDs.
- This module must not import Reading Graph or Knowledge Graph business objects.
- This module must not construct chunk, relation, mention, entity, triple, or URI
  objects.
- Recovery loops remain caller-owned because each graph builder has different
  retry semantics and result objects.
