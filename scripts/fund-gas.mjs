// fund-gas.mjs — send testnet QOR from the owner account to the agent gas
// wallet (QoreChain diana testnet only). Usage:
//   node scripts/fund-gas.mjs [QOR]        (default 5)
// The gas wallet needs its own balance to pay for its ML-DSA-87 key
// registration and any agent txs it signs.
import { deriveUnifiedAccount } from "@qorechain/sdk";
import { parseEnvFile, OWNER_ENV, AGENT_ENV, broadcast, toUqor, fmtQor, balanceOf, EXPLORER } from "../agent/common.mjs";

const amountQor = process.argv[2] ?? "5";
const ownerEnv = parseEnvFile(OWNER_ENV);
const agentEnv = parseEnvFile(AGENT_ENV);
const owner = await deriveUnifiedAccount(ownerEnv.QORE_MNEMONIC, 0);
const gas = await deriveUnifiedAccount(agentEnv.GAS_MNEMONIC, 0);
console.log(`owner ${owner.cosmos}  balance ${fmtQor(await balanceOf(owner.cosmos))}`);
console.log(`gas   ${gas.cosmos}  balance ${fmtQor(await balanceOf(gas.cosmos))}`);
const msg = {
  typeUrl: "/cosmos.bank.v1beta1.MsgSend",
  value: { fromAddress: owner.cosmos, toAddress: gas.cosmos, amount: [{ denom: "uqor", amount: toUqor(amountQor) }] },
};
const res = await broadcast(owner, [msg], `fund gas wallet ${amountQor} QOR`, "hybrid");
if (res.code !== 0) {
  console.log(`REFUSED code ${res.code}: ${res.rawLog}`);
  process.exitCode = 1;
} else {
  console.log(`sent ${amountQor} QOR -> ${gas.cosmos}`);
  console.log(`tx ${res.transactionHash}  ${EXPLORER}${res.transactionHash}`);
  console.log(`gas balance now ${fmtQor(await balanceOf(gas.cosmos))}`);
}
