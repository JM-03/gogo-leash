// send-memo.mjs — send a native bank transfer with an exact memo (used for
// the QoreChain fest "Connect QoreX" proof: a self-send with the link memo).
// Usage: node scripts/send-memo.mjs <to> <uqor> <memo>
// QoreChain diana testnet only; the owner account signs.
import { deriveUnifiedAccount } from "@qorechain/sdk";
import { parseEnvFile, OWNER_ENV, broadcast, EXPLORER } from "../agent/common.mjs";

const [to, uqor, memo] = process.argv.slice(2);
if (!to || !uqor || !memo) throw new Error("usage: node scripts/send-memo.mjs <to> <uqor> <memo>");
const owner = await deriveUnifiedAccount(parseEnvFile(OWNER_ENV).QORE_MNEMONIC, 0);
const msg = {
  typeUrl: "/cosmos.bank.v1beta1.MsgSend",
  value: { fromAddress: owner.cosmos, toAddress: to, amount: [{ denom: "uqor", amount: uqor }] },
};
const res = await broadcast(owner, [msg], memo, "hybrid");
if (res.code !== 0) {
  console.log(`REFUSED code ${res.code}: ${res.rawLog}`);
  process.exitCode = 1;
} else {
  console.log(`sent ${uqor} uqor -> ${to}  memo "${memo}"`);
  console.log(`tx ${res.transactionHash}  ${EXPLORER}${res.transactionHash}`);
}
