/**
 * createVariableCollection
 *
 * Creates a new Figma variable collection with the specified name and modes.
 * If `modeNames` has more than one entry, the first mode is renamed from
 * Figma's default "Mode 1" to the first name, and additional modes are added.
 *
 * @param {string} name - The display name of the collection (e.g. "Color", "Spacing").
 * @param {string[]} modeNames - Ordered list of mode names (e.g. ["Light", "Dark"] or ["Value"]).
 * @returns {Promise<{
 *   collection: VariableCollection,
 *   modeIds: Record<string, string>
 * }>}
 *   `modeIds` maps each mode name to its modeId string.
 */
async function createVariableCollection(name, modeNames) {
  if (!modeNames || modeNames.length === 0) {
    throw new Error('createVariableCollection: modeNames must have at least one entry.')
  }

  // Create the collection — Figma always creates it with one mode named "Mode 1".
  const collection = figma.variables.createVariableCollection(name)

  // modeIds accumulator
  const modeIds = {}

  // Rename the default first mode
  const defaultMode = collection.modes[0]
  collection.renameMode(defaultMode.modeId, modeNames[0])
  modeIds[modeNames[0]] = defaultMode.modeId

  // Add additional modes
  for (let i = 1; i < modeNames.length; i++) {
    const newModeId = collection.addMode(modeNames[i])
    modeIds[modeNames[i]] = newModeId
  }

  return { collection, modeIds }
}
/**
 * createSemanticTokens
 *
 * Creates a batch of Figma variables in the given collection, one per entry in
 * `tokenMap`. Supports raw values, variable alias references, code syntax, and
 * scopes. Returns a map of token name → Variable for use in subsequent steps.
 *
 * @param {VariableCollection} collection - The target variable collection.
 * @param {Record<string, string>} modeIds - Map of {modeName: modeId} from createVariableCollection.
 * @param {Array<{
 *   name: string,
 *   type: 'COLOR' | 'FLOAT' | 'STRING' | 'BOOLEAN' | 'TIMING' | 'EASING',
 *   values: Record<string, string | number | boolean | MotionEasing | {type: 'VARIABLE_ALIAS', id: string}>,
 *   scopes?: VariableScope[],
 *   codeSyntax?: {WEB?: string, ANDROID?: string, iOS?: string}
 * }>} tokenMap - Ordered list of token definitions.
 *   - `name`: Variable name using slash hierarchy (e.g. "color/bg/primary").
 *   - `type`: Figma variable type.
 *   - `values`: Map of {modeName: value}. Values can be raw (hex string for COLOR,
 *     number for FLOAT) or alias objects {type: 'VARIABLE_ALIAS', id: variableId}.
 *     For COLOR, raw values are accepted as hex strings ("#rrggbb" or "#rrggbbaa")
 *     and converted to {r, g, b, a} automatically.
 *   - `scopes`: Array of VariableScope strings. Omit to use [] (hidden/primitive).
 *   - `codeSyntax`: Platform code syntax strings. Omit to skip.
 * @returns {Promise<{variables: Record<string, Variable>}>}
 *   `variables` maps each token name to its created Variable object.
 */
async function createSemanticTokens(collection, modeIds, tokenMap) {
  const variables = {}

  for (const token of tokenMap) {
    // Create the variable
    const variable = figma.variables.createVariable(token.name, collection, token.type)

    // Set values for each mode
    for (const [modeName, rawValue] of Object.entries(token.values)) {
      const modeId = modeIds[modeName]
      if (!modeId) {
        throw new Error(
          `createSemanticTokens: mode "${modeName}" not found in modeIds for token "${token.name}". ` +
            `Available modes: ${Object.keys(modeIds).join(', ')}`,
        )
      }

      let value = rawValue

      // Convert hex strings to Figma RGBA for COLOR type
      if (token.type === 'COLOR' && typeof rawValue === 'string' && rawValue.startsWith('#')) {
        value = hexToFigmaColor(rawValue)
      }

      variable.setValueForMode(modeId, value)
    }

    // Set scopes (default: empty array = hidden from property pickers / primitives)
    variable.scopes = token.scopes || []

    // Set code syntax per platform
    if (token.codeSyntax) {
      if (token.codeSyntax.WEB) {
        variable.setVariableCodeSyntax('WEB', token.codeSyntax.WEB)
      }
      if (token.codeSyntax.ANDROID) {
        variable.setVariableCodeSyntax('ANDROID', token.codeSyntax.ANDROID)
      }
      if (token.codeSyntax.iOS) {
        variable.setVariableCodeSyntax('iOS', token.codeSyntax.iOS)
      }
    }

    variables[token.name] = variable
  }

  return { variables }
}

