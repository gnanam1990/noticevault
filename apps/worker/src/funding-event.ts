// Existing NoticeVaultAgreement RegularFunded ABI only.
export const FUNDING_EVENT = [
  {
    "type": "event",
    "name": "RegularFunded",
    "inputs": [
      {
        "name": "newF",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "newD",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      },
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
