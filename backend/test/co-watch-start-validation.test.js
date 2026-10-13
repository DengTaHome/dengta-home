const assert=require("node:assert/strict");
const {test}=require("node:test");
const {startCoWatchSession}=require("../services/co-watch-sessions");
test("invalid replacement never ends an active session",async()=>{
 for(const failure of ["conversation","media","page","encryption","playlist"]){
  const updates=[],inserts=[];
  const mode=failure==="page"?"web_page":failure==="playlist"?"listening":"direct_media";
  const options={database:{from(){}},input:{session_id:"2c90a3ba-5a90-4a21-9f3f-a24c84cc7a50",session_mode:mode,media_url:"https://media.example.test/video.mp4",playlist_id:"bad",item_id:"bad"},
    findSession:async()=>null,findActiveSession:async()=>({id:"old-active",status:"active"}),findConversation:async()=>failure==="conversation"?null:{id:"conversation"},
    validateMediaUrl:async url=>{if(failure==="media")throw Error("Invalid media");return url;},
    validatePageUrl:async url=>{if(failure==="page")throw Error("Invalid page");return url;},
    encryptMediaUrl:url=>{if(failure==="encryption")throw Error("Encryption failed");return url;},
    updateSession:async(...args)=>updates.push(args),insertSession:async(...args)=>inserts.push(args)};
  await assert.rejects(startCoWatchSession(options));assert.equal(updates.length,0,failure);assert.equal(inserts.length,0,failure);
 }
});
test("a valid replacement validates and encrypts before ending the old session",async()=>{
 const events=[];
 const result=await startCoWatchSession({database:{from(){}},input:{session_id:"2c90a3ba-5a90-4a21-9f3f-a24c84cc7a50",session_mode:"direct_media",media_url:"https://media.example.test/video.mp4"},
  findSession:async()=>null,findActiveSession:async()=>({id:"old-active",status:"active"}),findConversation:async()=>({id:"conversation"}),
  validateMediaUrl:async url=>{events.push("validate");return url;},encryptMediaUrl:url=>{events.push("encrypt");return url;},
  updateSession:async()=>events.push("end-old"),insertSession:async(_db,value)=>{events.push("insert-new");return value;}});
 assert.equal(result.status,"created");assert.deepEqual(events,["validate","encrypt","end-old","insert-new"]);
});
