import type { SamplingScopeConfig, TemperatureSetting } from "./types.js";

export function resolveSamplingSetting(
  value: TemperatureSetting | undefined,
  fieldName: string,
  retryIndex?: number,
  retryMax?: number,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === "number") {
    return value;
  }

  if (value.length === 1) {
    return value[0];
  }

  if (value.length !== 2) {
    throw new RangeError(
      `${fieldName} must be a number or a 2-item range like [0.6, 0.98]`,
    );
  }
  const [start, end] = value;

  if (start === undefined || end === undefined) {
    throw new RangeError(
      `${fieldName} must be a number or a 2-item range like [0.6, 0.98]`,
    );
  }

  if (retryIndex === undefined || retryMax === undefined || retryMax <= 0) {
    return start;
  }
  const boundedRetryIndex = Math.min(Math.max(retryIndex, 0), retryMax);
  const progress = boundedRetryIndex / retryMax;

  return start + (end - start) * progress;
}

export function resolveTemperatureSetting(
  temperature: TemperatureSetting | undefined,
  retryIndex?: number,
  retryMax?: number,
): number | undefined {
  return resolveSamplingSetting(
    temperature,
    "temperature",
    retryIndex,
    retryMax,
  );
}

export function getScopeDefaults<S extends string>(
  scope: S | undefined,
  sampling: SamplingScopeConfig<S> | undefined,
  defaultTemperature: TemperatureSetting,
  defaultTopP: TemperatureSetting,
): {
  temperature: TemperatureSetting;
  topP: TemperatureSetting;
} {
  if (scope === undefined) {
    return {
      temperature: defaultTemperature,
      topP: defaultTopP,
    };
  }

  if (sampling === undefined) {
    return {
      temperature: defaultTemperature,
      topP: defaultTopP,
    };
  }

  const profile = sampling[scope];

  if (profile === undefined) {
    return {
      temperature: defaultTemperature,
      topP: defaultTopP,
    };
  }

  return {
    temperature: profile.temperature ?? defaultTemperature,
    topP: profile.topP ?? defaultTopP,
  };
}
