import { useEffect, type ReactNode } from "react";

import { t, useLocale, type TextKey } from "../../i18n";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";

export function AuthCard({ title, children }: { title: TextKey; children: ReactNode }) {
  const locale = useLocale();
  // The static title is English; the client sets the title in the current language.
  useEffect(() => {
    document.title = `${t(title)} · ${t("brand")}`;
  }, [title, locale]);
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1 className="text-xl">{t(title)}</h1>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">{children}</CardContent>
    </Card>
  );
}
