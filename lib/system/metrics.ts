/**
 * In-memory counters for the Next.js process. The system dashboard reads these
 * to surface live SSE connection count. Reset on process restart — acceptable
 * because the dashboard is a single-process observability aid, not a billing
 * source.
 */
type MetricsState = { activeStreams: number };

const g = globalThis as unknown as { __chatUiMetrics?: MetricsState };
if (!g.__chatUiMetrics) {
  g.__chatUiMetrics = { activeStreams: 0 };
}
const state = g.__chatUiMetrics;

export function incActiveStreams() {
  state.activeStreams += 1;
}
export function decActiveStreams() {
  state.activeStreams = Math.max(0, state.activeStreams - 1);
}
export function getActiveStreams() {
  return state.activeStreams;
}
