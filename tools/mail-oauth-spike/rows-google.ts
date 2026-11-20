import {
  buildMime,
  failureCodes,
  folderBySpecialUse,
  newMessageId,
  openImap,
  plusAddress,
  searchMessageId,
  smtpSend,
} from "./mail";
import { errorCodes, randomToken, scopeText, text, tokenRequest } from "./oauth";
import {
  appendTest,
  askKind,
  capabilityText,
  askPart,
  combine,
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
  redeem,
  refreshForm,
  refusalText,
  skip,
  yes,
  type Part,
  type Row,
} from "./rows-core";

// Rows of Google in testing mode (G1–G7).

const g1: Row = {
  id: "G1",
  async run(ctx) {
    const params = await consent(ctx);
    if (params["error"] !== undefined) return fail(`consent refused: ${refusalText(params)}`);
    const redeemed = await redeem(ctx);
    if (!redeemed.ok) return fail(redeemed.evidence);
    const seen = await askKind(
      ctx,
      "G1: Did you see the 'Google hasn't verified this app' screen before you could continue? (y/n/skip)",
      { yes: "unverified-app screen shown: yes", no: "unverified-app screen shown: no" }
    );
    return combine([
      { ok: true, text: `granted scope ${ctx.state.tokens?.imapScope ?? "absent"}` },
      { ok: true, text: "a refresh token came back: yes" },
      seen,
    ]);
  },
};

const g2: Row = {
  id: "G2",
  async run(ctx) {
    const session = await imapOrFail(ctx);
    if (isOutcome(session)) return session;
    const capabilities = [...session.capabilities.keys()].map((key) => key.toUpperCase());
    const list = await folders(ctx, session);
    const missing = ["SPECIAL-USE", "MOVE", "UIDPLUS"].filter((name) => !capabilities.includes(name));
    const evidence = `XOAUTH2 login works; CAPABILITY: ${capabilityText(session)}; LIST: ${listText(list)}`;
    return missing.length === 0 ? pass(evidence) : fail(`missing ${missing.join(", ")}; ${evidence}`);
  },
};

const g3: Row = {
  id: "G3",
  async run(ctx) {
    const session = await imapOrFail(ctx);
    if (isOutcome(session)) return session;
    const list = await folders(ctx, session);
    const delimiter = list.find((folder) => folder.path === "INBOX")?.delimiter ?? "/";
    const spikePath = `AI${delimiter}Spike`;
    const created = await session.mailboxCreate(spikePath);
    const messageId = newMessageId();
    const uid = await appendTest(ctx, session, "INBOX", { subject: "EA spike G3 move", messageId });
    if (uid === undefined) return fail(`label ${spikePath} created: ${yes(created.created)}; APPEND gave no UID`);
    const lock = await session.getMailboxLock("INBOX");
    let moved;
    try {
      moved = await session.messageMove([uid], spikePath, { uid: true });
    } finally {
      lock.release();
    }
    const inInbox = await searchMessageId(session, "INBOX", messageId);
    const inSpike = await searchMessageId(session, spikePath, messageId);
    const allMail = folderBySpecialUse(list, "\\All", "All Mail");
    const inAll = allMail === undefined ? undefined : await searchMessageId(session, allMail, messageId);
    return combine([
      { ok: true, text: `label ${spikePath} created: ${yes(created.created)}` },
      { ok: moved !== false, text: `UID MOVE answered: ${yes(moved !== false)}` },
      { ok: inInbox.length === 0, text: `copies left in INBOX: ${inInbox.length}` },
      { ok: inSpike.length === 1, text: `copies in ${spikePath}: ${inSpike.length}` },
      {
        ok: inAll === undefined ? null : inAll.length === 1,
        text: `copies in All Mail: ${inAll === undefined ? "no All Mail folder in LIST" : inAll.length}`,
      },
    ]);
  },
};

const g4: Row = {
  id: "G4",
  async run(ctx) {
    const session = await imapOrFail(ctx);
    if (isOutcome(session)) return session;
    const drafts = folderBySpecialUse(await folders(ctx, session), "\\Drafts", "Drafts");
    if (drafts === undefined) return fail("no Drafts folder in LIST");
    const plainId = newMessageId();
    const plain = await appendTest(ctx, session, drafts, {
      subject: "EA spike G4 draft",
      messageId: plainId,
      flags: ["\\Draft"],
    });
    if (plain === undefined) return fail("APPEND to Drafts gave no UID");
    const lock = await session.getMailboxLock(drafts);
    try {
      await session.messageDelete([plain], { uid: true });
    } finally {
      lock.release();
    }
    const left = await searchMessageId(session, drafts, plainId);

    const rootId = newMessageId();
    await appendTest(ctx, session, "INBOX", { subject: "EA spike G4 thread root", messageId: rootId });
    const replyId = newMessageId();
    const reply = await appendTest(ctx, session, drafts, {
      subject: "Re: EA spike G4 thread root",
      messageId: replyId,
      flags: ["\\Draft"],
      inReplyTo: rootId,
      references: rootId,
    });
    const threaded = await askPart(
      ctx,
      "G4: Open Gmail. Does the draft 'Re: EA spike G4 thread root' sit in the thread of the Inbox mail 'EA spike G4 thread root'? (y/n/skip)",
      "reply draft in the thread"
    );
    if (reply !== undefined) {
      const replyLock = await session.getMailboxLock(drafts);
      try {
        await session.messageDelete([reply], { uid: true });
      } finally {
        replyLock.release();
      }
    }
    return combine([
      { ok: true, text: "APPEND to Drafts gave a UID: yes" },
      { ok: left.length === 0, text: `copies left after UID EXPUNGE: ${left.length}` },
      threaded,
    ]);
  },
};

