import { SaxesParser, type SaxesTagPlain } from "saxes";

export interface XmlElement {
  readonly name: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly children: readonly XmlElement[];
  readonly text: string;
}

interface MutableXmlElement {
  readonly name: string;
  readonly attributes: Record<string, string>;
  readonly children: MutableXmlElement[];
  text: string;
}

export function parseXml(content: string): XmlElement {
  const parser = new SaxesParser({ xmlns: false });
  const stack: MutableXmlElement[] = [];
  let root: MutableXmlElement | undefined;

  parser.on("opentag", (tag: SaxesTagPlain) => {
    const element: MutableXmlElement = {
      name: tag.name,
      attributes: Object.fromEntries(
        Object.entries(tag.attributes).map(([name, value]) => [
          name,
          String(value),
        ]),
      ),
      children: [],
      text: "",
    };

    const parent = stack[stack.length - 1];
    if (parent === undefined) {
      root = element;
    } else {
      parent.children.push(element);
    }

    stack.push(element);
  });

  parser.on("text", (text: string) => {
    const current = stack[stack.length - 1];
    if (current !== undefined) {
      current.text += text;
    }
  });

  parser.on("cdata", (text: string) => {
    const current = stack[stack.length - 1];
    if (current !== undefined) {
      current.text += text;
    }
  });

  parser.on("closetag", () => {
    stack.pop();
  });

  parser.write(content).close();

  if (root === undefined) {
    throw new Error("XML document is empty");
  }

  return freezeXmlElement(root);
}

export function findChild(
  element: XmlElement,
  localName: string,
): XmlElement | undefined {
  return element.children.find(
    (child) => getLocalName(child.name) === localName,
  );
}

export function findChildren(
  element: XmlElement,
  localName: string,
): readonly XmlElement[] {
  return element.children.filter(
    (child) => getLocalName(child.name) === localName,
  );
}

export function findDescendant(
  element: XmlElement,
  localName: string,
): XmlElement | undefined {
  for (const child of element.children) {
    if (getLocalName(child.name) === localName) {
      return child;
    }

    const descendant = findDescendant(child, localName);
    if (descendant !== undefined) {
      return descendant;
    }
  }

  return undefined;
}

export function findDescendants(
  element: XmlElement,
  localName: string,
): readonly XmlElement[] {
  const descendants: XmlElement[] = [];

  for (const child of element.children) {
    if (getLocalName(child.name) === localName) {
      descendants.push(child);
    }

    descendants.push(...findDescendants(child, localName));
  }

  return descendants;
}

export function getAttribute(
  element: XmlElement,
  name: string,
): string | undefined {
  return element.attributes[name];
}

export function getDescendantText(element: XmlElement): string {
  let text = element.text;

  for (const child of element.children) {
    text += getDescendantText(child);
  }

  return text;
}

export function getLocalName(name: string): string {
  const index = name.indexOf(":");

  return index === -1 ? name : name.slice(index + 1);
}

function freezeXmlElement(element: MutableXmlElement): XmlElement {
  return {
    name: element.name,
    attributes: Object.freeze({ ...element.attributes }),
    children: Object.freeze(element.children.map(freezeXmlElement)),
    text: element.text,
  };
}
