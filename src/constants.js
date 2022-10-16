import ERC20Abi from "./abi/ERC20.json";
import { ethers } from "ethers";

const RPC_URL =
  "https://solemn-omniscient-borough.arbitrum-mainnet.quiknode.pro/69c7aa690b0d1164b85b62e06251b25e2fb85171/";
const provider = new ethers.providers.JsonRpcProvider(RPC_URL);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const ERC20 = new ethers.Contract(
  ethers.constants.AddressZero,
  ERC20Abi,
  provider
);

export { sleep, RPC_URL, ERC20, provider };
