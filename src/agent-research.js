const number = value => Number.isFinite(value) ? value.toLocaleString('en-US', { maximumSignificantDigits: 8 }) : '预热不足';
const percent = value => Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : '—';
const time = value => new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });

export function formatResearchNote(result) {
  const data = result.data;
  const values = result.kind === 'indicators' ? result.series.map(s => `${s.name}: ${number(s.latest?.value)}`) : [
    `${result.options.strategy} · 收益 ${percent(result.metrics.totalReturn)} · 最大回撤 ${percent(result.metrics.maxDrawdown)} · 完成 ${result.metrics.tradeCount} 笔交易`,
    `初始资金 ${number(result.options.initialCapital)} · 双边费率 ${result.options.feeBps} bp · 滑点 ${result.options.slippageBps} bp`,
  ];
  return [
    `${result.kind === 'indicators' ? '指标概览' : '基础回测'} · ${data.symbol} · ${data.interval}`,
    ...values,
    `样本 ${time(data.from)} → ${time(data.to)}（北京时间），${data.usedBars} 根；排除 ${data.excludedBars} 根。`,
    `来源 ${data.source.providerName || data.source.provider || '未知'}；${data.source.cache === 'stale' ? '断网历史缓存' : '已下载历史'}；${data.assumedClosedBars ? `${data.assumedClosedBars} 根收盘状态按历史顺序推定` : data.closedOnly ? '使用源确认收盘数据' : '含未确认收盘数据'}。`,
    `计算 ${time(Date.parse(result.computedAt))} · 样本 SHA256 ${data.sha256.slice(0, 16)}`,
    ...result.warnings,
  ].join('\n').slice(0, 2000);
}

export function mountAgentResearch({ container, api, context, canEdit, publish, toast, esc, download }) {
  let result = null;
  container.className = 'agent-research';
  container.dataset.symbol = context.symbol;
  container.dataset.interval = context.interval;
  container.innerHTML = `<h3>Agent 计算预览</h3><p>用当前标的的历史数据，预览 Agent 可读取的指标或回测结果，再把计算依据加入共享批注。</p><form class="agent-research-form"><select aria-label="Agent 计算类型"><option value="indicators">SMA / EMA / RSI / MACD</option><option value="backtest">当前基础回测策略</option></select><button class="secondary">计算预览</button></form><div class="agent-research-output" role="status"></div><div class="agent-research-actions hidden"><button class="quiet" data-export-research>导出结果 JSON</button><button class="secondary" data-share-research ${canEdit ? '' : 'disabled'}>加入共享批注</button></div>`;
  const form = container.querySelector('form'), button = form.querySelector('button'), output = container.querySelector('[role="status"]');
  if(!context.ready){button.disabled=true;output.textContent='正在读取当前图表行情，请稍候…';}
  if(context.symbol.startsWith('CSV:')){button.disabled=true;output.textContent='Agent 计算使用主机在线行情；CSV 仍在当前浏览器的 Pine 与回测中计算。';}
  form.onsubmit = async event => {
    event.preventDefault(); result = null;
    container.querySelector('.agent-research-actions').classList.add('hidden');
    const kind = form.querySelector('select').value;
    button.disabled = true; output.textContent = '正在读取历史并计算…';
    const input = { symbol: context.symbol, interval: context.interval, limit: 800, tail: 5,
      ...(kind === 'indicators' ? { indicators: [{ type: 'SMA', period: 20 }, { type: 'EMA', period: 12 }, { type: 'RSI', period: 14 }, { type: 'MACD', fast: 12, slow: 26, signal: 9 }] } : { options: context.backtestOptions }) };
    try {
      const value = await api(`/api/research/${kind}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
      if (!container.isConnected) return;
      result = value; output.innerHTML = `<pre>${esc(formatResearchNote(result))}</pre>`;
      container.querySelector('.agent-research-actions').classList.remove('hidden');
    } catch (error) { if (container.isConnected) output.textContent = error.message; }
    finally { button.disabled = false; }
  };
  container.querySelector('[data-export-research]').onclick = () => {
    if (result) download(`${result.data.symbol}-${result.kind}-${result.id}.json`, JSON.stringify(result, null, 2), 'application/json');
  };
  container.querySelector('[data-share-research]').onclick = () => {
    if (!result || !canEdit) return;
    publish({ symbol: result.data.symbol, interval: result.data.interval, timestamp: result.data.to, price: result.data.lastClose, text: formatResearchNote(result) });
    toast('计算结果已加入批注，正在同步。');
  };
}
