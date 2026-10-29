export const NOTICE_EVENT = [
  {
    "type": "event",
    "name": "NoticeStarted",
    "inputs": [
      {
        "name": "S",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      },
      {
        "name": "reason",
        "type": "uint8",
        "indexed": false,
        "internalType": "uint8"
      }
    ],
    "anonymous": false
  }
] as const;
