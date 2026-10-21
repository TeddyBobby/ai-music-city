
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

const X={};
const roots=[];
function screen(key,name,x,y){const f=A(page,name,"VERTICAL",1440,1024,"bg");f.x=x;f.y=y;f.clipsContent=true;X[key]=f.id;roots.push(f);return f;}
function aiNav(root,selected=false){const ns=root.findOne(n=>n.type==="FRAME"&&n.name==="导航");nav(ns,"AI 助手","spark",selected,"assistant");mutated.push(ns.id);}
function aiShell(root,title,subtitle){const s=shell(root,title,subtitle,"assistant");aiNav(root,true);const en=root.findOne(n=>n.type==="TEXT"&&n.characters==="YuE2  本地引擎");en.characters="Hermes · 设计演示";mutated.push(en.id);const top=s.main.findOne(n=>n.type==="FRAME"&&n.name==="页头");const status=top.findOne(n=>n.type==="INSTANCE"&&n.name==="状态 / 已就绪");status.swapComponent(C[L.components.badge["中性"]]);status.setProperties({[L.props.badge]:"演示"});mutated.push(status.id);return s;}
const assistant=screen("assistant","12 · AI 助手 / 创作对话",200,3800);
const s=aiShell(assistant,"有个想法？和助手聊聊。","写词、聊曲风、构思封面。把想法慢慢打磨成作品。");
const layout=row(s.content,"对话工作区",1152,700,24);layout.counterAxisAlignItems="MIN";
const left=card(layout,"会话与作品上下文",224,700,"sidebar",16,16);
button(left,"＋ 新建对话","次要",192,40,"aiStates");
T(left,"最近对话",192,"辅助","subtle");
const session=card(left,"选中的会话",192,null,"accentLow",12,6);
T(session,"晨光 · 创作灵感",168,"标签","accent");T(session,"今天  ·  已关联作品",168,"辅助","muted");
T(left,"夜航的封面方向",192,"正文","muted");T(left,"新歌的第一句歌词",192,"正文","muted");
line(left,192);
T(left,"本次对话的上下文",192,"标签");
const context=card(left,"已关联作品",192,null,"panel",12,8);const cr=row(context,"作品",168,48,12);art(cr,44);const ci=col(cr,"名称",112,2);T(ci,"晨光",112,"标签");T(ci,"华语流行",112,"辅助","muted");
T(context,"✓ 标题、歌词、曲风\n— 未发送音频文件",168,"辅助","muted");
button(left,"切换关联作品","文字",192,32,"aiStates");
spacer(left,192,1,true);
T(left,"只引用你选中的内容。\n切换作品时会提示确认。",192,"辅助","subtle");
button(left,"Hermes 连接设置","次要",192,36,"connect");
const chat=card(layout,"对话内容",904,700,"panel",24,12);
const ch=row(chat,"对话状态",856,30,12);icon(ch,"spark",20);T(ch,"Hermes",140,"标签");T(ch,"创作伙伴 · 连接后效果示例",494,"辅助","muted");button(ch,"会话选项","文字",166,30,"aiStates");
const user=card(chat,"用户消息",856,null,"panelAlt",12,4);T(user,"你",832,"辅助","subtle");T(user,"把《晨光》的副歌改得更有希望，也帮我想一个封面方向。",832,"正文");
T(chat,"可以。把意象放在“向前走”和“第一束光”上，让歌词与封面呼应。",856,"正文");
const draft=card(chat,"助手歌词草稿",856,null,"field",16,8);const dh=row(draft,"草稿标题",824,28,12);T(dh,"歌词草稿 · 副歌",580,"标签","accent");badge(dh,"尚未填入","中性");
T(draft,"[Chorus]\n让第一束光，照亮心里的远方\n把昨天的风，唱成今天的晴朗",824,"正文");
const dr=row(draft,"草稿操作",824,36,12);button(dr,"预览并填入创作","主要",176,36,"applyDraft");button(dr,"复制歌词","文字",108,36);T(dr,"只更新选中的字段",516,"辅助","muted");
const cover=card(chat,"助手封面建议",856,null,"accentLow",12,6);T(cover,"封面方向：清晨的光，照进安静的城市",832,"标签");const cv=row(cover,"封面操作",832,32,12);T(cv,"暖绿色 · 胶片颗粒 · 无文字 · 正方形",592,"辅助","muted");button(cv,"去生成封面 →","次要",228,32,"cover");
const compose=card(chat,"消息输入框",856,null,"field",12,8);T(compose,"继续聊聊，或者描述你想要的封面…",832,"正文","muted");const cm=row(compose,"发送消息",832,36,12);badge(cm,"关联：晨光");T(cm,"Enter 发送 · Shift + Enter 换行",536,"辅助","subtle");button(cm,"发送 ↑","主要",160,36,"aiStates");

