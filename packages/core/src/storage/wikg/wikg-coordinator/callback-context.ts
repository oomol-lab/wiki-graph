import {
  getWikiGraphPlatform,
  type HostAsyncContext,
  type HostAsyncContextProvider,
} from "../../../runtime/platform/index.js";

interface CallbackScope {
  readonly identity: string;
  active: boolean;
}

const contexts = new WeakMap<
  HostAsyncContextProvider,
  HostAsyncContext<readonly CallbackScope[]>
>();

function context() {
  const provider = getWikiGraphPlatform().asyncContext;
  let value = contexts.get(provider);
  if (value === undefined) {
    value = provider.create<readonly CallbackScope[]>();
    contexts.set(provider, value);
  }
  return value;
}

export async function withArchiveCallback<T>(
  identity: string,
  operation: () => Promise<T> | T,
): Promise<T> {
  const storage = context();
  const scope: CallbackScope = { identity, active: true };
  try {
    return await storage.run([...(storage.getStore() ?? []), scope], operation);
  } finally {
    // Detached descendants must not retain a false reader dependency once the
    // actual callback has completed. No archive/page instance is retained here.
    scope.active = false;
  }
}

export function assertArchiveDrainNotReentrant(identity: string): void {
  if (
    context()
      .getStore()
      ?.some((scope) => scope.active && scope.identity === identity)
  ) {
    throw new Error(
      "Cannot drain an archive from an active Archive callback for the same source.",
    );
  }
}
