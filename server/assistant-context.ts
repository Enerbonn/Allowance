import { money } from './domain.ts';

const common = new Set('about also and are can could did does for from had has have how into just last much need our please recent show some tell that the their them there these they this those through under was were what when where which who will with would you your'.split(' '));
const words = (text: string) => [...new Set(text.toLowerCase().match(/[a-z0-9][a-z0-9-]{2,}/g) || [])].filter(word => !common.has(word));

/** Pass only authorized records, newest first. Keep recent context for follow-ups. */
export function retrieve<T>(query: string, records: T[], describe: (record:T) => string, limit: number, recent: number) {
  const terms = words(query).slice(0, 24);
  const head = records.slice(0, recent);
  const ranked = records.slice(head.length).map((record, index) => {
    const keys = new Set(words(describe(record)));
    return { record, index, score: terms.reduce((n, term) => n + (keys.has(term) ? 1 : 0), 0) };
  }).filter(row => row.score > 0).sort((a, b) => b.score - a.score || a.index - b.index);
  return [...head, ...ranked.slice(0, limit - head.length).map(row => row.record)];
}

export function spendingSummary(records: {status:string; mode:string; amount:number}[]) {
  return Object.fromEntries(['simulated', 'testnet'].map(mode => {
    const sum = (status:string) => money(records.reduce((total, row) => total + (row.status === status && row.mode === mode ? row.amount : 0), 0));
    return [mode, { paidXlm: sum('paid'), reservedXlm: sum('authorized') }];
  }));
}
