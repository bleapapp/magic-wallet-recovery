import { type Abi, parseAbi } from 'viem';
import { entryPoint07Abi } from 'viem/account-abstraction';

export { entryPoint07Abi };

/** Kernel v3.1 account: only the members this tool uses. */
export const kernelAbi = parseAbi([
  'function accountId() pure returns (string)',
  'function rootValidator() view returns (bytes21)',
  'function permissionConfig(bytes4 pId) view returns ((bytes2 permissionFlag, address signer, bytes22[] policyData))',
  'function validationConfig(bytes21 vId) view returns ((uint32 nonce, address hook))',
  'function execute(bytes32 execMode, bytes executionCalldata) payable',
  'function initialize(bytes21 _rootValidator, address hook, bytes validatorData, bytes hookData, bytes[] initConfig)',
  'error InvalidCaller()',
  'error InvalidValidator()',
  'error InvalidNonce()',
  'error OnlyExecuteUserOp()',
  'error SignerPrefixNotPresent()',
  'error PolicyFailed(uint256 i)',
]);

/** Kernel v3.1 factory. */
export const kernelFactoryAbi = parseAbi([
  'function createAccount(bytes data, bytes32 salt) payable returns (address)',
  'function getAddress(bytes data, bytes32 salt) view returns (address)',
  'error InitializeError()',
]);

/** Meta-factory (FactoryStaker). Only used to decode historical deployment transactions. */
export const metaFactoryAbi = parseAbi([
  'function deployWithFactory(address factory, bytes createData, bytes32 salt) payable returns (address)',
  'function approved(address factory) view returns (bool)',
]);

/** Errors shared by both Cosigning Module versions. */
const cosigningModuleErrors = [
  'error NotOwner()',
  'error NotScwOwner()',
  'error NotRootPermission()',
  'error SignerAlreadyExists()',
  'error SignerDoesNotExist()',
  'error SlowWithdrawAlreadyTriggered()',
  'error SlowWithdrawNotTriggered()',
  'error TimelockTooHigh()',
] as const;

/** Bleap Cosigning Module V1. */
export const cosigningModuleV1Abi = parseAbi([
  'function signers(address wallet, bytes32 id) view returns (address)',
  'function timelockForSlowWithdraw() view returns (uint256)',
  'function triggeredSlowWithdrawals(address wallet) view returns (uint256)',
  'function remainingSlowWithdrawTime(address wallet) view returns (uint256)',
  'function triggerSlowWithdraw(bytes32 id, address wallet)',
  'function unTriggerSlowWithdraw(bytes32 id, address wallet)',
  ...cosigningModuleErrors,
]);

/** Bleap Cosigning Module V2. The slow-withdrawal deadline is stored at trigger time. */
export const cosigningModuleV2Abi = parseAbi([
  'function signers(address wallet, bytes32 id) view returns (address)',
  'function timelockForSlowWithdraw() view returns (uint256)',
  'function triggeredSlowWithdrawals(address wallet) view returns (uint48 triggeredAt, uint48 readyAt)',
  'function remainingSlowWithdrawTime(address wallet) view returns (uint256)',
  'function triggerSlowWithdraw(bytes32 id, address wallet)',
  'function unTriggerSlowWithdraw(bytes32 id, address wallet)',
  ...cosigningModuleErrors,
]);

export const erc20Abi = parseAbi([
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
]);

export const erc721Abi = parseAbi([
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function safeTransferFrom(address from, address to, uint256 tokenId)',
]);

export const erc1155Abi = parseAbi([
  'function balanceOf(address account, uint256 id) view returns (uint256)',
  'function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes data)',
]);

/** Errors raised by libraries used inside the contracts above (e.g. an ECDSA library). */
const libraryErrorsAbi = parseAbi(['error InvalidSignature()']);

/** Error ABIs used to decode revert data from any of the contracts above. */
export const knownErrorsAbi: Abi = [
  ...entryPoint07Abi.filter((item) => item.type === 'error'),
  ...kernelAbi.filter((item) => item.type === 'error'),
  ...kernelFactoryAbi.filter((item) => item.type === 'error'),
  ...cosigningModuleV2Abi.filter((item) => item.type === 'error'),
  ...libraryErrorsAbi,
];
