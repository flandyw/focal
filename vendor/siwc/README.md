# Sign in with ChatGPT DevKit (vendored)

Source: https://github.com/openai/sign-in-with-chatgpt-devkit @ f723814 (`packages/local`, `packages/react`, brand assets).
Licensed under the Sign-in with ChatGPT DevKit Noncommercial License v1.0 (see `LICENSE`); third-party notices in `THIRD_PARTY_NOTICES.md`.

Changed files (per licence §4(b)):
- `local/src/index.ts`, `local/src/types.ts`: added `proxyResponses()` — an authenticated raw pass-through to the Responses API so structured output, tools and file inputs keep working.
