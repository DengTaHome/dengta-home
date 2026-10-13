const assert = require('node:assert/strict');
const { test } = require('node:test');
const { extractText } = require('../services/adaptive-file-parser');
const parse = async (name,text) => (await extractText(name,Buffer.from(text))).text;

test('CSV multiline fields, escaped quotes and TSV delimiters',async()=>{
  assert.equal(await parse('fixture.csv','role,text\nassistant,"星灯\n说""你好"""'),'role | text\nassistant | 星灯\n说"你好"');
  assert.equal(await parse('fixture.tsv','role\ttext\nuser\t星灯'),'role | text\nuser | 星灯');
  await assert.rejects(parse('fixture.csv','role,"unfinished'),{code:'import_csv_invalid'});
});
test('JSONL, nested exports and content parts preserve text',async()=>{
  assert.equal(await parse('fixture.jsonl','{"role":"user","content":"你好"}\n{"role":"assistant","content":[{"text":"星灯"}]}'),'user: 你好\nassistant: 星灯');
  assert.equal(await parse('fixture.json',JSON.stringify([{mapping:{a:{message:{author:{role:'assistant'},content:{parts:['星灯']}}}}}])),'assistant: 星灯');
  await assert.rejects(parse('fixture.jsonl','{oops'),{code:'import_json_invalid'});
});
test('UTF-16, GBK, binary disguises and unsupported legacy docs',async()=>{
  assert.equal((await extractText('fixture.txt',Buffer.concat([Buffer.from([255,254]),Buffer.from('星灯','utf16le')]))).text,'星灯');
  assert.equal((await extractText('fixture.txt',Buffer.from([0xb5,0xc6,0xcb,0xfe]))).text,'灯塔');
  await assert.rejects(extractText('fixture.txt',Buffer.from([1,0,2,3])),{code:'import_file_type_unsupported'});
  await assert.rejects(extractText('fixture.doc',Buffer.from([0xd0,0xcf,0x11,0xe0])),{code:'import_file_type_unsupported'});
  await assert.rejects(extractText('fixture.zip',Buffer.from([0x50,0x4b,3,4])),{code:'import_file_type_unsupported'});
});
test('MIME charset, multipart, base64 HTML and quoted-printable mail',async()=>{
  const mail='Subject: =?UTF-8?B?5pif54Gv?=\r\nContent-Type: multipart/alternative; boundary="sample"\r\n\r\n--sample\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n=E4=BD=A0=E5=A5=BD\r\n--sample\r\nContent-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n'+Buffer.from('<p>你好</p>').toString('base64')+'\r\n--sample--\r\n';
  const result=await parse('fixture.eml',mail);
  assert.match(result,/星灯/); assert.match(result,/你好/); assert.doesNotMatch(result,/boundary|=E4/);
});
test('VTT header is omitted while readable formats retain all text',async()=>{
  assert.equal(await parse('fixture.vtt','WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\n星灯'),'星灯');
  for (const ext of ['txt','md','markdown','text','xml','yaml','yml','ini','conf','log']) assert.equal(await parse('fixture.'+ext,'星灯你好'),'星灯你好');
  assert.equal(await parse('fixture.html','<html><script>private()</script><p>星灯</p></html>'),'星灯');
});

test('real PDF and DOCX documents, malformed PDF diagnostics',async()=>{
  const fs = require('node:fs'); const path = require('node:path'); const JSZip = require('jszip');
  const pdf = await extractText('sample.pdf',fs.readFileSync(path.join(__dirname,'fixtures/sample.pdf')));
  assert.equal(pdf.format,'pdf'); assert.ok(pdf.text.length > 0);
  await assert.rejects(extractText('broken.pdf',Buffer.from('%PDF-incomplete')),{code:'import_pdf_invalid'});
  const zip = new JSZip();
  zip.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>星灯你好</w:t></w:r></w:p></w:body></w:document>');
  const docx = await extractText('fixture.docx', await zip.generateAsync({type:'nodebuffer'}));
  assert.equal(docx.format,'docx'); assert.match(docx.text,/星灯你好/);
});
