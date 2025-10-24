const leverageSlider = document.getElementById('leverage-slider');
const leverageOutput = document.getElementById('leverage-output');
const allocationSlider = document.getElementById('allocation-slider');
const allocationOutput = document.getElementById('allocation-output');
const tradeForm = document.getElementById('trade-form');
const tradeHistory = document.getElementById('trade-history');
const clearButton = document.getElementById('clear-trades');
const directionInputs = document.querySelectorAll("input[name='direction']");
const chartSymbol = document.getElementById('chart-symbol');
const chartInterval = document.getElementById('chart-interval');
const performanceBody = document.getElementById('performance-body');

const trades = [];
const performanceBySymbol = new Map();

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

const updateLeverageOutput = () => {
  leverageOutput.textContent = `x${leverageSlider.value}`;
};

const updateAllocationOutput = () => {
  allocationOutput.textContent = `${allocationSlider.value}%`;
};

leverageSlider.addEventListener('input', updateLeverageOutput);
allocationSlider.addEventListener('input', updateAllocationOutput);
updateLeverageOutput();
updateAllocationOutput();

const calculateEstimatedPnl = (trade) => {
  const notional = Number(trade.quantity) * Number(trade.leverage);
  const riskFactor = Number(trade.allocation) / 100;
  const directional = trade.direction === 'long' ? 1 : -1;
  const baseline = notional * riskFactor * 0.8;
  const value = Number((baseline * directional).toFixed(2));
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
  const symbol = formData.get('symbol').toUpperCase();
  const direction = formData.get('direction');
  const leverage = Number(formData.get('leverage')) || Number(leverageSlider.value);
  const allocation = Number(formData.get('allocation')) || Number(allocationSlider.value);
  const quantity = Number(formData.get('quantity')) || 0;
  const notes = formData.get('notes');

  const trade = {
    time: formatTime(new Date()),
    symbol,
    direction,
    leverage,
    allocation,
    quantity,
    notes,
  };

  trade.pnl = calculateEstimatedPnl(trade);

  trades.unshift(trade);

  if (trades.length > 12) {
    trades.length = 12;
  }

  tradeForm.reset();
  leverageSlider.value = leverage;
  allocationSlider.value = allocation;
  updateLeverageOutput();
  updateAllocationOutput();
  directionInputs.forEach((input) => {
    if (input.value === direction) {
      input.checked = true;
    }
  });

  renderTrades();
  updatePerformance(trade);
});

clearButton.addEventListener('click', () => {
  trades.length = 0;
  performanceBySymbol.clear();
  renderTrades();
  renderPerformance();
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
  const base = chartSymbol.value.startsWith('ETH')
    ? 1860
    : chartSymbol.value.startsWith('SOL')
    ? 32
    : chartSymbol.value.startsWith('XRP')
    ? 0.52
    : 28600;
  const data = generateSeriesData(base * (chartInterval.selectedIndex + 0.9));
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
  setChartData();
  resizeChart();
});
chartInterval.addEventListener('change', () => {
  setChartData();
  resizeChart();
});

setChartData();
renderTrades();
renderPerformance();
