
const L={"createdNodeIds":["2:55","2:56","2:57","2:58","2:59","2:60","2:61","2:62","2:63","2:64","2:65","2:66","2:67","2:68","2:69","2:70","2:71","2:72","2:73","2:74","2:75","2:76","2:77","2:78","2:79","2:80","2:81","2:82","2:83","2:84","2:85","2:86","2:87","2:88","2:89","2:90","2:91","2:92","2:93","2:94","2:98","2:99","2:101","2:102","2:104","2:105","2:107","2:108","2:111","2:112","2:114","2:115","2:117","2:118","2:120","2:121","2:123","2:124","2:126","2:127","2:130","2:131","2:133","2:134","2:136","2:137","2:139","2:140","2:143","2:144","2:146","2:147","2:149","2:150","2:155","2:156","2:157","2:162","2:163","2:164","2:165","2:166","2:167","2:168","2:169","2:170","2:171","2:172","2:173","2:174"],"mutatedNodeIds":["0:1"],"screens":{"overview":"2:55","create":"2:56","progress":"2:57","library":"2:58","detail":"2:59","project":"2:60","queue":"2:61","settings":"2:62","states":"2:63"},"componentBoard":"2:64","masters":"2:67","components":{"button":{"主要":"2:68","次要":"2:70","文字":"2:72","危险":"2:74","禁用":"2:76","生成中":"2:78"},"badge":{"中性":"2:81","完成":"2:83","处理中":"2:85","未启用":"2:87","错误":"2:89"},"icons":{"music":"2:93","library":"2:98","folder":"2:101","queue":"2:104","settings":"2:107","play":"2:111","arrow":"2:114","check":"2:117","download":"2:120","plus":"2:123","search":"2:126","volume":"2:130","chevron":"2:133","spark":"2:136","lock":"2:139","previous":"2:143","next":"2:146"},"nav":{"默认":"2:149","选中":"2:156"},"input":"2:164","art":"2:166"},"props":{"button":"文字#2:0","badge":"文字#2:7","nav":"文字#2:13","navIcon":"图标#2:16","input":"内容#2:19"},"styles":{"标题":"S:b44a7fa43790d021d56dd71b647ba00f51f0efe3,","区块":"S:0936cec38dc48efa59c0186f1da7820b5d034eef,","小标题":"S:46c432308b81fb735180c1fdd3a855970b7e9008,","正文":"S:ee9e2bfa2cd14f084948f5f0f479e00dfce3746d,","标签":"S:159a8d78afba35d16cd74fd1c6f00db14779c074,","辅助":"S:a5121663779b36f35296c83e645945b1fd364da6,"},"collections":["VariableCollectionId:2:2","VariableCollectionId:2:19"],"variables":{"color/bg":"VariableID:2:20","color/sidebar":"VariableID:2:21","color/panel":"VariableID:2:22","color/panelAlt":"VariableID:2:23","color/field":"VariableID:2:24","color/line":"VariableID:2:25","color/ink":"VariableID:2:26","color/muted":"VariableID:2:27","color/subtle":"VariableID:2:28","color/accent":"VariableID:2:29","color/accentLow":"VariableID:2:30","color/onAccent":"VariableID:2:31","color/amber":"VariableID:2:32","color/red":"VariableID:2:33","color/redLow":"VariableID:2:34","color/cyan":"VariableID:2:35","space/4":"VariableID:2:36","space/8":"VariableID:2:37","space/12":"VariableID:2:38","space/16":"VariableID:2:39","space/24":"VariableID:2:40","space/32":"VariableID:2:41","space/40":"VariableID:2:42","radius/6":"VariableID:2:43","radius/10":"VariableID:2:44","radius/12":"VariableID:2:45","radius/16":"VariableID:2:46","radius/24":"VariableID:2:47","radius/999":"VariableID:2:48"},"palette":{"bg":"#111615","sidebar":"#151C18","panel":"#1B231E","panelAlt":"#232D26","field":"#141B17","line":"#354239","ink":"#F1F5EF","muted":"#A8B6AC","subtle":"#829488","accent":"#C6F27D","accentLow":"#2A3B26","onAccent":"#172412","amber":"#F2C77D","red":"#F2A096","redLow":"#3A2624","cyan":"#A9D1CF"},"page":"0:1","fonts":["Noto Sans SC","Noto Serif SC","Geist Mono"],"discovery":{"codeConnect":"none","existingScreens":"empty","libraries":"community SDS inspected; local components required for Chinese typography and custom dark theme","style":"custom Chinese desktop interface"},"counts":{"screens":9,"variables":29,"components":32}};
const page=await figma.getNodeByIdAsync(L.page); await figma.setCurrentPageAsync(page);
await Promise.all([{family:"Noto Sans SC",style:"Regular"},{family:"Noto Sans SC",style:"Medium"},{family:"Noto Sans SC",style:"Bold"},{family:"Noto Serif SC",style:"Medium"},{family:"Geist Mono",style:"Regular"}].map(f=>figma.loadFontAsync(f)));
const created=[], mutated=[], links=[];
const V=Object.fromEntries(await Promise.all(Object.entries(L.variables).map(async([k,id])=>[k,await figma.variables.getVariableByIdAsync(id)])));
const compIDs=[...Object.values(L.components.button),...Object.values(L.components.badge),...Object.values(L.components.icons),...Object.values(L.components.nav),L.components.input,L.components.art];
const C=Object.fromEntries(await Promise.all(compIDs.map(async id=>[id,await figma.getNodeByIdAsync(id)])));
const remember=n=>(created.push(n.id),n);
const rgb=h=>({r:parseInt(h.slice(1,3),16)/255,g:parseInt(h.slice(3,5),16)/255,b:parseInt(h.slice(5,7),16)/255});
const paint=n=>figma.variables.setBoundVariableForPaint({type:"SOLID",color:rgb(L.palette[n])},"color",V["color/"+n]);
function fill(n,c){n.fills=c?[paint(c)]:[];}
function rad(n,r=12){n.setBoundVariable("cornerRadius",V["radius/"+r]);}
function gap(n,g){if(V["space/"+g])n.setBoundVariable("itemSpacing",V["space/"+g]);else n.itemSpacing=g;}
function pad(n,x,y=x){for(const k of ["paddingLeft","paddingRight"]){if(V["space/"+x])n.setBoundVariable(k,V["space/"+x]);else n[k]=x;}for(const k of ["paddingTop","paddingBottom"]){if(V["space/"+y])n.setBoundVariable(k,V["space/"+y]);else n[k]=y;}}
function A(parent,name,dir,w,h=null,bg=null,padding=0,spacing=0){const f=remember(figma.createAutoLayout(dir));f.name=name;fill(f,bg);f.resize(w,h||10);f.primaryAxisSizingMode=dir==="HORIZONTAL"?"FIXED":h?"FIXED":"AUTO";f.counterAxisSizingMode=dir==="HORIZONTAL"&&!h?"AUTO":"FIXED";if(parent)parent.appendChild(f);if(padding)pad(f,padding);gap(f,spacing);f.clipsContent=false;return f;}
function T(parent,label,w,style="正文",color="ink"){w=Number(w);const t=remember(figma.createText());t.name=label.split("\n")[0].slice(0,32);t.fontName={family:"Noto Sans SC",style:style==="标题"?"Bold":["区块","小标题","标签"].includes(style)?"Medium":"Regular"};t.textStyleId=L.styles[style];t.characters=label;t.fills=[paint(color)];t.resize(w,24);t.textAutoResize="HEIGHT";t.characters=label;parent.appendChild(t);return t;}
function customText(parent,label,w,size=40,color="ink",family="Noto Sans SC",weight="Bold"){const t=remember(figma.createText());t.name=label.slice(0,32);t.fontName={family,style:weight};t.fontSize=size;t.lineHeight={unit:"PIXELS",value:Math.ceil(size*1.35)};t.characters=label;t.fills=[paint(color)];t.resize(w,24);t.textAutoResize="HEIGHT";t.characters=label;parent.appendChild(t);return t;}
function line(parent,w){const r=remember(figma.createRectangle());r.name="分隔线";r.resize(w,1);r.fills=[paint("line")];parent.appendChild(r);return r;}
function icon(parent,key,size=20){const i=remember(C[L.components.icons[key]].createInstance());parent.appendChild(i);i.rescale(size/24);return i;}
function button(parent,label,type="次要",width=144,height=44,dest){const i=remember(C[L.components.button[type]].createInstance());parent.appendChild(i);i.setProperties({[L.props.button]:label});i.resize(width,height);i.name="按钮 / "+label;if(dest)links.push({id:i.id,dest});return i;}
function badge(parent,label,state="中性"){const i=remember(C[L.components.badge[state]].createInstance());parent.appendChild(i);i.setProperties({[L.props.badge]:label});i.name="状态 / "+label;return i;}
function input(parent,value,w,h=44){const i=remember(C[L.components.input].createInstance());parent.appendChild(i);i.setProperties({[L.props.input]:value});i.resize(w,h);i.counterAxisAlignItems=h>44?"MIN":"CENTER";i.name="输入 / "+value.slice(0,20);return i;}
function card(parent,name,w,h=null,bg="panel",padding=24,spacing=16){const f=A(parent,name,"VERTICAL",w,h,bg,padding,spacing);rad(f,16);f.strokes=[paint("line")];f.strokeWeight=1;return f;}
function row(parent,name,w,h=null,spacing=12){const f=A(parent,name,"HORIZONTAL",w,h,null,0,spacing);f.counterAxisAlignItems="CENTER";return f;}
function col(parent,name,w,spacing=8){return A(parent,name,"VERTICAL",w,null,null,0,spacing);}
function spacer(parent,w,h=1,grow=false){const f=A(parent,"弹性间距","VERTICAL",w,h);if(grow)f.layoutSizingVertical="FILL";return f;}
function headingRow(parent,title,width,side="",style="小标题"){const f=row(parent,title,width,30);T(f,title,side?width-150:width,style);if(side)T(f,side,138,"辅助","muted");return f;}
function art(parent,size=120){const i=remember(C[L.components.art].createInstance());parent.appendChild(i);i.rescale(size/240);return i;}
function waveform(parent,w=300,h=48,green=true){const f=remember(figma.createNodeFromSvg('<svg width="'+w+'" height="'+h+'" viewBox="0 0 '+w+' '+h+'" xmlns="http://www.w3.org/2000/svg">'+Array.from({length:64},(_,i)=>{const bh=8+Math.abs(Math.sin(i*0.81)*Math.cos(i*0.23))* (h-10);return '<rect x="'+(i*w/64)+'" y="'+((h-bh)/2)+'" width="'+(w/90)+'" height="'+bh+'" rx="1.5" fill="'+(green&&i<31?L.palette.accent:L.palette.line)+'"/>';}).join('')+'</svg>'));f.name="波形 / 试听预览";parent.appendChild(f);return f;}
function nav(parent,label,key,selected=false,dest){const i=remember(C[L.components.nav[selected?"选中":"默认"]].createInstance());parent.appendChild(i);i.setProperties({[L.props.nav]:label,[L.props.navIcon]:L.components.icons[key]});i.resize(176,46);i.name="导航 / "+label;if(dest)links.push({id:i.id,dest});return i;}
function footer(root){const f=A(root,"全局播放器","HORIZONTAL",1440,88,"panel",24,24);f.counterAxisAlignItems="CENTER";f.strokes=[paint("line")];f.strokeTopWeight=1;art(f,48);const info=col(f,"当前播放",212,2);T(info,"晨光",212,"标签");T(info,"华语流行 · 轻快女声",212,"辅助","muted");icon(f,"previous",20);button(f,"播放","主要",64,40,"detail");icon(f,"next",20);T(f,"00:12",44,"辅助","muted");waveform(f,420,34);T(f,"00:28",44,"辅助","muted");icon(f,"volume",20);const vl=row(f,"音量",88,16,0);const bar=remember(figma.createRectangle());bar.resize(88,3);fill(bar,"line");rad(bar,6);vl.appendChild(bar);button(f,"播放队列","文字",100,36,"library");return f;}
function shell(root,title,subtitle,active,crumb){root.itemSpacing=0;const body=A(root,"工作区","HORIZONTAL",1440,936);const side=A(body,"主导航","VERTICAL",224,936,"sidebar",24,24);
 const brand=row(side,"品牌",176,44,10);icon(brand,"music",30);customText(brand,"听见",124,28,"ink","Noto Sans SC","Bold");T(side,"本地音乐工作台",176,"辅助","muted");
 const ns=col(side,"导航",176,8);nav(ns,"开始创作","music",active==="create","create");nav(ns,"我的作品","library",active==="library","library");nav(ns,"我的项目","folder",active==="project","project");nav(ns,"任务队列","queue",active==="queue","queue");
 line(side,176);T(side,"更多创作方式",176,"辅助","subtle");
 const extras=col(side,"待启用功能",176,12);for(const label of ["音频改编","哼唱成歌"]){const r=row(extras,label,176,24,8);icon(r,"lock",16);T(r,label,84,"正文","muted");T(r,"未启用",60,"辅助","subtle");}
 spacer(side,176,1,true);nav(side,"设置","settings",active==="settings","settings");
 const state=card(side,"本机状态",176,92,"panel",12,4);T(state,title.includes("正在")?"●  本机运行 · 生成中":"●  本机运行 · 已就绪",150,"辅助","accent");T(state,"Apple M5 · 16 GB",150,"辅助","muted");T(state,"作品保存在这台电脑",150,"辅助","subtle");
 const main=A(body,"页面内容","VERTICAL",1216,936,null,32,24);
 const top=row(main,"页头",1152,24,12);T(top,crumb||"工作台  /  "+title,850,"辅助","muted");T(top,"YuE2  本地引擎",150,"辅助","muted");badge(top,title.includes("正在")?"生成中":"已就绪",title.includes("正在")?"处理中":"完成");
 const hero=col(main,"标题区",1152,4);customText(hero,title,1152,32);T(hero,subtitle,1152,"正文","muted");
 const content=A(main,"主体内容","VERTICAL",1152,null,null,0,24);footer(root);return {main,content,hero,side};}
