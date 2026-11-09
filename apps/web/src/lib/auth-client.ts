import { createAuthClient } from "better-auth/react";

// `location` is missing in the Astro build step, which imports islands on the server.
export const authClient = createAuthClient({
  baseURL: typeof location === "undefined" ? undefined : location.origin,
});
