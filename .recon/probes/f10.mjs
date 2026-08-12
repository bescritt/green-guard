import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyHeuristically } from '../../src/core/heuristics.js';
const feats = (o = {}) => ({ url:'https://example.com/', domain:'example.com', title:'Example', textSample:'normal', hasAutoplayMedia:false, hasPopups:false, fullscreenAttempts:0, focusGrabs:0, permissionRequests:[], ...o });
test('f10', () => {
  const scam = feats({ textSample:'Our privacy policy and terms of service. Contact us. URGENT: call this number now your computer is infected!', hasAutoplayMedia:true, focusGrabs:5 });
  const r = classifyHeuristically(scam);
  console.log('scam score', r.score, 'tier', r.tier, 'matched', r.matched.map(m=>m.id+':'+m.weight));
  const clean = feats({ textSample:'privacy policy terms contact' });
  const c = classifyHeuristically(clean);
  console.log('clean score', c.score, 'tier', c.tier);
});
