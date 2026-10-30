/** Normalize recognized identities only; never rewrite stored preparations or bindings. */
const structured=/^(?:draft:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|agreement:0x[0-9a-f]{40})$/i;
export function isStructuredAttemptResource(resource:string):boolean{return structured.test(resource);}
export function canonicalAttemptResource(resource:string):string{return isStructuredAttemptResource(resource)?resource.toLowerCase():resource;}