function tagRow(parent,tags,w){const r=row(parent,"风格标签",w,28,8);for(const tag of tags)badge(r,tag);return r;}
function form(parent){const c=card(parent,"创作表单",744,null,"panel",24,12);
 const n=col(c,"作品名称",696,6);const nr=row(n,"名称标签",696,22);T(nr,"作品名称",576,"标签");T(nr,"选填",108,"辅助","muted");input(n,"晨光",696,44);
 const st=col(c,"风格",696,8);headingRow(st,"音乐风格",696,"必填");input(st,"温暖的华语流行，清澈女声，木吉他与钢琴，轻快而治愈。",696,64);tagRow(st,["华语流行","温柔民谣","轻快女声","木吉他"],696);
 const ly=col(c,"歌词编辑器",696,8);headingRow(ly,"歌词",696,"必填 · 支持段落标记");
 const tags=row(ly,"插入段落",696,28,8);for(const t of ["＋ 主歌","＋ 副歌","＋ 间奏","＋ 结尾"])button(tags,t,"次要",88,28);
 input(ly,"[Verse]\n晨光轻轻落在窗前\n微风吹过安静街边\n把小小心愿唱给蓝天\n让新的故事从今天开篇",696,144);
 const advanced=row(c,"高级设置入口",696,36);icon(advanced,"settings",18);T(advanced,"高级设置",128,"标签");T(advanced,"完整编曲 · 随机变化 · 1 个版本",388,"辅助","muted");const ab=button(advanced,"展开","文字",106,32);links.push({id:ab.id,dest:"advanced",overlay:true});
 return c;}
