export const en = {
  brand: "Email Assistant",
  noscript: "This app needs JavaScript. Turn it on and reload the page.",
  continue: "Continue",
  // nav
  nav_main: "Main",
  nav_onboarding: "Onboarding",
  nav_activity: "Activity",
  nav_mailboxes: "Mailboxes",
  nav_settings: "Settings",
  nav_rules: "Rules",
  menu_open: "Open menu",
  menu_title: "Menu",
  user_menu: "Account menu",
  log_out: "Log out",
  // shell states
  auth_error_banner_one: "1 mailbox has a login error.",
  auth_error_banner_many: "{count} mailboxes have a login error.",
  auth_error_banner_link: "Open Mailboxes",
  placeholder_text: "Not built yet. It comes with the next update.",
  no_organization_title: "No organization",
  no_organization_text: "Your account is not in any organization. Ask the owner for an invitation.",
  load_error_text: "Could not load your account.",
  retry: "Retry",
  loading: "Loading",
  // login
  login_title: "Sign in",
  email_label: "E-mail",
  password_label: "Password",
  sign_in: "Sign in",
  signing_in: "Signing in…",
  login_error_credentials: "Wrong e-mail or password.",
  error_too_many: "Too many attempts. Wait a minute and try again.",
  error_generic: "Something went wrong. Try again.",
  login_setup_done: "Password set. Sign in.",
  login_help_summary: "No password yet?",
  login_help_text:
    "Setup links are created on the server with web:invite. A link works once, for 24 hours. If yours has expired, ask for a new one.",
  // setup
  setup_title: "Set your password",
  new_password_label: "New password",
  repeat_password_label: "Repeat password",
  password_help: "At least 12 characters. A passphrase of a few words works well.",
  set_password: "Set password",
  setting_password: "Setting password…",
  password_too_short: "At least 12 characters.",
  password_too_long: "At most 128 characters.",
  passwords_differ: "The passwords do not match.",
  email_invalid: "Enter a valid e-mail address.",
  password_required: "Enter your password.",
  setup_link_invalid: "This link was used or has expired. Ask for a new one.",
  setup_link_missing: "This page needs a setup link.",
  go_to_sign_in: "Go to sign in",
  // 404
  not_found_title: "Page not found",
  not_found_text: "This page does not exist.",
  not_found_link: "Go to the start page",
  // page titles
  title_onboarding: "Onboarding",
  title_activity: "Activity",
  title_mailboxes: "Mailboxes",
  title_settings: "Settings",
  title_rules: "Rules",
  title_login: "Sign in",
  title_setup: "Set your password",
  title_not_found: "Page not found",
} as const;

export type TextKey = keyof typeof en;

export function t(key: TextKey, vars?: Record<string, string | number>): string {
  const text: string = en[key];
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}