const g5: Row = {
  id: "G5",
  async run(ctx) {
    const session = await imapOrFail(ctx);
    if (isOutcome(session)) return session;
    const tokens = ctx.state.tokens;
    const login = ctx.state.login;
    if (tokens === undefined || login === undefined) return needs("the login");
    const messageId = newMessageId();
    const to = plusAddress(ctx.env.ownerAddress, "ea-spike");
    const mime = await buildMime({
      from: login,
      to,
      subject: "EA spike G5",
      text: "Test mail of the mail OAuth spike. Delete it.",
      messageId,
      actionId: randomToken(9),
    });
    try {
      await smtpSend({ ...ctx.endpoints.smtp, user: login, accessToken: tokens.imap }, mime, login, to);
    } catch (error) {
      return fail(`SMTP XOAUTH2 send failed: ${failureCodes(error)}`);
    }
    const parts: Part[] = [{ ok: true, text: "SMTP XOAUTH2 send on port 465 accepted: yes" }];
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
          "G5: Did the mail 'EA spike G5' arrive at your owner address? (y/n/skip)",
          "plus-address mail arrived"
        )
      );
    }
    const sent = folderBySpecialUse(await folders(ctx, session), "\\Sent", "Sent Mail");
    if (sent === undefined) {
      parts.push({ ok: false, text: "no Sent Mail folder in LIST" });
    } else {
      const copies = await pollFor(
        ctx,
        async () => {
          const found = await searchMessageId(session, sent, messageId);
          return found.length > 0 ? found : undefined;
        },
        { timeoutMs: 30_000, everyMs: 3000 }
      );
      const count = copies.value?.length ?? 0;
      parts.push({ ok: count === 1, text: `copies in Sent Mail with the same Message-ID: ${count}` });
    }
    return combine(parts);
  },
};

const g6: Row = {
  id: "G6",
  async run(ctx) {
    const redeemed = await redeem(ctx);
    if (!redeemed.ok) return fail(redeemed.evidence);
    const tokens = ctx.state.tokens;
    const revokeUrl = ctx.endpoints.revokeUrl;
    if (tokens === undefined || revokeUrl === undefined) return needs("the refresh token");
    const old = tokens.refresh;
    const refreshed = await tokenRequest(ctx.deps.fetch, ctx.endpoints.tokenUrl, refreshForm(ctx, old));
    const next = text(refreshed.body, "refresh_token");
    const rotates = next !== undefined && next !== old;
    if (next !== undefined) tokens.refresh = next;
    const revoked = await ctx.deps.fetch(revokeUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: tokens.refresh }).toString(),
    });
    const after = await tokenRequest(ctx.deps.fetch, ctx.endpoints.tokenUrl, refreshForm(ctx, tokens.refresh));
    const invalid = after.body["error"] === "invalid_grant";
    const evidence = `refresh http ${refreshed.status}; refresh answer rotates the refresh token: ${yes(rotates)} (new token returned: ${yes(next !== undefined)}); revoke answered http ${revoked.status}; refresh after revoke: ${errorCodes(after)}; granted scope on refresh ${scopeText(refreshed.body)}`;
    return refreshed.status === 200 && revoked.status === 200 && invalid ? pass(evidence) : fail(evidence);
  },
};

const g7: Row = {
  id: "G7",
  async run(ctx) {
    const login = ctx.state.login ?? ctx.state.claims.email;
    if (login === undefined) return needs("the login address");
    const wanted = await askPart(
      ctx,
      "G7 (optional): Test an IMAP login with an app password? You type it at a hidden prompt. (y/n/skip)",
      "app-password test wanted",
      { optional: true }
    );
    if (wanted.ok !== true) return skip("not run (optional)");
    const password = await ctx.deps.askSecret("G7: app password (hidden): ");
    if (password === null || password.length === 0) return skip("no app password given");
    try {
      const session = await openImap(ctx.endpoints.imap, login, { pass: password });
      await session.logout().catch(() => undefined);
      return pass("app-password IMAP login works: yes");
    } catch (error) {
      return fail(`app-password IMAP login failed: ${failureCodes(error)}`);
    }
  },
};

export const GOOGLE_ROWS: Row[] = [g1, g2, g3, g4, g5, g6, g7];
