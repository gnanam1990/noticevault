export const OWNER_JOURNAL_KEY = 'noticevault:owner-deployment:5042:0xff525d6940ad0e308ed6eda443c792694353f9da';
const OWNER = '0xff525d6940ad0e308ed6eda443c792694353f9da';
export function readOwnerJournal(read: (key:string)=>string|null): string {
 try {
  const raw=read(OWNER_JOURNAL_KEY);
  if(raw===null)return 'No record at this exact key on this origin. This does not clear other origins or pending wallet requests.';
  if(raw.length>4096)return 'Malformed journal; reconciliation remains blocked.';
  const value:unknown=JSON.parse(raw);
  if(!value||typeof value!=='object'||Array.isArray(value))return 'Malformed journal; reconciliation remains blocked.';
  const r=value as Record<string,unknown>;
  if((r.state!=='unknown'&&r.state!=='submitted')||r.chainId!==5042||typeof r.from!=='string'||r.from.toLowerCase()!==OWNER||typeof r.nonce!=='string'||!/^(0|[1-9][0-9]*)$/.test(r.nonce)||BigInt(r.nonce)>=2n**256n||typeof r.checksum!=='string'||!/^[0-9a-f]{64}$/.test(r.checksum)||typeof r.initCodeKeccak!=='string'||!/^0x[0-9a-f]{64}$/i.test(r.initCodeKeccak)||(r.state==='submitted'&&(typeof r.hash!=='string'||!/^0x[0-9a-f]{64}$/i.test(r.hash))))return 'Malformed or mismatched journal; reconciliation remains blocked.';
  return 'Prior attempt: '+r.state+'; chain 5042; nonce '+r.nonce+'; init code '+r.initCodeKeccak+(r.state==='submitted'?'; transaction '+String(r.hash):'')+'. Do not repeat. Receipt and nonce reconciliation are required.';
 } catch { return 'Journal unavailable or malformed; reconciliation remains blocked.'; }
}
export function mountOwnerJournal(root:HTMLElement, anchor:HTMLElement):()=>void {
 const button=root.ownerDocument.createElement('button');button.type='button';button.textContent='Check prior deployment journal (read only)';
 const output=root.ownerDocument.createElement('p');output.setAttribute('role','status');output.textContent='Prior deployment journal not checked. This control does not contact a wallet or modify storage.';
 anchor.after(button);button.after(output);
 button.onclick=()=>{const origin=root.ownerDocument.location?.origin??'current origin';output.textContent='Origin: '+origin+'; key: '+OWNER_JOURNAL_KEY+' — '+readOwnerJournal(key=>localStorage.getItem(key));};
 return ()=>{button.onclick=null;button.remove();output.remove();};
}
