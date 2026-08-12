import { validateSummaryResult } from '../../src/core/contract.js';
console.log('valid:', JSON.stringify(validateSummaryResult({ summary: 'S', model: 'm', tokensUsed: 3 })));
console.log('no tokens:', JSON.stringify(validateSummaryResult({ summary: 'S', model: 'm' })));
console.log('bad summary:', JSON.stringify(validateSummaryResult({ summary: 42, model: 'm', tokensUsed: 3 })));
console.log('bad tokens:', JSON.stringify(validateSummaryResult({ summary: 'S', model: 'm', tokensUsed: 'many' })));
