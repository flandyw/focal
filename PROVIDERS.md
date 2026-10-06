# AI Providers

Focal uses a small abstraction layer so every place the app talks to a language
model — file auto-rename, the text-event planner, any
new AI feature — works the same way regardless of which backend you pick.

This document explains the abstraction and how to add a new provider.

## Mental model

A `Provider` (declared in `src/lib/providers/types.ts`) is one concrete way to
talk to an LLM. Each provider owns its own HTTP details: URL, auth header,
whether the host enforces a JSON schema, whether it supports reasoning tokens,
and so on. Callers only deal in `ChatMessage` / `ReasoningConfig` / JSON schema
terms — they never touch `fetch`, bearer headers, or `response_format` quirks.

```
            ┌────────────────────────────────────────────────────┐
            │             Caller (e.g. autoRename.ts)            │
            │                                                    │
            │  getActiveProvider().chatCompletion({              │
            │    model, messages, jsonSchema, reasoning, … })    │
            └────────────────────────────┬───────────────────────┘
                                         │
                                         ▼
            ┌────────────────────────────────────────────────────┐
            │       src/lib/providers/index.ts (registry)       │
            │   getActiveProvider()  setActiveProvider(id)       │
            │   getEffectiveModel()  setEffectiveModel(value)   │
            └────────────────────────────┬───────────────────────┘
                                         │
              ┌──────────────────────────┴──────────────────────────┐
              ▼                                                     ▼
  ┌────────────────────────────┐               ┌────────────────────────────────┐
  │ src/lib/providers/openrouter│               │    src/lib/providers/ollama     │
  │  • https://openrouter.ai    │               │  • http://localhost:11434      │
  │  • Auth: bearer apiKey      │               │  • Auth: optional bearer       │
  │  • response_format strict   │               │  • native format schema       │
  │  • supportsReasoning: true  │               │  • supportsReasoning: false    │
  └────────────────────────────┘               └────────────────────────────────┘
```

The registry is the single source of truth for "which provider is active".
Switch in `src/lib/providers/index.ts` if you want to add a new one or
reorder the default list.

## Concepts

`ChatMessage` — a role-tagged string (one of `system`, `user`, `assistant`).
Caller shapes the prompt; the provider just relays it.

`ReasoningConfig` — transparent struct the provider may forward to the host.
Providers that don't support reasoning ignore it.

`JsonSchemaSpec` — `{ name, schema, strict? }`. Providers translate this into
whatever the host uses:
- OpenRouter → `response_format: { type: "json_schema", ... }` (server enforces)
- Ollama → native `/api/chat` `format: <JSON schema>`
- ChatGPT → Responses API structured output through the local Sign in with ChatGPT service

`ModelInfo` — what `listModels()` returns. Ollama also supplies local size,
parameter count, quantization, family, context length, and host-reported
capabilities from `/api/tags` and `/api/show`.

## Current providers

| Provider   | Default base URL                  | Auth         | Strict JSON schema | Supports reasoning |
|------------|------------------------------------|--------------|--------------------|--------------------|
| OpenRouter | `https://openrouter.ai/api/v1`     | bearer key   | yes                | yes                |
| Ollama     | `http://localhost:11434`           | none         | yes via native `format` | no             |
| ChatGPT    | `VITE_CHATGPT_BASE_PATH`            | Sign in with ChatGPT (OS-encrypted, local) | yes via Responses | yes via `x-focal-reasoning-effort` |

Default backends and fields rendered in the AI section in Settings come from
each provider's `configFields` declaration. UI rendering is driven entirely
by what the provider exposes — no per-provider branching in `AIModelSection.tsx`
beyond "is this the active one?".

## Structured-output reliability

OpenRouter enforces `response_format: { type: "json_schema", ... }` server-side
when a `JsonSchemaSpec` is supplied, so a valid response is guaranteed as long
as the upstream host supports structured outputs. That is why `autoRename.ts`
and `TextEventPlanner.tsx` keep their hand-rolled parsers
strict — they reject payloads that look right but reference unknown subjects
or projects.

Ollama uses the native `/api/chat` endpoint with `format` set to the supplied
JSON schema. That is the one supported structured-output path for local
models. We do not use XML prompting or tool-calling loops for structured app
features; 8B models are more reliable when asked for one schema-constrained
JSON object.

The provider still performs two small defensive steps:

1. It strips accidental markdown fences or prose with `extractJsonPayload`.
2. It retries once if the returned object does not match the required root
   keys. The caller's parser remains the final validator for app-specific ids,
   dates, and enum values.

The desktop app routes Ollama through a small native Tauri bridge so packaged
webviews are not blocked by Ollama's CORS policy. Settings can test the server,
show its version, discover chat-capable installed models, and pull a model from
the Ollama library without opening a terminal. Pulls use the same cancellation
path as chat requests.

## Adding a new provider

A drop-in provider is two files plus one line in the registry.

### 1. Pick an id

The id is the stable string stored in the `provider` setting. Lowercase,
short, no spaces. Examples: `openrouter`, `ollama`, `lmstudio`, `vllm`,
`openai`. Avoid colliding with an existing provider.

### 2. Create the implementation

Make a new file under `src/lib/providers/<id>.ts`. Export a constant that
implements the `Provider` interface:

