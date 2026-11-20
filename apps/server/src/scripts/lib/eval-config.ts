import { createCliOutput } from "../../platform/cli";
import { type Config, ConfigError, loadConfig } from "../../platform/config";

const cli = createCliOutput("eval");

/**
 * The config for an eval run that needs it (`--sim`, the case sets, `--real`). A bad value stops the run with the
 * key names, never a value: `config error: <KEY>`, a key of the config. null: the error is printed, the caller returns 1.
 * `--suspicious` and `--gap` read no config.
 */
export function loadEvalConfig(): Config | null {
  try {
    return loadConfig();
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    cli.fail(`config error: ${error.keys.join(", ")}`);
    return null;
  }
}
