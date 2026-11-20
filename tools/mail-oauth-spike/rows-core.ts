import type { ListResponse } from "imapflow";

import { buildMime, failureCodes, openImap, type ImapSession } from "./mail";
import {
  authorizeUrl,
  errorCodes,
  GOOGLE_SCOPES,
  idClaims,
  MS_BASE_SCOPES,
  MS_GRAPH_SCOPE,
  MS_IMAP_SCOPE,
  pkcePair,
  REDIRECT_URI,
  scopeText,
  text,
  tokenRequest,
  type CallbackParams,
  type Endpoints,
  type IdClaims,
  type Provider,
} from "./oauth";
import { capability, folderPath, word } from "./redact";

// Shared types and steps of the probe rows. One `Ctx` per probe run: it holds the tokens in memory only.

export type Verdict = "PASS" | "FAIL" | "SKIP";
export type Answer = "y" | "n" | "skip";

export interface Outcome {
  verdict: Verdict;
  evidence: string;
}

export interface Row {
  id: string;
  run(ctx: Ctx): Promise<Outcome>;
}

export interface SpikeEnv {
  clientId: string;
  clientSecret?: string;
  ownerAddress: string;
}

export interface Deps {
  fetch: typeof fetch;
  /** A manual row: the owner answers y, n or skip. */
  ask(question: string): Promise<Answer>;
  /** A hidden prompt. `null` when the owner gives nothing. */
  askSecret(question: string): Promise<string | null>;
  /** Progress for the owner; never a secret. */
  say(line: string): void;
  /** Starts the one-shot callback server, shows the URL, waits for the redirect query. */
  browse(buildUrl: (state: string) => string): Promise<CallbackParams>;
  sleep(ms: number): Promise<void>;
  now(): number;
}

interface Tokens {
  imap: string;
  imapScope: string;
  graph?: string;
  graphScope?: string;
  refresh: string;
  idToken?: string;
}

export interface LoginAttempt {
  claim: "email" | "preferred_username";
  ok: boolean;
  codes?: string;
}

export interface Ctx {
  provider: Provider;
  env: SpikeEnv;
  deps: Deps;
  endpoints: Endpoints;
  state: {
    verifier?: string;
    params?: CallbackParams;
    redeem?: Promise<RedeemResult>;
    tokens?: Tokens;
    claims: IdClaims;
    login?: string;
    attempts?: LoginAttempt[];
    imap?: ImapSession;
    folders?: ListResponse[];
  };
}

export const newCtx = (provider: Provider, env: SpikeEnv, deps: Deps, endpoints: Endpoints): Ctx => ({
  provider,
  env,
  deps,
  endpoints,
  state: { claims: {} },
});

export const yes = (value: boolean): string => (value ? "yes" : "no");

export const pass = (evidence: string): Outcome => ({ verdict: "PASS", evidence });
export const fail = (evidence: string): Outcome => ({ verdict: "FAIL", evidence });
export const skip = (evidence: string): Outcome => ({ verdict: "SKIP", evidence });

/** One piece of a row. `ok` null = skipped. An optional piece never turns a row into SKIP. */
export interface Part {
  ok: boolean | null;
  text: string;
  optional?: boolean;
}

export function combine(parts: Part[]): Outcome {
  const evidence = parts.map((part) => part.text).join("; ");
  if (parts.some((part) => part.ok === false)) return fail(evidence);
  if (parts.some((part) => part.ok === null && part.optional !== true)) return skip(evidence);
  return pass(evidence);
}

/** An observation: the owner says yes or no, and both are results. Only a skipped answer leaves the row open. */
export async function askKind(ctx: Ctx, question: string, labels: { yes: string; no: string }): Promise<Part> {
  const answer = await ctx.deps.ask(question);
  if (answer === "skip") return { ok: null, text: "not answered" };
  return { ok: true, text: answer === "y" ? labels.yes : labels.no };
}

export async function askPart(
  ctx: Ctx,
  question: string,
  label: string,
  options?: { optional?: boolean }
): Promise<Part> {
  const answer = await ctx.deps.ask(question);
  const optional = options?.optional === true ? { optional: true } : {};
  if (answer === "skip") return { ok: null, text: `${label}: skipped`, ...optional };
  return { ok: answer === "y", text: `${label}: ${answer === "y" ? "yes" : "no"}`, ...optional };
}

export const needs = (what: string): Outcome => skip(`not run: ${what} is missing (an earlier row failed)`);

export const aadstsOf = (description: string | undefined): string => description?.match(/AADSTS\d{3,7}/)?.[0] ?? "none";

