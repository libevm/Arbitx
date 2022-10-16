import { useEffect, useState, useCallback, Fragment } from "react";
import { ethers } from "ethers";
import { useLocalStorage } from "./hooks/useLocalStorage";
import { useParams } from "react-router-dom";
import {
  Box,
  Avatar,
  CardHeader,
  Link,
  Grid,
  Typography,
  Tooltip,
  CircularProgress,
  TableRow,
  Table,
  TableCell,
  TableHead,
  TableBody,
} from "@mui/material";
import styled from "styled-components";
import ERC20Abi from "./abi/ERC20.json";
import ERC721Abi from "./abi/ERC721.json";
import SeaportRouterAbi from "./abi/SeaportRouter.json";
import UniswapV2SwapRouterAbi from "./abi/UniswapV2SwapRouter.json";
import UniswapV3Abi from "./abi/UniswapV3.json";

import "./index.css";
import logo from "./logo.png";
import { ERC20, provider, sleep } from "./constants";

const TableCellMono = styled(TableCell)`
  font-family: monospace;
  font-size: 12px;
`;

// Transfer function topic
const TRANSFER_TOPIC_HASH =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef".toLowerCase();

// Common ABIs
const ABIS = [
  ...ERC20Abi,
  ...ERC721Abi,
  ...SeaportRouterAbi,
  ...UniswapV2SwapRouterAbi,
  ...UniswapV3Abi,
];

// States
const TX_DECODING_STATE = {
  RETRIEVING_TRACE: 0, // Getting trace from quick node
  RETRIEVING_STATE_CHANGES: 1, // Getting state changes
  RETRIEVING_TRANSFER_EVENTS: 2, // Getting transfer events
  RETRIEVING_FUNC_SIG: 3, // Getting function signatures from 4byte
  RETRIEVING_CONTRACT_NAME: 4, // Getting contract names
  DONE: 5, // We good
};

// Default decoder with common abis
let defaultDecoder = new ethers.utils.Interface(ABIS);

// Extract out all function signatures (4bytes)
function getUnknownFunctionSignatures(decoder, stackTrace) {
  const { input, calls } = stackTrace;
  const innerCalls = calls || [];

  try {
    // Decoder successfully decoded the data,
    // its a known function signature
    decoder.parseTransaction({ data: input });
    return [
      ...innerCalls.map((x) => getUnknownFunctionSignatures(decoder, x)).flat(),
    ];
  } catch (e) {
    // Decoder doesn't know the function signature, add it
    return [
      input.slice(0, 10),
      ...innerCalls.map((x) => getUnknownFunctionSignatures(decoder, x)).flat(),
    ];
  }
}

// Only gets unique function signatures
function getUniqueUnkownFunctionSignatures(decoder, stackTrace) {
  return Array.from(
    new Set(getUnknownFunctionSignatures(decoder, stackTrace))
  ).flat();
}

// Extract out all the addresses from the decoder
function getUnkownAddresses(knownAddresses, stackTrace) {
  // Convert to lowercase
  const { from, to, calls } = stackTrace;

  let unknowns = [];

  // If not found
  if (!knownAddresses[from.toLowerCase()]) {
    unknowns.push(from.toLowerCase());
  }

  if (!knownAddresses[to.toLowerCase()]) {
    unknowns.push(to.toLowerCase());
  }

  return [
    ...unknowns,
    ...(calls || []).map((x) => getUnkownAddresses(knownAddresses, x)).flat(),
  ];
}

function getUniqueUnknownAddresses(knownAddresses, stackTrace) {
  return Array.from(
    new Set(getUnkownAddresses(knownAddresses, stackTrace))
  ).flat();
}

