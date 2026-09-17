// All amounts are integer KRW. A shared item's remainder follows participant order.
export const amount = value => {
  const digits = String(value ?? '').replace(/[^0-9]/g, '');
  return digits ? Math.min(Number(digits), 1000000000) : 0;
};
export const money = value => `${Number(value || 0).toLocaleString('ko-KR')}원`;
export function calculate(state) {
  const people = state.participants || [];
  const totals = Object.fromEntries(people.map(p => [p.id, { id:p.id, name:p.name, personal:0, shared:0, paid:0, owed:0, net:0 }]));
  const errors = [];
  let grandTotal = 0;
  const groups = (state.groups || []).map(group => {
    let total = 0;
    for (const item of group.personal || []) {
      const price = amount(item.amount);
      if (!price) continue;
      if (!totals[item.participantId]) { errors.push(`${group.title || '정산 묶음'}: 개인 메뉴의 참여자를 선택해 주세요.`); continue; }
      totals[item.participantId].personal += price;
      total += price;
    }
    for (const item of group.shared || []) {
      const price = amount(item.amount);
      if (!price) continue;
      const ids = people.map(p => p.id).filter(id => (item.participantIds || []).includes(id));
      if (!ids.length) { errors.push(`${group.title || '정산 묶음'}: 공용 메뉴를 먹은 사람을 선택해 주세요.`); continue; }
      const base = Math.floor(price / ids.length), remainder = price % ids.length;
      ids.forEach((id, i) => { totals[id].shared += base + (i < remainder ? 1 : 0); });
      total += price;
    }
    if (total && !totals[group.payerId]) errors.push(`${group.title || '정산 묶음'}: 결제자를 선택해 주세요.`);
    else if (total) totals[group.payerId].paid += total;
    grandTotal += total;
    return { id:group.id, title:group.title, total, payerId:group.payerId };
  });
  for (const person of Object.values(totals)) {
    person.owed = person.personal + person.shared;
    person.net = person.paid - person.owed;
  }
  const transfers = errors.length ? [] : settle(Object.values(totals).filter(p => p.net));
  return { people:Object.values(totals), groups, grandTotal, transfers, errors };
}

function settle(people) {
  // Explore creditor choices to minimize transfer count for normal lunch groups.
  if (people.length > 10) return greedy(people);
  const debtors = people.filter(p => p.net < 0).map(p => ({ id:p.id, remaining:-p.net }));
  const creditors = people.filter(p => p.net > 0).map(p => ({ id:p.id, remaining:p.net }));
  const memo = new Map();
  function search() {
    const debtor = debtors.find(p => p.remaining > 0);
    if (!debtor) return [];
    const key = `${debtors.map(p => p.remaining).join(',')}|${creditors.map(p => p.remaining).join(',')}`;
    if (memo.has(key)) return memo.get(key);
    let best = null;
    const seen = new Set();
    for (const creditor of creditors) {
      if (!creditor.remaining || seen.has(creditor.remaining)) continue;
      seen.add(creditor.remaining);
      const value = Math.min(debtor.remaining, creditor.remaining);
      debtor.remaining -= value;
      creditor.remaining -= value;
      const candidate = [{ from:debtor.id, to:creditor.id, amount:value }, ...search()];
      debtor.remaining += value;
      creditor.remaining += value;
      if (!best || candidate.length < best.length) best = candidate;
    }
    const result = best || [];
    memo.set(key, result);
    return result;
  }
  return search();
}
function greedy(people) {
  const debtors = people.filter(p => p.net < 0).map(p => ({ id:p.id, amount:-p.net })).sort((a,b) => b.amount-a.amount);
  const creditors = people.filter(p => p.net > 0).map(p => ({ id:p.id, amount:p.net })).sort((a,b) => b.amount-a.amount);
  const transfers = [];
  let i=0,j=0;
  while (i<debtors.length && j<creditors.length) {
    const value = Math.min(debtors[i].amount, creditors[j].amount);
    transfers.push({ from:debtors[i].id, to:creditors[j].id, amount:value });
    debtors[i].amount -= value; creditors[j].amount -= value;
    if (!debtors[i].amount) i++;
    if (!creditors[j].amount) j++;
  }
  return transfers;
}
