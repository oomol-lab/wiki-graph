/** Opt-in wall-clock evidence for slow durable filesystem workflows. */
export async function regressionPhase<T>(
  name: string,
  operation: () => Promise<T>,
): Promise<T> {
  const started = performance.now();
  const trace = process.env.WIKIGRAPH_REGRESSION_TRACE === "1";
  if (trace) console.log(`[regression-phase] start ${name}`);
  try {
    return await operation();
  } finally {
    if (trace)
      console.log(
        `[regression-phase] end ${name} ${Math.round(performance.now() - started)}ms`,
      );
  }
}
