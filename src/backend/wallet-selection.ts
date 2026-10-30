// Same-page provider selection invalidation; persistent journals remain authoritative.
const listeners=new Set<()=>void>();
export function onWalletSelectionChange(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener);};}
export function invalidateWalletSelection(){for(const listener of [...listeners]){try{listener();}catch{/* Continue invalidating the other in-flight controllers. */}}}
