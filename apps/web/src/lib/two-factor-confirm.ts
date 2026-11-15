import type { authClient } from "./auth-client";

type TwoFactorApi = Pick<typeof authClient.twoFactor, "disable" | "generateBackupCodes">;

// F128: turning two-factor off and making new backup codes need a code (an app code or a backup code) as well as the
// password. The Better Auth client types know only `password`; the code goes in `fetchOptions.body`, which the client
// merges into the request body.
export function disableWithCode(api: TwoFactorApi, input: { password: string; code: string }) {
  return api.disable({ password: input.password, fetchOptions: { body: { code: input.code } } });
}

export function newCodesWithCode(api: TwoFactorApi, input: { password: string; code: string }) {
  return api.generateBackupCodes({ password: input.password, fetchOptions: { body: { code: input.code } } });
}
