type Base=Readonly<{agreement:string;factory:string;client:string;provider:string;token:string;termsHash:string;noticeReserve:string;observedRegularFunded:string;observedRegularPaid:string;observedNoticePaid:string;observedClientRefunded:string;observedLiability:string;observedBalance:string}>;
export type DurableBusinessOutcome=Base&(Readonly<{kind:'STATE_CHANGED';action:'create-agreement';initialRegular:string;noticeReserve:string;depositedAmount:string;clientNonce:string;termsDigest:string}>|Readonly<{kind:'TRANSFER'|'NO_CHANGE';action:'claim-provider'|'claim-client-refund';recipient:string;amount:string;regularAmount:string;noticeAmount:string;noticeMaterialized:boolean}>);

/** Validate wire evidence only; this function cannot issue trusted server evidence. */
export function validBusinessOutcome(value:unknown,context:{action:string;account:string;target:string;binding?:{termsHash:string;termsDigest?:string};blockNumber:unknown;blockHash:unknown}):value is DurableBusinessOutcome{
 try{
 if(!value||typeof value!=='object'||!context.binding)return false;const o=value as DurableBusinessOutcome;
 const address=(v:unknown):v is string=>typeof v==='string'&&/^0x[0-9a-f]{40}$/i.test(v)&&BigInt(v)!==0n;
 const hash=(v:unknown)=>typeof v==='string'&&/^0x[0-9a-f]{64}$/i.test(v);
 const uint=(v:unknown):v is string=>typeof v==='string'&&/^(0|[1-9][0-9]{0,77})$/.test(v)&&BigInt(v)<(1n<<256n);
 if(o.action!==context.action||![o.agreement,o.factory,o.client,o.provider,o.token,context.target,context.account].every(address)||o.agreement===o.factory||o.agreement===o.token||o.client===o.provider||o.termsHash!==context.binding.termsHash||!hash(o.termsHash)||!hash(context.blockHash)||!uint(context.blockNumber))return false;
 if(![o.noticeReserve,o.observedRegularFunded,o.observedRegularPaid,o.observedNoticePaid,o.observedClientRefunded,o.observedLiability,o.observedBalance].every(uint))return false;
 const F=BigInt(o.observedRegularFunded),R=BigInt(o.noticeReserve),RP=BigInt(o.observedRegularPaid),NP=BigInt(o.observedNoticePaid),CR=BigInt(o.observedClientRefunded),L=BigInt(o.observedLiability);
 if(F===0n||R===0n||F+R>=(1n<<256n)||NP>R||RP+CR>F||F+R-RP-NP-CR!==L||BigInt(o.observedBalance)<L)return false;
 if(o.action==='create-agreement')return o.kind==='STATE_CHANGED'&&o.factory.toLowerCase()===context.target.toLowerCase()&&o.client.toLowerCase()===context.account.toLowerCase()&&hash(o.termsDigest)&&o.termsDigest===context.binding.termsDigest&&[o.initialRegular,o.depositedAmount,o.clientNonce].every(uint)&&BigInt(o.initialRegular)>0n&&F>=BigInt(o.initialRegular)&&F%BigInt(o.initialRegular)===0n&&BigInt(o.depositedAmount)===BigInt(o.initialRegular)+R;
 if(!['claim-provider','claim-client-refund'].includes(o.action)||!['TRANSFER','NO_CHANGE'].includes(o.kind)||o.agreement.toLowerCase()!==context.target.toLowerCase()||typeof o.noticeMaterialized!=='boolean'||![o.amount,o.regularAmount,o.noticeAmount].every(uint)||!address(o.recipient))return false;
 const amount=BigInt(o.amount),regular=BigInt(o.regularAmount),notice=BigInt(o.noticeAmount);
 if((o.kind==='NO_CHANGE')!==(amount===0n)||regular+notice!==amount)return false;
 return o.action==='claim-provider'?o.recipient.toLowerCase()===o.provider.toLowerCase()&&regular<=RP&&notice<=NP:o.recipient.toLowerCase()===o.client.toLowerCase()&&amount<=CR&&regular===amount&&notice===0n&&!o.noticeMaterialized;
 }catch{return false;}
}
