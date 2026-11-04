/**
 * Fail-closed bounded UTF-8 reader for read-only Firestore REST inventory.
 * Response.text() buffers the ENTIRE remote body before the old byte check.
 * Streaming stops at the cap, avoiding unbounded memory usage in a worker.
 *
 * This module does not authorize reads or writes, only validates a response.
 */
export async function readBoundedFirestoreJson(response,{
  limit=2_000_000,sizeError='firestore_response_too_large',
  parseError='invalid_firestore_response'
}={}){
  if(!Number.isSafeInteger(limit)||limit<1||limit>2_000_000)
    throw Error('invalid_read_limit');
  const header=response?.headers?.get?.('Content-Length');
  if(header!==null && header!==undefined){
    if(!/^[0-9]+$/.test(header)||!Number.isSafeInteger(Number(header)))
      throw Error(parseError);
    if(Number(header)>limit)throw Error(sizeError);
  }
  const reader=response?.body?.getReader?.();
  if(!reader)throw Error(parseError);
  const decoder=new TextDecoder('utf-8',{fatal:true});
  let raw='',size=0,complete=false;
  try{
    while(true){
      const {done,value}=await reader.read();
      if(done){complete=true;break;}
      if(!(value instanceof Uint8Array))throw Error(parseError);
      size+=value.byteLength;
      if(size>limit)throw Error(sizeError);
      raw+=decoder.decode(value,{stream:true});
    }
    raw+=decoder.decode();
  }catch(error){
    // Abort the body when the response is malicious, truncated or oversized.
    try{await reader.cancel();}catch{}
    if(error instanceof TypeError)throw Error(parseError);
    throw error;
  }finally{
    try{reader.releaseLock()}catch{}
  }
  if(!complete)throw Error(parseError);
  try{return JSON.parse(raw)}catch{throw Error(parseError)}
}
