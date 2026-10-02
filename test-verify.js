const openfda = require('./.next/server/lib/drug-verification/adapters/openfda.js');
const rxnorm = require('./.next/server/lib/drug-verification/adapters/rxnorm.js');
const dailymed = require('./.next/server/lib/drug-verification/adapters/dailymed.js');
const unitcm = require('./.next/server/lib/drug-verification/adapters/unitcm.js');

const name = '布洛芬缓释片';
Promise.all([
  openfda.verify(name).then(r => ({ source: 'openfda', r })).catch(e => ({ source: 'openfda', error: e.message })),
  rxnorm.verify(name).then(r => ({ source: 'rxnorm', r })).catch(e => ({ source: 'rxnorm', error: e.message })),
  dailymed.verify(name).then(r => ({ source: 'dailymed', r })).catch(e => ({ source: 'dailymed', error: e.message })),
  unitcm.verify(name).then(r => ({ source: 'unitcm', r })).catch(e => ({ source: 'unitcm', error: e.message })),
]).then(results => console.log(JSON.stringify(results, null, 2)));
