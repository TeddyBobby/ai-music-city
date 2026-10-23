import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Alert,
  Avatar,
  Menu,
  Modal,
  Skeleton,
  Tabs,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import {
  AlertCircle,
  ArrowUpRight,
  CircleHelp,
  Disc3,
  Headphones,
  MoreHorizontal,
  Music2,
  Pause,
  Pencil,
  Play,
  Plus,
  Search,
  Trophy,
  Undo2,
  UserRound,
} from "lucide-react";
import { Artwork, Button, EmptyState, IconButton } from "../components/ui";
import { PublishDialog } from "../components/PublishDialog";
import { AlbumPublishDialog } from "../components/AlbumPublishDialog";
import {
  notifyPlazaUpdated,
  plazaApi,
  type PlazaAlbum,
  type PlazaPost,
  type PlazaRankingEntry,
  type PlazaRankings,
} from "../lib/plaza";
import type { Job } from "../lib/types";
import { duration, errorMessage, titleOf, when } from "../lib/utils";
import { useApp } from "../state/app";
import { usePlayer } from "../state/player";
import { usePlayerOverlay } from "../state/playerOverlay";
import "./Plaza.css";
import "./CollectionDesign.css";

type PlazaView = "singles" | "albums" | "rankings";
type Withdrawal =
  { type: "single"; post: PlazaPost } | { type: "album"; album: PlazaAlbum };
const emptyRankings: PlazaRankings = { manual: [], ai: [], scope: "local" };

function Author({
  author,
  published_at,
}: Pick<PlazaPost, "author" | "published_at">) {
  return (
    <div className="plaza-author">
      <Avatar size={28} radius="xl" className="plaza-avatar" aria-hidden="true">
        <UserRound size={15} />
      </Avatar>
      <div>
        <span>{author.name}</span>
        <time dateTime={published_at}>{when(published_at)}</time>
      </div>
    </div>
  );
}

function AlbumArtwork({ album }: { album: PlazaAlbum }) {
  return album.tracks[0] ? (
    <Artwork job={album.tracks[0]} />
  ) : (
    <div className="plaza-album-art-empty" aria-label="专辑暂无可用封面">
      <Disc3 size={52} strokeWidth={1} />
      <span>暂无可用曲目</span>
    </div>
  );
}

function toggleTrack(jobs: Job[], index: number) {
  const player = usePlayer.getState();
  if (player.current?.id === jobs[index]?.id && player.playing) player.pause();
  else player.play(jobs, index);
}

