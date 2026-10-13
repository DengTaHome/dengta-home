const assert=require('node:assert/strict');
const {resolveContextWindow}=require('../services/context-budget');
const {applyGenerationBudget,assertSerializedRequestBudget}=require('../services/generation-budget');
const {openAiResponsesMaxOutputTokens}=require('../services/generation-output-budget');
const {buildOpenAiResponsesInput,buildOpenAiMessages,generateReply,generateReplyStream,MAIN_CHAT_PROMPT_ARCHITECTURE}=require('../services/ai-service');
for(const model of ['gpt-4.1','openai/gpt-4.1-mini','gpt-4.1-nano-2025-04-14'])assert.equal(resolveContextWindow(model),1047576);
assert.equal(resolveContextWindow('gpt-4-0613'),8192);assert.notEqual(resolveContextWindow('gpt-4.5-preview'),8192);
for(const provider of ['custom','openai-responses']) for(const max_tokens of [undefined,null,0,512,4096]) for(const effort of ['none','high','xhigh']) {
 const settings={provider,model:'budget-fixture',max_tokens,reasoning_effort:effort};
 const messages=Array.from({length:400},(_,i)=>({role:i%2?'assistant':'user',content:'history '.repeat(100)})).concat([{role:'user',content:'latest input exactly'}]);
 const plan={systemInstructions:['  persona stays exactly\n'],messages};const original=JSON.stringify({settings,messages});
 applyGenerationBudget(plan,{settings});assert.equal(JSON.stringify({settings,messages}),original);assert.equal(plan.systemInstructions[0],'  persona stays exactly\n');assert.deepEqual(plan.messages.at(-1),messages.at(-1));
 const output=provider==='openai-responses'?openAiResponsesMaxOutputTokens(settings):max_tokens>0?max_tokens:undefined;
 const body=provider==='openai-responses'?{model:settings.model,instructions:plan.systemInstructions.join('\n\n'),input:buildOpenAiResponsesInput(plan.messages),max_output_tokens:output}:{model:settings.model,messages:buildOpenAiMessages(plan.messages,plan.systemInstructions),max_tokens:output};
 assert.doesNotThrow(()=>assertSerializedRequestBudget('https://fixture.test/v1/responses',{body:JSON.stringify(body)}),`planner/transport mismatch for ${provider}/${max_tokens}/${effort}`);
}
console.log('30 planner/transport cases: omitted, null, zero, explicit output and Responses reasoning budgets passed');

async function serializedProviderCases() {
 const originalFetch=global.fetch;
 const baseSettings={provider:'custom',model:'fictional-budget-fixture',runtime_api_key:'fictional-test-key',api_url:'https://fictional.invalid/v1',max_tokens:0};
 const tools=Array.from({length:60},(_,i)=>({name:'fixture_'+i,description:'fixture description',input_schema:{type:'object',properties:{}}}));
 let calls=[],toolWrites=0;
 global.fetch=async(url,options)=>{
  assert.equal(new URL(url).hostname,'fictional.invalid');
  assertSerializedRequestBudget(url,options);
  const body=JSON.parse(options.body);calls.push(body);
  if(body.stream)return new Response('data: '+JSON.stringify({choices:[{delta:{content:'Fictional reply.'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});
  return Response.json({choices:[{message:{content:'Fictional reply.'},finish_reason:'stop'}]});
 };
 try {
  await assert.rejects(generateReply({settings:baseSettings,systemInstructionsOverride:'fixture',messages:[{role:'user',content:'x'.repeat(157950)}],tools,executeTool:async()=>{toolWrites++;}}),error=>error.code==='context_budget_exceeded'&&error.budgetStage==='planning'&&error.budgetUsage.input===59796);
  assert.equal(calls.length,0,'oversize protected wire input fails during planning before any provider call');
  const messages=Array.from({length:1500},(_,i)=>({role:i%2?'assistant':'user',content:'fixture '+i+' '+ 'x'.repeat(100)})).concat([{role:'user',content:'latest fictional input'}]);
  const before=JSON.stringify({messages,baseSettings,tools});
  for(const generate of [generateReply,generateReplyStream]) {
   calls=[];
   await generate({settings:baseSettings,messages,tools,executeTool:async()=>{toolWrites++;},promptArchitecture:MAIN_CHAT_PROMPT_ARCHITECTURE,onEvent(){}});
   assert.equal(calls.length,1);
   assert.equal(calls[0].tools.length,60);
   assert.deepEqual(calls[0].messages.at(-1),messages.at(-1));
   assert.equal(calls[0].messages.find(message=>message.role!=='system').role,'user');
   assert.ok(calls[0].messages.length<messages.length,'older history is removed to fit actual tool wrappers');
  }
  assert.equal(JSON.stringify({messages,baseSettings,tools}),before);
  assert.equal(toolWrites,0);
  const toolHistory=[];
  for(let i=0;i<160;i++)toolHistory.push(
   {role:'user',content:'fictional user '+i},
   {role:'assistant',content:'',tool_calls:[{id:'fixture-call-'+i,type:'function',function:{name:'fixture_0',arguments:JSON.stringify({fixture:'x'.repeat(1800)})}}]},
   {role:'tool',tool_call_id:'fixture-call-'+i,content:'fictional tool result '+i},
   {role:'assistant',content:'fictional completion '+i}
  );
  toolHistory.push({role:'user',content:'latest tool history fixture'});
  calls=[];
  await generateReply({settings:baseSettings,messages:toolHistory,tools,executeTool:async()=>{toolWrites++;},systemInstructionsOverride:'fixture'});
  const retained=calls[0].messages.filter(message=>message.role!=='system');
  assert.ok(retained.length<toolHistory.length,'tool call arguments and IDs consume the serialized input budget');
  assert.equal(retained[0].role,'user');
  assert.deepEqual(retained.at(-1),toolHistory.at(-1));
  for(const message of retained.filter(message=>message.role==='tool'))assert.ok(retained.some(other=>other.tool_calls?.some(call=>call.id===message.tool_call_id)),'a retained tool result keeps its assistant tool call');
  assert.equal(toolWrites,0,'history trimming does not replay tool effects');
  for(const provider of ['custom','openai-responses','gemini','anthropic']) {
   calls=[];
   const providerSettings={...baseSettings,provider,max_tokens:512};
   global.fetch=async(url,options)=>{
    assert.equal(new URL(url).hostname,'fictional.invalid');assertSerializedRequestBudget(url,options);
    const body=JSON.parse(options.body);calls.push(body);
    if(provider==='openai-responses')return Response.json({output_text:'Fictional provider reply.'});
    if(provider==='gemini')return Response.json({candidates:[{content:{parts:[{text:'Fictional provider reply.'}]}}]});
    if(provider==='anthropic')return Response.json({content:[{type:'text',text:'Fictional provider reply.'}]});
    return Response.json({choices:[{message:{content:'Fictional provider reply.'},finish_reason:'stop'}]});
   };
   await generateReply({settings:providerSettings,messages,systemInstructionsOverride:'fixture',attachments:[{mimeType:'image/png',data:'A'.repeat(16000)}]});
   assert.equal(calls.length,1,provider+' actual messages and attachment wrappers fit the transport budget');
  }
  console.log('Serialized provider budgets passed: sixty tools, streamed/non-streamed history, tool metadata, attachments, protected input and no replay');
 } finally {global.fetch=originalFetch;}
}
serializedProviderCases().catch(error=>{console.error(error);process.exitCode=1;});
