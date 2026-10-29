import {useEffect,useRef} from 'react';
import {mountOwnerDeployment} from './deployment-owner-view';
import markup from './owner-deployment-markup';
import './owner-deployment-view.css';
/** Static repository-owned markup only; bundle content uses textContent. */
export function OwnerDeployment({onBack}:{onBack:()=>void}) {
 const root=useRef<HTMLElement>(null);
 useEffect(()=>{if(!root.current)return;root.current.focus();return mountOwnerDeployment(root.current);},[]);
 return <div className="owner-deployment-review">
 <button type="button" onClick={onBack}>Back to NoticeVault</button>
 <main ref={root} tabIndex={-1} aria-labelledby="owner-review-title" dangerouslySetInnerHTML={{__html:markup}} />
 </div>;
}
