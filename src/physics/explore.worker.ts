/**
 * Works out and flies the comparison runs for /?explore=<key> off the page's thread: each
 * solve or simulated flight takes up to about a second, which would stall the 3D view.
 * Answers one ExploreRequest with its ExploreFlown[]; the page ends a worker whose answer
 * it no longer needs.
 */
import { simulateControlled } from './closedloop';
import { exploreRuns, type ExploreFlown, type ExploreRequest } from './explore';
import { computeTimeline } from './timeline';

self.onmessage = async (e: MessageEvent<ExploreRequest>) => {
  const { params, key, mode } = e.data;
  const runs = await exploreRuns(params, key);
  const flown: ExploreFlown[] = runs.map((run) => {
    const ideal = computeTimeline({ ...params, ...run.changes });
    return { run, tl: mode === 'controlled' ? simulateControlled(ideal) : ideal };
  });
  self.postMessage(flown);
};
