import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyHeuristically, needsDeepAnalysis } from '../../src/core/heuristics.js';
const feats = (o = {}) => ({ url:'https://example.com/', domain:'example.com', title:'Example', textSample:'normal', hasAutoplayMedia:false, hasPopups:false, fullscreenAttempts:0, focusGrabs:0, permissionRequests:[], ...o });
test('h5', () => {
  const a = classifyHeuristically(feats({ hasAutoplayMedia: true, focusGrabs: 2 }));
  console.log('H5 score', a.score);
  assert.ok(needsDeepAnalysis(a));
  const b = classifyHeuristically(feats({ hasAutoplayMedia: true, fullscreenAttempts: 5, focusGrabs: 8 }));
  console.log('H5b score', b.score);
  assert.ok(!needsDeepAnalysis(b));
});