/**
 * Converts a hex color string to a Figma RGBA object.
 * Supports "#rgb", "#rrggbb", and "#rrggbbaa".
 *
 * @param {string} hex
 * @returns {{ r: number, g: number, b: number, a: number }}
 */
function hexToFigmaColor(hex) {
  let h = hex.replace('#', '')

  // Expand shorthand #rgb → #rrggbb
  if (h.length === 3) {
    h = h
      .split('')
      .map((c) => c + c)
      .join('')
  }

  const r = parseInt(h.substring(0, 2), 16) / 255
  const g = parseInt(h.substring(2, 4), 16) / 255
  const b = parseInt(h.substring(4, 6), 16) / 255
  const a = h.length === 8 ? parseInt(h.substring(6, 8), 16) / 255 : 1

  return { r, g, b, a }
}

const p=figma.currentPage; p.name="听见 / 中文工作台";
await Promise.all([{family:"Noto Sans SC",style:"Regular"},{family:"Noto Sans SC",style:"Medium"},{family:"Noto Sans SC",style:"Bold"},{family:"Noto Serif SC",style:"Medium"},{family:"Geist Mono",style:"Regular"}].map(f=>figma.loadFontAsync(f)));
const created=[], changed=[p.id]; const remember=n=>(created.push(n.id),n);
const {collection:primitive,modeIds:pm}=await createVariableCollection("听见 / 基础",["值"]);
const palette={bg:"#111615",sidebar:"#151C18",panel:"#1B231E",panelAlt:"#232D26",field:"#141B17",line:"#354239",ink:"#F1F5EF",muted:"#A8B6AC",subtle:"#829488",accent:"#C6F27D",accentLow:"#2A3B26",onAccent:"#172412",amber:"#F2C77D",red:"#F2A096",redLow:"#3A2624",cyan:"#A9D1CF"};
const prim=await createSemanticTokens(primitive,pm,Object.entries(palette).map(([n,v])=>({name:"palette/"+n,type:"COLOR",values:{"值":v},scopes:[],codeSyntax:{WEB:"var(--palette-"+n+")"}})));
const {collection:semantic,modeIds:sm}=await createVariableCollection("听见 / 界面",["深色"]);
const tokenMap=Object.keys(palette).map(n=>({name:"color/"+n,type:"COLOR",values:{"深色":{type:"VARIABLE_ALIAS",id:prim.variables["palette/"+n].id}},scopes:["FRAME_FILL","SHAPE_FILL","TEXT_FILL","STROKE_COLOR"],codeSyntax:{WEB:"var(--color-"+n+")"}}));
for(const n of [4,8,12,16,24,32,40])tokenMap.push({name:"space/"+n,type:"FLOAT",values:{"深色":n},scopes:["GAP"],codeSyntax:{WEB:"var(--space-"+n+")"}});
for(const n of [6,10,12,16,24,999])tokenMap.push({name:"radius/"+n,type:"FLOAT",values:{"深色":n},scopes:["CORNER_RADIUS"],codeSyntax:{WEB:"var(--radius-"+n+")"}});
const sem=await createSemanticTokens(semantic,sm,tokenMap);
const tokens=sem.variables;
const rgb=h=>({r:parseInt(h.slice(1,3),16)/255,g:parseInt(h.slice(3,5),16)/255,b:parseInt(h.slice(5,7),16)/255});
const paint=n=>figma.variables.setBoundVariableForPaint({type:"SOLID",color:rgb(palette[n])},"color",tokens["color/"+n]);
function fill(n,c){n.fills=c?[paint(c)]:[];}
function rad(n,r){n.setBoundVariable("cornerRadius",tokens["radius/"+r]);}
function gap(n,g){n.setBoundVariable("itemSpacing",tokens["space/"+g]);}
function pad(n,x,y=x){for(const k of ["paddingLeft","paddingRight"])n.setBoundVariable(k,tokens["space/"+x]);for(const k of ["paddingTop","paddingBottom"])n.setBoundVariable(k,tokens["space/"+y]);}
const styles={};
for(const [name,size,weight,line] of [["标题",32,"Bold",44],["区块",20,"Medium",30],["小标题",16,"Medium",26],["正文",14,"Regular",24],["标签",14,"Medium",22],["辅助",12,"Regular",20]]){
 const s=figma.createTextStyle();s.name="听见/"+name;s.fontName={family:"Noto Sans SC",style:weight};s.fontSize=size;s.lineHeight={unit:"PIXELS",value:line};styles[name]=s.id;
}
function text(parent,label,style="正文",color="ink"){const t=remember(figma.createText());t.name=label.slice(0,28);t.fontName={family:"Noto Sans SC",style:style==="标题"?"Bold":["区块","小标题","标签"].includes(style)?"Medium":"Regular"};t.textStyleId=styles[style];t.characters=label;t.fills=[paint(color)];parent.appendChild(t);return t;}
function al(parent,name,dir,w,h,color){const f=remember(figma.createAutoLayout(dir));f.name=name;fill(f,color);if(w&&h)f.resize(w,h);f.primaryAxisSizingMode="FIXED";f.counterAxisSizingMode="FIXED";parent.appendChild(f);return f;}
const screens={};const names=[["overview","00 · 功能与使用流程",0,0],["create","01 · 开始创作",1,0],["progress","02 · 正在生成",2,0],["library","03 · 我的作品",0,1],["detail","04 · 作品详情",1,1],["project","05 · 项目与候选版本",2,1],["queue","06 · 任务队列",0,2],["settings","07 · 设置与扩展能力",1,2],["states","08 · 关键状态",2,2]];
for(const [key,name,col,row] of names){const f=al(p,name,"VERTICAL",1440,1024,"bg");f.x=200+col*1600;f.y=200+row*1200;f.clipsContent=true;screens[key]=f.id;}
const board=al(p,"09 · 组件与设计规范","VERTICAL",1440,1024,"bg");board.x=5000;board.y=200;pad(board,32);gap(board,24);text(board,"组件与设计规范","标题");text(board,"中文优先 · 原生可编辑组件 · 共享颜色与间距","正文","muted");
const masters=al(p,"本地组件 / 主组件","VERTICAL",900,1500,"sidebar");masters.x=6600;masters.y=200;pad(masters,24);gap(masters,24);
const components={};const props={};
function component(name,w,h,bg){const c=remember(figma.createComponent());c.name=name;c.resize(w,h);c.layoutMode="HORIZONTAL";c.primaryAxisSizingMode="FIXED";c.counterAxisSizingMode="FIXED";c.primaryAxisAlignItems="CENTER";c.counterAxisAlignItems="CENTER";fill(c,bg);rad(c,10);masters.appendChild(c);return c;}
const buttonVariants=[];
for(const kind of ["主要","次要","文字","危险","禁用","生成中"]){
 const c=component("样式="+kind,148,44,kind==="主要"?"accent":kind==="危险"?"redLow":kind==="文字"?null:"panelAlt");
 if(kind==="次要"){c.strokes=[paint("line")];c.strokeWeight=1;}
 const t=text(c,kind==="生成中"?"生成中…":"按钮","标签",kind==="主要"?"onAccent":kind==="危险"?"red":kind==="禁用"?"subtle":"ink");
 c.description="中文操作按钮。主要操作每个区域只保留一个；生成中不支持暂停。";
 buttonVariants.push(c);
}
const btnSet=remember(figma.combineAsVariants(buttonVariants,masters));btnSet.name="听见 / 按钮";btnSet.description="操作按钮：主要、次要、文字、危险、禁用、生成中。";
const btnLabel=btnSet.addComponentProperty("文字","TEXT","按钮");buttonVariants.forEach((c,i)=>{c.x=(i%3)*172;c.y=Math.floor(i/3)*68;c.children[0].componentPropertyReferences={characters:btnLabel};});btnSet.resize(516,136);components.button=Object.fromEntries(buttonVariants.map(c=>[c.name.split("=")[1],c.id]));props.button=btnLabel;
const badgeVariants=[];for(const kind of ["中性","完成","处理中","未启用","错误"]){const c=component("状态="+kind,96,28,kind==="完成"?"accentLow":kind==="错误"?"redLow":"panelAlt");rad(c,999);c.primaryAxisSizingMode="AUTO";pad(c,12,4);text(c,kind,"辅助",kind==="完成"?"accent":kind==="处理中"?"amber":kind==="错误"?"red":"muted");badgeVariants.push(c);}
const bset=remember(figma.combineAsVariants(badgeVariants,masters));bset.name="听见 / 状态标签";const bprop=bset.addComponentProperty("文字","TEXT","状态");badgeVariants.forEach((c,i)=>{c.x=i*120;c.y=0;c.children[0].componentPropertyReferences={characters:bprop};});bset.resize(620,48);components.badge=Object.fromEntries(badgeVariants.map(c=>[c.name.split("=")[1],c.id]));props.badge=bprop;
const icons={};
const paths={
music:'<path d="M9 18V5l12-2v13M9 8l12-2"/><ellipse cx="6" cy="18" rx="3" ry="3"/><ellipse cx="18" cy="16" rx="3" ry="3"/>',
library:'<path d="M4 4h16v16H4zM8 4v16M12 8h4M12 12h4"/>',
folder:'<path d="M3 6h6l2 2h10v12H3z"/>',
queue:'<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
settings:'<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/>',
play:'<path d="M8 5l11 7-11 7z"/>',arrow:'<path d="M4 12h15M14 6l6 6-6 6"/>',check:'<path d="M5 12l4 4L19 6"/>',
download:'<path d="M12 3v12M7 10l5 5 5-5M4 17v4h16v-4"/>',
plus:'<path d="M12 4v16M4 12h16"/>',search:'<circle cx="10" cy="10" r="6"/><path d="M15 15l6 6"/>',
volume:'<path d="M4 9h4l5-4v14l-5-4H4zM17 8c3 3 3 5 0 8"/>',
chevron:'<path d="M6 9l6 6 6-6"/>',spark:'<path d="M12 3l3 6 6 3-6 3-3 6-3-6-6-3 6-3z"/>',
lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 018 0v4"/>',
previous:'<path d="M6 5v14M19 5l-10 7 10 7z"/>',next:'<path d="M18 5v14M5 5l10 7-10 7z"/>'
};
const iconTray=al(masters,"图标组件","HORIZONTAL",840,80,null);gap(iconTray,8);
for(const [key,path] of Object.entries(paths)){const c=remember(figma.createComponent());c.name="图标/"+key;c.resize(24,24);fill(c,null);const v=remember(figma.createNodeFromSvg('<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#A8B6AC" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">'+path+'</svg>'));v.name="矢量";c.appendChild(v);iconTray.appendChild(c);icons[key]=c.id;}
components.icons=icons;
const navVariants=[];for(const state of ["默认","选中"]){const c=component("状态="+state,168,46,state==="选中"?"accentLow":null);c.primaryAxisAlignItems="MIN";pad(c,12,8);gap(c,12);const icon=(await figma.getNodeByIdAsync(icons.music)).createInstance();remember(icon);c.appendChild(icon);text(c,"开始创作","标签",state==="选中"?"accent":"muted");navVariants.push(c);}
const nset=remember(figma.combineAsVariants(navVariants,masters));nset.name="听见 / 导航项";const np=nset.addComponentProperty("文字","TEXT","开始创作");const ni=nset.addComponentProperty("图标","INSTANCE_SWAP",icons.music);navVariants.forEach((c,i)=>{c.x=i*192;c.y=0;c.children[0].componentPropertyReferences={mainComponent:ni};c.children[1].componentPropertyReferences={characters:np};});nset.resize(384,70);components.nav=Object.fromEntries(navVariants.map(c=>[c.name.split("=")[1],c.id]));props.nav=np;props.navIcon=ni;
const input=component("听见 / 输入框",640,44,"field");input.primaryAxisAlignItems="MIN";pad(input,16,8);input.strokes=[paint("line")];input.strokeWeight=1;
const it=text(input,"请输入内容","正文","ink");it.textAutoResize="HEIGHT";it.resize(608,24);it.layoutSizingHorizontal="FILL";const ip=input.addComponentProperty("内容","TEXT","请输入内容");it.componentPropertyReferences={characters:ip};components.input=input.id;props.input=ip;
const artist=component("听见 / 唱片封面",240,240,"accentLow");artist.layoutMode="NONE";artist.clipsContent=true;rad(artist,16);
for(let i=0;i<7;i++){const e=remember(figma.createEllipse());e.name="声纹圆环 "+i;e.resize(280-i*30,280-i*30);e.x=-10+i*15;e.y=54+i*15;fill(e,null);e.strokes=[paint(i%2?"line":"accent")];e.strokeWeight=1;artist.appendChild(e);}
const sun=remember(figma.createEllipse());sun.name="晨光";sun.resize(66,66);sun.x=124;sun.y=36;sun.fills=[paint("accent")];artist.appendChild(sun);components.art=artist.id;
return {createdNodeIds:created,mutatedNodeIds:changed,screens,componentBoard:board.id,masters:masters.id,components,props,styles,collections:[primitive.id,semantic.id],variables:Object.fromEntries(Object.entries(tokens).map(([n,v])=>[n,v.id])),palette,page:p.id,fonts:["Noto Sans SC","Noto Serif SC","Geist Mono"],discovery:{codeConnect:"none",existingScreens:"empty",libraries:"community SDS inspected; local components required for Chinese typography and custom dark theme",style:"custom Chinese desktop interface"},counts:{screens:Object.keys(screens).length,variables:Object.keys(tokens).length,components:6+5+17+2+2}};
