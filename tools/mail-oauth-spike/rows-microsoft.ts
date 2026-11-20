import {
  buildMime,
  folderBySpecialUse,
  graphSendMime,
  newMessageId,
  plusAddress,
  readHeaders,
  searchMessageId,
  smtpLogin,
} from "./mail";
import { errorCodes, MS_GRAPH_SCOPE, randomToken, REDIRECT_URI, text, tokenRequest } from "./oauth";
import { word } from "./redact";
import {
  aadstsOf,
  appendTest,
  askKind,
  capabilityText,
  askPart,
  combine,
  connectImap,
  consent,
  fail,
  folders,
  imapOrFail,
  isOutcome,
  listText,
  needs,
  ownerIsLogin,
  pass,
  pollFor,
  queryNames,
  redeem,
  refreshForm,
  refusalText,
  yes,
  type Ctx,
  type Part,
  type Row,
} from "./rows-core";

// Rows of the Microsoft business tenant (M1–M14) and the personal account.

const m1: Row = {
  id: "M1",
  async run(ctx) {
    const params = await consent(ctx);
    if (params["error"] !== undefined) return fail(`consent refused: ${refusalText(params)}`);
    if (params["code"] === undefined) return fail(`callback without code or error: ${refusalText(params)}`);
    const kind = await askKind(
      ctx,
      "M1: Which consent screen did you see? y = you could approve for yourself (user consent), n = it asked for an administrator.",
      { yes: "consent screen kind: user consent", no: "consent screen kind: administrator approval" }
    );
    return combine([{ ok: true, text: "consent redirect gave a code" }, kind]);
  },
};

const m2: Row = {
  id: "M2",
  async run(ctx) {
    const redeemed = await redeem(ctx);
    if (!redeemed.ok) return fail(redeemed.evidence);
    const tokens = ctx.state.tokens;
    if (tokens?.graph === undefined) return needs("the Graph token");
    return pass(
      `code redeemed for IMAP: yes, granted scope ${tokens.imapScope}; refresh token redeemed for Graph: yes, granted scope ${tokens.graphScope ?? "absent"}`
    );
  },
};

const m3: Row = {
  id: "M3",
  async run(ctx) {
    const failure = await connectImap(ctx);
    if (failure !== null) return fail(failure);
    const winner = ctx.state.attempts?.find((attempt) => attempt.ok);
    const defaults = await askPart(
      ctx,
      "M3: Are security defaults ON for this tenant (Entra admin center → Properties → Manage security defaults)? (y/n/skip)",
      "owner says security defaults are on"
    );
    return combine([{ ok: true, text: `OAuth IMAP login works (login claim ${winner?.claim ?? "?"})` }, defaults]);
  },
};

const m4: Row = {
  id: "M4",
  async run(ctx) {
    const session = await imapOrFail(ctx);
    if (isOutcome(session)) return session;
    const capabilities = [...session.capabilities.keys()].map((key) => key.toUpperCase());
    const list = await folders(ctx, session);
    const missingCapabilities = ["MOVE", "UIDPLUS", "IDLE"].filter((name) => !capabilities.includes(name));
    const missingFolders = (["\\Sent", "\\Drafts", "\\Trash", "\\Junk"] as const).filter(
      (flag) => !list.some((folder) => folder.specialUse === flag)
    );
    const evidence = `CAPABILITY: ${capabilityText(session)}; LIST: ${listText(list)}`;
    const gaps = [...missingCapabilities, ...missingFolders.map((flag) => `special-use ${flag}`)];
    return gaps.length === 0 ? pass(evidence) : fail(`missing ${gaps.join(", ")}; ${evidence}`);
  },
};

const m5: Row = {
  id: "M5",
  async run(ctx) {
    const session = await imapOrFail(ctx);
    if (isOutcome(session)) return session;
    const list = await folders(ctx, session);
    const delimiter = list.find((folder) => folder.path === "INBOX")?.delimiter ?? "/";
    const spikePath = `AI${delimiter}Spike`;
    const created = await session.mailboxCreate(spikePath);
    const messageId = newMessageId();
    const uid = await appendTest(ctx, session, "INBOX", { subject: "EA spike M5 move", messageId });
    if (uid === undefined) return fail(`folder ${spikePath} created: ${yes(created.created)}; APPEND gave no UID`);
    const lock = await session.getMailboxLock("INBOX");
    try {
      const moved = await session.messageMove([uid], spikePath, { uid: true });
      const copyuid = moved !== false && moved.uidMap !== undefined && moved.uidMap.size > 0;
      const evidence = `folder ${spikePath} created: ${yes(created.created)}; APPEND to INBOX gave a UID; UID MOVE gave COPYUID: ${yes(copyuid)}`;
      return copyuid ? pass(evidence) : fail(evidence);
    } finally {
      lock.release();
    }
  },
};

