const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createRequire}=require('node:module');
const {createRequestScope}=require('../services/request-scope');
const originalRequire=createRequire(require.resolve('../routes/co-watch'));
const userId='11111111-1111-4111-8111-111111111111',companionId='33333333-3333-4333-8333-333333333333',sessionId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
async function main(){
 let mode='listening',title='虚构歌名',captured,release,fail=false;const logs=[];
 const module={exports:{}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../routes/co-watch'),'utf8'),{module,exports:module.exports,Buffer,console:{warn:(_label,data)=>logs.push(data)},require(name){if(name==='../services/co-watch-sessions')return {...originalRequire(name),startCoWatchSession:async()=>({status:'resumed',session:{id:sessionId,title,session_mode:mode,media_url:'https://example.test/validated-media'}})};return originalRequire(name);}});
 const companion={id:companionId,user_id:userId,status:'active'};
 const scope=createRequestScope({adminSupabase:{from(){}},user:{id:userId},profile:{id:userId,status:'active',role:'member'},companion,companions:[companion]});
 const router=module.exports.createCoWatchRouter({interestEngine:{recordWatch:async(_scope,input)=>{assert.equal(_scope,scope);captured=input;if(fail)throw Object.assign(new Error('Bearer fictional-private-text'),{code:'private-secret-code'});return new Promise(resolve=>{release=resolve;});}}});
 const handler=router.stack.find(layer=>layer.route?.path==='/sessions').route.stack[0].handle;
 const req={scope,body:{title:'Wrong input title',media_url:'https://example.test/unvalidated-input'}};
 const response=()=>({set(){},status(value){this.httpStatus=value;return this;},json(value){this.body=value;return this;}});
 let res=response();await handler(req,res,error=>{throw error;});assert.equal(res.httpStatus,200);assert.equal(res.body.session.id,sessionId);assert.equal(captured.request_id,sessionId);assert.equal(captured.kind,'music');assert.equal(captured.title,title);assert.equal(captured.source_url,'https://example.test/validated-media');assert.ok(release,'history must not delay the session response');release({recorded:true,warning:{code:'interest_profile_save_failed'}});await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(JSON.parse(JSON.stringify(logs[0])),{code:'interest_profile_save_failed',recorded:true});
 mode='web_page';res=response();await handler(req,res,error=>{throw error;});assert.equal(captured.kind,'video');release({recorded:true});await new Promise(resolve=>setImmediate(resolve));
 title='';captured=null;await handler(req,response(),error=>{throw error;});assert.equal(captured,null,'unnamed screen capture must not create empty history');
 title='虚构影片';fail=true;await handler(req,response(),error=>{throw error;});await new Promise(resolve=>setImmediate(resolve));assert.equal(logs.at(-1).code,'watch_save_failed');assert.doesNotMatch(JSON.stringify(logs),/Bearer|fictional-private-text|private-secret/);
 console.log('Co-watch interest delivery: validated title/URL, session retry key, listening kind, empty-title skip, nonblocking response and private error redaction passed');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
