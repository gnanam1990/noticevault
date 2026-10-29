// Exact ClientRefunded ABI from NoticeVaultAgreement.
export const REFUND_EVENT = [
  {
    "type": "event",
    "name": "ClientRefunded",
    "inputs": [
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  }
] as const;
