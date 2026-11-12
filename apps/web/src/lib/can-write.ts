import type { Me } from "@ea/core/web";

// A suspended organization takes no write: the server refuses it (`org_suspended`), the panel hides or disables the control.
export function canWrite(me: Pick<Me, "organization"> | null): boolean {
  return me !== null && me.organization.plan !== "suspended";
}
