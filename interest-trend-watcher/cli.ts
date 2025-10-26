import { runWatcher } from "./watcher.js";
import { extractSymbols } from "./tokenize.js";

const cmd = process.argv[2] ?? "run";

if (cmd === "run") {
  runWatcher().catch(e=>{
    console.error("[interest] error:", e?.response?.data ?? e);
    process.exit(1);
  });
} else if (cmd === "dump") {
  runWatcher().then(r=> console.log(JSON.stringify(r,null,2))).catch(e=>{console.error(e);process.exit(1);});
} else if (cmd === "test-tokenize") {
  const demo = [
    { id:"1", title:"Bitcoin ETF flows surge; $BTC hits new records", url:"x", timestamp:Date.now(), source:"demo", symbols:["BTC"] },
    { id:"2", title:"Solana ecosystem upgrade LIVE — SOL on fire", url:"y", timestamp:Date.now(), source:"demo" },
    { id:"3", title:"ETH L2 partnership announced", url:"z", timestamp:Date.now(), source:"demo" }
  ] as any;
  console.log(demo.flatMap(extractSymbols));
} else {
  console.log("usage: node dist/cli.js [run|dump|test-tokenize]");
}