function audit(root){const ns=root.findAll(()=>true);const counts={};for(const n of ns)counts[n.type]=(counts[n.type]||0)+1;const images=ns.filter(n=>"fills"in n&&Array.isArray(n.fills)&&n.fills.some(f=>f.type==="IMAGE")).map(n=>({id:n.id,name:n.name,type:n.type,width:n.width,height:n.height}));return {id:root.id,name:root.name,width:root.width,height:root.height,descendants:ns.length,counts,images,textFonts:[...new Set(ns.filter(n=>n.type==="TEXT").flatMap(n=>n.getStyledTextSegments(["fontName"]).map(s=>s.fontName.family)))]};}

const X={"assistant":"15:562","cover":"15:831"},roots=[];
function screen(key,name,x,y,w=1440,h=1024){const f=A(page,name,"VERTICAL",w,h,"bg");f.x=x;f.y=y;f.clipsContent=true;X[key]=f.id;roots.push(f);return f;}
function overlay(key,name,x,y,w,h){const f=screen(key,name,x,y,w,h);fill(f,"panel");pad(f,24);gap(f,16);rad(f,16);return f;}
function titlebar(parent,title,w){const r=row(parent,title,w,36,12);T(r,title,w-80,"区块");const b=button(r,"关闭","文字",68,32);links.push({id:b.id,close:true});}
const connect=screen("connect","14 · Hermes 连接与能力",3400,3800);
const s=shell(connect,"连接你的 Hermes","沿用本机的 AI 配置，让对话、歌词和封面在同一个地方完成。","settings","设置  /  AI 助手");
const ns=connect.findOne(n=>n.type==="FRAME"&&n.name==="导航");nav(ns,"AI 助手","spark",false,"assistant");
const content=row(s.content,"连接与能力",1152,700,24);content.counterAxisAlignItems="MIN";
const left=col(content,"连接配置",728,16);
const local=card(left,"本机检测结果",728,null,"accentLow",24,10);const lr=row(local,"检测标题",680,28);T(lr,"已找到本机 Hermes",482,"小标题");badge(lr,"待连接","未启用");T(local,"Hermes 已安装；供工作台连接的接口尚未启动。",680,"正文");T(local,"当前状态来自本机只读检查。完成接入后，再分别检测对话与图片能力。",680,"辅助","muted");
const config=card(left,"连接信息",728,null,"panel",24,16);
T(config,"连接信息",680,"小标题");T(config,"服务地址",680,"标签");input(config,"http://127.0.0.1:8642",680,44);
T(config,"访问凭证",680,"标签");input(config,"尚未设置 · 接入时从本机安全配置读取",680,44);
T(config,"访问凭证由本机服务保管，不写入对话和作品文件。",680,"辅助","muted");
const buttons=row(config,"连接操作",680,44,12);button(buttons,"测试连接","主要",200,44,"aiStates");button(buttons,"查看连接指引","次要",200,44,"connectGuide");T(buttons,"尚未连接",256,"辅助","subtle");
const boundary=card(left,"会话范围",728,null,"field",20,8);T(boundary,"围绕当前作品的独立对话",688,"标签");T(boundary,"每次发送前显示关联作品；可移除歌词和曲风上下文。\n工作台会话独立保存，不导入你已有的其他 Hermes 对话。",688,"正文","muted");
const right=card(content,"能力检测",400,700,"panel",24,16);
T(right,"分别检查两种能力",352,"区块");
const chat=card(right,"对话能力",352,null,"field",16,10);const hr=row(chat,"对话状态",320,28);T(hr,"对话与创作建议",208,"标签");badge(hr,"待检测");T(chat,"聊天、歌词润色、曲风建议。\n使用 Hermes 当前配置的对话模型。",320,"正文","muted");
const pic=card(right,"图片能力",352,null,"field",16,10);const ir=row(pic,"图片状态",320,28);T(ir,"封面生成",208,"标签");badge(ir,"待配置","未启用");T(pic,"检测到图片工具代码，但尚未选择并验证图片服务。",320,"正文","muted");button(pic,"跟随 Hermes 图片配置 ▾","次要",320,40);T(pic,"配置服务后，单独测试图片能力。",320,"辅助","subtle");
line(right,352);T(right,"关于本地与联网",352,"标签");T(right,"Hermes 在这台电脑上运行。\n对话和图片是否联网，取决于你选择的模型服务。",352,"正文","muted");
spacer(right,352,1,true);button(right,"保存连接配置","禁用",352,44);T(right,"连接检测通过后可保存。",352,"辅助","subtle");

