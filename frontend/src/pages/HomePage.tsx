import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  Alert,
  Paper,
  Skeleton,
  Switch,
  Textarea,
  UnstyledButton,
} from "@mantine/core";
import { Link, useNavigate } from "react-router-dom";
import {
  AlertCircle,
  ArrowRight,
  ArrowUpRight,
  AudioLines,
  ChevronRight,
  Compass,
  Disc3,
  Image,
  MessageCircle,
  Pause,
  Play,
  Shuffle,
  SlidersHorizontal,
} from "lucide-react";
import { Artwork, Button, IconButton } from "../components/ui";
import { duration, readStore, titleOf, when, writeStore } from "../lib/utils";
import { saveHomeDraft } from "../lib/homeDraft";
import type { Job } from "../lib/types";
import { useApp } from "../state/app";
import { usePlayer } from "../state/player";
import { usePlayerOverlay } from "../state/playerOverlay";
import { LiveJobCard, useMusicJobs } from "./QueuePage";
import { HomeProjects } from "./HomeProjects";
import { HomeSoundscape } from "../components/HomeSoundscape";
import { BrandWordmark } from "../components/BrandWordmark";
import "./Home.css";

const art = "/static/assets/home/";
const inspirations = [
  {
    title: "林间民谣",
    caption: "木吉他 · 温暖人声",
    image: "discover-landscape.jpg",
    prompt:
      "温暖的华语独立民谣，指弹木吉他，柔和钢琴，自然亲近的女声，像午后走在林间，舒缓而有层次。",
    instrumental: false,
  },
  {
    title: "午夜漫游",
    caption: "合成器 · 复古律动",
    image: "night-drive.jpg",
    prompt:
      "复古 synthwave 电子音乐，温暖的模拟合成器，清晰的鼓点，流动的低音，像沿着海岸公路夜间行驶。",
    instrumental: true,
  },
  {
    title: "日光碎片",
    caption: "梦幻流行 · 轻盈女声",
    image: "color-pop.jpg",
    prompt:
      "轻盈的华语 dream pop，空气感女声，明亮的吉他与柔软的合成器，旋律朗朗上口，像阳光照进房间，温柔又有希望感。",
    instrumental: false,
  },
  {
    title: "黑胶午后",
    caption: "爵士钢琴 · 慵懒节拍",
    image: "cover-studio.jpg",
    prompt:
      "慵懒的爵士 lo-fi，温暖的钢琴，低音提琴，刷镲和轻柔鼓点，细腻的黑胶质感，适合咖啡馆的安静午后。",
    instrumental: true,
  },
  {
    title: "山野来信",
    caption: "原声民谣 · 叙事男声",
    image: "discover-landscape.jpg",
    prompt:
      "华语原声民谣，低声叙事的男声，木吉他与手风琴，缓慢而开阔的节奏，写一封来自山野的信，质朴且有力量。",
    instrumental: false,
  },
  {
    title: "蓝色时刻",
    caption: "氛围电子 · 空间感",
    image: "night-drive.jpg",
    prompt:
      "宁静的 ambient 音乐，缓慢铺开的合成器，细碎的电钢琴，宽阔的混响空间，像凌晨的蓝色海面，无鼓点。",
    instrumental: true,
  },
  {
    title: "橘子汽水",
    caption: "夏日流行 · 轻快节奏",
    image: "color-pop.jpg",
    prompt:
      "清新的华语夏日流行，轻快明亮的女声，funk 吉他与律动贝斯，轻巧的鼓点，像冰镇橘子汽水，俏皮而有记忆点。",
    instrumental: false,
  },
  {
    title: "旧唱片",
    caption: "灵魂乐 · 复古质感",
    image: "cover-studio.jpg",
    prompt:
      "复古华语 soul，醇厚的男声，Rhodes 电钢琴，温暖的贝斯与克制的鼓点，模拟磁带质感，节奏松弛而富有情感。",
    instrumental: false,
  },
];

function SectionLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <UnstyledButton component={Link} to={to} className="home-section-link">
      {children}
      <ArrowUpRight size={14} />
    </UnstyledButton>
  );
}

