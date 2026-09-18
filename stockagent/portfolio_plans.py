"""Category-first cash allocation; output is a proposal, never a ledger trade."""
from datetime import date
from decimal import Decimal, ROUND_DOWN

from .portfolio_ledger import ZERO, number, scalar, snapshot


def proposals(portfolio, today=None):
    today = today or date.today().isoformat()
    summary = snapshot(portfolio)
    results = []
    for plan in portfolio.get('plans', []):
        if plan.get('enabled') is False:
            continue
        account = next(a for a in summary['accounts'] if a['id'] == plan['account_id'])
        budget = number(plan['amount'])
        result = {'id': plan['id'], 'name': plan['name'], 'date': plan['next_date'], 'due': plan['next_date'] <= today,
                  'budget': scalar(budget), 'orders': [], 'blocked': [], 'unallocated': scalar(budget)}
        if account['cash'] is None:
            result['blocked'].append('请先核对账户可用现金')
            results.append(result)
            continue
        budget = min(budget, number(account['cash']))
        if plan['strategy'] == 'initial' and summary['total']['value'] is None:
            result['blocked'].append('持仓行情不完整，无法计算建仓缺口')
            results.append(result)
            continue
        allocations = []
        for category in summary['categories']:
            if plan['strategy'] == 'initial':
                weight = max(ZERO, number(plan['target_capital']) * number(category['target_pct']) / 100 - number(category['value']))
            else:
                weight = number(category['target_pct'])
            weighted = [r for r in portfolio['products'] if r['category_id'] == category['id'] and r.get('active',True) and r.get('allocation_weight',0)>0]
            if weighted:
                weight_total = sum(number(r['allocation_weight']) for r in weighted)
                allocations.extend((category,weight*number(r['allocation_weight'])/weight_total,r) for r in weighted)
            else:
                allocations.append((category, weight, None))
        total_weight = sum((weight for _, weight, _ in allocations), ZERO)
        if not total_weight:
            result['blocked'].append('当前没有配置缺口')
            results.append(result)
            continue
        spent = ZERO
        for category, weight, designated in allocations:
            if not weight:
                continue
            allocation = budget * weight / total_weight
            if plan['strategy'] == 'initial':
                allocation = min(allocation, weight)
            candidates = [p for p in portfolio['products'] if p['category_id'] == category['id'] and p.get('active', True)]
            primary = designated or next((p for p in candidates if p['id'] == category.get('primary_product_id')), None)
            if not primary:
                result['blocked'].append(f"{category['name']}：请指定主要买入产品")
                continue
            ordered = [primary] + ([p for p in candidates if p['id'] != primary['id']] if category.get('allow_substitution') and not designated else [])
            selected = None
            reason = ''
            for product in ordered:
                mark = product.get('mark')
                if not mark or not 0 <= (date.fromisoformat(today) - date.fromisoformat(mark['date'])).days <= 7:
                    reason = '缺少近期价格／净值'
                    continue
                if product.get('purchase_blocked'):
                    reason = '产品暂停买入'
                    continue
                if plan['strategy'] == 'dip':
                    history = sorted((r for r in product.get('price_history', []) if r['date'] <= today),key=lambda r:r['date'])
                    if len(history) < 20:
                        reason = '回撤观察不足20个价格记录'
                        continue
                    peak = max(number(r['price']) for r in history[-120:])
                    drawdown = (1 - number(mark['price']) / peak) * 100
                    if drawdown < number(plan['drawdown_pct']):
                        reason = f"未达到{plan['drawdown_pct']}%回撤"
                        continue
                selected = product
                break
            if not selected:
                result['blocked'].append(f"{category['name']}：{reason}")
                continue
            cost = account.get('trading_cost') or {}
            rate = number(selected.get('fee_rate_pct', cost.get('commission_rate_pct', 0))) / 100
            minimum_fee = number(cost.get('min_commission', 0)) if selected['kind'] == 'exchange' else ZERO
            limit = selected.get('purchase_limit')
            if limit is not None:
                allocation = min(allocation, number(limit))
            price = number(selected['mark']['price'])
            if selected['kind'] == 'exchange':
                lot = number(selected.get('lot_size', 100))
                shares = (max(ZERO, min(allocation / (1 + rate), allocation - minimum_fee)) / price / lot).to_integral_value(rounding=ROUND_DOWN) * lot
                gross = shares * price
                fee = max(minimum_fee, gross * rate) if shares else ZERO
                amount = gross + fee
                if not shares:
                    result['blocked'].append(f"{category['name']}：预算不足一个交易单位及费用")
                    continue
            else:
                amount = allocation.quantize(Decimal('0.01'), rounding=ROUND_DOWN)
                fee = amount - amount / (1 + rate)
                shares = None
                if amount < number(selected.get('min_purchase', 1)):
                    result['blocked'].append(f"{category['name']}：未达到最低申购金额")
                    continue
            spent += amount
            result['orders'].append({'category_id': category['id'], 'product_id': selected['id'], 'account_id': account['id'],
                                     'amount': scalar(amount), 'estimated_fee': scalar(fee), 'shares': scalar(shares),
                                     'price': scalar(price), 'substituted': selected['id'] != primary['id']})
        result['unallocated'] = scalar(number(plan['amount']) - spent)
        results.append(result)
    return results
