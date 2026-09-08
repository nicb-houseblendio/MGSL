import { orderGate, ADD_A_LOT, NOTHING_NEW } from './archOrderGate.ts';

let fail = 0;
const ok = (name, cond, got) => { console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (cond ? '' : '   got: ' + JSON.stringify(got))); if (!cond) fail++; };

// new mode: the two gates coincide
let g = orderGate({ mode: 'new', lineCount: 0, writableCount: 0 });
ok('new/empty: step blocked', g.itemsStepOk === false, g);
ok('new/empty: cannot write', g.canWrite === false, g);
ok('new/empty: hint says add a lot', g.itemsHint === ADD_A_LOT, g);
ok('new/empty: no review hint (never reached)', g.reviewHint === null, g);

g = orderGate({ mode: 'new', lineCount: 2, writableCount: 2 });
ok('new/2 lots: step ok, writes, no hints', g.itemsStepOk && g.canWrite && g.itemsHint === null && g.reviewHint === null, g);

// existing mode: the reported bug. Three of the order's own lines, nothing added.
g = orderGate({ mode: 'existing', lineCount: 3, writableCount: 0 });
ok('edit/3 own lines: step OK (the cart is not empty)', g.itemsStepOk === true, g);
ok('edit/3 own lines: nothing would be written', g.canWrite === false, g);
ok('edit/3 own lines: Items hint is silent', g.itemsHint === null, g);
ok('edit/3 own lines: Review explains why Update is dead', g.reviewHint === NOTHING_NEW, g);

g = orderGate({ mode: 'existing', lineCount: 4, writableCount: 1 });
ok('edit/3 own + 1 new: step ok, writes, no hints', g.itemsStepOk && g.canWrite && g.itemsHint === null && g.reviewHint === null, g);

// every own line dropped and nothing added: a drop is not a write, so this is empty
g = orderGate({ mode: 'existing', lineCount: 0, writableCount: 0 });
ok('edit/all dropped: step blocked with add-a-lot', g.itemsStepOk === false && g.itemsHint === ADD_A_LOT, g);

// defensive: writable can never exceed lines
g = orderGate({ mode: 'existing', lineCount: 1, writableCount: 5 });
ok('writable is clamped to lineCount', g.canWrite === true && g.itemsStepOk === true, g);

console.log(fail ? ('# FAIL ' + fail) : '# archOrderGate ok');
process.exit(fail ? 1 : 0);