const coverRoot=screen("cover","13 · AI 封面 / 生成与应用",1800,3800);
const c=aiShell(coverRoot,"给这首歌，一个画面。","从歌词和情绪出发，生成候选封面，再挑选最贴合的一张。");
const cl=row(c.content,"封面工作区",1152,700,24);cl.counterAxisAlignItems="MIN";
const controls=card(cl,"封面生成设置",384,700,"panel",24,16);
const work=row(controls,"关联歌曲",336,56,12);art(work,56);const wi=col(work,"歌曲信息",268,2);T(wi,"晨光",268,"小标题");T(wi,"华语流行 · 封面单独保存",268,"辅助","muted");
line(controls,336);
headingRow(controls,"画面描述",336);
input(controls,"清晨第一束光穿过薄雾，安静的城市被温柔唤醒。暖绿色与米白，细腻胶片颗粒，留出呼吸感，不要文字。",336,144);
button(controls,"根据歌词完善描述","次要",336,36,"assistant");
T(controls,"画面偏好",336,"标签");
tagRow(controls,["胶片感","治愈","无文字"],336);
const ratio=row(controls,"比例",336,36);T(ratio,"封面比例",148,"正文","muted");button(ratio,"1 : 1 · 正方形","次要",176,36);
T(controls,"使用 Hermes 配置的图片工具。\n这里展示生成后的候选效果。",336,"辅助","muted");
spacer(controls,336,1,true);
button(controls,"生成封面","主要",336,48,"aiStates");T(controls,"新的候选不会自动替换当前封面。",336,"辅助","subtle");
const results=col(cl,"候选预览",744,16);
const preview=card(results,"选中封面预览",744,516,"field",24,16);
const pr=row(preview,"预览标题",696,28,12);T(pr,"候选封面",440,"小标题");badge(pr,"预览示例");button(pr,"放大查看","文字",144,28,"coverZoom");
const visual=row(preview,"封面画面",696,384,0);visual.primaryAxisAlignItems="CENTER";art(visual,384);
T(preview,"候选 01 · 晨光与回声    /    封面示意，非本次真实生成结果",696,"辅助","muted");
const choices=row(results,"候选选择与版本",744,72,12);
const thumb=card(choices,"已选候选 01",232,72,"accentLow",12,8);thumb.layoutMode="HORIZONTAL";thumb.primaryAxisSizingMode="FIXED";thumb.counterAxisAlignItems="CENTER";art(thumb,48);T(thumb,"✓ 候选 01",148,"标签","accent");
const history=card(choices,"旧封面",232,72,"panel",12,8);history.layoutMode="HORIZONTAL";history.primaryAxisSizingMode="FIXED";history.counterAxisAlignItems="CENTER";art(history,48);T(history,"原封面 · 可恢复",148,"标签");
button(choices,"再试一个方向","次要",256,44,"assistant");
const apply=row(results,"封面应用操作",744,48,12);T(apply,"应用到《晨光》，原封面保留。",424,"辅助","muted");button(apply,"应用为作品封面","主要",308,48,"coverApplied");
T(results,"图片生成未启用时，可以先写好描述，再前往连接设置。",744,"辅助","subtle");
return {createdNodeIds:created,mutatedNodeIds:mutated,screens:X,links,audits:roots.map(audit)};