```ts
// src/lib/providers/lmstudio.ts
import { getLmStudioBaseUrl, getLmStudioModel } from "@/lib/settings"
import type { Provider } from "@/lib/providers/types"

export const lmStudioProvider: Provider = {
  id: "lmstudio",
  displayName: "LM Studio",
  summary: "Local LLM server. Free, fully offline.",
  requiresApiKey: false,
  configFields: [
    { key: "baseUrl", label: "Server URL", kind: "text", required: true },
    { key: "model",   label: "Model",      kind: "text", required: true },
  ],
  supportsReasoning: false,

  isConfigured() {
    return Boolean(getLmStudioBaseUrl()) && Boolean(getLmStudioModel())
  },

  async listModels() {
    // call your host; return [{ id, name?, ... }]
  },
  async healthcheck() {
    // GET /models or a probe; return { ok, error? }
  },
  async chatCompletion(req) {
    // translate req to your host's request shape, return { content }
  },
}
```

A few conventions:

- `configFields` drives the Settings UI. Only declare fields you actually read.
- `listModels()` and `healthcheck()` must throw / return `{ ok: false, error }`
  — the UI assumes they can fail.
- Inside `chatCompletion`, throw a plain `Error` with a useful message on
  non-2xx responses. The caller receives the message verbatim.
- If your host enforces strict JSON schemas (e.g. via `response_format`,
  `guided_json`, etc.), set `supportsStructuredOutput: true` on the returned
  `ModelInfo` and pass `req.jsonSchema`'s `schema` straight through. If the
  host only does best-effort JSON, it is not a good fit for Focal's planning
  features.

### 3. Register it

Open `src/lib/providers/index.ts` and add the import + entry to `PROVIDERS`:

```ts
import { lmStudioProvider } from "@/lib/providers/lmstudio"

const PROVIDERS: Record<string, Provider> = {
  [openrouterProvider.id]: openrouterProvider,
  [ollamaProvider.id]: ollamaProvider,
  [lmStudioProvider.id]: lmStudioProvider,   // ← new
}
```

If you want it as the default for fresh installs (not a hard requirement;
most users should opt in explicitly), promote its id to `DEFAULT_PROVIDER_ID`
in `src/lib/settings.ts` and add a `getLmStudioBaseUrl()` /
`getLmStudioModel()` pair there. Existing users keep OpenRouter unless they
flip the toggle.

### 4. (Optional) Add Settings fields

If the provider needs more than the four shared keys (`apiKey`, `baseUrl`,
`model`), add a getter/setter pair in `src/lib/settings.ts`. Storage layout
from the user perspective:

| localStorage key             | Purpose                                         |
|------------------------------|-------------------------------------------------|
| `focal-ai-provider`          | Active provider id                              |
| `focal-openrouter-key`       | OpenRouter API key (local-only, never synced)   |
| `focal-openrouter-model`     | Last selected OpenRouter model id               |
| `focal-ollama-base-url`      | Ollama native API base URL                      |
| `focal-ollama-model`         | Last selected Ollama tag                        |

Add new keys following the same pattern (`focal-<provider>-<field>`). For
remote fields that aren't secrets (base URLs, model ids), the plugin should
also add them to `UserSettings` and the sync mappers in `src/lib/sync/mappers.ts`
plus `collectUserSettingsForSync` in `src/lib/sync/engine.ts` so the choice
follows the user between devices.

### 5. Surface the provider in the AI section

The provider picker in `src/components/settings/AIModelSection.tsx` is driven
entirely by `listProviders()`. Once you register the provider, it appears in
the segmented control. The conditional sections (`{providerId === "openrouter"}
…`) are driven per-id — extend them if your provider needs a custom field
(e.g. multi-tenant org id) — but prefer reusing `baseUrl` / `model` /
`apiKey` to keep the UI compact.

## Capability checklist

When adding a provider, run through this list:

- **Strict JSON schema** — does your host enforce it? Set
  `supportsStructuredOutput` accordingly. Tight schemas need to be passed
  through. If your host cannot enforce schemas, do not use it for Focal's AI
  planning features until it can.
- **Reasoning tokens** — does your host support a `reasoning` block? Set
  `supportsReasoning`. If it doesn't, the UI hides the section automatically,
  and `chatCompletion` should drop the field rather than send it.
- **Auth** — `requiresApiKey: true` flips the UI to a password input. If the
  provider is auth-less, leave it false and declare a `baseUrl` field instead.
- **Latency / perf data** — only OpenRouter has the live p50 endpoint. If
  your provider exposes something equivalent, surface it however you like
  (the `ModelRow` perf map is provider-scoped).
- **Errors** — keep error messages plain English and include the HTTP status
  when relevant. The Settings UI shows them directly.

## Healthchecks

`healthcheck()` is called when the user clicks "Test connection" in the AI
section. Implement it as a cheap GET to whatever root your host exposes
(`/models`, `/health`, etc.). It must never crash; return
`{ ok: false, error: "..." }` instead.

## What lives where (recap)

| Concern                                    | File                                       |
|--------------------------------------------|--------------------------------------------|
| Provider interface + types                 | `src/lib/providers/types.ts`               |
| Individual implementations                 | `src/lib/providers/<id>.ts`                |
| Shared provider helpers (JSON extract / shape repair / chat mapping) | `src/lib/providers/shared.ts` |
| Active provider + effective model          | `src/lib/providers/index.ts`               |
| Provider keys (localStorage)               | `src/lib/settings.ts`                      |
| Provider UI                                | `src/components/settings/AIModelSection.tsx`|
| Cross-device sync of provider choice       | `src/lib/sync/mappers.ts`, `engine.ts`     |
| Doc for humans                             | `PROVIDERS.md` (this file)                 |

When in doubt: prefer one file, prefer no new abstractions, prefer letting
the existing parsers in `autoRename.ts`/`TextEventPlanner.tsx`
do strict validation rather than relying on the host to enforce schemas.