function StackTraceTreeViewer(stackTrace) {
  const {
    type,
    to,
    gas,
    prettyValue,
    prettyAddress,
    prettyInput,
    prettyOutput,
    input,
    output,
    calls,
    error,
  } = stackTrace;

  const prettyValueStr =
    prettyValue === null ? "" : `ETH: ${ethers.utils.formatEther(prettyValue)}`;

  const prettyGas = parseInt(gas, 16);

  return (
    <li key={`${isNaN(prettyGas) ? "0" : prettyGas.toString()}`}>
      <details open>
        <summary>
          [{isNaN(prettyGas) ? "0" : prettyGas.toString()}] {prettyValueStr} [
          {type}]{" "}
          <Tooltip title={to} placement="top-start">
            <a href={`https://arbiscan.io//address/${to}`}>
              {prettyAddress || to}::{prettyInput || input}
            </a>
          </Tooltip>
        </summary>
        <ul>
          {(calls || []).length > 0 &&
            calls.map((x) => StackTraceTreeViewer(x))}
          {output !== undefined && (
            <li key={`return-${parseInt(gas, 16).toString()}`}>
              return [{prettyOutput || output}]
            </li>
          )}
          {
            // Sending ETH doesn't return value it seems
            output === undefined && error === undefined && (
              <li key={`return-${parseInt(gas, 16).toString()}`}>
                return [0x]
              </li>
            )
          }
          {error !== undefined && (
            <li
              className="error-li"
              key={`revert-${parseInt(gas, 16).toString()}`}
            >
              reverted [{error}]
            </li>
          )}
        </ul>
      </details>
    </li>
  );
}

// Make the contract traces readable
function formatTraceTree(decoder, knownContractAddresses, stackTrace) {
  let prettyInput = null;
  let prettyAddress = null;
  let prettyOutput = null;
  let prettyValue = null;

  try {
    const txDescription = decoder.parseTransaction({ data: stackTrace.input });
    const txParams = txDescription.functionFragment.inputs
      .map((x) => x.name)
      .filter((x) => x !== null);

    // Sometimes it has the tx param name
    if (txParams.length > 0) {
      const txArgs = txParams
        .map((x) => txDescription.args[x])
        .map((x) => x.toString());
      prettyInput =
        txDescription.name +
        "(" +
        txArgs.map((x, idx) => txParams[idx] + "=" + txArgs[idx] + ")");
    } else {
      // Otherwise no params
      prettyInput =
        txDescription.name +
        "(" +
        txDescription.args.map((x) => x.toString()) +
        ")";
    }
  } catch (e) {}

  try {
    // If theres an address inside
    if (!!knownContractAddresses[stackTrace.to.toLowerCase()]) {
      prettyAddress = knownContractAddresses[stackTrace.to.toLowerCase()];
    }
  } catch (e) {}

  if (stackTrace.value) {
    try {
      const bn = ethers.BigNumber.from(stackTrace.value);
      if (bn.gt(ethers.constants.Zero)) {
        prettyValue = bn;
      }
    } catch (e) {}
  }

  return {
    ...stackTrace,
    prettyValue,
    prettyAddress,
    prettyInput,
    prettyOutput,
    calls: (stackTrace.calls || []).map((x) =>
      formatTraceTree(decoder, knownContractAddresses, x)
    ),
  };
}

