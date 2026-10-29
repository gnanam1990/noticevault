import React, {useState} from "react";
import {AlertTriangle, Download, X} from "lucide-react";
import {useDemoStore} from "../demo/DemoStore.js";
export function StorageErrorBanner() {
  const {state,dispatch,exportRaw}=useDemoStore();
  const [exportError,setExportError]=useState<string|null>(null);
  const readErrors=Object.entries(state.storageErrors);
  const writeErrors=Object.entries(state.storageWriteErrors);
  const downloadRaw=()=>{
    try {
      const raw=exportRaw(); const url=URL.createObjectURL(new Blob([raw],{type:"application/json"}));
      const link=document.createElement("a");link.href=url;link.download="noticevault-raw-storage-backup.json";link.click();URL.revokeObjectURL(url);setExportError(null);
    } catch(err) {setExportError(String(err));}
  };
  if(readErrors.length===0 && writeErrors.length===0 && !exportError)return null;
  return <section className="space-y-2 px-4 pt-3" aria-label="Storage and action errors">
    {readErrors.map(([key,message])=><div key={key} role="alert" className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
      <p className="font-semibold flex gap-2"><AlertTriangle size={16}/> Saved demo is quarantined</p>
      <p className="text-xs mt-1 break-words">{message}</p>
      <p className="text-xs mt-2">Existing bytes have not been overwritten. Financial actions and saved edits are blocked. Export the raw payloads below; the agreement export does not recover corrupt storage. An explicit reset on Overview archives current payloads before starting a new session. Legacy keys stay untouched.</p>
      <button type="button" onClick={downloadRaw} className="mt-2 min-h-11 px-3 border border-red-300 rounded flex items-center gap-2"><Download size={14}/>Export raw storage</button>
    </div>)}
    {writeErrors.map(([key,message])=><div key={key} role="alert" className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-900 flex gap-3">
      <div className="flex-1 min-w-0"><p className="font-semibold">Action was not applied</p><p className="text-xs mt-1 break-words">{message}</p><p className="text-xs mt-2">The last committed agreement and activity state is unchanged. Review the error before trying again. Unsaved draft input may need to be entered again after reload.</p></div>
      <button type="button" aria-label="Dismiss action error" className="min-h-11 min-w-11" onClick={()=>dispatch({type:"DISMISS_WRITE_ERROR",key})}><X size={16}/></button>
    </div>)}
    {exportError && <p role="alert" className="text-sm text-red-800">Raw storage export failed: {exportError}</p>}
  </section>;
}
