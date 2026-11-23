export type ColorScheme = "light" | "dark";

// The switch of the dark scan. While it is false every scan runs in the light scheme only.
export const DARK_SCAN_ON = false;

// The schemes a scan covers when the call names none: light always; dark too on the desktop project (the phone gives the same
// colour pairs, and the CI run has a time limit). `darkOn` is a parameter so a test can check the case the constant switches on.
export function defaultSchemes(projectName: string, darkOn: boolean = DARK_SCAN_ON): ColorScheme[] {
  return darkOn && projectName === "desktop" ? ["light", "dark"] : ["light"];
}
