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

/**
 * createComponentWithVariants
 *
 * Creates a component set by generating all combinations of `variantAxes`,
 * building one Figma component per combination, then calling
 * `figma.combineAsVariants` to produce the component set. After combining,
 * the variants are repositioned into a grid so they don't all stack at (0, 0).
 *
 * @param {{
 *   name: string,
 *   description?: string,
 *   variantAxes: Record<string, string[]>,
 *   baseProps: {
 *     width: number,
 *     height: number,
 *     fills?: Paint[],
 *     padding?: {top?: number, bottom?: number, left?: number, right?: number},
 *     radius?: number,
 *     layoutMode?: 'HORIZONTAL' | 'VERTICAL' | 'NONE',
 *     itemSpacing?: number
 *   },
 *   page: PageNode
 * }} config
 *   - `name`: Component set name (e.g. "Button").
 *   - `description`: Optional human-readable purpose and usage guidance.
 *   - `variantAxes`: Each key is a variant property name; each value is an array of
 *     allowed values. All combinations are generated (Cartesian product).
 *     Example: { Size: ['Small', 'Medium', 'Large'], Style: ['Primary', 'Ghost'] }
 *     produces 6 variants.
 *   - `baseProps`: Visual properties applied to every variant.
 *   - `page`: The PageNode to create components on (must be set as current page by caller).
 * @returns {Promise<{
 *   componentSet: ComponentSetNode,
 *   variants: ComponentNode[]
 * }>}
 */
async function createComponentWithVariants(config) {
  const { name, variantAxes, baseProps, page } = config

  // Ensure we are on the correct page
  // Page already selected by the caller.

  // Compute Cartesian product of variant axes
  const axisNames = Object.keys(variantAxes)
  const axisValues = axisNames.map((k) => variantAxes[k])
  const combinations = cartesianProduct(axisValues)

  // Build one component per combination
  const components = []
  for (const combo of combinations) {
    const comp = figma.createComponent()

    // Name: "Property=Value, Property=Value, ..."
    comp.name = axisNames.map((ax, i) => `${ax}=${combo[i]}`).join(', ')

    // Base geometry
    comp.resize(baseProps.width, baseProps.height)

    // Fills
    if (baseProps.fills !== undefined) {
      comp.fills = baseProps.fills
    } else {
      comp.fills = [{ type: 'SOLID', color: { r: 0.9, g: 0.9, b: 0.9 } }]
    }

    // Corner radius
    if (baseProps.radius !== undefined) {
      comp.cornerRadius = baseProps.radius
    }

    // Auto-layout
    if (baseProps.layoutMode && baseProps.layoutMode !== 'NONE') {
      comp.layoutMode = baseProps.layoutMode
      comp.primaryAxisAlignItems = 'CENTER'
      comp.counterAxisAlignItems = 'CENTER'
      if (baseProps.itemSpacing !== undefined) {
        comp.itemSpacing = baseProps.itemSpacing
      }
    }

    // Padding
    if (baseProps.padding) {
      comp.paddingTop = baseProps.padding.top ?? 0
      comp.paddingBottom = baseProps.padding.bottom ?? 0
      comp.paddingLeft = baseProps.padding.left ?? 0
      comp.paddingRight = baseProps.padding.right ?? 0
    }

    page.appendChild(comp)
    components.push(comp)
  }

  // Combine into a component set
  const componentSet = figma.combineAsVariants(components, page)
  componentSet.name = name
  if (config.description) {
    componentSet.description = config.description
  }

  // Grid layout — variants stack at (0, 0) after combineAsVariants; reposition them.
  const GRID_GAP = 16
  const cols = Math.max(1, axisValues[axisValues.length - 1]?.length ?? 1)
  const variantWidth = baseProps.width
  const variantHeight = baseProps.height

  componentSet.children.forEach((variant, idx) => {
    const col = idx % cols
    const row = Math.floor(idx / cols)
    variant.x = col * (variantWidth + GRID_GAP)
    variant.y = row * (variantHeight + GRID_GAP)
  })

  // Resize component set to wrap its children with padding
  const totalCols = Math.min(cols, combinations.length)
  const totalRows = Math.ceil(combinations.length / cols)
  const PADDING = 40
  componentSet.resize(
    totalCols * variantWidth + (totalCols - 1) * GRID_GAP + PADDING * 2,
    totalRows * variantHeight + (totalRows - 1) * GRID_GAP + PADDING * 2,
  )

  // Position component set at a safe canvas location
  componentSet.x = 480
  componentSet.y = 80

  return { componentSet, variants: componentSet.children }
}

/**
 * Computes the Cartesian product of multiple arrays.
 * cartesianProduct([[A, B], [1, 2]]) → [[A,1], [A,2], [B,1], [B,2]]
 *
 * @param {Array<string[]>} arrays
 * @returns {string[][]}
 */
function cartesianProduct(arrays) {
  return arrays.reduce(
    (acc, curr) => acc.flatMap((combo) => curr.map((val) => [...combo, val])),
    [[]],
  )
}

