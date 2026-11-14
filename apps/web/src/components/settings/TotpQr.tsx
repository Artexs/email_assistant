import { useMemo } from "react";

import { t } from "../../i18n";
import { qrPath } from "../../lib/totp-setup";

// The QR code of an otpauth URI as one SVG path. It is drawn in the browser: the secret never leaves the page.
export function TotpQr({ uri }: { uri: string }) {
  const { size, d } = useMemo(() => qrPath(uri), [uri]);
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={t("tf_qr_label")}
      shapeRendering="crispEdges"
      className="h-48 w-48 rounded-md bg-white p-0"
      data-qr="totp"
    >
      <path d={d} fill="#000" />
    </svg>
  );
}
