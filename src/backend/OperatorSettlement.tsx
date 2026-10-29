import {useMemo} from 'react';
import {OperatorApproval} from './OperatorApproval';
export function OperatorSettlement({workspaceId,streamId,agreement}:{workspaceId:string;streamId:string;agreement:string}){
 const actions=useMemo(()=>(['start-notice','materialize-notice','claim-provider','claim-client-refund'] as const).map(action=>({agreement,streamId,action})),[agreement,streamId]);
 return <section aria-label="Connected notice and settlement"><p className="mt-4 text-sm">Start notice requires the client. Recording a missed checkpoint or triggering a payout is permissionless for authenticated workspace members. Payments always go to the immutable provider or client; the caller cannot redirect them. Each action requires its own review and confirmation.</p>{actions.map(action=><OperatorApproval key={action.action} workspaceId={workspaceId} draftId={streamId+':'+agreement} renewal={action}/>)}</section>;
}
