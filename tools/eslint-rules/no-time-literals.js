// Rule `ea/no-time-literals`: minutes, hours and days are written with MINUTE_MS, HOUR_MS or DAY_MS from the
// core time module (packages/core/src/time.ts). Plain ESM: `eslint .` loads the config without a TypeScript loader.

const MESSAGE =
  "Write minutes, hours and days with MINUTE_MS, HOUR_MS or DAY_MS from the core time module (packages/core/src/time.ts).";
const TIME_LITERALS = new Set([60_000, 3_600_000, 86_400_000]);
const COPY_NAMES = new Set(["MINUTE", "MINUTE_MS", "MIN_MS", "HOUR", "HOUR_MS", "DAY", "DAY_MS"]);
// A chain with this unit folds into the next larger unit when the integer factors multiply to a multiple of this.
const FOLD_AT = { MINUTE_MS: 60, HOUR_MS: 24 };
const WRAPPERS = new Set(["TSAsExpression", "TSSatisfiesExpression", "TSNonNullExpression", "TSTypeAssertion"]);

const unwrap = (node) => {
  let current = node;
  while (WRAPPERS.has(current.type)) current = current.expression;
  return current;
};
const isProduct = (node) => node.type === "BinaryExpression" && node.operator === "*";
const isNumber = (node) => node.type === "Literal" && typeof node.value === "number";

/** The factors of a `*` chain: nested `*` nodes, parentheses and TS wrappers are flattened. */
function factorsOf(node) {
  const inner = unwrap(node);
  if (!isProduct(inner)) return [inner];
  return [...factorsOf(inner.left), ...factorsOf(inner.right)];
}

/** The parent of `node` once TS wrappers are skipped. */
function parentOf(node) {
  let parent = node.parent;
  while (parent && WRAPPERS.has(parent.type)) parent = parent.parent;
  return parent;
}

/** Product of the integer literal factors, or null when it leaves the safe integers (no float arithmetic). */
function integerProduct(factors) {
  let product = 1;
  for (const factor of factors) {
    if (!isNumber(factor) || !Number.isInteger(factor.value)) continue;
    product *= factor.value;
    if (!Number.isSafeInteger(product)) return null;
  }
  return product;
}

function chainReports(factors) {
  const numbers = factors.filter(isNumber).map((factor) => factor.value);
  if (numbers.some((value) => TIME_LITERALS.has(value))) return true;
  if (numbers.includes(60) && numbers.includes(1000)) return true;
  const product = integerProduct(factors);
  if (product === null || product === 0) return false;
  if (product % 60_000 === 0) return true;
  return factors.some(
    (factor) => factor.type === "Identifier" && factor.name in FOLD_AT && product % FOLD_AT[factor.name] === 0
  );
}

/** True when `node` sits in the initializer of a declarator or class field whose name copies a unit (reported on its own). */
function inNamedCopy(node) {
  let child = node;
  for (let parent = node.parent; parent; child = parent, parent = parent.parent) {
    if (parent.type === "VariableDeclarator" && parent.init === child && isCopyName(parent.id)) return true;
    if (parent.type === "PropertyDefinition" && parent.value === child && isCopyName(parent.key, parent.computed)) {
      return true;
    }
  }
  return false;
}

function isCopyName(id, computed = false) {
  return !computed && id.type === "Identifier" && COPY_NAMES.has(id.name);
}

export default {
  meta: { type: "suggestion", schema: [], messages: { time: MESSAGE } },
  create(context) {
    const report = (node) => {
      if (!inNamedCopy(node)) context.report({ node, messageId: "time" });
    };
    const reportName = (node, id, computed) => {
      if (isCopyName(id, computed)) context.report({ node, messageId: "time" });
    };
    return {
      Literal(node) {
        if (!isNumber(node) || !TIME_LITERALS.has(node.value)) return;
        const parent = parentOf(node);
        if (parent && isProduct(parent)) return; // a factor: its chain decides
        report(node);
      },
      BinaryExpression(node) {
        if (!isProduct(node)) return;
        const parent = parentOf(node);
        if (parent && isProduct(parent)) return; // not the outermost node of the chain
        if (chainReports(factorsOf(node))) report(node);
      },
      VariableDeclarator(node) {
        reportName(node, node.id, false);
      },
      PropertyDefinition(node) {
        reportName(node, node.key, node.computed);
      },
    };
  },
};
