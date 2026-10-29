import {useMemo} from 'react';
import {OperatorApproval} from './OperatorApproval';
export function OperatorRenewal({workspaceId,streamId,agreement}:{workspaceId:string;streamId:string;agreement:string}){
 const approval=useMemo(()=>({agreement,streamId,action:'approve-renewal' as const}),[agreement,streamId]);
 const funding=useMemo(()=>({agreement,streamId,action:'fund-renewal' as const}),[agreement,streamId]);
 return <section aria-label="Connected renewal"><p className="mt-4 text-sm">Review approval and funding separately. Confirmed funding advances the next period. An unresolved attempt blocks further actions for this agreement.</p><OperatorApproval workspaceId={workspaceId} draftId={streamId+':'+agreement} renewal={approval}/><OperatorApproval workspaceId={workspaceId} draftId={streamId+':'+agreement} renewal={funding}/></section>;
}