const m6: Row = {
  id: "M6",
  async run(ctx) {
    const session = await imapOrFail(ctx);
    if (isOutcome(session)) return session;
    const drafts = folderBySpecialUse(await folders(ctx, session), "\\Drafts", "Drafts");
    if (drafts === undefined) return fail("no Drafts folder in LIST");
    const rootId = newMessageId();
    await appendTest(ctx, session, "INBOX", { subject: "EA spike M6 thread root", messageId: rootId });
    const plain = await appendTest(ctx, session, drafts, {
      subject: "EA spike M6 draft",
      messageId: newMessageId(),
      flags: ["\\Draft"],
    });
    const reply = await appendTest(ctx, session, drafts, {
      subject: "Re: EA spike M6 thread root",
      messageId: newMessageId(),
      flags: ["\\Draft"],
      inReplyTo: rootId,
      references: rootId,
    });
    const appended: Part = {
      ok: plain !== undefined && reply !== undefined,
      text: `APPEND to Drafts gave a UID: ${yes(plain !== undefined && reply !== undefined)}`,
    };
    ctx.deps.say("M6: open Outlook on the web, folder Drafts.");
    const editable = await askPart(
      ctx,
      "M6: Can you open and edit the draft 'EA spike M6 draft'? (y/n/skip)",
      "draft editable in Outlook on the web"
    );
    const threaded = await askPart(
      ctx,
      "M6: Does the draft 'Re: EA spike M6 thread root' sit in the thread with the Inbox mail 'EA spike M6 thread root'? (y/n/skip)",
      "reply draft in the thread"
    );
    return combine([appended, editable, threaded]);
  },
};

const m7: Row = {
  id: "M7",
  async run(ctx) {
    const session = await imapOrFail(ctx);
    if (isOutcome(session)) return session;
    const uid = await appendTest(ctx, session, "INBOX", { subject: "EA spike M7 unread", messageId: newMessageId() });
    const shown = await askPart(
      ctx,
      "M7: Does 'EA spike M7 unread' show in the Inbox of Outlook on the web as unread, new mail? (y/n/skip)",
      "APPEND to INBOX shows as unread new mail"
    );
    return combine([{ ok: uid !== undefined, text: `APPEND gave a UID: ${yes(uid !== undefined)}` }, shown]);
  },
};

const m8: Row = {
  id: "M8",
  async run(ctx) {
    const session = await imapOrFail(ctx);
    if (isOutcome(session)) return session;
    const lock = await session.getMailboxLock("INBOX");
    try {
      const start = ctx.deps.now();
      const idle = session.idle();
      await ctx.deps.sleep(1000);
      const started = session.idling;
      await session.noop();
      await idle;
      const seconds = (ctx.deps.now() - start) / 1000;
      const evidence = `IDLE started: ${yes(started)}; IDLE ended after ${seconds.toFixed(1)} s (limit 5 s)`;
      return started && seconds <= 5 ? pass(evidence) : fail(evidence);
    } finally {
      lock.release();
    }
  },
};

const m9: Row = {
  id: "M9",
  async run(ctx) {
    const redeemed = await redeem(ctx);
    if (!redeemed.ok) return fail(redeemed.evidence);
    if (ctx.state.login === undefined) {
      const failure = await connectImap(ctx);
      if (failure !== null) return fail(failure);
    }
    const tokens = ctx.state.tokens;
    if (tokens === undefined || ctx.state.login === undefined) return needs("the login");
    const result = await smtpLogin({ ...ctx.endpoints.smtp, user: ctx.state.login, accessToken: tokens.imap });
    if (result.ok) return fail("SMTP XOAUTH2 login was accepted (expected the refusal 5.7.139)");
    const evidence = `SMTP XOAUTH2 login refused: ${result.codes} (expected 5.7.139)`;
    return result.codes.includes("5.7.139") ? pass(evidence) : fail(evidence);
  },
};

