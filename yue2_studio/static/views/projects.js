import { api } from "../api.js";
import { confirmDialog, fill, fmt, h, toast, toastError } from "../ui.js";

/** #/projects — list of projects (name, tracks · chosen, updated) + a "新建项目" form. */
export async function projectsView({ el }) {
  const nameIn = h("input", { id: "p-name", type: "text", placeholder: "项目名称，例如：城市夜行", maxlength: 200, required: true, autocomplete: "off" });
  const createBtn = h("button", { type: "submit", class: "primary", id: "p-create" }, "新建项目");
  const form = h("form", { class: "row nowrap", onsubmit: create }, nameIn, createBtn);
  const grid = h("div", { class: "grid-cards" });
  fill(el,
    h("div", { class: "view-head" }, h("h1", {}, "项目"), h("span", { class: "sub" }, "把作品整理成专辑，每首曲目保留多个版本，选出满意的定稿。")),
    h("div", { class: "panel project-list-create" }, form),
    grid);

  async function load() {
    try { const { projects } = await api.projects(); paint(projects); } catch (e) { toastError(e); }
  }
  function paint(projects) {
    fill(grid, projects.length ? projects.map(card) : h("div", { class: "empty", style: "grid-column:1/-1" }, "还没有项目。先新建项目，再添加曲目与作品版本。"));
  }
  function card(p) {
    const n = p.track_count || 0, m = p.chosen_count || 0;
    return h("div", { class: "card project-card", dataset: { id: p.id } },
      h("img", { class: "project-icon", src: "/static/assets/0832d.svg", alt: "", width: 64, height: 64 }),
      h("div", { class: "row between" }, h("a", { class: "title project-card-title", href: `#/project/${p.id}` }, p.name),
        h("button", { class: "ghost sm danger", onclick: () => remove(p) }, "删除")),
      p.description ? h("p", { class: "small muted" }, fmt.excerpt(p.description, 120)) : null,
      h("div", { class: "meta" },
        h("span", {}, h("b", { class: "num" }, n), " 首曲目"),
        h("span", {}, h("b", { class: "num" }, m), " 首已定稿"),
        h("span", { title: p.updated_at }, "更新于 ", fmt.when(p.updated_at))));
  }
  async function create(e) {
    e.preventDefault();
    const name = nameIn.value.trim();
    if (!name) return toast("请填写项目名称", "err");
    createBtn.disabled = true;
    try { const { project } = await api.createProject({ name }); location.hash = `#/project/${project.id}`; }
    catch (err) { toastError(err); createBtn.disabled = false; }
  }
  async function remove(p) {
    if (!confirmDialog(`删除项目「${p.name}」？项目内的曲目会移除，音乐文件仍然保留。`)) return;
    try { await api.removeProject(p.id); toast("项目已删除", "ok"); load(); } catch (e) { toastError(e); }
  }
  await load();
  return {};
}
