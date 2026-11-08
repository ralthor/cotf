# Shared test fixtures

`classifier-cases.json` holds move-classification cases that both implementations must agree on:

- TypeScript: `web/src/core/classification/parity.test.ts`
- Python: `backend/tests/test_scoring.py`

If you change thresholds, bump the policy version (`cls-v1`) in both implementations and update this file.