function FeatureCard({
  label,
  icon,
  image,
  heading,
  description,
  actions,
  to,
  onOpen,
  ariaLabel,
}: {
  label: string;
  icon: ReactNode;
  image: ReactNode;
  heading: string;
  description: string;
  actions: ReactNode;
  to?: string;
  onOpen?: () => void;
  ariaLabel?: string;
}) {
  const content = (
    <>
      <span className="home-feature-label">
        {icon}
        {label}
      </span>
      <div className="home-feature-copy">
        <h2 title={heading}>{heading}</h2>
        <p>{description}</p>
      </div>
    </>
  );
  return (
    <Paper
      component="article"
      className="home-feature-card"
      withBorder
      aria-label={label}
    >
      <div className="home-feature-art" aria-hidden="true">
        {image}
      </div>
      <div className="home-feature-shade" />
      {to ? (
        <UnstyledButton
          component={Link}
          to={to}
          className="home-feature-primary"
          aria-label={ariaLabel}
        >
          {content}
        </UnstyledButton>
      ) : onOpen ? (
        <UnstyledButton
          onClick={onOpen}
          className="home-feature-primary"
          aria-label={ariaLabel}
        >
          {content}
        </UnstyledButton>
      ) : (
        <div className="home-feature-primary">{content}</div>
      )}
      <div className="home-feature-footer">{actions}</div>
    </Paper>
  );
}

