// The phone channel: the offline page of the installed panel and the push device card.
export const enPhone = {
  offline_title: "No connection",
  offline_text: "The panel needs a network connection to show your data. Check the connection and try again.",
  offline_retry: "Try again",

  // The push device card of Settings
  push_title: "Phone notices",
  push_help:
    "Get a short notice on this device when something needs you. It shows a kind and a count, never mail text. Notices stop when your sign-in ends: open the panel again to bring them back.",
  push_not_set_up: "Phone notices are not set up on this server",
  push_unsupported: "This browser cannot show phone notices.",
  push_devices_title: "Devices with notices",
  push_no_devices: "No device has notices on yet.",
  push_added: "Added {date}",
  push_last: "Last notice {date}",
  push_never: "No notice delivered yet",
  push_enable: "Turn on notices on this device",
  push_enabled_toast: "Notices are on for this device.",
  push_blocked: "Notices are blocked in the browser settings",
  push_enable_failed: "Could not turn on notices on this device. Try again.",
  push_test: "Send a test notice",
  push_test_none: "No notice was sent. Turn on notices on this device first.",
  push_test_limit: "Too many test notices. Try again in an hour.",
  push_load_error: "Could not load the devices.",
  push_remove_short: "Remove",
  push_remove: "Remove {label}",
  push_remove_title: "Remove this device?",
  push_remove_text: "It gets no more notices. You can turn them on again on that device.",
  push_remove_confirm: "Remove device",
  push_removed_toast: "Device removed.",
  push_install: "Install the app",
  push_install_ios: "Share → Add to Home Screen, then open the app and turn on notices here (iOS 16.4 or later).",
} as const;
