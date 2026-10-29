export const CLAIM_EVENT = [
  {
    "type": "event",
    "name": "ProviderClaimed",
    "inputs": [
      {
        "name": "regularDelta",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "noticeDelta",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "total",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  }
] as const;
