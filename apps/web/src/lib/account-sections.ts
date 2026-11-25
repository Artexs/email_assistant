import type { Me } from "@ea/core/web";

import { canDeleteOrganization } from "./delete-organization";

export interface AccountSections {
  // The change-password form and the two-factor section: they need a password.
  passwordControls: boolean;
  // The owner's security log (flag `security_log`).
  securityLog: boolean;
  // The Security card: the two-factor section or the security log. With neither the card is not drawn.
  securityCard: boolean;
  // The delete block: the owner rule of `canDeleteOrganization`, and the member needs a password to confirm it.
  deleteBlock: boolean;
  // The fixed hint for a member who has no password.
  ssoOnlyHint: boolean;
  // The note under the sessions list: this session came from the company account (12 h cap).
  ssoSession: boolean;
}

// Which parts of the account cards a member sees. While `me` is not loaded no password control shows (the form
// would flash for a member without a password).
export function accountSections(
  me: Pick<Me, "hasPassword" | "signInMethod" | "role" | "features"> | null
): AccountSections {
  if (me === null) {
    return {
      passwordControls: false,
      securityLog: false,
      securityCard: false,
      deleteBlock: false,
      ssoOnlyHint: false,
      ssoSession: false,
    };
  }
  const securityLog = me.role === "owner" && me.features.includes("security_log");
  return {
    passwordControls: me.hasPassword,
    securityLog,
    securityCard: me.hasPassword || securityLog,
    deleteBlock: me.hasPassword && canDeleteOrganization(me),
    ssoOnlyHint: !me.hasPassword,
    ssoSession: me.signInMethod === "sso",
  };
}