const existing=figma.root.children.find(p=>p.name==="02 / 工作室方向");
if(existing)throw Error("Studio page already exists: "+existing.id);
const page=figma.createPage();page.name="02 / 工作室方向";await figma.setCurrentPageAsync(page);
const created=[],mutated=[page.id];
await Promise.all([{family:"Noto Sans SC",style:"Regular"},{family:"Noto Sans SC",style:"Medium"},{family:"Noto Sans SC",style:"Bold"},{family:"Geist Mono",style:"Regular"}].map(f=>figma.loadFontAsync(f)));
const palette={bg:"#202224",bar:"#292B2E",side:"#252729",field:"#1B1D1F",raised:"#333539",line:"#414347",ink:"#E4E5E7",muted:"#A8AAAD",subtle:"#81858A",accent:"#C9956F",accentLow:"#41372F",onAccent:"#1C1D1F",selected:"#383B40",good:"#B7C0AC"};
const prim=await createVariableCollection("Studio / 原始值",["Value"]);
const tokens=Object.entries(palette).map(([k,v])=>({name:k,type:"COLOR",values:{Value:v},scopes:[]}));
const primitives=(await createSemanticTokens(prim.collection,prim.modeIds,tokens)).variables;
const sem=await createVariableCollection("Studio / 语义",["Default"]);
const semantics=Object.entries(primitives).map(([k,v])=>({name:"color/"+k,type:"COLOR",values:{Default:{type:"VARIABLE_ALIAS",id:v.id}},scopes:["FRAME_FILL","SHAPE_FILL","TEXT_FILL","STROKE_COLOR"],codeSyntax:{WEB:"var(--studio-"+k+")"}}));
for(const v of [4,8,12,16,20,24,32])semantics.push({name:"space/"+v,type:"FLOAT",values:{Default:v},scopes:["GAP"],codeSyntax:{WEB:"var(--studio-space-"+v+")"}});
semantics.push({name:"radius/control",type:"FLOAT",values:{Default:4},scopes:["CORNER_RADIUS"],codeSyntax:{WEB:"var(--studio-radius-control)"}});
const vars=(await createSemanticTokens(sem.collection,sem.modeIds,semantics)).variables;
const rgb=h=>({r:parseInt(h.slice(1,3),16)/255,g:parseInt(h.slice(3,5),16)/255,b:parseInt(h.slice(5,7),16)/255});
const paint=k=>figma.variables.setBoundVariableForPaint({type:"SOLID",color:rgb(palette[k])},"color",vars["color/"+k]);
const styles={};
for(const [key,size,weight,line] of [["title",24,"Medium",32],["section",14,"Medium",22],["body",13,"Regular",22],["small",11,"Regular",18],["control",12,"Medium",20],["lyrics",18,"Regular",34],["mono",12,"Regular",20]]){
const st=figma.createTextStyle();st.name="Studio / "+key;st.fontName={family:key==="mono"?"Geist Mono":"Noto Sans SC",style:weight};st.fontSize=size;st.lineHeight={unit:"PIXELS",value:line};styles[key]=st.id;}
const built=await createComponentWithVariants({name:"Studio / 按钮",description:"工作室方向的紧凑操作。主要用于生成与采用；次要和文字用于编辑。",variantAxes:{"样式":["主要","次要","文字","选中"]},baseProps:{width:120,height:32,layoutMode:"HORIZONTAL",radius:4,itemSpacing:8},page});
built.componentSet.x=3400;built.componentSet.y=200;created.push(built.componentSet.id);
const labelProp=built.componentSet.addComponentProperty("文字","TEXT","按钮");
const buttonIds={};
for(const v of built.variants){created.push(v.id);const type=v.name.split("=")[1];buttonIds[type]=v.id;v.fills=type==="文字"?[]:[paint(type==="主要"?"accent":type==="选中"?"selected":"raised")];v.strokes=type==="次要"?[paint("line")]:[];v.strokeWeight=1;v.setBoundVariable("cornerRadius",vars["radius/control"]);v.setBoundVariable("paddingLeft",vars["space/12"]);v.setBoundVariable("paddingRight",vars["space/12"]);v.setBoundVariable("itemSpacing",vars["space/8"]);const t=figma.createText();created.push(t.id);t.fontName={family:"Noto Sans SC",style:"Medium"};t.textStyleId=styles.control;t.characters="按钮";t.fills=[paint(type==="主要"?"onAccent":"ink")];v.appendChild(t);t.componentPropertyReferences={characters:labelProp};}
const specimen=figma.createAutoLayout("VERTICAL");page.appendChild(specimen);specimen.name="Studio / 控件样本";specimen.x=3400;specimen.y=500;specimen.resize(560,92);specimen.fills=[paint("bg")];specimen.paddingTop=24;specimen.paddingBottom=24;specimen.paddingLeft=24;specimen.paddingRight=24;specimen.itemSpacing=12;created.push(specimen.id);
const strip=figma.createAutoLayout("HORIZONTAL");specimen.appendChild(strip);strip.resize(512,32);strip.fills=[];strip.itemSpacing=8;created.push(strip.id);
for(const v of built.variants){const n=v.createInstance();strip.appendChild(n);n.setProperties({[labelProp]:v.name.split("=")[1]});created.push(n.id);}
const allVars={...Object.fromEntries(Object.entries(primitives).map(([k,v])=>["primitive/"+k,v.id])),...Object.fromEntries(Object.entries(vars).map(([k,v])=>[k,v.id]))};
return {createdNodeIds:created,mutatedNodeIds:mutated,page:page.id,variables:allVars,palette,styles,buttons:buttonIds,labelProp,specimen:specimen.id,collections:[prim.collection.id,sem.collection.id],scopes:semantics.map(v=>({name:v.name,scopes:v.scopes})),fonts:["Noto Sans SC","Geist Mono"]};