function HomeComposer() {
  const navigate = useNavigate();
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [idea, setIdea] = useState(() => {
    const saved = readStore<{ prompt?: string; instrumental?: boolean }>(
      "home.idea",
      {},
    );
    return {
      prompt:
        typeof saved?.prompt === "string" ? saved.prompt.slice(0, 1000) : "",
      instrumental: saved?.instrumental === true,
    };
  });
  const [batch, setBatch] = useState(0);
  const [error, setError] = useState("");
  useEffect(() => writeStore("home.idea", idea), [idea]);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!idea.prompt.trim()) {
      textarea.current?.focus();
      return;
    }
    if (!saveHomeDraft({ ...idea, prompt: idea.prompt.trim() })) {
      setError("创作想法暂时无法保存，请检查浏览器存储后重试。");
      return;
    }
    navigate("/create?homeDraft=1");
  }
  return (
    <section className="home-create-hub" aria-labelledby="home-create-title">
      <div className="home-greeting">
        <div className="home-brand" role="img" aria-label="AI乐之城">
          <BrandWordmark />
        </div>
        <h1 id="home-create-title">今天，想做什么音乐？</h1>
      </div>
      <Paper component="form" className="home-composer" onSubmit={submit}>
        <Textarea
          ref={textarea}
          className="home-prompt"
          aria-label="描述你想创作的音乐"
          placeholder="独立民谣、指弹木吉他、温暖人声……说说你想听见的声音。"
          value={idea.prompt}
          maxLength={1000}
          rows={4}
          onChange={(event) => {
            setIdea({ ...idea, prompt: event.currentTarget.value });
            setError("");
          }}
          onKeyDown={(event) => {
            if (
              (event.metaKey || event.ctrlKey) &&
              event.key === "Enter" &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <div className="home-composer-footer">
          <div className="home-composer-options">
            <Switch
              checked={idea.instrumental}
              onChange={(event) =>
                setIdea({ ...idea, instrumental: event.currentTarget.checked })
              }
              label="纯音乐"
              size="sm"
              className="home-instrumental"
            />
            <span className="home-composer-separator" />
            <Link to="/create" className="home-custom-link">
              <SlidersHorizontal size={14} />
              自定义创作
            </Link>
          </div>
          <Button
            variant="primary"
            type="submit"
            className="home-create-button"
            disabled={!idea.prompt.trim()}
          >
            <AudioLines size={16} />
            继续创作
            <ArrowRight size={15} />
          </Button>
        </div>
      </Paper>
      {error && (
        <p className="home-composer-error" role="alert">
          {error}
        </p>
      )}
      <div className="home-inspiration-heading">
        <span>试试这些灵感</span>
        <UnstyledButton
          className="home-shuffle"
          onClick={() => setBatch((value) => (value + 1) % 2)}
          aria-label="换一批创作灵感"
        >
          <Shuffle size={13} />
          换一批
        </UnstyledButton>
      </div>
      <div className="home-inspiration-grid">
        {inspirations.slice(batch * 4, batch * 4 + 4).map((item) => (
          <UnstyledButton
            key={item.title}
            className={`home-inspiration${idea.prompt === item.prompt ? " is-selected" : ""}`}
            aria-label={`使用${item.title}灵感`}
            aria-pressed={idea.prompt === item.prompt}
            onClick={() => {
              setIdea({ prompt: item.prompt, instrumental: item.instrumental });
              setError("");
              textarea.current?.focus({ preventScroll: true });
            }}
          >
            <img src={art + item.image} alt="" />
            <span className="home-inspiration-shade" />
            <span className="home-inspiration-copy">
              <strong>{item.title}</strong>
              <small>{item.caption}</small>
            </span>
            <span className="home-inspiration-arrow">
              <ArrowUpRight size={15} />
            </span>
          </UnstyledButton>
        ))}
      </div>
    </section>
  );
}

export function HomePage() {
  const { active, history, doneTotal, loading, error, reload } =
    useMusicJobs(8);
  const currentId = usePlayer((state) => state.current?.id);
  const playing = usePlayer((state) => state.playing);
  const engine = useApp((state) => state.status?.engine);
  const recent = history
    .filter((job) => job.status === "done" && job.artifacts?.audio)
    .slice(0, 4);
  const featured = recent[0];
  function toggleTrack(job: Job) {
    const player = usePlayer.getState();
    if (player.current?.id === job.id) player.toggle();
    else
      player.play(
        recent,
        recent.findIndex((item) => item.id === job.id),
      );
  }
  function openPlayer(job: Job) {
    usePlayerOverlay.getState().open(job.id);
  }
  return (
    <div className="home-page">
      <HomeSoundscape />
      {error && (
        <Alert
          icon={<AlertCircle size={16} />}
          className="home-error"
          title="作品和任务暂时无法更新"
        >
          <div className="home-error-content">
            <span>{error}</span>
            <Button onClick={() => void reload()}>重试</Button>
          </div>
        </Alert>
      )}
      <HomeComposer />
      {active.length > 0 && (
        <section className="home-active-task" aria-label="正在生成的音乐">
          <div className="home-section-heading">
            <h2>
              正在创作<span>{active.length} 个任务</span>
            </h2>
            <SectionLink to="/queue">查看队列</SectionLink>
          </div>
          <LiveJobCard
            key={active[0].id}
            job={active[0]}
            compact
            onFinish={() => void reload()}
          />
        </section>
      )}
      <section className="home-explore-grid" aria-label="探索AI乐之城">
        <FeatureCard
          label="音乐广场"
          icon={<Compass size={15} />}
          image={<img src={art + "discover-landscape.jpg"} alt="" />}
          heading="让好音乐，被听见。"
          description="发现单曲、专辑与新的声音"
          to="/plaza"
          actions={<SectionLink to="/plaza">去逛逛</SectionLink>}
        />
        <FeatureCard
          label="封面工作室"
          icon={<Image size={15} />}
          image={<img src={art + "cover-studio.jpg"} alt="" />}
          heading="给声音，一张面孔。"
          description="为你的音乐，设计专属封面"
          to="/assistant?mode=cover"
          actions={
            <>
              <SectionLink to="/assistant?mode=cover">设计封面</SectionLink>
              <UnstyledButton
                component={Link}
                to="/assistant"
                className="home-feature-action home-feature-secondary"
              >
                <MessageCircle size={14} /> 创作助手
              </UnstyledButton>
            </>
          }
        />
        <FeatureCard
          label="继续聆听"
          icon={<Disc3 size={15} />}
          image={
            loading ? <Skeleton height="100%" /> : <Artwork job={featured} />
          }
          heading={
            loading
              ? "正在读取作品"
              : featured
                ? titleOf(featured)
                : error
                  ? "暂时无法读取作品"
                  : "等你的第一首作品"
          }
          description={
            loading
              ? "稍等片刻…"
              : featured
                ? `最近完成 · ${duration(featured.timing?.audio_seconds || 0)}`
                : error
                  ? "恢复连接后会自动更新"
                  : "创作完成后，回来听听"
          }
          onOpen={!loading && featured ? () => openPlayer(featured) : undefined}
          ariaLabel={featured ? `全屏聆听 ${titleOf(featured)}` : undefined}
          actions={
            <>
              {!loading && featured ? (
                <UnstyledButton
                  className="home-feature-action"
                  aria-label={`${currentId === featured.id && playing ? "暂停" : "播放"}最近作品`}
                  onClick={() => toggleTrack(featured)}
                >
                  {currentId === featured.id && playing ? (
                    <Pause size={15} fill="currentColor" />
                  ) : (
                    <Play size={15} fill="currentColor" />
                  )}
                  {currentId === featured.id && playing
                    ? "暂停播放"
                    : "播放作品"}
                </UnstyledButton>
              ) : !loading ? (
                <SectionLink to="/create">开始创作</SectionLink>
              ) : (
                <span />
              )}
              <SectionLink to="/library">作品库</SectionLink>
            </>
          }
        />
      </section>
      <section className="home-recent" aria-label="最近作品">
        <div className="home-section-heading">
          <h2>最近作品{!loading && !error && <span>{doneTotal} 首</span>}</h2>
          <SectionLink to="/library">全部作品</SectionLink>
        </div>
        {loading ? (
          <div className="home-track-grid" aria-label="正在读取作品">
            {[0, 1, 2, 3].map((item) => (
              <Skeleton key={item} height={90} radius={12} />
            ))}
          </div>
        ) : recent.length ? (
          <div className="home-track-grid">
            {recent.map((job) => {
              const isPlaying = currentId === job.id && playing;
              return (
                <Paper
                  component="article"
                  withBorder
                  className={`home-track${isPlaying ? " is-playing" : ""}`}
                  key={job.id}
                >
                  <UnstyledButton
                    className="home-track-cover"
                    aria-label={`全屏聆听 ${titleOf(job)}`}
                    onClick={() => openPlayer(job)}
                  >
                    <Artwork job={job} size={50} />
                  </UnstyledButton>
                  <div className="home-track-copy">
                    <UnstyledButton
                      className="home-track-title"
                      title={titleOf(job)}
                      onClick={() => openPlayer(job)}
                    >
                      {titleOf(job)}
                    </UnstyledButton>
                    <span>
                      {duration(job.timing?.audio_seconds || 0)}
                      <i />
                      {when(job.finished_at || job.created_at)}
                    </span>
                  </div>
                  <IconButton
                    className="home-track-play"
                    label={`${isPlaying ? "暂停" : "播放"} ${titleOf(job)}`}
                    onClick={() => toggleTrack(job)}
                  >
                    {isPlaying ? (
                      <Pause size={14} fill="currentColor" />
                    ) : (
                      <Play size={14} fill="currentColor" />
                    )}
                  </IconButton>
                </Paper>
              );
            })}
          </div>
        ) : (
          <Paper withBorder className="home-empty-works">
            <AudioLines size={24} strokeWidth={1.3} />
            <span>
              {error ? "作品暂时无法读取" : "你的音乐作品，会从这里开始。"}
            </span>
            <SectionLink to={error ? "/library" : "/create"}>
              {error ? "前往作品库" : "开始创作"}
            </SectionLink>
          </Paper>
        )}
      </section>
      <HomeProjects />
      <div className="home-status-footer">
        <span>
          <i className={engine ? "connected" : ""} />
          {engine ? "本地创作空间" : "正在连接本机服务"}
        </span>
        <Link to="/settings">
          模型与连接设置
          <ChevronRight size={12} />
        </Link>
      </div>
    </div>
  );
}
