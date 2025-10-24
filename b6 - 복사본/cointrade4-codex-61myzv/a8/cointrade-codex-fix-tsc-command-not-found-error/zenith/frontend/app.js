const leverageSlider = document.getElementById('leverage-slider');
const leverageOutput = document.getElementById('leverage-output');
const allocationSlider = document.getElementById('allocation-slider');
const allocationOutput = document.getElementById('allocation-output');
const symbolInput = document.getElementById('symbol');
const tradeForm = document.getElementById('trade-form');
const tradeHistory = document.getElementById('trade-history');
const clearButton = document.getElementById('clear-trades');
const chartSymbol = document.getElementById('chart-symbol');
const chartInterval = document.getElementById('chart-interval');
const performanceBody = document.getElementById('performance-body');
const aiDirectionLabel = document.getElementById('ai-direction');
const aiQuantityLabel = document.getElementById('ai-quantity');
const aiPriceLabel = document.getElementById('ai-price');
const aiConfidenceLabel = document.getElementById('ai-confidence');
const aiRationale = document.getElementById('ai-rationale');

const trades = [];
const performanceBySymbol = new Map();
const portfolioEquity = 25640.2;
let latestProjection = null;

const formatTime = (date) => {
  return `${date.getHours().toString().padStart(2, '0')}:${date
    .getMinutes()
    .toString()
    .padStart(2, '0')}:${date.getSeconds().toString().padStart(2, '0')}`;
};

