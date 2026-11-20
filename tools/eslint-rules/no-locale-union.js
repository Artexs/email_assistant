// Rule `ea/no-locale-union`: the language of a product text is UserLocale, userLocales or userLocaleSchema from
// @ea/core (packages/core/src/tenancy.ts). The rule reports a new copy of the "en" and "pl" pair: a two-member union,
// an `as const` list and a `z.enum` list. Plain ESM: `eslint .` loads the config without a TypeScript loader.

const MESSAGE = "Use UserLocale, userLocales or userLocaleSchema from @ea/core (packages/core/src/tenancy.ts).";

const WRAPPERS = new Set(["TSAsExpression", "TSSatisfiesExpression", "TSNonNullExpression", "TSTypeAssertion"]);

const unwrap = (node) => {
  let current = node;
  while (WRAPPERS.has(current.type)) current = current.expression;
  return current;
};

/** True when `values` holds exactly "en" and "pl", in any order. */
const isLocalePair = (values) =>
  values.length === 2 && values.every((value) => value === "en" || value === "pl") && values[0] !== values[1];

const stringOf = (node) => (node?.type === "Literal" && typeof node.value === "string" ? node.value : null);

/** The two strings of an array expression of string literals, or null. */
function arrayStrings(node) {
  const array = unwrap(node);
  if (array.type !== "ArrayExpression") return null;
  const values = array.elements.map((element) => (element ? stringOf(element) : null));
  return values.includes(null) ? null : values;
}

export default {
  meta: { type: "problem", schema: [], messages: { copy: MESSAGE } },
  create(context) {
    return {
      TSUnionType(node) {
        const values = node.types.map((member) => (member.type === "TSLiteralType" ? stringOf(member.literal) : null));
        if (isLocalePair(values)) context.report({ node, messageId: "copy" });
      },
      ArrayExpression(node) {
        const parent = node.parent;
        const asConst =
          parent?.type === "TSAsExpression" &&
          parent.typeAnnotation.type === "TSTypeReference" &&
          parent.typeAnnotation.typeName.name === "const";
        if (asConst && isLocalePair(arrayStrings(node) ?? [])) context.report({ node, messageId: "copy" });
      },
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== "MemberExpression" || callee.property.name !== "enum" || node.arguments.length === 0)
          return;
        if (isLocalePair(arrayStrings(node.arguments[0]) ?? [])) context.report({ node, messageId: "copy" });
      },
    };
  },
};