/** The consent redirect, once per run. Evidence shows the error word and the query names, never a value of a secret. */
export async function consent(ctx: Ctx): Promise<CallbackParams> {
  if (ctx.state.params !== undefined) return ctx.state.params;
  const { verifier, challenge } = pkcePair();
  ctx.state.verifier = verifier;
  const scopes = ctx.provider === "google" ? GOOGLE_SCOPES : [...MS_BASE_SCOPES, MS_IMAP_SCOPE, MS_GRAPH_SCOPE];
  ctx.state.params = await ctx.deps.browse((state) =>
    authorizeUrl(ctx.provider, ctx.endpoints, { clientId: ctx.env.clientId, state, challenge, scopes })
  );
  return ctx.state.params;
}

export const queryNames = (params: CallbackParams): string =>
  Object.keys(params)
    .map((name) => (/^[a-z_]{1,30}$/.test(name) ? name : "<odd>"))
    .join(" ");

/** Why a consent did not give a code: the error word and the AADSTS code. */
export function refusalText(params: CallbackParams): string {
  return `error ${word(params["error"])}, ${aadstsOf(params["error_description"])}, query names: ${queryNames(params)}`;
}

const clientForm = (ctx: Ctx, form: Record<string, string>): Record<string, string> => ({
  client_id: ctx.env.clientId,
  ...(ctx.env.clientSecret === undefined ? {} : { client_secret: ctx.env.clientSecret }),
  ...form,
});

export function refreshForm(ctx: Ctx, refreshToken: string, scope?: string): Record<string, string> {
  return clientForm(ctx, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    ...(scope === undefined ? {} : { scope }),
  });
}

export type RedeemResult = { ok: true } | { ok: false; evidence: string };

/**
 * Redeem the code once. Microsoft: the code gives the IMAP token; the refresh token then gives the Graph token (row M2).
 * Google: the code gives one token for IMAP and SMTP. The tokens stay in `ctx.state`.
 */
export function redeem(ctx: Ctx): Promise<RedeemResult> {
  ctx.state.redeem ??= redeemOnce(ctx);
  return ctx.state.redeem;
}

async function redeemOnce(ctx: Ctx): Promise<RedeemResult> {
  const params = await consent(ctx);
  const code = params["code"];
  if (code === undefined) return { ok: false, evidence: `no code: ${refusalText(params)}` };
  const microsoft = ctx.provider !== "google";
  const first = await tokenRequest(
    ctx.deps.fetch,
    ctx.endpoints.tokenUrl,
    clientForm(ctx, {
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: ctx.state.verifier ?? "",
      ...(microsoft ? { scope: [...MS_BASE_SCOPES, MS_IMAP_SCOPE].join(" ") } : {}),
    })
  );
  const access = text(first.body, "access_token");
  const refresh = text(first.body, "refresh_token");
  if (first.status !== 200 || access === undefined) {
    return { ok: false, evidence: `code redeem failed: ${errorCodes(first)}` };
  }
  if (refresh === undefined)
    return { ok: false, evidence: `code redeem gave no refresh token, scope ${scopeText(first.body)}` };
  const tokens: Tokens = { imap: access, imapScope: scopeText(first.body), refresh };
  const idToken = text(first.body, "id_token");
  if (idToken !== undefined) tokens.idToken = idToken;
  ctx.state.claims = idClaims(idToken);
  ctx.state.tokens = tokens;
  if (microsoft) {
    const second = await tokenRequest(
      ctx.deps.fetch,
      ctx.endpoints.tokenUrl,
      refreshForm(ctx, refresh, `offline_access ${MS_GRAPH_SCOPE}`)
    );
    const graph = text(second.body, "access_token");
    if (second.status !== 200 || graph === undefined) {
      return { ok: false, evidence: `refresh token for Graph failed: ${errorCodes(second)}` };
    }
    tokens.graph = graph;
    tokens.graphScope = scopeText(second.body);
    tokens.refresh = text(second.body, "refresh_token") ?? refresh;
  }
  return { ok: true };
}

/**
 * Log in to IMAP with each login candidate from the ID token. The first success stays open as the session. The other
 * results are kept for row M12. Returns the evidence of a failure, or null.
 */
