/** Synthetic cryptographic fixtures only: no wallet, live RPC or broadcast. */
import { describe, it, expect } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { buildTypedData, verifyProviderSignature } from "./eip712.js";
import type { EIP712PublicClient } from "./eip712.js";
import { LOCAL_FIXTURE_DEPLOYMENT } from "./deployments.js";
import type { TermsInput } from "./types.js";
const account=privateKeyToAccount("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
const dep={...LOCAL_FIXTURE_DEPLOYMENT,factoryAddress:"0x2222222222222222222222222222222222222222"};
const terms:TermsInput={schemaVersion:1,client:"0x1111111111111111111111111111111111111111",provider:account.address,token:"0x3333333333333333333333333333333333333333",amountPerPeriod:3000000n,periodSeconds:2592000n,noticeSeconds:864000n,startAt:2000000600n,clientNonce:0n,acceptanceDeadline:2000086400n,termsDocumentHash:("0x"+"cc".repeat(32)) as Hex};
const block=123n;
async function signature(){return account.signTypedData(buildTypedData(terms,dep));}
function client(code:unknown, result:unknown="0x1626ba7e", failure?:"code"|"signature") {
 const reads:Array<{kind:string;blockNumber?:bigint;address:string}>=[];
 const rpc:EIP712PublicClient={getBytecode:async args=>{reads.push({kind:"code",...args});if(failure==="code")throw new Error("code unavailable");return code as Hex|undefined;},readContract:async args=>{reads.push({kind:"signature",blockNumber:(args as {blockNumber?:bigint}).blockNumber,address:args.address});if(failure==="signature")throw new Error("signature unavailable");return result;}};
 return {rpc,reads};
}
describe("T023 pinned provider account type",()=>{
 it("valid ECDSA cannot skip contract-wallet validation",async()=>{const c=client("0x6000","0xdeadbeef");const r=await verifyProviderSignature(terms,dep,await signature(),c.rpc,block);expect(r).toMatchObject({status:"invalid",method:"erc1271"});expect(c.reads.map(x=>x.kind)).toEqual(["code","signature"]);});
 it("valid ECDSA cannot skip failed code determination",async()=>{const c=client("0x",undefined,"code");expect((await verifyProviderSignature(terms,dep,await signature(),c.rpc,block)).status).toBe("unknown");expect(c.reads).toHaveLength(1);});
 it("missing client is unknown even with valid ECDSA",async()=>{expect((await verifyProviderSignature(terms,dep,await signature(),null,block)).status).toBe("unknown");});
 it("missing pin performs no reads and is unknown",async()=>{const c=client("0x6000");expect((await verifyProviderSignature(terms,dep,"0x01",c.rpc)).status).toBe("unknown");expect(c.reads).toEqual([]);});
 it("missing code capability cannot fall back to ERC1271",async()=>{let calls=0;const c={readContract:async()=>{calls++;return "0x1626ba7e";}};expect((await verifyProviderSignature(terms,dep,"0x01",c,block)).status).toBe("unknown");expect(calls).toBe(0);});
 it("confirmed EOA valid signature succeeds after pinned code read",async()=>{const c=client("0x");expect(await verifyProviderSignature(terms,dep,await signature(),c.rpc,block)).toMatchObject({status:"valid",method:"ecdsa"});expect(c.reads).toEqual([{kind:"code",address:account.address,blockNumber:block}]);});
 it("confirmed EOA wrong signature rejects without ERC1271",async()=>{const c=client("0x");expect(await verifyProviderSignature(terms,dep,"0x01",c.rpc,block)).toMatchObject({status:"invalid",method:"ecdsa"});expect(c.reads).toHaveLength(1);});
 it("contract success pins BOTH reads and accepts arbitrary ERC1271 bytes",async()=>{const c=client("0x6000");expect(await verifyProviderSignature(terms,dep,"0x01",c.rpc,block)).toMatchObject({status:"valid",method:"erc1271"});expect(c.reads).toEqual([{kind:"code",address:account.address,blockNumber:block},{kind:"signature",address:account.address,blockNumber:block}]);});
 it("contract RPC failure is unknown even with valid ECDSA",async()=>{const c=client("0x6000",undefined,"signature");expect((await verifyProviderSignature(terms,dep,await signature(),c.rpc,block)).status).toBe("unknown");});
 it.each([undefined,null,"garbage","0x0",3])("malformed or absent code %s is unknown",async code=>{const c=client(code);expect((await verifyProviderSignature(terms,dep,await signature(),c.rpc,block)).status).toBe("unknown");expect(c.reads).toHaveLength(1);});
});