/** Send a MIME mail with Graph to the plus address. Shared by the Graph probes. Returns the HTTP status. */
async function graphSend(
  ctx: Ctx,
  spec: { subject: string; messageId: string; actionId: string; bcc?: string }
): Promise<number | undefined> {
  const graph = ctx.state.tokens?.graph;
  const graphBase = ctx.endpoints.graphBase;
  const login = ctx.state.login;
  if (graph === undefined || graphBase === undefined || login === undefined) return undefined;
  const mime = await buildMime({
    from: login,
    to: plusAddress(ctx.env.ownerAddress, "ea-spike"),
    ...(spec.bcc === undefined ? {} : { bcc: spec.bcc }),
    subject: spec.subject,
    text: "Test mail of the mail OAuth spike. Delete it.",
    messageId: spec.messageId,
    actionId: spec.actionId,
  });
  return await graphSendMime(ctx.deps.fetch, graphBase, graph, mime);
}

const m10: Row = {
  id: "M10",
  async run(ctx) {
    const session = await imapOrFail(ctx);
    if (isOutcome(session)) return session;
    const messageId = newMessageId();
    const actionId = randomToken(9);
    const status = await graphSend(ctx, {
      subject: "EA spike M10",
      messageId,
      actionId,
      bcc: plusAddress(ctx.env.ownerAddress, "ea-spike-bcc"),
    });
    if (status === undefined) return needs("the Graph token");
    if (status !== 202) return fail(`Graph sendMail MIME answered http ${status} (expected 202)`);
    const parts: Part[] = [{ ok: true, text: "Graph sendMail MIME answered http 202" }];

    const sent = folderBySpecialUse(await folders(ctx, session), "\\Sent", "Sent Items");
    if (sent === undefined) return fail("no Sent Items folder in LIST");
    const copy = await pollFor(ctx, async () => (await searchMessageId(session, sent, messageId))[0], {
      timeoutMs: 60_000,
      everyMs: 5000,
    });
    if (copy.value === undefined) {
      parts.push({ ok: false, text: "Sent Items copy found by SEARCH HEADER Message-ID within 60 s: no" });
    } else {
      const headers = await readHeaders(session, sent, copy.value, ["message-id", "x-ea-action-id"]);
      parts.push({ ok: true, text: `Sent Items copy found by SEARCH HEADER Message-ID after ${copy.seconds} s: yes` });
      parts.push({
        ok: headers["message-id"] === messageId,
        text: `Sent copy Message-ID unchanged: ${yes(headers["message-id"] === messageId)}`,
      });
      parts.push({
        ok: headers["x-ea-action-id"] === actionId,
        text: `Sent copy X-EA-Action-Id unchanged: ${yes(headers["x-ea-action-id"] === actionId)}`,
      });
    }

    if (ownerIsLogin(ctx)) {
      const arrived = await pollFor(ctx, async () => (await searchMessageId(session, "INBOX", messageId))[0], {
        timeoutMs: 60_000,
        everyMs: 5000,
      });
      parts.push({
        ok: arrived.value !== undefined,
        text: `plus-address mail arrived in INBOX within 60 s: ${yes(arrived.value !== undefined)}`,
      });
    } else {
      parts.push(
        await askPart(
          ctx,
          "M10: Did the mail 'EA spike M10' arrive at your owner address? (y/n/skip)",
          "plus-address mail arrived"
        )
      );
    }
    parts.push(
      await askPart(ctx, "M10: Did the Bcc copy arrive at the '+ea-spike-bcc' address? (y/n/skip)", "Bcc delivered")
    );
    const outcome = combine(parts);
    return { ...outcome, evidence: `${outcome.evidence}; size limit not probed (docs only)` };
  },
};

const m11: Row = {
  id: "M11",
  async run(ctx) {
    const redeemed = await redeem(ctx);
    if (!redeemed.ok) return fail(redeemed.evidence);
    const tokens = ctx.state.tokens;
    if (tokens === undefined) return needs("the refresh token");
    const old = tokens.refresh;
    const scope = `offline_access ${MS_GRAPH_SCOPE}`;
    const first = await tokenRequest(ctx.deps.fetch, ctx.endpoints.tokenUrl, refreshForm(ctx, old, scope));
    const next = text(first.body, "refresh_token");
    const rotated = first.status === 200 && next !== undefined && next !== old;
    if (next !== undefined) tokens.refresh = next;
    const again = await tokenRequest(ctx.deps.fetch, ctx.endpoints.tokenUrl, refreshForm(ctx, old, scope));
    const evidence = `refresh http ${first.status}; new refresh token returned: ${yes(next !== undefined)}; differs from the old one: ${yes(rotated)}; old token redeems again: ${yes(again.status === 200)} (http ${again.status})`;
    return rotated ? pass(evidence) : fail(evidence);
  },
};

