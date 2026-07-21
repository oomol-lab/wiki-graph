import { withHelpRoute } from "../../../support/index.js";

export function rejectActionFlag(
  value: string | undefined,
  flag: string,
  action: string,
  helpRoute: string,
): void {
  if (value !== undefined) {
    throw new Error(
      withHelpRoute(
        `The \`chapter ${action}\` action does not support ${flag}.`,
        helpRoute,
      ),
    );
  }
}

export function rejectActionBooleanFlag(
  value: boolean | undefined,
  flag: string,
  action: string,
  helpRoute: string,
): void {
  if (value !== undefined) {
    throw new Error(
      withHelpRoute(
        `The \`chapter ${action}\` action does not support ${flag}.`,
        helpRoute,
      ),
    );
  }
}

export function rejectConflictingMoveFlags(
  values: {
    readonly after?: string;
    readonly before?: string;
    readonly first?: boolean;
    readonly last?: boolean;
    readonly parent?: string;
    readonly root?: boolean;
  },
  helpRoute: string,
): void {
  const parentTargets = [
    values.parent === undefined ? undefined : "--parent",
    values.root === undefined ? undefined : "--root",
  ].filter((flag): flag is string => flag !== undefined);
  const positionTargets = [
    values.before === undefined ? undefined : "--before",
    values.after === undefined ? undefined : "--after",
    values.first === undefined ? undefined : "--first",
    values.last === undefined ? undefined : "--last",
  ].filter((flag): flag is string => flag !== undefined);

  if (parentTargets.length > 1) {
    throw new Error(
      withHelpRoute(
        `Choose only one parent target: ${parentTargets.join(", ")}.`,
        helpRoute,
      ),
    );
  }
  if (positionTargets.length > 1) {
    throw new Error(
      withHelpRoute(
        `Choose only one position target: ${positionTargets.join(", ")}.`,
        helpRoute,
      ),
    );
  }
  if (
    parentTargets.length > 0 &&
    (values.before !== undefined || values.after !== undefined)
  ) {
    throw new Error(
      withHelpRoute(
        "Do not combine --parent or --root with --before or --after.",
        helpRoute,
      ),
    );
  }
  if (parentTargets.length === 0 && positionTargets.length === 0) {
    throw new Error(
      withHelpRoute(
        "`chapter move` requires --parent, --root, --before, --after, --first, or --last.",
        helpRoute,
      ),
    );
  }
}