const states=screen("aiStates","15 · AI 助手 / 关键状态与边界",5000,3800);pad(states,40);gap(states,20);
const sth=row(states,"状态标题",1360,32);T(sth,"AI 助手  /  交互状态",1100,"标签","accent");badge(sth,"新增能力 · 待开发");
customText(states,"每一步，都知道发生了什么。",1360,36);T(states,"连接、生成、应用分开反馈；保留输入与旧版本，方便继续。",1360,"正文","muted");
const data=[
["01  正在回复","Hermes 正在整理歌词…","已输出的内容保留在对话里。停止后可以补充要求或重新发送。","停止回复","assistant","处理中"],
["02  Hermes 无法连接","暂时连不上本机助手","检查本机 Hermes 接口是否已启动。输入内容保留，音乐创作仍可使用。","检查连接","connect","错误"],
["03  聊天可用，图片待配置","可以继续聊，封面先写描述","对话和图片分别检测；图片工具配置完成后再生成。不会把连接成功当作出图成功。","配置图片能力","connect","未启用"],
["04  图片生成中 / 失败","正在生成新的封面候选","生成时可离开页面。失败后保留描述与当前封面，可只重试这一步。","返回封面","cover","处理中"],
["05  歌曲上下文变化","当前对话关联《晨光》","打开另一首作品时，选择继续当前会话，或为新作品开始对话。","保留当前会话","assistant","中性"],
["06  填入前发现内容有变化","先比较，再填入","助手回复期间你修改过歌词。显示替换范围，保留原稿；填入不会自动开始生成。","查看替换预览","applyDraft","未启用"]
];
for(let r=0;r<2;r++){const rr=row(states,"状态组 "+r,1360,296,20);rr.counterAxisAlignItems="MIN";for(const d of data.slice(r*3,r*3+3)){const c=card(rr,d[0],440,296,"panel",24,12);T(c,d[0],392,"标签","accent");badge(c,d[1],d[5]);T(c,d[2],392,"正文","muted");spacer(c,392,1,true);button(c,d[3],"次要",392,40,d[4]);}}
T(states,"本页为状态说明。接入、图片服务调用与封面管理均为新增设计，尚未开发验证。",1360,"辅助","subtle");