const m12: Row = {
  id: "M12",
  async run(ctx) {
    const failure = await connectImap(ctx);
    if (failure !== null) return fail(failure);
    const { email, preferred_username: upn } = ctx.state.claims;
    const attempt = (claim: "email" | "preferred_username"): string => {
      const found = ctx.state.attempts?.find((item) => item.claim === claim);
      return found === undefined ? "not tried (same value as the other claim, or absent)" : yes(found.ok);
    };
    const equal = email !== undefined && upn !== undefined && email.toLowerCase() === upn.toLowerCase();
    const evidence = `email claim present: ${yes(email !== undefined)}; preferred_username claim present: ${yes(upn !== undefined)}; both equal: ${yes(equal)}; IMAP login with email: ${attempt("email")}; with preferred_username: ${attempt("preferred_username")}`;
    return ctx.state.attempts?.some((item) => item.ok) === true ? pass(evidence) : fail(evidence);
  },
};

const m13: Row = {
  id: "M13",
  async run(ctx) {
    const redeemed = await redeem(ctx);
    if (!redeemed.ok) return fail(redeemed.evidence);
    const scope = `offline_access ${MS_GRAPH_SCOPE}`;
    const garbage = await tokenRequest(
      ctx.deps.fetch,
      ctx.endpoints.tokenUrl,
      refreshForm(ctx, "garbage-refresh-token", scope)
    );
    const parts: Part[] = [
      { ok: garbage.status >= 400 && garbage.status < 500, text: `garbage refresh token: ${errorCodes(garbage)}` },
    ];
    const removal = await askPart(
      ctx,
      "M13 (optional): Remove the app now in My Apps (myapps.microsoft.com → your profile → Manage → apps), then answer y. This ends the grant. (y/n/skip)",
      "app removed in My Apps",
      { optional: true }
    );
    if (removal.ok === true && ctx.state.tokens !== undefined) {
      const after = await tokenRequest(
        ctx.deps.fetch,
        ctx.endpoints.tokenUrl,
        refreshForm(ctx, ctx.state.tokens.refresh, scope)
      );
      parts.push({ ok: after.status >= 400, text: `refresh after removal: ${errorCodes(after)}`, optional: true });
    } else {
      parts.push({ ok: null, text: "refresh after removal: not tested", optional: true });
    }
    return combine(parts);
  },
};

const m14: Row = {
  id: "M14",
  async run(ctx) {
    const base = ctx.endpoints.adminConsentUrl;
    if (base === undefined) return needs("an admin-consent endpoint");
    const params = await ctx.deps.browse(
      (state) =>
        `${base}?${new URLSearchParams({
          client_id: ctx.env.clientId,
          redirect_uri: REDIRECT_URI,
          state,
          scope: "https://graph.microsoft.com/.default",
        }).toString()}`
    );
    const granted = params["admin_consent"]?.toLowerCase() === "true";
    const evidence = `admin consent redirect: admin_consent ${granted ? "True" : word(params["admin_consent"] ?? "absent")}, error ${word(params["error"] ?? "none")}, ${aadstsOf(params["error_description"])}; query names: ${queryNames(params)}`;
    return granted ? pass(evidence) : fail(evidence);
  },
};

const p1: Row = {
  id: "P1",
  async run(ctx) {
    const failure = await connectImap(ctx);
    if (failure !== null) return fail(failure);
    const parts: Part[] = [
      { ok: true, text: `common consent gave a code; granted scope ${ctx.state.tokens?.imapScope ?? "absent"}` },
      { ok: true, text: "OAuth IMAP login works" },
    ];
    const status = await graphSend(ctx, {
      subject: "EA spike P1",
      messageId: newMessageId(),
      actionId: randomToken(9),
    });
    if (status === undefined) return needs("the Graph token");
    parts.push({
      ok: status === 202,
      text: `Graph sendMail MIME answered http ${status} (expected 202); Graph granted scope ${ctx.state.tokens?.graphScope ?? "absent"}`,
    });
    return combine(parts);
  },
};

export const MICROSOFT_ROWS: Row[] = [m1, m2, m3, m4, m5, m6, m7, m8, m9, m10, m11, m12, m13, m14];
export const PERSONAL_ROWS: Row[] = [p1];
