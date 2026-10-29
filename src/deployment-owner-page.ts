import markup from './backend/owner-deployment-markup';
import {mountOwnerDeployment} from './backend/deployment-owner-view';
const root=document.querySelector('main');
if(!(root instanceof HTMLElement))throw Error('Owner review root missing');
root.innerHTML=markup;
mountOwnerDeployment(root);
