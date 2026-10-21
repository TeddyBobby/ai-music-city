import { api } from '../api.js';
import { applyTheme, fill, fmt, h, toast, toastError } from '../ui.js';

export async function settingsView({ el, app }) {
  let s;
  try { s = await api.settings(); app.settings = s; }
  catch (e) { fill(el, h('div', { class: 'errbox' }, '设置读取失败，请刷新重试。')); toastError(e); return {}; }
  let disposed = false;
  const min = s.min_memory_budget_gib ?? 6, max = s.max_memory_budget_gib ?? 12;
  const select = (id, value, opts) => h('select', { id }, opts.map(([v, text]) => h('option', { value: v, selected: v === value }, text)));
  const f = {
    preset: select('st-preset', s.default_preset, [['fast', '快速 · 8bit（推荐）'], ['quality', '高质量 · bf16'], ['custom', '自定义']]),
    low: select('st-lowmem', s.low_memory || 'auto', [['on', '开启（推荐）'], ['auto', '根据电脑内存自动选择'], ['off', '关闭']]),
    mem: h('input', { id: 'st-mem', type: 'range', min, max, step: 1, value: s.memory_budget_gib, 'aria-label': '内存预算' }),
    ac: h('input', { type: 'checkbox', id: 'st-ac', checked: s.require_ac }),
    fast: h('input', { type: 'checkbox', id: 'st-fast', checked: s.fast_numerics !== false }),
    prune: h('input', { id: 'st-prune', type: 'number', min: 1, max: 365, value: s.prune_uploads_days ?? '', placeholder: '留空则保留' }),
    theme: select('st-theme', s.theme || 'system', [['system', '跟随系统'], ['dark', '深色'], ['light', '浅色']]),
  };
  const memValue = h('strong', { class: 'num' }, `${s.memory_budget_gib} GiB`);
  f.mem.addEventListener('input', () => { memValue.textContent = `${f.mem.value} GiB`; });
  const field = (label, input, hint) => h('label', { class: 'field' }, h('span', { class: 'lbl' }, label), input, hint ? h('span', { class: 'hint' }, hint) : null);
  const recommend = h('div', { class: 'panel settings-recommend' });
  const paintRecommend = () => fill(recommend, h('div', { class: 'row between' }, h('h3', {}, '为这台 Mac 推荐'),
    h('span', { class: 'tag ok' }, s.default_preset === 'fast' && s.low_memory === 'on' ? '已采用推荐设置' : '可切换到推荐设置')),
    h('p', {}, `Apple Silicon${s.machine_ram_gib ? ` · ${Math.round(s.machine_ram_gib)} GB 统一内存` : ''}`),
    h('p', { class: 'hint' }, '快速预设 + 低内存模式。首次生成需要加载模型，进度会显示在任务队列中。'));
  paintRecommend();
  const save = h('button', { class: 'primary', type: 'submit' }, '保存设置');
  const form = h('form', { class: 'stack', onsubmit: async (e) => {
    e.preventDefault();
    const prune = f.prune.value.trim() ? Number(f.prune.value) : null;
    if (prune !== null && (!Number.isInteger(prune) || prune < 1 || prune > 365)) return toast('自动清理天数需为 1–365，或留空保留。', 'err');
    save.disabled = true;
    try {
      s = await api.saveSettings({ default_preset: f.preset.value, low_memory: f.low.value, memory_budget_gib: Number(f.mem.value), require_ac: f.ac.checked, fast_numerics: f.fast.checked, prune_uploads_days: prune, theme: f.theme.value });
      app.settings = s; applyTheme(s.theme); paintRecommend(); toast('设置已保存，下次生成时生效。', 'ok');
      await app.refreshStatus?.();
    } catch (err) { toastError(err); } finally { save.disabled = false; }
  } }, h('div', { class: 'panel stack settings-form' },
    h('h3', {}, '生成与外观'),
    field('默认生成方式', f.preset, '这台电脑已验证快速 8bit 模式；其他预设可能需要更多内存。'),
    field('低内存模式', f.low, '依次加载模型，降低生成时的内存占用。'),
    h('label', { class: 'field' }, h('span', { class: 'lbl' }, '内存预算', memValue), f.mem,
      h('span', { class: 'setting-range' }, h('span', {}, `${min} GiB`), h('span', {}, `${max} GiB`)),
      h('span', { class: 'hint' }, '为 macOS 和其他应用预留内存。')), field('界面主题', f.theme),
    h('label', { class: 'check' }, f.ac, '仅在连接电源时开始生成'),
    h('details', { class: 'settings-advanced' }, h('summary', {}, '高级设置'), h('div', { class: 'stack' },
      h('label', { class: 'check' }, f.fast, '使用快速计算'), h('p', { class: 'hint' }, '相同随机种子需使用相同计算模式，才能复现结果。'),
      field('自动清理闲置上传文件（天）', f.prune, '只清理没有任务引用的上传文件，不会清理已生成作品。')))),
    h('div', { class: 'row between' }, h('span', { class: 'hint' }, '保存后对下一次生成生效'), save));
  const engine = h('div', { class: 'panel stack' });
  const capabilities = h('div', { class: 'panel settings-extension' });
  const helper = h('div', { class: 'panel stack' }, h('h3', {}, 'AI 助手'), h('p', { class: 'hint' }, '正在检测本机 Hermes…'));
  const cap = (title, available, detail) => h('div', { class: 'capability' }, h('div', { class: 'row between' }, h('span', {}, title), h('span', { class: `tag ${available ? 'ok' : ''}` }, available ? '可用' : '未配置')), h('p', { class: 'hint' }, detail));
  function paint(st) {
    if (disposed) return;
    if (!st) { fill(engine, h('h3', {}, '音乐模型'), h('p', { class: 'hint' }, '服务暂时未连接')); return; }
    const e = st.engine, detailsOpen = engine.querySelector("details")?.open;
    fill(engine, h('div', { class: 'row between' }, h('h3', {}, '音乐模型'), h('span', { class: `tag ${st.models.present ? 'ok' : 'err'}` }, st.models.present ? '本机已安装' : '缺少模型')),
      h('strong', {}, st.models.name || 'YuE2-3B'), h('p', { class: 'hint' }, `${st.models.runtime || 'MLX / Apple GPU'} · 当前精度 ${e.precision || '尚未加载'}`),
      h('p', { class: 'hint' }, '快速模式使用 AR 8bit 量化；音频合成部分仍使用 bf16。'),
      h('dl', { class: 'kv' }, h('dt', {}, '运行状态'), h('dd', {}, ({ ready: '就绪', busy: '生成中', cold: '等待创作', idle: '待加载', error: '异常', loading: '加载中' })[e.state] || e.state), h('dt', {}, '模型内存'), h('dd', {}, fmt.gib(e.memory_gib)), h('dt', {}, '等待任务'), h('dd', {}, st.queue.queued)),
      h('details', { class: 'settings-advanced' }, h('summary', {}, '模型文件与版本'), h('dl', { class: 'kv' },
        h('dt', {}, '权重目录'), h('dd', { class: 'mono small' }, st.models.converted_dir), h('dt', {}, '音频解码器'), h('dd', { class: 'mono small' }, st.models.vae_dir), h('dt', {}, '应用版本'), h('dd', {}, st.version))));
    if (detailsOpen) engine.querySelector('details').open = true;
    fill(capabilities, h('h3', {}, '扩展功能'), cap('音频改编 / 哼唱', st.cover.available, st.cover.available ? '从参考音频中提取旋律。' : '尚未安装所需附加模型，当前可使用歌词创作。'),
      cap('LoRA 风格适配', st.loras.adapters.some(a => a.valid), `${st.loras.adapters.filter(a => a.valid).length} 个可用适配器`),
      cap('MP3 导出', st.ffmpeg, st.ffmpeg ? '已安装音频转换工具。' : '当前仍可下载原始音频。'));
  }
  paint(app.status); app.listeners.add(paint);
  fill(el, h('div', { class: 'view-head' }, h('h1', {}, '设置'), h('span', { class: 'sub' }, '适合这台 Mac 的生成方式、模型和连接。')),
    h('div', { class: 'cols settings-layout' }, h('div', { class: 'stack' }, recommend, form), h('div', { class: 'stack' }, engine, helper, capabilities)));
  fetch('/api/assistant/status').then(r => { if (!r.ok) throw new Error(); return r.json(); }).then(st => {
    if (disposed) return;
    fill(helper, h('h3', {}, 'AI 助手'), cap('Hermes 对话', st.chat.available, st.chat.model), cap('封面生成', st.image.verified, st.image.model + ' · ' + st.image.message),
      h('p', { class: 'hint' }, '音乐在本机生成；对话和封面使用 Hermes 已连接的在线模型。'), h('a', { class: 'btn', href: '#/assistant?mode=settings' }, '管理助手连接'));
  }).catch(() => { if (!disposed) fill(helper, h('h3', {}, 'AI 助手'), h('p', { class: 'hint' }, '连接状态暂时无法读取'), h('a', { href: '#/assistant?mode=settings' }, '检查助手连接')); });
  return { unmount() { disposed = true; app.listeners.delete(paint); } };
}
