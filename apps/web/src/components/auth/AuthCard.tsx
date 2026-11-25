import { useEffect, type ReactNode } from "react";

import { t, useLocale, type TextKey } from "../../i18n";
import { BrandMark } from "../shell/BrandMark";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";

// The page title: one `h1`. The static title is English; the client sets the title in the current language.
function useDocumentTitle(title: TextKey) {
  const locale = useLocale();
  useEffect(() => {
    document.title = `${t(title)} · ${t("brand")}`;
  }, [title, locale]);
}

// The frame of a sign-in step. Without `panel` it is one card. With `panel` it is two columns from `lg`: the brand panel on the left
// and the form on the right; below `lg` only the form shows, with the mark and the name above its title.
export function AuthCard({ title, children, panel = false }: { title: TextKey; children: ReactNode; panel?: boolean }) {
  useDocumentTitle(title);
  if (!panel) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            <h1 className="text-2xl font-bold">{t(title)}</h1>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">{children}</CardContent>
      </Card>
    );
  }
  return (
    <div className="grid min-h-screen gap-5 p-5 lg:grid-cols-2">
      <aside className="bg-primary text-primary-foreground hidden flex-col justify-between gap-10 rounded-[32px] p-10 lg:flex">
        <p className="flex items-center gap-3 text-lg font-extrabold">
          <BrandMark tone="inverse" />
          {t("brand")}
        </p>
        <div className="flex flex-col gap-3">
          <p className="text-3xl font-extrabold">{t("login_panel_title")}</p>
          <p className="text-base">{t("login_panel_text")}</p>
        </div>
      </aside>
      <div className="flex items-center justify-center p-1 lg:p-6">
        <div className="flex w-full max-w-100 flex-col gap-6">
          <div className="flex flex-col gap-6">
            <p className="flex items-center gap-3 text-lg font-extrabold lg:hidden">
              <BrandMark />
              {t("brand")}
            </p>
            <h1 className="text-2xl font-bold">{t(title)}</h1>
          </div>
          <div className="flex flex-col gap-4">{children}</div>
        </div>
      </div>
    </div>
  );
}
