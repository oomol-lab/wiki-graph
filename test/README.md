# Tests

This project uses `Vitest` for unit and integration tests.

- `test/fixtures/` contains original, repository-safe sample inputs for tests.
- `test/helpers/` contains reusable test utilities.
- `test/` currently includes a minimal smoke test to verify the framework is wired correctly.
- `test/cli/README.md` tracks CLI help-routing coverage and related acceptance criteria.

Fixture policy:

- All fixture text is original and authored for this repository.
- Fixture files are intentionally small so the test suite stays fast.
- Binary fixtures should be reproducible from scripts in `scripts/`.

LLM testing policy:

- This project does not test live LLM behavior.
- If a feature requires a real LLM call to exercise, skip that path in tests.
- Prefer testing deterministic logic around prompts, parsing, validation, data flow, and file handling.
- When needed, isolate LLM-dependent code behind mocks, stubs, or test doubles instead of calling real models.
