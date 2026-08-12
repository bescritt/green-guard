import { BloomFilter } from '../../src/core/bloom.js';
const N = 100000, P = 0.001;
const bad = Array.from({length:N}, (_,i)=>`scam-${i}.example.com`);
let t=Date.now();
const f = BloomFilter.fromKeys(bad, P);
const buildMs = Date.now()-t;
console.log(`bits=${f.bits} k=${f.hashes} bytes=${f.bytes.length} (${(f.bytes.length/1024).toFixed1?0:(f.bytes.length/1024).toFixed(1)} KiB) buildMs=${buildMs}`);
// all inserted must be found: zero false negatives allowed, ever
let fn=0; for (const d of bad) if(!f.has(d)) fn++;
console.log(`false_negatives=${fn} (MUST be 0)`);
// measured false positive rate on 200k unseen keys
const M=200000; let fp=0;
t=Date.now();
for(let i=0;i<M;i++) if(f.has(`clean-${i}.example.org`)) fp++;
const qMs=Date.now()-t;
console.log(`measured_fp=${(fp/M).toExponential(3)} target<=${P} fp_count=${fp}/${M}`);
console.log(`query_throughput=${Math.round(M/(qMs/1000)).toLocaleString()}/s  ns_per_query=${((qMs*1e6)/M).toFixed(0)}`);
console.log(`fillRatio=${f.fillRatio().toFixed(4)} estimatedFp=${f.estimatedFpRate().toExponential(3)}`);
// round trip
const ser=f.serialize();
const g=BloomFilter.deserialize(ser);
let mismatch=0; for(let i=0;i<1000;i++){const k=`scam-${i}.example.com`; if(g.has(k)!==f.has(k)) mismatch++;}
console.log(`serialized_bytes=${ser.length} roundtrip_mismatch=${mismatch} (MUST be 0)`);
// tamper detection
const bad2=Uint8Array.from(ser); bad2[40]^=0xff;
try{ BloomFilter.deserialize(bad2); console.log('TAMPER_DETECTED=NO  <-- BUG'); }
catch(e){ console.log(`TAMPER_DETECTED=YES (${e.message.slice(0,40)})`); }
