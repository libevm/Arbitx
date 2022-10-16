import { ethers } from "ethers";

const RPC_URL =
  "https://solemn-omniscient-borough.arbitrum-mainnet.quiknode.pro/69c7aa690b0d1164b85b62e06251b25e2fb85171/";
const provider = new ethers.providers.JsonRpcProvider(RPC_URL);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export { sleep, RPC_URL, provider };
