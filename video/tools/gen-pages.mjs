// vidrec gen-pages.mjs — builds terminal.html (verbatim real outputs, typed
// playback) and close.html from the captured command output.
import { readFileSync, writeFileSync } from "node:fs";

const propose = readFileSync("/tmp/vidrec/propose-out.txt", "utf8").trimEnd().split("\n");
const drill = readFileSync("/tmp/vidrec/drill-out.txt", "utf8").trimEnd().split("\n");

const script = [
  { cmd: "node agent/leash.mjs propose", out: propose },
  { cmd: "node agent/vault.mjs attack 0x0d95bE136395430Af3BF55Ea702623608B3524FD 0.5", out: drill },
];

const terminal = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:#0b0f14;color:#d7e0ea;font:15px/1.55 "JetBrains Mono",ui-monospace,Menlo,Consolas,monospace}
.bar{background:#11161d;color:#8b98a9;padding:10px 18px;font-size:13px;border-bottom:1px solid #1e2630}
#t{padding:22px 28px;white-space:pre-wrap;word-break:break-word}
.cmd{color:#7ee787;font-weight:700}.ok{color:#7ee787}.bad{color:#ff7b72;font-weight:700}.dim{color:#8b98a9}
.cur{display:inline-block;width:9px;height:18px;background:#d7e0ea;vertical-align:-3px;animation:blink 1s steps(1) infinite}
@keyframes blink{50%{opacity:0}}
</style></head><body>
<div class="bar">gogo-leash — terminal &nbsp;·&nbsp; QoreChain diana testnet</div>
<div id="t"></div><script>
const script = ${JSON.stringify(script)};
const el = document.getElementById('t');
const sleep = ms => new Promise(r => setTimeout(r, ms));
function esc(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function color(line){
  if (/READY|APPROVE/.test(line)) return '<span class="ok">'+esc(line)+'</span>';
  if (/SKIP|REFUSE|BLOCKED/.test(line)) return '<span class="bad">'+esc(line)+'</span>';
  if (/^gogo-leash:|^propose:/.test(line)) return '<span class="dim">'+esc(line)+'</span>';
  return esc(line);
}
(async () => {
  for (const step of script) {
    const cmdEl = document.createElement('div');
    cmdEl.innerHTML = '<span class="cmd">$ </span><span class="typed"></span><span class="cur"></span>';
    el.appendChild(cmdEl);
    const typed = cmdEl.querySelector('.typed');
    for (const ch of step.cmd) { typed.textContent += ch; await sleep(22); }
    cmdEl.querySelector('.cur').remove();
    el.appendChild(document.createTextNode('\\n'));
    for (const line of step.out) {
      const d = document.createElement('div');
      d.innerHTML = color(line);
      el.appendChild(d);
      await sleep(260);
    }
    el.appendChild(document.createTextNode('\\n'));
    await sleep(600);
  }
  const p = document.createElement('div');
  p.innerHTML = '<span class="cmd">$ </span><span class="cur"></span>';
  el.appendChild(p);
  await sleep(1500);
  window.__done = true;
})();
<\/script></body></html>`;

const close = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:#0b0f14;color:#e6edf3;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;display:flex;align-items:center;justify-content:center;text-align:center}
h1{font-size:64px;margin:0 0 12px}h1 span{color:#7ee787}
p{font-size:24px;color:#b7c2cd;margin:10px 0}
.small{font-size:17px;color:#8b98a9;margin-top:28px;line-height:1.7}
code{color:#7ee787}
</style></head><body><div>
<h1>Gogo <span>Leash</span></h1>
<p>The desk keeps trading. The money stays leashed.</p>
<div class="small">github.com/JM-03/gogo-leash<br>vault <code>0xC82274b045f7481C953f3DC0e88e9e54B308Dfd4</code> · QoreChain diana testnet<br>Post-Quantum AI Agents — Build Before Q-Day</div>
</div></body></html>`;

writeFileSync("/tmp/vidrec/terminal.html", terminal);
writeFileSync("/tmp/vidrec/close.html", close);
console.log("pages written");