function RankingColumn({
  kind,
  entries,
  searching,
}: {
  kind: "manual" | "ai";
  entries: PlazaRankingEntry[];
  searching: boolean;
}) {
  const currentId = usePlayer((state) => state.current?.id);
  const playing = usePlayer((state) => state.playing);
  return (
    <section
      className={`plaza-ranking plaza-ranking-${kind}`}
      aria-label={kind === "manual" ? "我的评分榜" : "AI 参考榜"}
    >
      <header className="plaza-ranking-head">
        <span className="plaza-ranking-mark" aria-hidden="true">
          {kind === "manual" ? "我" : "AI"}
        </span>
        <div>
          <h2>{kind === "manual" ? "我的评分榜" : "AI 参考榜"}</h2>
          <p>
            {kind === "manual"
              ? "按你的真实评分排序"
              : "按 AI 参考分排序，不代表实际听感"}
          </p>
        </div>
        <span className="plaza-ranking-scale">10 分制</span>
      </header>
      {entries.length ? (
        <ol className="plaza-ranking-list">
          {entries.map((entry, index) => {
            const name = titleOf(entry.post.job),
              isPlaying = currentId === entry.post.job_id && playing;
            return (
              <li
                className={`plaza-ranking-row${isPlaying ? " is-playing" : ""}`}
                key={entry.post.job_id}
                value={entry.rank}
              >
                <span
                  className="plaza-rank-position"
                  aria-label={`第 ${entry.rank} 名`}
                >
                  {String(entry.rank).padStart(2, "0")}
                </span>
                <UnstyledButton
                  className="plaza-rank-cover"
                  aria-label={`${isPlaying ? "暂停" : "播放"} ${name}`}
                  onClick={() =>
                    toggleTrack(
                      entries.map((item) => item.post.job),
                      index,
                    )
                  }
                >
                  <Artwork job={entry.post.job} size={44} />
                  <span>
                    {isPlaying ? (
                      <Pause size={15} fill="currentColor" />
                    ) : (
                      <Play size={15} fill="currentColor" />
                    )}
                  </span>
                </UnstyledButton>
                <div className="plaza-ranking-title">
                  <UnstyledButton
                    title={name}
                    onClick={() =>
                      usePlayerOverlay
                        .getState()
                        .open(entry.post.job_id, "reviews")
                    }
                  >
                    {name}
                  </UnstyledButton>
                  <span>
                    {entry.post.author.name} ·{" "}
                    {duration(entry.post.job.timing?.audio_seconds || 0)}
                  </span>
                </div>
                <UnstyledButton
                  className="plaza-ranking-score"
                  aria-label={`查看 ${name} 的${kind === "manual" ? "我的评分" : "AI 参考分"} ${entry.score.toFixed(1)}`}
                  onClick={() =>
                    usePlayerOverlay
                      .getState()
                      .open(entry.post.job_id, "reviews")
                  }
                >
                  {entry.score.toFixed(1)}
                </UnstyledButton>
              </li>
            );
          })}
        </ol>
      ) : (
        <div className="plaza-ranking-empty">
          <Trophy size={25} strokeWidth={1.4} />
          <p>{searching ? "没有匹配的上榜单曲" : "还没有上榜单曲"}</p>
          <span>
            {searching
              ? "试试其他关键词。"
              : kind === "manual"
                ? "发布单曲并为它评分后，即可在这里看到排名。"
                : "已发布单曲获得 AI 乐评后，即可进入榜单。"}
          </span>
        </div>
      )}
    </section>
  );
}

