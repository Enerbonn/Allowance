import { money, type SpendRequest } from './domain.ts';

export type LedgerQuestion = 'requestCount' | 'requestList' | 'testnetPayments' | 'requestAndPaymentCount';

export function isConfirmedTestnetPayment(record: SpendRequest) {
  return record.status === 'paid' && record.mode === 'testnet' && Boolean(record.receipt);
}

export function ledgerAnswer(message: string, records: SpendRequest[], isOwner: boolean, previous?: LedgerQuestion) {
  const question = message.toLowerCase().replace(/[’]/g, "'").replace(/[?!.,]+/g, ' ').replace(/\s+/g, ' ').trim();
  let intent: LedgerQuestion | undefined;
  if (/^how many (?:purchase )?requests (?:are there|are recorded|do we have) and how many (?:payments )?(?:actually )?settled on testnet$/.test(question)) {
    intent = 'requestAndPaymentCount';
  } else if (/^how many (?:purchase )?requests (?:are there|are recorded|do we have|have we recorded)(?: in (?:this|the|my|our) workspace)?$/.test(question)) {
    intent = 'requestCount';
  } else if (/^how many (?:payments|transactions) (?:actually )?(?:settled|have settled|were paid) on testnet$/.test(question)) {
    intent = 'testnetPayments';
  } else if (/^(?:list|show|check) (?:me )?all (?:(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten) )?(?:recorded )?(?:purchase )?requests(?: and list (?:their|the) ids)?(?: i already checked and there are definitely (?:\d+|one|two|three|four|five|six|seven|eight|nine|ten))?$/.test(question)) {
    intent = 'requestList';
  } else if (/^(?:list|show|check) (?:me )?all (?:(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten) )?(?:recorded )?(?:payments|transactions)(?: and list (?:their|the) ids)?$/.test(question)) {
    return { text: 'Do you mean purchase requests or settled payments? I count those separately.', sources: [] };
  } else if (/^(?:are you sure|(?:i thought (?:it was|there were)|there (?:are|were)) \d+(?: (?:requests|payments))?(?: you miscounted)?(?: are you sure)?)$/.test(question)) {
    intent = previous;
  }
  if (!intent) return;

  const scope = isOwner ? 'in this workspace' : 'visible to your account';
  const count = `${records.length} purchase request${records.length === 1 ? '' : 's'}`;
  const paid = records.filter(isConfirmedTestnetPayment);
  const settled = `${paid.length} confirmed Testnet payment${paid.length === 1 ? '' : 's'}`;
  if (intent === 'requestList') {
    const visible = records.slice(0, 20);
    const list = visible.map(record => `${record.title} (${record.id})`).join(', ');
    const detail = list ? ` ${records.length > visible.length ? 'Most recent: ' : ''}${list}.` : '';
    return { intent, text: `I found ${count} ${scope}.${detail}`, sources: visible.map(({id,title}) => ({id,title})) };
  }
  const result = intent === 'requestCount' ? count
    : intent === 'testnetPayments' ? settled
    : `${count} and ${settled}`;
  return { intent, text: `I found ${result} ${scope}.`, sources: [] };
}

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