const draft=overlay("applyDraft","16 · 填入创作 / 替换预览",200,5000,720,542);titlebar(draft,"把这段歌词填入创作",672);
T(draft,"仅更新《晨光》的副歌。标题和曲风保持不变。",672,"正文","muted");
const diff=row(draft,"歌词比较",672,238,16);diff.counterAxisAlignItems="MIN";
const before=card(diff,"原内容",328,238,"field",16,12);T(before,"当前内容",296,"标签","muted");T(before,"[Chorus]\n让新的故事\n从今天开篇",296,"正文","muted");
const after=card(diff,"新内容",328,238,"accentLow",16,12);T(after,"助手建议",296,"标签","accent");T(after,"[Chorus]\n让第一束光\n照亮心里的远方\n把昨天的风\n唱成今天的晴朗",296,"正文");
T(draft,"填入后可在创作页继续修改；原稿保留，可撤销本次替换。",672,"辅助","muted");
const da=row(draft,"确认操作",672,44);button(da,"确认填入，返回创作","主要",440,44,"create");const cancel=button(da,"暂不替换","次要",220,44);links.push({id:cancel.id,close:true});
T(draft,"填入不会开始生成音乐。",672,"辅助","subtle");

const applied=overlay("coverApplied","17 · 封面已应用",1000,5000,480,318);titlebar(applied,"已设为《晨光》的封面",432);T(applied,"原封面已保留。你可以在作品详情中查看或恢复。",432,"正文","muted");const ar=row(applied,"封面结果",432,92);art(ar,80);T(ar,"晨光\n封面更新成功 · 演示状态",332,"正文");button(applied,"查看作品","主要",432,44,"detail");