function App() {
  const [knownContractAddresses, setKnownContractAddresses] = useLocalStorage(
    "contractAddresses",
    {}
  );
  const [tokenNames, setTokenNames] = useLocalStorage("tokenNames", {});
  const [tokenDecimals, setTokenDecimals] = useLocalStorage(
    "tokenDecimals",
    {}
  );
  const [customTextSignatures, setCustomTextSignatures] = useLocalStorage(
    "textSignatures",
    []
  );
  const [parsed, setIsParsed] = useState(false);
  const [decoder, setDecoder] = useState(null);
  const [callData, setCallData] = useState(null);
  const [stateDiff, setStateDiff] = useState(null);
  const [transferEvents, setTransferEvents] = useState(null);
  const [isValidTxHash, setIsValidTxHash] = useState(true);
  const [decodingState, setDecodingState] = useState(null);
  const { txhash } = useParams();

  const getStackTrace = useCallback(async () => {
    // Can't figure out why this function keeps getting called
    // using this bool as a hacky way to prevent re-rendering
    setIsParsed(true);

    if (txhash.length !== 66 && txhash.slice(0, 2) !== "0x") {
      setIsValidTxHash(false);
      return;
    }

    setDecodingState(TX_DECODING_STATE.RETRIEVING_TRACE);

    const stackTraceData = await provider
      .send("debug_traceTransaction", [txhash, { tracer: "callTracer" }])
      .catch(() => null);

    if (stackTraceData === null) {
      setIsValidTxHash(false);
      return;
    }

    setDecodingState(TX_DECODING_STATE.RETRIEVING_STATE_CHANGES);

    // State changes
    const stateChangeTrace = await provider
      .send("debug_traceTransaction", [
        txhash,
        {
          tracer: `{
                data: [],
                fault: function(log) {},
                step: function(log) {
                    var s = log.op.toString();
                    if(s == "SSTORE") {
                        var myStack = [];
                        var stackLength = log.stack.length();
                        for (var i = 0; i < 2; i++) {
                            myStack.push(log.stack.peek(i));
                        }
                        
                        var offset = parseInt(myStack[stackLength - 1]);
                        var length = parseInt(myStack[stackLength - 2]);
                        this.data.push({
                            op: s,
                            address: log.contract.getAddress(),
                            caller: log.contract.getCaller(),
                            stack: myStack,
                            memory: log.memory.slice(offset, offset + length),
                        }); 
                    }
                },
                result: function() { return this.data; }}
            `,
          //   disableStack: true,
          //   disableMemory: true,
          //   disableStorage: true,
        },
      ])
      .catch(() => null);

    // Hexlify trace
    const stateChangeHexTrace = (stateChangeTrace || []).map((x) => {
      const newStack = x.stack.map((x) =>
        ethers.utils.hexlify(
          ethers.utils.zeroPad(ethers.BigNumber.from(x).toHexString(), 32)
        )
      );

      const hexEncode = (acc, x) => {
        let h = parseInt(x.toString()).toString(16);
        if (h.length !== 2) {
          h = "0" + h;
        }
        return acc + h;
      };

      const objToArr = (obj) =>
        Object.keys(obj)
          .map((x) => parseInt(x))
          .sort((a, b) => a - b)
          .map((x) => obj[x.toString()]);

      let newData = "0x" + objToArr(x.memory).reduce(hexEncode, "");
      let newAddress = "0x" + objToArr(x.address).reduce(hexEncode, "");
      let newCaller = "0x" + objToArr(x.caller).reduce(hexEncode, "");

      return {
        op: x.op,
        address: newAddress,
        caller: newCaller,
        stack: newStack,
        data: newData,
      };
    });

    // Merge all the state differences into a key value store
    const stateDiffKV = stateChangeHexTrace.reduce((acc, x) => {
      if (!acc[x.address]) {
        acc[x.address] = {};
      }

      acc[x.address][x.stack[0]] = x.stack[1];

      return acc;
    }, {});

    setDecodingState(TX_DECODING_STATE.RETRIEVING_TRANSFER_EVENTS);

    // Extract token transfer events
    const log3Trace = await provider.send("debug_traceTransaction", [
      txhash,
      {
        // Tracer we only care about LOGX
        tracer: `{
                  data: [],
                  fault: function(log) {},
                  step: function(log) {
                      var s = log.op.toString();
                      if(s == "LOG3") {
                          var myStack = [];
                          var stackLength = log.stack.length();
                          for (var i = 0; i < stackLength; i++) {
                              myStack.unshift(log.stack.peek(i));
                          }
                          
                          var offset = parseInt(myStack[stackLength - 1]);
                          var length = parseInt(myStack[stackLength - 2]);
                          this.data.push({
                              op: s,
                              address: log.contract.getAddress(),
                              caller: log.contract.getCaller(),
                              stack: myStack,
                              memory: log.memory.slice(offset, offset + length),
                          }); 
                      }
                  },
                  result: function() { return this.data; }}
              `,
        // disableStack: false,
        // disableMemory: false,
        // disableStorage: true
      },
    ]);

    const log3TraceHex = (log3Trace || []).map((x) => {
      const newStack = x.stack.map((x) =>
        ethers.utils.hexlify(
          ethers.utils.zeroPad(ethers.BigNumber.from(x).toHexString(), 32)
        )
      );

      const hexEncode = (acc, x) => {
        let h = parseInt(x.toString()).toString(16);
        if (h.length !== 2) {
          h = "0" + h;
        }
        return acc + h;
      };

      const objToArr = (obj) =>
        Object.keys(obj)
          .map((x) => parseInt(x))
          .sort((a, b) => a - b)
          .map((x) => obj[x.toString()]);

      let newData = "0x" + objToArr(x.memory).reduce(hexEncode, "");
      let newAddress = "0x" + objToArr(x.address).reduce(hexEncode, "");
      let newCaller = "0x" + objToArr(x.caller).reduce(hexEncode, "");

      return {
        op: x.op,
        address: newAddress,
        caller: newCaller,
        stack: newStack,
        data: newData,
      };
    });

    const erc20TransferEvents = log3TraceHex
      .filter((x) => {
        return x.stack.slice(-3)[0].toLowerCase() === TRANSFER_TOPIC_HASH;
      })
      .reduce((acc, x) => {
        if (!acc[x.address]) {
          acc[x.address] = [];
        }

        acc[x.address].push({
          from: "0x" + x.stack.slice(-4)[0].slice(26),
          to: "0x" + x.stack.slice(-5)[0].slice(26),
          amount: ethers.BigNumber.from(x.stack.slice(-6)[0]),
        });

        return acc;
      }, {});

    // Get tokens names and decimals
    const curTokenNames = (
      await Promise.all(
        Object.keys(erc20TransferEvents)
          .filter((x) => !tokenNames[x])
          .map((x) =>
            ERC20.attach(x)
              .symbol()
              .then((s) => [x, s])
              .catch(() => null)
          )
      )
    )
      .filter((x) => x !== null)
      .reduce((acc, x) => {
        return {
          ...acc,
          [x[0].toLowerCase()]: x[1],
        };
      }, {});

    const curTokenDecimals = (
      await Promise.all(
        Object.keys(erc20TransferEvents)
          .filter((x) => !tokenDecimals[x])
          .map((x) =>
            ERC20.attach(x)
              .decimals()
              .then((d) => [x, d])
              .catch(() => null)
          )
      )
    )
      .filter((x) => x !== null)
      .reduce((acc, x) => {
        return {
          ...acc,
          [x[0].toLowerCase()]: x[1],
        };
      }, {});

    console.log("curTokenNames", curTokenNames);
    console.log("curTokenDecimals", curTokenDecimals);

    setDecodingState(TX_DECODING_STATE.RETRIEVING_FUNC_SIG);

    const unknown4s = getUniqueUnkownFunctionSignatures(
      decoder,
      stackTraceData
    );
    const hexSigsRes = await Promise.all(
      unknown4s.map((x) =>
        fetch(
          `https://www.4byte.directory/api/v1/signatures/?format=json&hex_signature=${x}`,
          {
            method: "GET",
          }
        )
          .then((x) => x.json())
          .catch(() => null)
      )
    );
    const hexSigsResFlattened = hexSigsRes
      .filter((x) => x !== null)
      .map((x) => x.results)
      .flat();
    const textSignatures = hexSigsResFlattened.map(
      (x) => "function " + x.text_signature
    );

    // Save to localStorage
    const newCustomTextSignatures = [
      ...customTextSignatures,
      ...textSignatures,
    ];

    // Set a new decoder
    const newDecoder = new ethers.utils.Interface([
      ...decoder.format(),
      ...textSignatures,
    ]);

    setDecodingState(TX_DECODING_STATE.RETRIEVING_CONTRACT_NAME);

    // Attempt to get contract address name, rate limited to 5 every 1 second
    const unknownAddresses = getUniqueUnknownAddresses(
      knownContractAddresses,
      stackTraceData
    );
    let addressesSourceCode = [];
    for (let i = 0; i < unknownAddresses.length; i += 5) {
      const curSourceCodes = await Promise.all(
        unknownAddresses.slice(i, i + 5).map((x) =>
          fetch(
            `https://api.arbiscan.io/api?module=contract&action=getsourcecode&address=${x}&apikey=SGGHGKSTVVZ3RME4FQFMDU3SG1EIIW9YMH`,
            {
              method: "GET",
            }
          )
            .then((x) => x.json())
            .catch(() => {
              return { error: true };
            })
        )
      );
      addressesSourceCode = [...addressesSourceCode, ...curSourceCodes];

      // Rate limit of 5 req per second
      if (unknownAddresses.length >= 5) {
        await sleep(1100);
      }
    }
    // Exrtract out source code name (very hacky yes)
    const addressesNames = addressesSourceCode.map((x) => {
      let name = null;
      try {
        name = x.result[0]["ContractName"];
      } catch (e) {}
      if (name === "") {
        name = null;
      }
      return name;
    });

    // New key value
    const addressesWithNames = unknownAddresses
      .map((_, idx) => {
        return [unknownAddresses[idx].toLowerCase(), addressesNames[idx]];
      })
      .reduce((acc, x) => {
        if (x[1] === null) return acc;
        return {
          ...acc,
          [x[0]]: x[1],
        };
      }, {});

    // Save new Addresses
    const newKnownContractAddresses = {
      ...knownContractAddresses,
      ...addressesWithNames,
    };

    // Re-format trace data with new data
    const newStackTrace = formatTraceTree(
      newDecoder,
      newKnownContractAddresses,
      stackTraceData
    );

    // Finally set all the call data after we've parsed all the
    setTokenDecimals({
      ...tokenDecimals,
      ...curTokenDecimals,
    });
    setTokenNames({
      ...tokenNames,
      ...curTokenNames,
    });
    console.log("transferEvents", erc20TransferEvents);
    setTransferEvents(erc20TransferEvents);
    setStateDiff(stateDiffKV);
    setCallData(newStackTrace);
    setDecoder(newDecoder);
    setKnownContractAddresses(newKnownContractAddresses);
    setCustomTextSignatures(newCustomTextSignatures);
    setDecodingState(TX_DECODING_STATE.DONE);
  }, [
    setKnownContractAddresses,
    customTextSignatures,
    decoder,
    knownContractAddresses,
    setCustomTextSignatures,
    setTokenDecimals,
    setTokenNames,
    tokenDecimals,
    tokenNames,
    txhash,
  ]);

  useEffect(() => {
    // Initialize decoder
    if (decoder === null) {
      setDecoder(
        new ethers.utils.Interface([
          ...defaultDecoder.format(),
          ...customTextSignatures,
        ])
      );
    }

    // Get tx data
    if (
      decoder !== null &&
      callData === null &&
      txhash !== undefined &&
      !parsed
    ) {
      getStackTrace();
    }
  }, [decoder, callData, customTextSignatures, parsed, getStackTrace, txhash]);

  return (
    <>
      <div style={{ paddingTop: "25px" }} />
      <Grid container spacing={1}>
        <Grid item xs={1}></Grid>
        <Grid item xs={10}>
          <CardHeader
            avatar={
              <Link href="/">
                <Avatar alt="logo" src={logo} />
              </Link>
            }
            title={
              <Typography variant="h4" component="h4">
                Transaction Info
              </Typography>
            }
          />
          {callData === null &&
            isValidTxHash &&
            decodingState !== TX_DECODING_STATE.DONE && (
              <Box display="flex" alignItems="center">
                <CircularProgress />
                <Typography style={{ paddingLeft: "10px" }}>
                  {decodingState === TX_DECODING_STATE.RETRIEVING_TRACE &&
                    "Retrieving transaction data..."}
                  {decodingState ===
                    TX_DECODING_STATE.RETRIEVING_TRANSFER_EVENTS &&
                    "Detecting transfer events...."}
                  {decodingState ===
                    TX_DECODING_STATE.RETRIEVING_STATE_CHANGES &&
                    "Locating state changes...."}
                  {decodingState === TX_DECODING_STATE.RETRIEVING_FUNC_SIG &&
                    "Deriving function signatures...."}
                  {decodingState ===
                    TX_DECODING_STATE.RETRIEVING_CONTRACT_NAME &&
                    "Extracting contract names...."}
                </Typography>
              </Box>
            )}
          {callData === null && !isValidTxHash && "Invalid tx hash provided"}
          {callData !== null && stateDiff !== null && transferEvents !== null && (
            <>
              <Typography variant="h5">State Changes</Typography>
              {Object.keys(stateDiff).length === 0 ? (
                <>No state changes found</>
              ) : (
                <Table sx={{ minWidth: 650 }} size="small">
                  <TableHead>
                    <TableRow>
                      <TableCellMono>Address</TableCellMono>
                      <TableCellMono>Key -&gt; Value</TableCellMono>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {Object.keys(stateDiff).map((address) => {
                      const keys = Object.keys(stateDiff[address]);

                      return (
                        <Fragment>
                          <TableRow style={{ width: "100%" }}>
                            <TableCellMono
                              rowSpan={stateDiff[address].length + 1}
                            >
                              {knownContractAddresses[address.toLowerCase()] ? (
                                <Tooltip title={address} placement="top-start">
                                  <a
                                    href={`https://arbiscan.io//address/${address}`}
                                  >
                                    {knownContractAddresses[address]}
                                  </a>
                                </Tooltip>
                              ) : (
                                <a
                                  href={`https://arbiscan.io//address/${address}`}
                                >
                                  {address}
                                </a>
                              )}
                            </TableCellMono>
                            {keys.map((k) => (
                              <TableRow
                                style={{
                                  width: "100%",
                                }}
                              >
                                <TableCellMono sx={{ minWidth: "50%" }}>
                                  {k}
                                </TableCellMono>
                                <TableCellMono sx={{ minWidth: 50 }}>
                                  -&gt;
                                </TableCellMono>
                                <TableCellMono sx={{ minWidth: "50%" }}>
                                  {stateDiff[address][k]}
                                </TableCellMono>
                              </TableRow>
                            ))}
                          </TableRow>
                        </Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
              <div style={{ margin: "10px" }} />
              <Typography variant="h5">ERC20 Transfer Events</Typography>
              {Object.keys(stateDiff).length === 0 ? (
                <>No transfer events found</>
              ) : (
                <Table sx={{ minWidth: 650 }} size="small">
                  <TableHead>
                    <TableRow>
                      <TableCellMono>Token</TableCellMono>
                      <TableCellMono>[Amount] From -&gt; To</TableCellMono>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {Object.keys(transferEvents).map((address) => {
                      const a = transferEvents[address].map((k) => (
                        <TableRow
                          style={{
                            width: "100%",
                          }}
                        >
                          <TableCellMono>
                            {tokenNames[address.toLowerCase()] ? (
                              <Tooltip title={address} placement="top-start">
                                <a
                                  href={`https://arbiscan.io//address/${address}`}
                                >
                                  {tokenNames[address.toLowerCase()]}
                                </a>
                              </Tooltip>
                            ) : (
                              <a
                                href={`https://arbiscan.io//address/${address}`}
                              >
                                {address}
                              </a>
                            )}
                          </TableCellMono>
                          <TableCellMono>
                            {[
                              tokenDecimals[address.toLowerCase()]
                                ? ethers.utils.formatUnits(
                                    k.amount,
                                    tokenDecimals[address.toLowerCase()]
                                  )
                                : k.amount.toString(),
                            ]}
                          </TableCellMono>
                          <TableCellMono>{k.from}</TableCellMono>
                          <TableCellMono sx={{ minWidth: 50 }}>
                            -&gt;
                          </TableCellMono>
                          <TableCellMono>{k.to}</TableCellMono>
                        </TableRow>
                      ));

                      return a;
                    })}
                  </TableBody>
                </Table>
              )}
              <div style={{ margin: "10px" }} />
              <Typography variant="h5">Execution Trace</Typography>
              <ul className="tree">
                <li key="root">
                  <details open>
                    <summary>[Sender] {callData.from}</summary>
                    <ul>{StackTraceTreeViewer(callData)}</ul>
                  </details>
                </li>
              </ul>
            </>
          )}
        </Grid>
        <Grid item xs={1}></Grid>
      </Grid>
    </>
  );
}

export default App;

export {
  defaultDecoder,
  StackTraceTreeViewer,
  formatTraceTree,
  getUniqueUnknownAddresses,
  getUniqueUnkownFunctionSignatures,
};
