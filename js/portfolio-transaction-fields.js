/** Fields follow ledger semantics; hidden controls are disabled before submission. */
export function transactionFields(type, status = 'confirmed') {
  const fields = ['date','account_id','note'];
  if (type === 'deposit' || type === 'withdrawal') return [...fields,'amount'];
  fields.push('product_id');
  if (type === 'adjustment') return [...fields,'shares','cost_total'];
  if (type === 'dividend') return [...fields,'amount','fee'];
  if (status === 'pending') return [...fields,type === 'buy' ? 'amount' : 'shares'];
  return [...fields,'shares','price','fee'];
}

export function updateTransactionForm(form) {
  const type = form.elements.type?.value || form.dataset.tradeType;
  const statusControl = form.elements.status;
  const canPend = ['buy','sell'].includes(type);
  if (statusControl && !canPend) statusControl.value = 'confirmed';
  if (statusControl) statusControl.closest('label').hidden = !canPend;
  const status = statusControl?.value || form.dataset.tradeStatus || 'confirmed';
  const visible = new Set(transactionFields(type,status));
  for (const name of ['product_id','amount','shares','price','fee','cost_total','note']) {
    const input = form.elements[name];
    if (!input) continue;
    input.disabled = !visible.has(name);
    input.closest('label').hidden = !visible.has(name);
    input.required = visible.has(name) && (['amount','shares','price'].includes(name) || (name === 'note' && type === 'adjustment'));
    if (['amount','price'].includes(name)) input.min = '0.000001';
    if (name === 'shares') input.min = type === 'adjustment' ? '0' : '0.000001';
  }
}
