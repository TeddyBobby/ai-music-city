import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowRight,
  AudioLines,
  LoaderCircle,
  MessageCircle,
  Mic,
  ImagePlus,
  Sparkles,
} from "lucide-react";
import { HomeSoundscape } from "../components/HomeSoundscape";
import { HumComposer } from "../components/HumComposer";
import { ImageComposer } from "../components/ImageComposer";
import { MusicKindToggle } from "../components/MusicKindToggle";
import { generateFromPrompt, type MusicKind } from "../lib/musicCreation";
import type { Job } from "../lib/types";
import { useApp } from "../state/app";
import { useAuth } from "../state/auth";
import "./Home.css";

const inspirations = [
  {
    title: "林间民谣",
    sound: "木吉他",
    mood: "自然 · 治愈",
    image: "discover-landscape.jpg",
    prompt:
      "写一首温暖的中文民谣，木吉他伴奏，像走在雨后的森林里，轻松而治愈。",
  },
  {
    title: "日落公路",
    sound: "合成器",
    mood: "自由 · 远方",
    image: "night-drive.jpg",
    prompt:
      "写一首适合日落时开车听的中文歌，复古合成器、轻快鼓点，关于自由和远方。",
  },
  {
    title: "夏日心动",
    sound: "流行",
    mood: "明亮 · 轻快",
    image: "color-pop.jpg",
    prompt:
      "写一首轻快的中文流行歌，关于夏天里第一次心动，旋律明亮、俏皮、朗朗上口。",
  },
];

function savedPrompt() {
  try {
    return sessionStorage.getItem("music.prompt") || "";
  } catch {
    return "";
  }
}
function savedMusicKind(): MusicKind {
  try {
    return sessionStorage.getItem("music.kind") === "instrumental"
      ? "instrumental"
      : "vocal";
  } catch {
    return "vocal";
  }
}

