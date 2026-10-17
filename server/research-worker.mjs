import { parentPort, workerData } from 'node:worker_threads';
import { calculateResearch } from './research-calculations.mjs';

try {
  parentPort.postMessage({ result: await calculateResearch(workerData) });
} catch (error) {
  parentPort.postMessage({ error: { code: error.code || 'RESEARCH_CALCULATION_FAILED', message: String(error.message).slice(0, 1000) } });
}
