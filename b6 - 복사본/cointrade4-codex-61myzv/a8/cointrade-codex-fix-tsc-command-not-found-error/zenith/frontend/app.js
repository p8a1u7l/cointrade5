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

const trades = [];

const formatTime = (date) => {
  return `${date.getHours().toString().padStart(2, '0')}:${date
    .getMinutes()
    .toString()
    .padStart(2, '0')}:${date.getSeconds().toString().padStart(2, '0')}`;
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

tradeForm.addEventListener('submit', (event) => {
  event.preventDefault();

  const formData = new FormData(tradeForm);
  const symbol = formData.get('symbol').toUpperCase();
  const direction = formData.get('direction');
  const leverage = Number(formData.get('leverage')) || Number(leverageSlider.value);
  const allocation = Number(formData.get('allocation')) || Number(allocationSlider.value);
  const quantity = Number(formData.get('quantity'));
  const notes = formData.get('notes');

  trades.unshift({
    time: formatTime(new Date()),
    symbol,
    direction,
    leverage,
    allocation,
    quantity,
    notes,
  });

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
});

clearButton.addEventListener('click', () => {
  trades.length = 0;
  renderTrades();
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
  chart.resize(width, height);
};

window.addEventListener('resize', resizeChart);
resizeChart();

chartSymbol.addEventListener('change', setChartData);
chartInterval.addEventListener('change', setChartData);

setChartData();
renderTrades();
