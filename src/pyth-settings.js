export async function mountPythSettings({ container, api, local, onSaved = () => {}, onFree = () => {} }) {
  if (!container) return;
  const free=document.createElement('section');free.className='free-gold-sources';
  const heading=document.createElement('h3');heading.textContent='免费黄金行情 · 无需 Key';
  const description=document.createElement('p');description.className='search-hint';description.textContent='使用币安官方公开行情，无需注册数据服务，也没有试用倒计时。两种品种会一并加入自选，并下载可用历史。';
  const options=[['BINANCE:XAUUSDT','查看黄金永续','XAUUSDT：币安黄金永续，USDT 计价，有合约基差。'],['PAXGUSDT','查看 PAXG 现货','PAXGUSDT：黄金代币现货，适合查看更长的历史；不等同于现货黄金 XAU/USD。']];
  const freeStatus=document.createElement('p');freeStatus.className='search-hint';freeStatus.setAttribute('role','status');
  free.append(heading,description);
  for(const [symbol,label,text] of options){
    const row=document.createElement('div');row.className='free-gold-option';
    const detail=document.createElement('p');detail.textContent=text;
    const button=document.createElement('button');button.type='button';button.className=symbol.startsWith('BINANCE:')?'primary':'secondary';button.textContent=label;button.disabled=!local;
    button.onclick=async()=>{button.disabled=true;freeStatus.textContent='正在添加免费黄金品种…';try{await onFree(symbol);}catch(error){freeStatus.textContent=error.message;}finally{button.disabled=false;}};
    row.append(detail,button);free.append(row);
  }
  const limitation=document.createElement('p');limitation.className='search-hint';limitation.textContent='各品种从自身上市日起提供历史，使用各自真实报价；不会拼接成 PYTH 历史。';
  free.append(limitation,freeStatus);container.replaceChildren(free);
  const spot=document.createElement('p');spot.className='search-hint';
  const spotLink=document.createElement('a');spotLink.href='https://www.histdata.com/download-free-forex-historical-data/';spotLink.target='_blank';spotLink.rel='noreferrer';spotLink.textContent='HistData：免费现货黄金 XAU/USD 历史文件 ↗';
  spot.append(spotLink,document.createTextNode(' · 分钟和 Tick 文件，需单独下载导入，不是实时 API；文件时间为固定 UTC−5。'));free.append(spot);
  if(local)try{const result=await api('/api/feeds/gold/free');if(result.history?.running)freeStatus.textContent=`正在下载 ${result.history.current?.symbol||'免费黄金'} ${result.history.current?.interval||''} 历史…`;else if(result.history?.results?.length){const failed=result.history.results.filter(row=>row.error).length;freeStatus.textContent=failed?`历史已保存，${failed} 个周期暂未下载成功，可点击重试。`:'免费历史已下载到本机，可直接打开图表。';}}catch(error){freeStatus.textContent=error.message;}
  const optional=document.createElement('details');optional.className='pyth-optional';
  const summary=document.createElement('summary');summary.textContent='可选：使用 PYTH 原始行情（需另行授权）';optional.append(summary);
  const pyth=document.createElement('div');optional.append(pyth);container.append(optional);
  container=pyth;
  const title = document.createElement('h3'); title.textContent = 'PYTH 黄金历史行情';
  const hint = document.createElement('p'); hint.className = 'search-hint';
  hint.textContent = local ? 'PYTH 免费档不含 API；试用 Key 到期后可能需要付费。仅在需要 PYTH 原始报价且已有授权时填写。验证后下载日线、周线、4 小时和 1 小时，Key 只保存在本机服务端。' : '请在运行终端的电脑上配置数据授权。';
  container.replaceChildren(title, hint);
  if (!local) return;
  const link = document.createElement('a'); link.href = 'https://app.pyth.com/products'; link.target = '_blank'; link.rel = 'noreferrer'; link.textContent = '查看 PYTH 官方方案与 API 权限 ↗';
  const form = document.createElement('form'); form.className = 'pyth-key-form';
  const label = document.createElement('label'); label.textContent = 'PYTH API Key';
  const input = document.createElement('input'); input.type = 'password'; input.name = 'apiKey'; input.autocomplete = 'off'; input.required = true; input.minLength = 8; input.maxLength = 8192; input.setAttribute('aria-label', 'PYTH API Key');
  label.append(input);
  const button = document.createElement('button'); button.className = 'primary'; button.type = 'submit'; button.textContent = '保存并验证黄金行情';
  const status = document.createElement('p'); status.className = 'search-hint'; status.setAttribute('role', 'status'); status.textContent = '正在检查本机授权…';
  form.append(label, button); container.append(link, form, status);
  const showStatus = value => {
    status.textContent = value.configured ? (value.verifiedAt ? `黄金历史接口已验证 · ${new Date(value.verifiedAt).toLocaleString()}` : '已配置 Key；载入黄金时将验证访问权限。') : '尚未填写 Key。登录官方页面后选择「View your API key」。';
    if (value.history?.running) status.textContent += ` · 正在补齐 ${value.history.interval || '日线'} 历史`;
    else if (value.history?.results?.length) status.textContent += ' · ' + value.history.results.map(row => `${row.interval}：${row.count || 0} 根${row.warning ? '（范围受限，已保留可读数据）' : ''}`).join('，');
  };
  try { showStatus(await api('/api/feeds/pyth')); } catch (error) { status.textContent = error.message; }
  form.onsubmit = async event => {
    event.preventDefault(); button.disabled = true; status.textContent = '正在验证 PYTH 黄金历史行情…';
    const apiKey = input.value; input.value = '';
    try {
      const value = await api('/api/feeds/pyth', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey }) });
      showStatus(value); await onSaved(value);
    } catch (error) { status.textContent = error.message; }
    finally { button.disabled = false; }
  };
}