function AlbumDetails({
  album: initialAlbum,
  onClose,
}: {
  album: PlazaAlbum;
  onClose: () => void;
}) {
  const [album, setAlbum] = useState(initialAlbum);
  const [opened, setOpened] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const currentId = usePlayer((state) => state.current?.id);
  const playing = usePlayer((state) => state.playing);
  const requestId = useRef(0);
  const afterClose = useRef<(() => void) | null>(null);
  const load = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    setError("");
    try {
      const result = await plazaApi.getAlbum(initialAlbum.id);
      if (id === requestId.current) setAlbum(result.album);
    } catch (cause) {
      if (id === requestId.current) setError(errorMessage(cause));
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [initialAlbum.id]);
  useEffect(() => {
    void load();
    return () => {
      requestId.current += 1;
    };
  }, [load]);
  return (
    <Modal
      opened={opened}
      onClose={() => setOpened(false)}
      onExitTransitionEnd={() => {
        onClose();
        afterClose.current?.();
      }}
      title="专辑曲目"
      size={700}
      centered
      zIndex={650}
      closeButtonProps={{ "aria-label": "关闭专辑详情" }}
      classNames={{
        content: "ui-dialog plaza-album-dialog",
        header: "ui-dialog-head",
        body: "ui-dialog-body",
        title: "ui-dialog-title",
      }}
    >
      <div className="plaza-album-summary">
        <div className="plaza-album-mini">
          <AlbumArtwork album={album} />
        </div>
        <div>
          <h2>{album.title}</h2>
          <p>
            {album.track_count} 首 · {duration(album.duration_seconds)}
          </p>
          <span>
            {album.author.name} · {when(album.published_at)}
          </span>
        </div>
      </div>
      {album.caption && (
        <p className="plaza-album-description">{album.caption}</p>
      )}
      {error ? (
        <Alert
          icon={<AlertCircle size={16} />}
          title="暂时无法读取专辑"
          className="plaza-error"
          role="alert"
        >
          <div className="plaza-error-body">
            <span>{error}</span>
            <Button disabled={loading} onClick={() => void load()}>
              重试
            </Button>
          </div>
        </Alert>
      ) : (
        <>
          <div className="plaza-album-track-head">
            <span>
              {album.unavailable_count
                ? `${album.unavailable_count} 首原作品暂不可用`
                : "按专辑顺序播放"}
            </span>
            <Button
              variant="primary"
              disabled={loading || !album.tracks.length}
              onClick={() => usePlayer.getState().play(album.tracks)}
            >
              <Play size={14} fill="currentColor" />
              全部播放
            </Button>
          </div>
          {loading ? (
            <div
              className="plaza-album-track-loading"
              role="status"
              aria-label="正在读取专辑曲目"
            >
              <Skeleton height={54} />
              <Skeleton height={54} />
            </div>
          ) : album.tracks.length ? (
            <ol className="plaza-album-track-list">
              {album.tracks.map((job, index) => {
                const name = titleOf(job),
                  isPlaying = currentId === job.id && playing;
                const originalIndex = album.job_ids.indexOf(job.id);
                return (
                  <li
                    key={job.id}
                    className={`plaza-album-track${isPlaying ? " is-playing" : ""}`}
                  >
                    <span className="plaza-track-index">
                      {String(
                        originalIndex >= 0 ? originalIndex + 1 : index + 1,
                      ).padStart(2, "0")}
                    </span>
                    <Artwork job={job} size={42} />
                    <UnstyledButton
                      className="plaza-track-title"
                      onClick={() => toggleTrack(album.tracks, index)}
                      title={name}
                    >
                      {name}
                    </UnstyledButton>
                    <span className="plaza-track-duration">
                      {duration(job.timing?.audio_seconds || 0)}
                    </span>
                    <IconButton
                      label={`${isPlaying ? "暂停" : "播放"} ${name}`}
                      onClick={() => toggleTrack(album.tracks, index)}
                    >
                      {isPlaying ? (
                        <Pause size={16} fill="currentColor" />
                      ) : (
                        <Play size={16} fill="currentColor" />
                      )}
                    </IconButton>
                    <IconButton
                      label={`全屏查看 ${name}`}
                      onClick={() => {
                        afterClose.current = () =>
                          usePlayerOverlay.getState().open(job.id);
                        setOpened(false);
                      }}
                    >
                      <ArrowUpRight size={16} />
                    </IconButton>
                  </li>
                );
              })}
            </ol>
          ) : (
            <div className="plaza-album-no-tracks">
              <Music2 size={22} />
              <p>专辑中的原作品暂不可用</p>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

export function PlazaPage() {
  const toast = useApp((state) => state.toast);
  const currentId = usePlayer((state) => state.current?.id);
  const playing = usePlayer((state) => state.playing);
  const [params, setParams] = useSearchParams();
  const selectedView = params.get("view");
  const view: PlazaView =
    selectedView === "albums" || selectedView === "rankings"
      ? selectedView
      : "singles";
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [posts, setPosts] = useState<PlazaPost[]>([]);
  const [albums, setAlbums] = useState<PlazaAlbum[]>([]);
  const [rankings, setRankings] = useState<PlazaRankings>(emptyRankings);
  const [total, setTotal] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [publish, setPublish] = useState<{ job?: Job } | null>(null);
  const [publishAlbum, setPublishAlbum] = useState<{
    album?: PlazaAlbum;
  } | null>(null);
  const [detailAlbum, setDetailAlbum] = useState<PlazaAlbum | null>(null);
  const [withdraw, setWithdraw] = useState<Withdrawal | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);
  const requestId = useRef(0);
  const nextOffset = useRef(0);
  const inFlight = useRef(false);
  const lastRefresh = useRef(0);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const filterKey = `${view}\n${search}`;
  const activeFilter = useRef(filterKey);
  activeFilter.current = filterKey;
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);

  const load = useCallback(
    async (append = false) => {
      if (append && inFlight.current) return;
      const id = ++requestId.current,
        key = `${view}\n${search}`,
        offset = append ? nextOffset.current : 0;
      inFlight.current = true;
      lastRefresh.current = Date.now();
      setLoading(!append);
      setLoadingMore(append);
      setError("");
      try {
        if (view === "singles") {
          const feed = await plazaApi.list(search, offset);
          if (id !== requestId.current || key !== activeFilter.current) return;
          nextOffset.current = offset + feed.posts.length;
          setPosts((previous) => [
            ...new Map(
              (append ? [...previous, ...feed.posts] : feed.posts).map(
                (post) => [post.job_id, post],
              ),
            ).values(),
          ]);
          setTotal(feed.total);
        } else if (view === "albums") {
          const feed = await plazaApi.albums(search, offset);
          if (id !== requestId.current || key !== activeFilter.current) return;
          nextOffset.current = offset + feed.albums.length;
          setAlbums((previous) => [
            ...new Map(
              (append ? [...previous, ...feed.albums] : feed.albums).map(
                (album) => [album.id, album],
              ),
            ).values(),
          ]);
          setTotal(feed.total);
        } else {
          const feed = await plazaApi.rankings(search);
          if (id !== requestId.current || key !== activeFilter.current) return;
          setRankings(feed);
        }
        setLoaded(true);
      } catch (cause) {
        if (id === requestId.current && key === activeFilter.current)
          setError(errorMessage(cause));
      } finally {
        if (id === requestId.current && key === activeFilter.current) {
          inFlight.current = false;
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [search, view],
  );
  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      void load();
    }, 100);
  }, [load]);
  useEffect(() => {
    setPosts([]);
    setAlbums([]);
    setRankings(emptyRankings);
    setTotal(0);
    setLoaded(false);
    nextOffset.current = 0;
    void load();
    return () => {
      requestId.current += 1;
      inFlight.current = false;
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, [load]);
  useEffect(() => {
    const resume = () => {
      if (
        document.visibilityState === "visible" &&
        Date.now() - lastRefresh.current > 2000
      )
        scheduleRefresh();
    };
    const events = [
      "tingjian:plaza-updated",
      "yue2:jobs-updated",
      "yue2:review-updated",
    ];
    events.forEach((event) => window.addEventListener(event, scheduleRefresh));
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      events.forEach((event) =>
        window.removeEventListener(event, scheduleRefresh),
      );
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [scheduleRefresh]);
  function openPublish() {
    if (view === "albums") setPublishAlbum({});
    else setPublish({});
  }
  async function withdrawPublication() {
    if (!withdraw || withdrawing) return;
    const id =
      withdraw.type === "single" ? withdraw.post.job_id : withdraw.album.id;
    setWithdrawing(true);
    try {
      if (withdraw.type === "single") await plazaApi.withdraw(id);
      else await plazaApi.withdrawAlbum(id);
      setWithdraw(null);
      toast("已撤回发布，原作品仍保留在「我的作品」。", "ok");
      notifyPlazaUpdated(id);
    } catch (cause) {
      toast(errorMessage(cause), "err");
    } finally {
      setWithdrawing(false);
    }
  }
  const count =
    view === "singles"
      ? posts.length
      : view === "albums"
        ? albums.length
        : rankings.manual.length + rankings.ai.length;
  const unit = view === "albums" ? "张专辑" : "首单曲";
  return (
    <div className="collection-page plaza-page">
      <header className="collection-heading plaza-intro">
        <div className="collection-heading-copy">
          <span className="collection-eyebrow">
            <Headphones size={14} /> 音乐广场
          </span>
          <h1>让灵感，有回响。</h1>
          <p>听见一首好歌，也留下你的创作故事。</p>
          <div className="collection-heading-actions">
            <Button
              variant="primary"
              className="plaza-publish"
              onClick={openPublish}
            >
              <Plus size={16} />
              {view === "albums" ? "发布专辑" : "发布单曲"}
            </Button>
            {view === "singles" && posts.length > 0 && (
              <Button
                onClick={() =>
                  usePlayer.getState().play(posts.map((post) => post.job))
                }
              >
                <Play size={15} fill="currentColor" /> 开始听歌
              </Button>
            )}
          </div>
        </div>
        <div className="plaza-intro-art" aria-hidden="true">
          <div className="plaza-record-sleeve">
            <span>
              每一种心情
              <br />
              都有自己的旋律
            </span>
            <Music2 size={25} />
          </div>
          <div className="plaza-record">
            <span>
              <Music2 size={21} />
            </span>
          </div>
        </div>
      </header>
      <Tabs
        value={view}
        onChange={(value) => {
          const next = new URLSearchParams(params);
          next.set("view", value || "singles");
          setParams(next);
        }}
        keepMounted={false}
      >
        <div className="plaza-toolbar">
          <Tabs.List className="plaza-view-tabs" aria-label="广场内容">
            <Tabs.Tab value="singles" leftSection={<Music2 size={15} />}>
              单曲
            </Tabs.Tab>
            <Tabs.Tab value="albums" leftSection={<Disc3 size={15} />}>
              专辑
            </Tabs.Tab>
            <Tabs.Tab value="rankings" leftSection={<Trophy size={15} />}>
              排行榜
            </Tabs.Tab>
          </Tabs.List>
          <TextInput
            type="search"
            className="plaza-search"
            leftSection={<Search size={16} />}
            aria-label="搜索广场"
            maxLength={200}
            placeholder={
              view === "albums"
                ? "搜索专辑、曲目或发布文字"
                : "搜索单曲或发布文字"
            }
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </div>
        <div className="plaza-feed-meta">
          <span className="plaza-count" aria-live="polite">
            {loaded
              ? view === "rankings"
                ? "听过，才有自己的答案 · 已评分的单曲在这里相遇"
                : `${search ? "找到" : "已发布"} ${total} ${unit}`
              : error
                ? "暂时无法读取"
                : "读取广场…"}
            {loading && count > 0 && <span> · 更新中</span>}
          </span>
          <span className="plaza-local-note">
            <CircleHelp size={13} />
            本机预览 · 当前内容未上传互联网
          </span>
        </div>
        <Tabs.Panel value={view}>
          {error && (
            <Alert
              className="plaza-error"
              icon={<AlertCircle size={16} />}
              title="广场暂时无法更新"
              role="alert"
            >
              <div className="plaza-error-body">
                <span>{error}</span>
                <Button
                  disabled={loading || loadingMore}
                  onClick={() => void load()}
                >
                  重试
                </Button>
              </div>
            </Alert>
          )}
          {loading && !count ? (
            <div
              className={view === "rankings" ? "plaza-rankings" : "plaza-grid"}
              role="status"
              aria-label="正在读取广场内容"
            >
              {Array.from(
                { length: view === "rankings" ? 2 : 4 },
                (_, index) => (
                  <div
                    className="plaza-skeleton"
                    key={index}
                    aria-hidden="true"
                  >
                    <Skeleton
                      className={
                        view === "rankings"
                          ? "plaza-skeleton-ranking"
                          : "plaza-skeleton-cover"
                      }
                    />
                    <Skeleton height={16} width="72%" />
                    <Skeleton height={12} width="92%" />
                  </div>
                ),
              )}
            </div>
          ) : view === "rankings" && (loaded || !error) ? (
            <div className="plaza-rankings" aria-busy={loading}>
              <RankingColumn
                kind="manual"
                entries={rankings.manual}
                searching={Boolean(search)}
              />
              <RankingColumn
                kind="ai"
                entries={rankings.ai}
                searching={Boolean(search)}
              />
            </div>
          ) : !count && !error ? (
            <div className="plaza-empty">
              <EmptyState
                title={
                  search
                    ? `没有找到匹配的${view === "albums" ? "专辑" : "单曲"}`
                    : view === "albums"
                      ? "还没有发布的专辑"
                      : "还没有发布的单曲"
                }
                description={
                  search
                    ? "试试其他关键词。"
                    : view === "albums"
                      ? "把多首作品编排成一张专辑，完整呈现这次创作。"
                      : "选一首自己的作品，写下这次创作的想法。"
                }
              >
                {search ? (
                  <Button
                    onClick={() => {
                      setQuery("");
                      setSearch("");
                    }}
                  >
                    清空搜索
                  </Button>
                ) : (
                  <Button variant="primary" onClick={openPublish}>
                    <Plus size={15} />
                    {view === "albums" ? "发布第一张专辑" : "发布第一首单曲"}
                  </Button>
                )}
              </EmptyState>
            </div>
          ) : (
            view !== "rankings" && (
              <div
                className="plaza-grid"
                aria-label={view === "albums" ? "已发布的专辑" : "已发布的单曲"}
                aria-busy={loading}
              >
                {view === "singles"
                  ? posts.map((post, index) => {
                      const isPlaying = currentId === post.job_id && playing,
                        name = titleOf(post.job);
                      return (
                        <article
                          className={`plaza-card${isPlaying ? " is-playing" : ""}`}
                          key={post.id}
                        >
                          <div className="plaza-cover">
                            <UnstyledButton
                              className="plaza-cover-open"
                              aria-label={`全屏查看 ${name}`}
                              onClick={() =>
                                usePlayerOverlay.getState().open(post.job_id)
                              }
                            >
                              <Artwork job={post.job} />
                            </UnstyledButton>
                            <span className="plaza-duration">
                              {duration(post.job.timing?.audio_seconds || 0)}
                            </span>
                            <UnstyledButton
                              className="plaza-play"
                              aria-label={`${isPlaying ? "暂停" : "播放"} ${name}`}
                              onClick={() =>
                                toggleTrack(
                                  posts.map((item) => item.job),
                                  index,
                                )
                              }
                            >
                              {isPlaying ? (
                                <Pause size={18} fill="currentColor" />
                              ) : (
                                <Play size={18} fill="currentColor" />
                              )}
                            </UnstyledButton>
                          </div>
                          <div className="plaza-card-heading">
                            <UnstyledButton
                              className="plaza-title"
                              title={name}
                              onClick={() =>
                                usePlayerOverlay.getState().open(post.job_id)
                              }
                            >
                              {name}
                            </UnstyledButton>
                            {post.can_manage && (
                              <Menu
                                position="bottom-end"
                                withinPortal
                                zIndex={450}
                              >
                                <Menu.Target>
                                  <IconButton label={`管理发布 ${name}`}>
                                    <MoreHorizontal size={17} />
                                  </IconButton>
                                </Menu.Target>
                                <Menu.Dropdown>
                                  <Menu.Item
                                    leftSection={<Pencil size={14} />}
                                    onClick={() =>
                                      setPublish({ job: post.job })
                                    }
                                  >
                                    编辑发布
                                  </Menu.Item>
                                  <Menu.Item
                                    leftSection={<ArrowUpRight size={14} />}
                                    onClick={() =>
                                      usePlayerOverlay
                                        .getState()
                                        .open(post.job_id)
                                    }
                                  >
                                    全屏播放
                                  </Menu.Item>
                                  <Menu.Divider />
                                  <Menu.Item
                                    leftSection={<Undo2 size={14} />}
                                    onClick={() =>
                                      setWithdraw({ type: "single", post })
                                    }
                                  >
                                    撤回发布
                                  </Menu.Item>
                                </Menu.Dropdown>
                              </Menu>
                            )}
                          </div>
                          {post.caption && (
                            <p className="plaza-caption">{post.caption}</p>
                          )}
                          <div className="plaza-card-footer">
                            <Author {...post} />
                          </div>
                        </article>
                      );
                    })
                  : albums.map((album) => (
                      <article
                        className="plaza-card plaza-album-card"
                        key={album.id}
                      >
                        <div className="plaza-cover">
                          <UnstyledButton
                            className="plaza-cover-open"
                            aria-label={`查看专辑 ${album.title}`}
                            onClick={() => setDetailAlbum(album)}
                          >
                            <AlbumArtwork album={album} />
                          </UnstyledButton>
                          <span className="plaza-duration">
                            {album.track_count} 首 ·{" "}
                            {duration(album.duration_seconds)}
                          </span>
                          <UnstyledButton
                            className="plaza-play"
                            disabled={!album.tracks.length}
                            aria-label={`播放专辑 ${album.title}`}
                            onClick={() =>
                              usePlayer.getState().play(album.tracks)
                            }
                          >
                            <Play size={18} fill="currentColor" />
                          </UnstyledButton>
                        </div>
                        <div className="plaza-card-heading">
                          <UnstyledButton
                            className="plaza-title"
                            title={album.title}
                            onClick={() => setDetailAlbum(album)}
                          >
                            {album.title}
                          </UnstyledButton>
                          {album.can_manage && (
                            <Menu
                              position="bottom-end"
                              withinPortal
                              zIndex={450}
                            >
                              <Menu.Target>
                                <IconButton label={`管理专辑 ${album.title}`}>
                                  <MoreHorizontal size={17} />
                                </IconButton>
                              </Menu.Target>
                              <Menu.Dropdown>
                                <Menu.Item
                                  leftSection={<Pencil size={14} />}
                                  onClick={() => setPublishAlbum({ album })}
                                >
                                  编辑专辑
                                </Menu.Item>
                                <Menu.Item
                                  leftSection={<Disc3 size={14} />}
                                  onClick={() => setDetailAlbum(album)}
                                >
                                  查看曲目
                                </Menu.Item>
                                <Menu.Divider />
                                <Menu.Item
                                  leftSection={<Undo2 size={14} />}
                                  onClick={() =>
                                    setWithdraw({ type: "album", album })
                                  }
                                >
                                  撤回专辑
                                </Menu.Item>
                              </Menu.Dropdown>
                            </Menu>
                          )}
                        </div>
                        {album.caption && (
                          <p className="plaza-caption">{album.caption}</p>
                        )}
                        {album.unavailable_count > 0 && (
                          <p className="plaza-album-unavailable">
                            {album.unavailable_count} 首原作品暂不可用
                          </p>
                        )}
                        <div className="plaza-card-footer">
                          <Author {...album} />
                        </div>
                      </article>
                    ))}
              </div>
            )
          )}
          {view !== "rankings" &&
            loaded &&
            nextOffset.current < total &&
            count > 0 && (
              <div className="plaza-more">
                <Button
                  disabled={loading || loadingMore}
                  onClick={() => void load(true)}
                >
                  {loadingMore ? "正在加载…" : "加载更多"}
                </Button>
                <span>
                  已显示 {count} / {total} {unit}
                </span>
              </div>
            )}
        </Tabs.Panel>
      </Tabs>
      {publish && (
        <PublishDialog
          job={publish.job}
          onClose={() => setPublish(null)}
          onPublished={() => {
            setPublish(null);
            scheduleRefresh();
          }}
        />
      )}
      {publishAlbum && (
        <AlbumPublishDialog
          album={publishAlbum.album}
          onClose={() => setPublishAlbum(null)}
          onPublished={() => {
            setPublishAlbum(null);
            scheduleRefresh();
          }}
        />
      )}
      {detailAlbum && (
        <AlbumDetails
          key={detailAlbum.id}
          album={detailAlbum}
          onClose={() => setDetailAlbum(null)}
        />
      )}
      {withdraw && (
        <Modal
          opened
          onClose={() => {
            if (!withdrawing) setWithdraw(null);
          }}
          title={withdraw.type === "album" ? "撤回专辑" : "撤回单曲发布"}
          centered
          size={480}
          zIndex={700}
          closeOnClickOutside={!withdrawing}
          closeOnEscape={!withdrawing}
          withCloseButton={!withdrawing}
          closeButtonProps={{ "aria-label": "关闭撤回确认" }}
          classNames={{
            content: "ui-dialog",
            header: "ui-dialog-head",
            body: "ui-dialog-body",
            title: "ui-dialog-title",
          }}
        >
          <p className="plaza-withdraw-copy">
            从广场撤回《
            {withdraw.type === "album"
              ? withdraw.album.title
              : titleOf(withdraw.post.job)}
            》？
            {withdraw.type === "album"
              ? "原曲目及其单曲发布会继续保留。"
              : "作品和生成文件会继续保留在「我的作品」中，之后可以重新发布。"}
          </p>
          <div className="dialog-actions">
            <Button disabled={withdrawing} onClick={() => setWithdraw(null)}>
              保留发布
            </Button>
            <Button
              variant="danger"
              disabled={withdrawing}
              onClick={() => void withdrawPublication()}
            >
              {withdrawing ? "正在撤回…" : "撤回发布"}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
