# Architecture & Patterns

## Adapter Pattern (Shared Interface)

We use a "Shared Interface" pattern for external integrations (e.g., LLMs, Mail Providers, Databases, WhatsApp) to decouple business logic from specific vendors.

### Structure

- **Interfaces**: Define abstract contracts (e.g., `ILLMProvider`, `IDatabaseProvider`) in `backend/src/adapters/interfaces`.
- **Adapters**: Implement these interfaces (e.g., `OpenAIAdapter`, `SupabaseAdapter`) in `backend/src/adapters/providers`. These are lightweight and transient.
- **Factory**: A central `IntegrationFactory` in `backend/src/adapters/factory.ts` instantiates the correct adapter based on configuration/type.

### Example Usage

```typescript
// LLM Provider
const llm = IntegrationFactory.createLLMProvider("OPENAI", { apiKey: "..." });
const response = await llm.generateResponse("Hello");

// Database Provider
const db = IntegrationFactory.createDatabaseProvider("SUPABASE", { url: "...", key: "..." });
const users = await db.select("users", { limit: 10 });
```

## Logging

Always use the `log` utility from `backend/src/utils/log.ts` instead of `console.log` or `console.error`.

### Usage

```typescript
import { log } from "./utils/log";

log.info("Information message", data);
log.error("Error message", error);
```
