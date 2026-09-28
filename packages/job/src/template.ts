type TemplateNode =
  | { readonly kind: "text"; readonly value: string }
  | { readonly expression: string; readonly kind: "value" }
  | {
      readonly body: readonly TemplateNode[];
      readonly itemName: string;
      readonly kind: "for";
      readonly valueName: string;
    }
  | {
      readonly alternate: readonly TemplateNode[];
      readonly condition: string;
      readonly consequent: readonly TemplateNode[];
      readonly kind: "if";
    };

const TOKEN_PATTERN = /(\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\})/gu;

/** Renders the deliberately small Jinja subset used by Wiki Graph job prompts. */
export function renderJobPrompt(
  template: string,
  values: Readonly<Record<string, unknown>>,
): string {
  const tokens = template.split(TOKEN_PATTERN);
  const parsed = parseNodes(tokens, 0, new Set());
  if (parsed.stop !== undefined) {
    throw new Error(`Unexpected template tag ${parsed.stop}.`);
  }
  return renderNodes(parsed.nodes, values);
}

function parseNodes(
  tokens: readonly string[],
  start: number,
  stops: ReadonlySet<string>,
): {
  readonly next: number;
  readonly nodes: readonly TemplateNode[];
  readonly stop?: string;
} {
  const nodes: TemplateNode[] = [];
  let index = start;
  while (index < tokens.length) {
    const token = tokens[index] ?? "";
    index += 1;
    if (token.startsWith("{{")) {
      nodes.push({
        expression: token.slice(2, -2).trim(),
        kind: "value",
      });
      continue;
    }
    if (!token.startsWith("{%")) {
      nodes.push({ kind: "text", value: token });
      continue;
    }
    const tag = token.slice(2, -2).trim();
    const keyword = tag.split(/\s+/u)[0] ?? "";
    if (stops.has(keyword)) {
      return { next: index, nodes, stop: keyword };
    }
    if (keyword === "if") {
      const consequent = parseNodes(tokens, index, new Set(["else", "endif"]));
      index = consequent.next;
      let alternate: readonly TemplateNode[] = [];
      if (consequent.stop === "else") {
        const parsedAlternate = parseNodes(tokens, index, new Set(["endif"]));
        if (parsedAlternate.stop !== "endif") {
          throw new Error("Template if block is missing endif.");
        }
        alternate = parsedAlternate.nodes;
        index = parsedAlternate.next;
      } else if (consequent.stop !== "endif") {
        throw new Error("Template if block is missing endif.");
      }
      nodes.push({
        alternate,
        condition: tag.slice(2).trim(),
        consequent: consequent.nodes,
        kind: "if",
      });
      continue;
    }
    if (keyword === "for") {
      const match = /^for\s+([A-Za-z_]\w*)\s+in\s+([A-Za-z_]\w*)$/u.exec(tag);
      if (match === null) throw new Error(`Unsupported template loop ${tag}.`);
      const body = parseNodes(tokens, index, new Set(["endfor"]));
      if (body.stop !== "endfor") {
        throw new Error("Template for block is missing endfor.");
      }
      nodes.push({
        body: body.nodes,
        itemName: match[1] ?? "",
        kind: "for",
        valueName: match[2] ?? "",
      });
      index = body.next;
      continue;
    }
    throw new Error(`Unsupported template tag ${tag}.`);
  }
  return { next: index, nodes };
}

function renderNodes(
  nodes: readonly TemplateNode[],
  values: Readonly<Record<string, unknown>>,
): string {
  return nodes
    .map((node) => {
      switch (node.kind) {
        case "text":
          return node.value;
        case "value":
          return stringify(resolveExpression(node.expression, values));
        case "if":
          return renderNodes(
            isTruthy(resolveCondition(node.condition, values))
              ? node.consequent
              : node.alternate,
            values,
          );
        case "for": {
          const value = resolvePath(node.valueName, values);
          if (!Array.isArray(value)) return "";
          const iterable: readonly unknown[] = value;
          return iterable
            .map((item) =>
              renderNodes(node.body, { ...values, [node.itemName]: item }),
            )
            .join("");
        }
      }
    })
    .join("");
}

function resolveExpression(
  expression: string,
  values: Readonly<Record<string, unknown>>,
): unknown {
  const [path, ...filters] = expression.split("|").map((part) => part.trim());
  for (const filter of filters) {
    if (filter !== "safe")
      throw new Error(`Unsupported template filter ${filter}.`);
  }
  return resolvePath(path ?? "", values);
}

function resolveCondition(
  condition: string,
  values: Readonly<Record<string, unknown>>,
): unknown {
  const equality =
    /^([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*==\s*(["'])(.*?)\2$/u.exec(condition);
  if (equality !== null) {
    return resolvePath(equality[1] ?? "", values) === equality[3];
  }
  return resolvePath(condition, values);
}

function resolvePath(
  path: string,
  values: Readonly<Record<string, unknown>>,
): unknown {
  let value: unknown = values;
  for (const segment of path.split(".")) {
    if (typeof value !== "object" || value === null) return undefined;
    value = (value as Readonly<Record<string, unknown>>)[segment];
  }
  return value;
}

function isTruthy(value: unknown): boolean {
  return (
    value !== undefined &&
    value !== null &&
    value !== false &&
    value !== 0 &&
    value !== ""
  );
}

function stringify(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (
    typeof value === "number" ||
    typeof value === "bigint" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }
  if (Array.isArray(value)) return value.map(stringify).join(",");
  return Object.prototype.toString.call(value);
}