export async function connectImap(ctx: Ctx): Promise<string | null> {
  if (ctx.state.imap !== undefined) return null;
  const redeemed = await redeem(ctx);
  if (!redeemed.ok) return redeemed.evidence;
  const tokens = ctx.state.tokens;
  if (tokens === undefined) return "no tokens";
  const claims = ctx.state.claims;
  const candidates: { claim: LoginAttempt["claim"]; user: string }[] = [];
  for (const claim of ["preferred_username", "email"] as const) {
    const user = claims[claim];
    if (user !== undefined && !candidates.some((candidate) => candidate.user.toLowerCase() === user.toLowerCase())) {
      candidates.push({ claim, user });
    }
  }
  if (candidates.length === 0) return "the ID token has no email or preferred_username claim";
  const attempts: LoginAttempt[] = [];
  for (const { claim, user } of candidates) {
    try {
      const session = await openImap(ctx.endpoints.imap, user, { accessToken: tokens.imap });
      attempts.push({ claim, ok: true });
      if (ctx.state.imap === undefined) {
        ctx.state.imap = session;
        ctx.state.login = user;
      } else {
        await session.logout().catch(() => undefined);
      }
    } catch (error) {
      attempts.push({ claim, ok: false, codes: failureCodes(error) });
    }
  }
  ctx.state.attempts = attempts;
  if (ctx.state.imap === undefined) {
    return `imap login failed: ${attempts.map((attempt) => `${attempt.claim} ${attempt.codes ?? ""}`).join("; ")}`;
  }
  return null;
}

export async function folders(ctx: Ctx, session: ImapSession): Promise<ListResponse[]> {
  ctx.state.folders ??= await session.list();
  return ctx.state.folders;
}

export const ownerIsLogin = (ctx: Ctx): boolean =>
  ctx.state.login !== undefined && ctx.state.login.toLowerCase() === ctx.env.ownerAddress.toLowerCase();

export async function pollFor<T>(
  ctx: Ctx,
  probe: () => Promise<T | undefined>,
  options: { timeoutMs: number; everyMs: number }
): Promise<{ value: T | undefined; seconds: number }> {
  const start = ctx.deps.now();
  for (;;) {
    const value = await probe();
    const elapsed = ctx.deps.now() - start;
    if (value !== undefined || elapsed >= options.timeoutMs) return { value, seconds: Math.round(elapsed / 1000) };
    await ctx.deps.sleep(options.everyMs);
  }
}

export async function closeSession(ctx: Ctx): Promise<void> {
  const session = ctx.state.imap;
  ctx.state.imap = undefined;
  if (session !== undefined) await session.logout().catch(() => undefined);
}

/** The IMAP session, or the evidence of the failure. */
export async function imapOrFail(ctx: Ctx): Promise<ImapSession | Outcome> {
  const failure = await connectImap(ctx);
  if (failure !== null) return fail(failure);
  const session = ctx.state.imap;
  return session === undefined ? needs("the IMAP session") : session;
}

export const isOutcome = (value: ImapSession | Outcome): value is Outcome => "verdict" in value;

/** Append a test message to `path`. Returns the UID, or undefined when the server gives no UID. */
export async function appendTest(
  ctx: Ctx,
  session: ImapSession,
  path: string,
  spec: { subject: string; messageId: string; flags?: string[]; inReplyTo?: string; references?: string }
): Promise<number | undefined> {
  const login = ctx.state.login ?? "";
  const mime = await buildMime({
    from: login,
    to: login,
    subject: spec.subject,
    text: "Test mail of the mail OAuth spike. Delete it.",
    messageId: spec.messageId,
    ...(spec.inReplyTo === undefined ? {} : { inReplyTo: spec.inReplyTo }),
    ...(spec.references === undefined ? {} : { references: spec.references }),
  });
  const result = await session.append(path, mime, spec.flags ?? []);
  return result === false ? undefined : result.uid;
}

const MAX_SPECIAL_FOLDERS = 12;
const MAX_CAPABILITIES = 40;

/** Capability names for evidence: upper case, a fixed charset, at most 40. */
export function capabilityText(session: ImapSession): string {
  const names = [...session.capabilities.keys()].map((key) => key.toUpperCase());
  const shown = names.slice(0, MAX_CAPABILITIES).map(capability).join(" ");
  return names.length > MAX_CAPABILITIES ? `${shown} (+${names.length - MAX_CAPABILITIES} more)` : shown;
}

/**
 * LIST for evidence. The INBOX and the special-use folders show by name (cut to 40 characters); every other folder
 * only adds to a count. A big mailbox cannot push the evidence over the guard limit.
 */
export function listText(list: ListResponse[]): string {
  const special = list.filter((folder) => folder.specialUse !== undefined || folder.path === "INBOX");
  const shown = special
    .slice(0, MAX_SPECIAL_FOLDERS)
    .map((folder) => `${folderPath(folder.path)} ${folder.specialUse ?? "-"}`);
  return `${shown.join(" | ")} | other folders: ${list.length - shown.length}`;
}