export function HomePage() {
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const humming = search.get("mode") === "hum";
  const imageMode = search.get("mode") === "image";
  const promptMode = !humming && !imageMode;
  const [musicKind, setMusicKind] = useState<MusicKind>(savedMusicKind);
  const [prompt, setPrompt] = useState(savedPrompt);
  const [phase, setPhase] = useState<
    "checking" | "writing" | "submitting" | null
  >(null);
  const [humBusy, setHumBusy] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const promptField = useRef<HTMLTextAreaElement>(null);
  const busy = !!phase || humBusy || imageBusy;

  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    try {
      sessionStorage.setItem("music.prompt", prompt);
    } catch {
      /* Private browsers can disable storage. */
    }
  }, [prompt]);
  useEffect(() => {
    try {
      sessionStorage.setItem("music.kind", musicKind);
    } catch {}
  }, [musicKind]);

  function created(job: Job) {
    void useApp.getState().refresh();
    navigate(`/generation/${encodeURIComponent(job.id)}`);
  }
  async function generate(event: FormEvent) {
    event.preventDefault();
    if (!prompt.trim() || busy || controller.current) return;
    // 未登录（游客）：直接跳登录页，不带提示语
    const user = useAuth.getState().user;
    if (!user) {
      void navigate("/login");
      return;
    }
    // 点击即跳生成页：prompt 存入 sessionStorage，由 /generation/composing 页面
    // 自己发起写词与提交（HomePage 卸载时的 abort 清理不会再杀掉生成流程）
    try {
      sessionStorage.setItem("music.composing", prompt);
      sessionStorage.setItem("music.composing.kind", musicKind);
    } catch {}
    void navigate("/generation/composing");
  }

  return (
    <div className="simple-home">
      <section className="home-hero-grid">
        <HomeSoundscape />
        <div className="music-composer-card">
          <div className="music-composer-toolbar">
            <div
              className="music-mode-tabs"
              role="tablist"
              aria-label="创作方式"
            >
              <button
                id="prompt-tab"
                type="button"
                role="tab"
                aria-selected={promptMode}
                aria-controls="music-input-panel"
                disabled={busy}
                className={promptMode ? "selected" : ""}
                onClick={() => setSearch({})}
              >
                <Sparkles size={17} />
                一句话
              </button>
              <button
                id="hum-tab"
                type="button"
                role="tab"
                aria-selected={humming}
                aria-controls="music-input-panel"
                disabled={busy}
                className={humming ? "selected" : ""}
                onClick={() => setSearch({ mode: "hum" })}
              >
                <Mic size={17} />
                哼一段
              </button>
              <button
                id="image-tab"
                type="button"
                role="tab"
                aria-selected={imageMode}
                aria-controls="music-input-panel"
                disabled={busy}
                className={imageMode ? "selected" : ""}
                onClick={() => setSearch({ mode: "image" })}
              >
                <ImagePlus size={17} />
                一张图
              </button>
            </div>
            <div className="home-music-kind">
              <MusicKindToggle
                value={musicKind}
                onChange={setMusicKind}
                disabled={busy}
              />
            </div>
          </div>
          <div
            id="music-input-panel"
            className="music-input-panel"
            role="tabpanel"
            aria-labelledby={
              humming ? "hum-tab" : imageMode ? "image-tab" : "prompt-tab"
            }
          >
            {humming ? (
              <HumComposer
                musicKind={musicKind}
                onCreated={created}
                onBusyChange={setHumBusy}
              />
            ) : imageMode ? (
              <ImageComposer
                musicKind={musicKind}
                onCreated={created}
                onBusyChange={setImageBusy}
              />
            ) : (
              <form
                onSubmit={generate}
                className="simple-prompt-form"
                aria-busy={!!phase}
              >
                <div className="music-composer-body">
                  <textarea
                    ref={promptField}
                    aria-label="想生成什么音乐"
                    placeholder={
                      musicKind === "instrumental"
                        ? "一段适合雨天读书的钢琴音乐…"
                        : "写一首关于夏天的歌，轻快一点…"
                    }
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                    onKeyDown={(event) => {
                      if (
                        event.key === "Enter" &&
                        (event.metaKey || event.ctrlKey) &&
                        !event.nativeEvent.isComposing &&
                        event.nativeEvent.keyCode !== 229 &&
                        !event.repeat &&
                        prompt.trim() &&
                        !busy
                      ) {
                        event.preventDefault();
                        event.currentTarget.form?.requestSubmit();
                      }
                    }}
                    aria-keyshortcuts="Control+Enter Meta+Enter"
                    maxLength={1000}
                    disabled={!!phase}
                    rows={4}
                  />
                </div>
                {error && (
                  <p className="music-inline-error" role="alert">
                    {error}
                  </p>
                )}
                <div className="simple-composer-actions">
                  <Link to="/assistant" className="composer-assistant">
                    <MessageCircle size={17} />
                    <span>AI 帮我想</span>
                  </Link>
                  <div className="home-generate-action">
                    {phase && phase !== "submitting" && (
                      <button
                        className="music-cancel"
                        type="button"
                        onClick={() => controller.current?.abort()}
                      >
                        取消
                      </button>
                    )}
                    <button
                      className="generate-music-button"
                      type="submit"
                      disabled={!prompt.trim() || !!phase}
                    >
                      {phase ? (
                        <LoaderCircle size={18} className="music-spinning" />
                      ) : (
                        <AudioLines size={18} />
                      )}
                      <span role="status">
                        {phase === "writing"
                          ? "AI 正在创作歌词…"
                          : phase === "checking"
                            ? "正在检查引擎…"
                            : phase
                              ? "正在提交任务…"
                              : "生成音乐"}
                      </span>
                      {!phase && <ArrowRight size={17} />}
                    </button>
                  </div>
                </div>
              </form>
            )}
          </div>
        </div>
      </section>
      <section className="home-inspiration" aria-label="创作灵感">
        <div className="home-inspiration-options">
          {inspirations.map((idea) => (
            <button
              className="home-inspiration-choice"
              type="button"
              key={idea.title}
              disabled={busy}
              aria-label={`用${idea.title}作为创作灵感`}
              aria-pressed={prompt === idea.prompt}
              onClick={() => {
                setPrompt(idea.prompt);
                setError("");
                if (!promptMode) setSearch({});
                requestAnimationFrame(() =>
                  promptField.current?.focus({ preventScroll: true }),
                );
              }}
            >
              <img src={`/static/assets/home/${idea.image}`} alt="" />
              <span>
                <span className="home-inspiration-copy">
                  <strong>{idea.title}</strong>
                  <small>
                    <span>{idea.sound}</span>
                    <span>{idea.mood}</span>
                  </small>
                </span>
                <ArrowRight size={14} aria-hidden="true" />
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
