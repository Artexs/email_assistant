// The one local ESLint plugin `ea`. Later local rules join `rules` here; eslint.config.js registers it once.
import noLocaleUnion from "./no-locale-union.js";
import noTimeLiterals from "./no-time-literals.js";

export default {
  meta: { name: "ea" },
  rules: { "no-locale-union": noLocaleUnion, "no-time-literals": noTimeLiterals },
};
