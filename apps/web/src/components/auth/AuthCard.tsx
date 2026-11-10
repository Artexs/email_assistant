import type { ReactNode } from "react";

import { t, type TextKey } from "../../i18n/en";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";

export function AuthCard({ title, children }: { title: TextKey; children: ReactNode }) {
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
