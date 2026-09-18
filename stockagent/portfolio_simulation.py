"""New-portfolio adapter for the shared, no-lookahead strategy simulator."""
from datetime import date, timedelta
from concurrent.futures import ThreadPoolExecutor

from .portfolio_ledger import PortfolioError, number, snapshot
from .portfolio_research import _clean_history, _RESEARCH_SLOTS, _rate_allowed
from .strategy_simulation import simulate, LIMITATIONS
from .quotes import get_price_history


def run(portfolio, request, *, loader=None, today=None, rate_key=None):
    if not _rate_allowed(rate_key) or not _RESEARCH_SLOTS.acquire(blocking=False):
        return 429, {'status':'busy', 'limitations':['已有模拟运行或请求过于频繁']}
    try:
        return evaluate(portfolio, request, loader=loader, today=today)
    finally:
        _RESEARCH_SLOTS.release()


def evaluate(p, request, *, loader=None, today=None):
    if not isinstance(request, dict):
        raise PortfolioError('模拟请求必须为对象')
    today = today or date.today()
    budget = float(number(request.get('budget'), '每期投入'))
    initial = float(number(request.get('initial_cash', 0), '起始现金'))
    dip = float(number(request.get('dip_pct', 5), '回撤档距'))
    years = request.get('years', 3)
    cadence = request.get('cadence', 'monthly')
    if not 1 <= budget <= 100000000 or initial > 100000000 or not 1 <= dip <= 50 or years not in (0,1,3,5,10) or cadence not in ('monthly','weekly'):
        raise PortfolioError('模拟金额、周期或历史区间无效')
    account = next((a for a in p['accounts'] if a['id'] == request.get('account_id')), None)
    if not account:
        raise PortfolioError('请选择费用账户')
    selected, weights, costs = {}, {}, {}
    mode=request.get('weight_mode','target')
    if mode not in ('target','holdings'):
        raise PortfolioError('组合权重方式无效')
    categories=p['categories']
    products_source=p['products']
    if mode=='holdings':
        summary=snapshot(p)
        if not summary['total']['value']:
            raise PortfolioError('当前持仓市值为空或行情不完整，无法模拟持仓比例')
        categories=[{**c,'target_pct':c['actual_pct']} for c in summary['categories']]
        products_source=[{**r,'allocation_weight':r['value'],'active':True} for r in summary['products'] if r['value']>0]
    for category in categories:
        if not category['target_pct']:
            continue
        products = [r for r in products_source if r['category_id'] == category['id'] and r.get('active', True)]
        weighted = [r for r in products if r.get('allocation_weight',0) > 0]
        if weighted:
            total = sum(r['allocation_weight'] for r in weighted)
            pairs = [(r, category['target_pct'] * r['allocation_weight'] / total) for r in weighted]
        else:
            primary = next((r for r in products if r['id'] == category.get('primary_product_id')), None)
            if not primary:
                raise PortfolioError(f"{category['name']}尚未指定主要产品或类内比例")
            pairs = [(primary, category['target_pct'])]
        for product, weight in pairs:
            selected[product['id']], weights[product['id']] = product, weight
            terms = account.get('trading_cost') or {}
            costs[product['id']] = {'kind':product['kind'], 'lot_size':product.get('lot_size',100),
                'min_commission':terms.get('min_commission',0), 'commission_rate_pct':product.get('fee_rate_pct',terms.get('commission_rate_pct',0)),
                'max_fee_ratio_pct':100, 'min_purchase':product.get('min_purchase',1), 'purchase_limit':product.get('purchase_limit')}
    if not selected or len(selected) > 20 or any(budget*w/100 < .01 for w in weights.values()):
        raise PortfolioError('请选择1至20只产品，且每只产品每期至少分配0.01元')
    cutoff = (today-timedelta(days=1)).isoformat()
    start = (today-timedelta(days=int(years*365.25))).isoformat() if years else '0001-01-01'
    def load(product):
        # Imported NAV is authoritative; never substitute an exchange ETF for an OTC fund.
        if len(product.get('price_history',[])) >= 60 or product['kind'] == 'fund':
            return {'points':[{'date':r['date'],'close':r['price']} for r in product.get('price_history',[])],
                    'provider':', '.join(sorted({r['source'] for r in product.get('price_history',[])})) or '未导入历史净值'}
        try:
            return (loader or get_price_history)(product['symbol'],market='A',range_key='max')
        except Exception:
            return {'error':'历史行情暂不可用'}
    with ThreadPoolExecutor(max_workers=4) as pool:
        responses = list(pool.map(load,selected.values()))
    prices, coverage = {}, []
    for (key, product), response in zip(selected.items(),responses):
        rows, report = _clean_history(key,response,cutoff)
        prices[key] = {d:v for d,v in sorted(rows.items())[-5200:] if d >= start}
        coverage.append({**report,'name':product['name'],'kind':product['kind']})
    dates = sorted(set.intersection(*(set(rows) for rows in prices.values())))
    problems = []
    if len(dates)<60:
        problems.append(f'需要至少60个共同日期，当前{len(dates)}个；场外产品请导入对应基金历史净值。')
    if any(r['invalid_rows'] or r['conflicting_dates'] for r in coverage):
        problems.append('历史数据含无效或冲突价格')
    if dates:
        if any({d for d in rows if dates[0]<=d<=dates[-1]} != set(dates) for rows in prices.values()):
            problems.append('共同区间存在缺失日期，无法可靠比较逐日回撤')
        gaps = [(date.fromisoformat(b)-date.fromisoformat(a)).days for a,b in zip(dates,dates[1:])]
        if gaps and (max(gaps)>14 or sum(gaps)/len(gaps)>3):
            problems.append('历史日期过于稀疏')
    limitations = [*problems,*LIMITATIONS,'场外以共同日期净值近似成交，份额向下取四位；不模拟真实确认延迟、历史申购限额和赎回费。']
    result = {'status':'insufficient_history' if problems else 'ready','coverage':coverage,'limitations':limitations,
              'weight_mode':mode,
              'target_weights':weights,'strategies':[],'observations':len(dates),'product_names':{k:r['name'] for k,r in selected.items()}}
    if problems:
        return 422,result
    result.update(start=dates[0],end=dates[-1])
    result['strategies'] = [simulate(mode,dates,prices,weights,budget,cadence,dip,initial,{},costs) for mode in ('periodic','dip')]
    return 200,result
