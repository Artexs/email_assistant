import { t } from "../../i18n/en";
import { Card, CardContent } from "../ui/card";

export function Placeholder() {
  return (
    <Card>
      <CardContent>
        <p className="text-muted-foreground">{t("placeholder_text")}</p>
      </CardContent>
    </Card>
  );
}