const zoom=overlay("coverZoom","18 · 封面大图预览",1600,5000,680,792);titlebar(zoom,"候选 01 · 晨光与回声",632);const zr=row(zoom,"大图",632,560,0);zr.primaryAxisAlignItems="CENTER";art(zr,560);T(zoom,"封面示意，非真实生成结果。应用前可继续调整描述。",632,"辅助","muted");button(zoom,"选择这张封面","主要",632,44,"coverApplied");

const guide=overlay("connectGuide","19 · 本机 Hermes / 连接指引",2400,5000,640,530);titlebar(guide,"连接本机 Hermes",592);
for(const [title,body] of [["1  启用本机接口","使用本机 Hermes 自带的 API 服务，设置访问凭证并仅监听本机地址。"],["2  测试对话能力","回到连接设置，测试服务与对话能力；成功后保存。"],["3  配置图片服务","在 Hermes 中选择可用的图片工具与服务，再单独测试封面生成。"]]){T(guide,title,592,"标签","accent");T(guide,body,592,"正文","muted");}
T(guide,"当前设计阶段不会启动服务、下载模型或发起图片调用。",592,"辅助","subtle");button(guide,"返回连接设置","主要",592,44,"connect");
const coverWork=await figma.getNodeByIdAsync("15:1028");coverWork.resize(1152,704);mutated.push(coverWork.id);
return {createdNodeIds:created,mutatedNodeIds:mutated,screens:X,links,audits:roots.map(audit)};
