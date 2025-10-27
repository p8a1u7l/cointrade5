import { runWatcher } from './watcher';
import { extractSymbols } from './tokenize';

const command = process.argv[2] ?? 'run';

if (command === 'run') {
  runWatcher().catch((error) => {
    console.error('[interest] error:', error?.response?.data ?? error);
    process.exit(1);
  });
} else if (command === 'dump') {
  runWatcher()
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
} else if (command === 'test-tokenize') {
  const demo = [
    {
      id: '1',
      title: 'Bitcoin ETF flows surge; $BTC hits new records',
      url: 'x',
      timestamp: Date.now(),
      source: 'demo',
      symbols: ['BTC'],
    },
    {
      id: '2',
      title: 'Solana ecosystem upgrade LIVE — SOL on fire',
      url: 'y',
      timestamp: Date.now(),
      source: 'demo',
    },
    {
      id: '3',
      title: 'ETH L2 partnership announced',
      url: 'z',
      timestamp: Date.now(),
      source: 'demo',
    },
  ] as any;
  console.log(demo.flatMap(extractSymbols));
} else {
  console.log('usage: node dist/packages/interest-watcher/src/cli.js [run|dump|test-tokenize]');
}