const formatCurrency = (value) => {
  if (value === 0) {
    return '$0.00';
  }
  const sign = value > 0 ? '+' : '-';
  const abs = Math.abs(value);
  return `${sign}$${abs.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const getBaselinePrice = (symbol) => {
  const upper = symbol.toUpperCase();
  if (upper.startsWith('ETH')) return 1860;
  if (upper.startsWith('SOL')) return 32;
  if (upper.startsWith('XRP')) return 0.52;
  if (upper.startsWith('BNB')) return 242;
  if (upper.startsWith('DOGE')) return 0.078;
  return 28600;
};

const formatPrice = (price) => {
  if (!Number.isFinite(price)) {
    return '-';
  }
  return `$${price.toLocaleString(undefined, {
    minimumFractionDigits: price < 2 ? 4 : 2,
    maximumFractionDigits: price < 2 ? 4 : 2,
  })}`;
};

const formatConfidence = (value) => `${Math.round(value * 100)}%`;

const buildAiNarrative = (projection) => {
  const bias = projection.direction === 'long' ? '상승 모멘텀 포착' : '하락 압력 감지';
  const confidenceText = `신뢰도 ${formatConfidence(projection.confidence)}`;
  const leverageText = `레버리지 x${projection.leverage}`;
  const allocationText = `포트폴리오 대비 ${projection.allocation}% 비중`;
  return `${bias} · ${confidenceText} · ${leverageText}, ${allocationText}`;
};

const updateAiPanel = (projection) => {
  if (!projection) {
    aiDirectionLabel.textContent = '분석 대기';
    aiDirectionLabel.classList.remove('positive', 'negative');
    aiQuantityLabel.textContent = '-';
    aiPriceLabel.textContent = '-';
    aiConfidenceLabel.textContent = '-';
    aiRationale.textContent = 'AI가 최신 데이터를 분석하고 있습니다.';
    return;
  }

  aiDirectionLabel.textContent = projection.direction === 'long' ? '매수' : '매도';
  aiDirectionLabel.classList.toggle('positive', projection.direction === 'long');
  aiDirectionLabel.classList.toggle('negative', projection.direction !== 'long');
  aiQuantityLabel.textContent = projection.quantity.toLocaleString(undefined, {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });
  aiPriceLabel.textContent = formatPrice(projection.price);
  aiConfidenceLabel.textContent = formatConfidence(projection.confidence);
  aiRationale.textContent = projection.rationale;
};

const evaluateAiProjection = () => {
  const symbol = (symbolInput.value || 'BTCUSDT').toUpperCase();
  const leverage = Number(leverageSlider.value);
  const allocation = Number(allocationSlider.value);
  const baseline = getBaselinePrice(symbol);
  const intervalIndex = chartInterval.selectedIndex >= 0 ? chartInterval.selectedIndex : 1;
  const volatility = 1 + intervalIndex * 0.08;
  const minuteBucket = Math.floor(Date.now() / 60000);
  const seed = symbol.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const oscillator = Math.sin((minuteBucket + seed) * 1.37);
  const direction = oscillator >= 0 ? 'long' : 'short';
  const confidence = clamp(Math.abs(oscillator) + 0.35, 0.45, 0.95);
  const price = Number((baseline * volatility).toFixed(baseline < 2 ? 4 : 2));
  const notionalBudget = (portfolioEquity * allocation) / 100;
  const rawQuantity = (notionalBudget * leverage) / price;
  const quantity = Math.max(Number(rawQuantity.toFixed(3)), 0.001);

  const projection = {
    symbol,
    leverage,
    allocation,
    direction,
    confidence,
    price,
    quantity,
  };

  projection.notional = Number((quantity * price).toFixed(2));
  projection.rationale = buildAiNarrative(projection);

  latestProjection = projection;
  updateAiPanel(projection);

  return projection;
};

const updateLeverageOutput = () => {
  leverageOutput.textContent = `x${leverageSlider.value}`;
};

const updateAllocationOutput = () => {
  allocationOutput.textContent = `${allocationSlider.value}%`;
};

const handleLeverageInput = () => {
  updateLeverageOutput();
  evaluateAiProjection();
};

const handleAllocationInput = () => {
  updateAllocationOutput();
  evaluateAiProjection();
};

leverageSlider.addEventListener('input', handleLeverageInput);
allocationSlider.addEventListener('input', handleAllocationInput);
updateLeverageOutput();
updateAllocationOutput();

const calculateEstimatedPnl = (trade) => {
  const directional = trade.direction === 'long' ? 1 : -1;
  const volatilityEdge = 0.006 + trade.confidence * 0.014;
  const estimated = trade.notional * trade.leverage * volatilityEdge * directional;
  const value = Number(estimated.toFixed(2));
  return Number.isNaN(value) ? 0 : value;
};

const renderTrades = () => {
  tradeHistory.innerHTML = '';

  if (!trades.length) {
    const row = document.createElement('tr');
    row.classList.add('placeholder');
    const cell = document.createElement('td');
    cell.colSpan = 6;
    cell.textContent = '아직 실행된 거래가 없습니다.';
    row.appendChild(cell);
    tradeHistory.appendChild(row);
    return;
  }

  trades.forEach((trade) => {
    const row = document.createElement('tr');
    if (trade.notes) {
      row.title = trade.notes;
    }
    const timeCell = document.createElement('td');
    timeCell.textContent = trade.time;
    const symbolCell = document.createElement('td');
    symbolCell.textContent = trade.symbol;

    const directionCell = document.createElement('td');
    directionCell.classList.add('numeric', 'direction-cell', trade.direction);
    directionCell.textContent = trade.direction === 'long' ? '매수' : '매도';

    const leverageCell = document.createElement('td');
    leverageCell.classList.add('numeric');
    leverageCell.textContent = `x${trade.leverage}`;

    const allocationCell = document.createElement('td');
    allocationCell.classList.add('numeric');
    allocationCell.textContent = `${trade.allocation}%`;

    const quantityCell = document.createElement('td');
    quantityCell.classList.add('numeric');
    quantityCell.textContent = Number(trade.quantity).toFixed(3);

    row.appendChild(timeCell);
    row.appendChild(symbolCell);
    row.appendChild(directionCell);
    row.appendChild(leverageCell);
    row.appendChild(allocationCell);
    row.appendChild(quantityCell);
    tradeHistory.appendChild(row);
  });
};

const renderPerformance = () => {
  performanceBody.innerHTML = '';
  if (!performanceBySymbol.size) {
    const row = document.createElement('tr');
    row.classList.add('placeholder');
    const cell = document.createElement('td');
    cell.colSpan = 3;
    cell.textContent = '거래가 기록되면 손익 요약이 표시됩니다.';
    row.appendChild(cell);
    performanceBody.appendChild(row);
    return;
  }

  const entries = Array.from(performanceBySymbol.entries()).sort(
    (a, b) => b[1].pnl - a[1].pnl,
  );

  entries.forEach(([symbol, data]) => {
    const row = document.createElement('tr');
    const symbolCell = document.createElement('td');
    symbolCell.textContent = symbol;

    const countCell = document.createElement('td');
    countCell.classList.add('numeric');
    countCell.textContent = data.count.toString();

    const pnlCell = document.createElement('td');
    pnlCell.classList.add('numeric', 'pnl-value');
    if (data.pnl > 0) {
      pnlCell.classList.add('positive');
    } else if (data.pnl < 0) {
      pnlCell.classList.add('negative');
    }
    pnlCell.textContent = formatCurrency(data.pnl);

    row.appendChild(symbolCell);
    row.appendChild(countCell);
    row.appendChild(pnlCell);
    performanceBody.appendChild(row);
  });
};

const updatePerformance = (trade) => {
  const current = performanceBySymbol.get(trade.symbol) || { count: 0, pnl: 0 };
  current.count += 1;
  current.pnl = Number((current.pnl + trade.pnl).toFixed(2));
  performanceBySymbol.set(trade.symbol, current);
  renderPerformance();
};

tradeForm.addEventListener('submit', (event) => {
  event.preventDefault();

  const formData = new FormData(tradeForm);
  const symbol = (formData.get('symbol') || symbolInput.value || 'BTCUSDT').toUpperCase();
  const leverage = Number(formData.get('leverage') || leverageSlider.value);
  const allocation = Number(formData.get('allocation') || allocationSlider.value);
  const userNotes = formData.get('notes');

  symbolInput.value = symbol;
  leverageSlider.value = leverage;
  allocationSlider.value = allocation;

  const projection = evaluateAiProjection();

  const trade = {
    time: formatTime(new Date()),
    symbol: projection.symbol,
    direction: projection.direction,
    leverage: projection.leverage,
    allocation: projection.allocation,
    quantity: projection.quantity,
    entryPrice: projection.price,
    confidence: projection.confidence,
    notional: projection.notional,
    notes: projection.rationale,
  };

  if (userNotes) {
    trade.notes = `${userNotes}\n${projection.rationale}`;
  }

  trade.pnl = calculateEstimatedPnl(trade);

  trades.unshift(trade);

  if (trades.length > 12) {
    trades.length = 12;
  }

  tradeForm.reset();
  symbolInput.value = projection.symbol;
  leverageSlider.value = projection.leverage;
  allocationSlider.value = projection.allocation;
  updateLeverageOutput();
  updateAllocationOutput();
  evaluateAiProjection();

  renderTrades();
  updatePerformance(trade);
});

clearButton.addEventListener('click', () => {
  trades.length = 0;
  performanceBySymbol.clear();
  renderTrades();
  renderPerformance();
  evaluateAiProjection();
});

const generateCandle = (index, basePrice) => {
  const open = basePrice + (Math.random() - 0.5) * 20;
  const close = open + (Math.random() - 0.5) * 20;
  const high = Math.max(open, close) + Math.random() * 10;
  const low = Math.min(open, close) - Math.random() * 10;
  return {
    time: index,
    open: Number(open.toFixed(2)),
    high: Number(high.toFixed(2)),
    low: Number(low.toFixed(2)),
    close: Number(close.toFixed(2)),
  };
};

const generateSeriesData = (basePrice = 28600) => {
  const candles = [];
  for (let i = 0; i < 120; i += 1) {
    const previous = candles[i - 1];
    const nextBase = previous ? previous.close : basePrice;
    candles.push(generateCandle(i, nextBase));
  }
  return candles;
};

const chartElement = document.getElementById('chart');
const chart = LightweightCharts.createChart(chartElement, {
  layout: {
    background: { color: 'transparent' },
    textColor: '#cfd4ff',
  },
  grid: {
    vertLines: { color: 'rgba(255,255,255,0.05)' },
    horzLines: { color: 'rgba(255,255,255,0.05)' },
  },
  timeScale: {
    borderColor: 'rgba(255,255,255,0.1)',
  },
  rightPriceScale: {
    borderColor: 'rgba(255,255,255,0.1)',
  },
  crosshair: {
    mode: LightweightCharts.CrosshairMode.Normal,
  },
});

const candleSeries = chart.addCandlestickSeries({
  upColor: '#00c896',
  downColor: '#ff6b6b',
  borderDownColor: '#ff6b6b',
  borderUpColor: '#00c896',
  wickDownColor: '#ff6b6b',
  wickUpColor: '#00c896',
});

const setChartData = () => {
  const selectedSymbol = chartSymbol.value || 'BTCUSDT';
  const base = getBaselinePrice(selectedSymbol);
  const intervalFactor = chartInterval.selectedIndex + 0.9;
  const data = generateSeriesData(base * intervalFactor);
  candleSeries.setData(data);
  chart.timeScale().fitContent();
};

const resizeChart = () => {
  const { width, height } = chartElement.getBoundingClientRect();
  if (width === 0 || height === 0) {
    return;
  }
  chart.resize(width, height);
};

window.addEventListener('resize', () => {
  window.requestAnimationFrame(resizeChart);
});

resizeChart();

chartSymbol.addEventListener('change', () => {
  symbolInput.value = chartSymbol.value;
  setChartData();
  resizeChart();
  evaluateAiProjection();
});

chartInterval.addEventListener('change', () => {
  setChartData();
  resizeChart();
  evaluateAiProjection();
});

symbolInput.addEventListener('input', () => {
  evaluateAiProjection();
});

symbolInput.addEventListener('blur', () => {
  symbolInput.value = (symbolInput.value || '').toUpperCase();
  const match = Array.from(chartSymbol.options).find(
    (option) => option.value === symbolInput.value,
  );
  if (match) {
    chartSymbol.value = match.value;
    setChartData();
    resizeChart();
  }
  evaluateAiProjection();
});

evaluateAiProjection();
setChartData();
renderTrades();
renderPerformance();
