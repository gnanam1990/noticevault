/** Production assets cannot be embedded by another origin, including wallet-enabled frames. */
export function releaseAssetResponse(response:Response){
 const headers=new Headers(response.headers);
 headers.append('Content-Security-Policy',"frame-ancestors 'none'");
 headers.set('X-Frame-Options','DENY');
 headers.set('X-Content-Type-Options','nosniff');
 return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
