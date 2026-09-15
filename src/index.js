const express=require("express");const session=require("express-session");const cookieParser=require("cookie-parser");const bcrypt=require("bcryptjs");const speakeasy=require("speakeasy");const QRCode=require("qrcode");const {Server}=require("@modelcontextprotocol/sdk/server/index.js");const {StdioServerTransport}=require("@modelcontextprotocol/sdk/shared/stdio.js");const {CallToolRequestSchema,ListToolsRequestSchema}=require("@modelcontextprotocol/sdk/types.js");const fs=require("fs");const path=require("path");
const DATA_DIR=process.env.DATA_FILE?path.dirname(process.env.DATA_FILE):path.join(__dirname,"..","data");
const DATA_FILE=process.env.DATA_FILE||path.join(DATA_DIR,"chat.json");
const AUTH_FILE=path.join(DATA_DIR,"auth.json");
const PORT=process.env.PORT||3000;
const PASSWORD_HASH=process.env.DISMAS_PASSWORD_HASH||"";
const TOTP_SECRET=process.env.DISMAS_TOTP_SECRET||"";
const SESSION_SECRET=process.env.DISMAS_SESSION_SECRET||"dismas-"+Math.random();
if(!fs.existsSync(DATA_DIR))fs.mkdirSync(DATA_DIR,{recursive:true});
function loadChat(){try{return JSON.parse(fs.readFileSync(DATA_FILE,"utf8"));}catch{return{messages:[],lastReadIndex:-1};}}
function saveChat(c){fs.writeFileSync(DATA_FILE,JSON.stringify(c,null,2));}
function addMessage(name,text){const c=loadChat();const ts=new Date().toISOString().replace("T"," ").substring(0,16);const m={timestamp:ts,name,text,index:c.messages.length};c.messages.push(m);saveChat(c);return m;}
function getLastMessage(){const c=loadChat();return c.messages.length===0?null:c.messages[c.messages.length-1];}
function markRead(i){const c=loadChat();c.lastReadIndex=i;saveChat(c);}
function getLastSyncIndex(){try{const a=JSON.parse(fs.readFileSync(AUTH_FILE,"utf8"));return a.lastSyncIndex||-1;}catch{return-1;}}
function setLastSyncIndex(i){let a={};try{a=JSON.parse(fs.readFileSync(AUTH_FILE,"utf8"));}catch{}a.lastSyncIndex=i;fs.writeFileSync(AUTH_FILE,JSON.stringify(a,null,2));}
const app=express();
app.use(express.json());app.use(cookieParser());
app.use(session({secret:SESSION_SECRET,resave:false,saveUninitialized:false,cookie:{maxAge:86400000,httpOnly:true,sameSite:"strict"}}));
function requireAuth(req,res,next){if(req.session&&req.session.authenticated)return next();if(req.path.startsWith("/api/"))return res.status(401).json({error:"Not authenticated"});res.redirect("/login");}
app.get("/login",(req,res)=>res.sendFile(path.join(__dirname,"..","public","login.html")));
app.post("/api/login",async(req,res)=>{const{password,token}=req.body;if(!password)return res.status(400).json({error:"Password required"});if(!bcrypt.compareSync(password,PASSWORD_HASH))return res.status(401).json({error:"The door remains barred."});if(TOTP_SECRET){if(!token)return res.status(401).json({error:"The second key is required.",needsToken:true});const v=speakeasy.totp.verify({secret:TOTP_SECRET,encoding:"base32",token,window:1});if(!v)return res.status(401).json({error:"The second key does not turn."});}req.session.authenticated=true;res.json({success:true,message:"The scriptorium opens."});});
app.post("/api/logout",(req,res)=>{req.session.destroy();res.json({success:true});});
app.get("/api/auth-status",(req,res)=>res.json({authenticated:!!(req.session&&req.session.authenticated)}));
app.get("/api/setup-qr",(req,res)=>{if(!TOTP_SECRET)return res.status(404).json({error:"No TOTP secret"});const u=speakeasy.otpauthUrl({secret:TOTP_SECRET,encoding:"base32",label:"Dismas Scriptorium",issuer:"Cathedral Vault"});QRCode.toDataURL(u,(e,d)=>{if(e)return res.status(500).json({error:"QR failed"});res.json({qr:d,otpauthUrl:u});});});
app.get("/",requireAuth,(req,res)=>res.sendFile(path.join(__dirname,"..","public","index.html")));
app.get("/api/messages",requireAuth,(req,res)=>res.json(loadChat()));
app.post("/api/messages",requireAuth,(req,res)=>{const{text}=req.body;if(!text||!text.trim())return res.status(400).json({error:"Required"});res.json(addMessage("David",text.trim()));});
app.post("/api/dismas",requireAuth,(req,res)=>{const{text}=req.body;if(!text||!text.trim())return res.status(400).json({error:"Required"});res.json(addMessage("Dismas",text.trim()));});
app.get("/api/unsynced",requireAuth,(req,res)=>{const c=loadChat();const ls=getLastSyncIndex();const u=c.messages.filter(m=>m.index>ls);res.json({unsynced:u,count:u.length,lastSyncIndex:ls});});
app.post("/api/mark-synced",requireAuth,(req,res)=>{const{upToIndex}=req.body;setLastSyncIndex(upToIndex);res.json({success:true});});
app.get("/api/health",(req,res)=>res.json({status:"alive",patron:"St. Dismas"}));
app.use(express.static(path.join(__dirname,"..","public")));
app.listen(PORT,()=>console.log(`Dismas Scriptorium on port ${PORT}`));
const mcpServer=new Server({name:"dismas-mcp",version:"2.0.0"},{capabilities:{tools:{}}});
mcpServer.setRequestHandler(ListToolsRequestSchema,async()=>({tools:[
{name:"check_dismas_chat",description:"Check if David sent a new message. Returns last unread or 'No new messages'. Minimal tokens.",inputSchema:{type:"object",properties:{}}},
{name:"respond_as_dismas",description:"Write a response as Dismas. Marks messages read.",inputSchema:{type:"object",properties:{text:{type:"string"}},required:["text"]}},
{name:"get_chat_history",description:"Get chat history. Use sparingly.",inputSchema:{type:"object",properties:{limit:{type:"number"}}}},
{name:"get_unsynced_messages",description:"Get messages not yet synced to Obsidian.",inputSchema:{type:"object",properties:{}}},
{name:"mark_synced",description:"Mark messages as synced up to index.",inputSchema:{type:"object",properties:{upToIndex:{type:"number"}},required:["upToIndex"]}}
]}));
mcpServer.setRequestHandler(CallToolRequestSchema,async(request)=>{const{name}=request.params;switch(name){
case"check_dismas_chat":{const l=getLastMessage();if(!l)return{content:[{type:"text",text:"No new messages. The scriptorium is quiet."}]};if(l.name==="Dismas")return{content:[{type:"text",text:"No new messages. Last response was from Dismas."}]};if(l.name==="David")return{content:[{type:"text",text:`NEW MESSAGE from David [${l.timestamp}]: ${l.text}`}]};return{content:[{type:"text",text:"No new messages."}]};}
case"respond_as_dismas":{const{text}=request.params;const m=addMessage("Dismas",text);const c=loadChat();markRead(c.messages.length-1);return{content:[{type:"text",text:`Response written: [${m.timestamp}] Dismas: ${text}`}]};}
case"get_chat_history":{const limit=request.params.limit||20;const c=loadChat();const r=c.messages.slice(-limit);return{content:[{type:"text",text:r.map(m=>`[${m.timestamp}] ${m.name}: ${m.text}`).join("\n")||"No messages."}]};}
case"get_unsynced_messages":{const c=loadChat();const ls=getLastSyncIndex();const u=c.messages.filter(m=>m.index>ls);if(u.length===0)return{content:[{type:"text",text:"No unsynced messages."}]};return{content:[{type:"text",text:`${u.length} unsynced:\n${u.map(m=>`[${m.timestamp}] ${m.name}: ${m.text}`).join("\n")}`}]};}
case"mark_synced":{const{upToIndex}=request.params;setLastSyncIndex(upToIndex);return{content:[{type:"text",text:`Synced up to ${upToIndex}.`}]};}
default:return{content:[{type:"text",text:`Unknown: ${name}`}]};}});
const transport=new StdioServerTransport();mcpServer.connect(transport).then(()=>console.error("Dismas MCP started")).catch(e=>console.error("MCP error:",e));