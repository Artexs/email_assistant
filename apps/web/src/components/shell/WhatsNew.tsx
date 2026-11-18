import { docsUrl } from "@ea/core/web";
import { X } from "lucide-react";
import { useState } from "react";

import { getLocale, t, useLocale } from "../../i18n";
import { readSeen, whatsNew, writeSeen, type CardRelease } from "../../lib/whats-new";
import { Button } from "../ui/button";

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

/** The browser storage, or null when even the access throws (a blocked storage). */
export function browserStorage(): Storage | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/** The Help link of the shell. The caller shows it only with the flag `docs_links` on. */
export function HelpLink({ className }: { className?: string }) {
  // `useLocale` subscribes to a language switch; `getLocale` is the value `t()` uses in the same render (also on the server).
  useLocale();
  const locale = getLocale();
  return (
    <a href={docsUrl("/", locale)} target="_blank" rel="noopener noreferrer" className={className}>
      {t("help_link")}
    </a>
  );
}

interface CardState {
  storage: Storage;
  newest: string;
  show: readonly CardRelease[];
}

/** The card of this page load: null when nothing is new or the storage is not usable. */
function openCard(releases: readonly CardRelease[], userId: string, storage: Storage | null): CardState | null {
  if (storage === null) return null;
  const stored = readSeen(storage, userId);
  if (stored === "unavailable") return null;
  const { show, newest } = whatsNew(releases, stored);
  if (newest === null || show.length === 0) return null;
  return { storage, newest, show };
}

/** The "What is new" card. It reads the storage once per page load; Close hides it and stores the newest version. */
export function WhatsNewCard({
  releases,
  userId,
  getStorage,
}: {
  releases: readonly CardRelease[];
  userId: string;
  getStorage: () => Storage | null;
}) {
  // `useLocale` subscribes to a language switch; `getLocale` is the value `t()` uses in the same render (also on the server).
  useLocale();
  const locale = getLocale();
  const [card, setCard] = useState(() => openCard(releases, userId, getStorage()));
  if (card === null) return null;
  const onDismiss = () => {
    writeSeen(card.storage, userId, card.newest);
    setCard(null);
  };
  return (
    <section aria-labelledby="whats-new-title" className="mx-4 mt-4 rounded-lg border bg-card p-4 text-sm">
      <div className="flex items-start justify-between gap-2">
        <h2 id="whats-new-title" className="font-semibold">
          {t("whats_new_title")}
        </h2>
        <Button
          variant="ghost"
          size="icon"
          className="-mt-2 -mr-2"
          aria-label={t("whats_new_dismiss")}
          onClick={onDismiss}
        >
          <X aria-hidden="true" />
        </Button>
      </div>
      <ul className="mt-1 list-disc space-y-1 pl-5">
        {card.show.flatMap((release) =>
          release.forUsers.map((item) => <li key={`${release.version}:${item.en}`}>{item[locale]}</li>)
        )}
      </ul>
      <a
        href={docsUrl("/changelog/", "en")}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-2 inline-block font-medium underline"
      >
        {t("whats_new_all")}
      </a>
    </section>
  );
}

/** The slot in the shell: nothing, and no storage read, unless the flag `docs_links` is on. */
export function WhatsNewSlot({
  features,
  releases,
  userId,
  getStorage,
}: {
  features: readonly string[];
  releases: readonly CardRelease[];
  userId: string;
  getStorage: () => Storage | null;
}) {
  if (!features.includes("docs_links")) return null;
  return <WhatsNewCard releases={releases} userId={userId} getStorage={getStorage} />;
}
