// Every file of this folder imports `z` from here. Zod 4 probes `new Function("")` when it builds an object schema,
// and the strict meta CSP of the web reports it; `jitless` stops the probe. The flag is global for the process.
import { z } from "zod";

z.config({ jitless: true });

export { z };
