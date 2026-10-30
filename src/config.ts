import {defineChain} from 'viem';
/**
 * wagmi configuration
 * Built with Arc Studio — https://studio.arc.io
 */

import { http, createConfig } from 'wagmi'
import { mainnet } from 'wagmi/chains'
import { arcTestnet } from 'viem/chains'
import { injected } from 'wagmi/connectors'

export const arcMainnet=defineChain({id:5042,name:'Arc Mainnet',nativeCurrency:{name:'USDC',symbol:'USDC',decimals:18},rpcUrls:{default:{http:['https://rpc.mainnet.arc.io']}},blockExplorers:{default:{name:'Arc Explorer',url:'https://explorer.arc.io'}}});


export const config = createConfig({
  chains: [arcTestnet, arcMainnet, mainnet], // mainnet needed for ENS resolution
  connectors: [injected()],
  transports: {
    [arcTestnet.id]: http(),
    [arcMainnet.id]: http(),
    [mainnet.id]: http(), // ENS resolution uses mainnet
  },
})
