"use client";

/* eslint-disable @next/next/no-img-element */

import { useEffect, useState } from "react";
import Link from "next/link";
import { MusicBackdrop } from "@/components/music/MusicBackdrop";
import { MusicPanel } from "@/components/music/MusicPanel";
import { Button } from "@/components/ui/button";
import { primeSongRecommendationClientCache } from "@/lib/song/recommendations-client";

const MANDOPOP_PREVIEW_POOL = [
  {
    title: "稻香",
    artist: "周杰伦",
    artwork:
      "https://is1-ssl.mzstatic.com/image/thumb/Music116/v4/53/6c/72/536c7219-e177-a912-9322-e1abf70e8733/23UM1IM58828.rgb.jpg/100x100bb.jpg",
  },
  {
    title: "富士山下",
    artist: "陈奕迅",
    artwork:
      "https://is1-ssl.mzstatic.com/image/thumb/Music125/v4/44/d3/57/44d35752-0906-6a22-ebc4-32d9553fa0fb/00602517176997.rgb.jpg/100x100bb.jpg",
  },
  {
    title: "红豆",
    artist: "王菲",
    artwork:
      "https://is1-ssl.mzstatic.com/image/thumb/Music125/v4/58/0e/51/580e517e-69a0-decc-96a4-b39fee54945c/Untitled.jpg/100x100bb.jpg",
  },
  {
    title: "月亮代表我的心",
    artist: "邓丽君",
    artwork:
      "https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/a6/f2/69/a6f269b8-a941-315e-f8bc-0c1736f45c9f/06UMGIM60865.rgb.jpg/100x100bb.jpg",
  },
  {
    title: "她来听我的演唱会",
    artist: "张学友",
    artwork:
      "https://is1-ssl.mzstatic.com/image/thumb/Music124/v4/e9/b9/2c/e9b92cb3-7d1b-a673-119e-d23ebb518273/00731454328722.rgb.jpg/100x100bb.jpg",
  },
  {
    title: "山丘",
    artist: "李宗盛",
    artwork:
      "https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/b8/6e/0e/b86e0ea3-1ad8-b425-5d7b-81d16bcd7a7d/Jonathan_LEE-Hill-cover.jpg/100x100bb.jpg",
  },
  {
    title: "江南",
    artist: "林俊杰",
    artwork:
      "https://is1-ssl.mzstatic.com/image/thumb/Music49/v4/9b/98/eb/9b98ebae-69b1-8009-678c-65e94124e0a8/dj.cqtiyqmo.jpg/100x100bb.jpg",
  },
  {
    title: "倔强",
    artist: "五月天",
    artwork: "https://is1-ssl.mzstatic.com/image/thumb/Music/07/f2/90/mzi.xhevnauo.jpg/100x100bb.jpg",
  },
  {
    title: "遇见",
    artist: "孙燕姿",
    artwork: "https://is1-ssl.mzstatic.com/image/thumb/Music/15/ca/82/mzi.fsgrhyyg.jpg/100x100bb.jpg",
  },
  {
    title: "海阔天空",
    artist: "Beyond",
    artwork:
      "https://is1-ssl.mzstatic.com/image/thumb/Features124/v4/9f/6d/62/9f6d62cd-c6fd-1037-fe9b-df8d6d752a3c/dj.isfwsfsf.jpg/100x100bb.jpg",
  },
  {
    title: "蓝莲花",
    artist: "许巍",
    artwork: "https://is1-ssl.mzstatic.com/image/thumb/Music69/v4/3a/88/3a/3a883ac8-0e9c-b892-9f6d-d56f8781b53d/dj.jyjfitio.jpg/100x100bb.jpg",
  },
  {
    title: "爱很简单",
    artist: "陶喆",
    artwork:
      "https://is1-ssl.mzstatic.com/image/thumb/Music125/v4/dd/bb/bd/ddbbbda1-9408-72b2-4c0b-943e648be6c1/190295574086.jpg/100x100bb.jpg",
  },
  {
    title: "平凡之路",
    artist: "朴树",
    artwork: "https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/63/f8/5f/63f85f7c-62f3-9501-2744-9cca6697ee18/cover.jpg/100x100bb.jpg",
  },
  {
    title: "后来",
    artist: "刘若英",
    artwork: "https://is1-ssl.mzstatic.com/image/thumb/Music6/v4/35/fd/2e/35fd2ef0-83c1-58dc-924b-553f04fb0104/dj.cozpisse.jpg/100x100bb.jpg",
  },
  {
    title: "可惜不是你",
    artist: "梁静茹",
    artwork:
      "https://is1-ssl.mzstatic.com/image/thumb/Features125/v4/ac/26/c6/ac26c690-047f-4058-bdb7-4383431b1693/dj.hlocweys.jpg/100x100bb.jpg",
  },
  {
    title: "唯一",
    artist: "王力宏",
    artwork: "https://is1-ssl.mzstatic.com/image/thumb/Music124/v4/48/fd/2f/48fd2fe5-31b2-d979-53a4-9aebf5175bdb/mzi.biqraozb.jpg/100x100bb.jpg",
  },
  {
    title: "新不了情",
    artist: "万芳",
    artwork: "https://is1-ssl.mzstatic.com/image/thumb/Music124/v4/79/93/ba/7993ba3c-5913-a076-5d7e-b90f12d74349/dj.wschqvhi.jpg/100x100bb.jpg",
  },
  {
    title: "童话",
    artist: "光良",
    artwork: "https://is1-ssl.mzstatic.com/image/thumb/Music125/v4/e8/d1/46/e8d146b6-de00-8135-9eca-e9123635a4a9/mzm.vcrwixfk.jpg/100x100bb.jpg",
  },
  {
    title: "倒带",
    artist: "蔡依林",
    artwork: "https://is1-ssl.mzstatic.com/image/thumb/Music/v4/e5/57/87/e55787b1-54d0-0c37-d72d-0f56c74f19e7/886443625020.jpg/100x100bb.jpg",
  },
  {
    title: "听海",
    artist: "张惠妹",
    artwork: "https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/be/24/8e/be248eba-cbbc-1868-01ad-9a0d723f6680/cover.jpg/100x100bb.jpg",
  },
  {
    title: "独家记忆",
    artist: "陈小春",
    artwork: "https://is1-ssl.mzstatic.com/image/thumb/Music118/v4/9c/42/61/9c42615a-9104-88be-e0c3-503fce373af7/00602517739727.rgb.jpg/100x100bb.jpg",
  },
  {
    title: "隐形的翅膀",
    artist: "张韶涵",
    artwork: "https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/c5/da/11/c5da111d-084e-cd46-d413-ab12685423de/4717398702138.jpg/100x100bb.jpg",
  },
  {
    title: "爱我别走",
    artist: "张震岳",
    artwork: "https://is1-ssl.mzstatic.com/image/thumb/Music69/v4/fb/02/6a/fb026a2d-30fb-6e79-d249-e5fb86f75c1c/ROD-5274.jpg/100x100bb.jpg",
  },
  {
    title: "至少还有你",
    artist: "林忆莲",
    artwork: "https://is1-ssl.mzstatic.com/image/thumb/Music125/v4/f3/7f/38/f37f3817-a8f6-8471-65ec-d5fc58800ec1/825646246632.jpg/100x100bb.jpg",
  },
  {
    title: "黄昏",
    artist: "周传雄",
    artwork: "https://is1-ssl.mzstatic.com/image/thumb/Features125/v4/7f/86/09/7f86091b-bba1-7a6f-3d18-2791314c7e9f/dj.oujbidjn.jpg/100x100bb.jpg",
  },
  {
    title: "说谎",
    artist: "林宥嘉",
    artwork: "https://is1-ssl.mzstatic.com/image/thumb/Music124/v4/57/e5/9b/57e59bd6-3564-e4c4-1add-e3dbbf4d8ab1/asset.jpg/100x100bb.jpg",
  },
  {
    title: "成都",
    artist: "赵雷",
    artwork: "https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/7e/e8/ac/7ee8ac29-c347-71cb-0a8a-6d841ee385b3/6976364784969.jpg/100x100bb.jpg",
  },
  {
    title: "夜空中最亮的星",
    artist: "逃跑计划",
    artwork: "https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/dc/85/ab/dc85ab94-26c9-5f50-3c89-d9a95b22ca1c/2910029.jpg/100x100bb.jpg",
  },
  {
    title: "泡沫",
    artist: "邓紫棋",
    artwork: "https://is1-ssl.mzstatic.com/image/thumb/Music/v4/c2/93/36/c2933614-7d2b-9ea2-2d16-6a8cbee287c2/887158384615_Cover.jpg/100x100bb.jpg",
  },
  {
    title: "消愁",
    artist: "毛不易",
    artwork: "https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/09/71/70/09717058-6e6d-b1a2-5bd0-dc8932d76f2a/4894944725954.jpg/100x100bb.jpg",
  },
  {
    title: "你怎么舍得我难过",
    artist: "黄品源",
    artwork: "https://is1-ssl.mzstatic.com/image/thumb/Music/v4/b4/da/d7/b4dad787-7f42-e597-8ba6-92beaa3a4c93/RD-1790.jpg/100x100bb.jpg",
  },
  {
    title: "红色高跟鞋",
    artist: "蔡健雅",
    artwork: "https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/f3/f4/c9/f3f4c9cc-1af9-8595-0834-63c719b4cb92/asset.jpg/100x100bb.jpg",
  },
  {
    title: "小幸运",
    artist: "田馥甄",
    artwork: "https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/69/87/7f/69877fbc-cd2c-bb9b-2397-5f3ed14a04a8/Hebe_Little_Happiness_1400.jpg/100x100bb.jpg",
  },
  {
    title: "年轮",
    artist: "张碧晨",
    artwork: "https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/b2/7c/5e/b27c5e6e-f841-216f-5062-520e64b01a8d/EP-NL.jpg/100x100bb.jpg",
  },
  {
    title: "年少有为",
    artist: "李荣浩",
    artwork: "https://is1-ssl.mzstatic.com/image/thumb/Music125/v4/43/00/33/4300338e-c6bb-0a7c-6a63-41e9b0630701/190295575922.jpg/100x100bb.jpg",
  },
  {
    title: "齐天",
    artist: "华晨宇",
    artwork: "https://is1-ssl.mzstatic.com/image/thumb/Music116/v4/14/79/de/1479de13-4112-8e4c-9847-6129a6605541/4894894509185.jpg/100x100bb.jpg",
  },
  {
    title: "大鱼",
    artist: "周深",
    artwork: "https://is1-ssl.mzstatic.com/image/thumb/Music125/v4/d0/f6/f2/d0f6f22d-1a6d-945f-0d0c-47dc5111a483/cover.jpg/100x100bb.jpg",
  },
  {
    title: "这，就是爱",
    artist: "张杰",
    artwork: "https://is1-ssl.mzstatic.com/image/thumb/Music112/v4/ff/d6/14/ffd614eb-9c9b-8338-a0f4-f0a960c61dc5/4894894508348.jpg/100x100bb.jpg",
  },
  {
    title: "演员",
    artist: "薛之谦",
    artwork: "https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/b0/09/04/b009043f-f576-54ce-5b1f-d7896d6933c0/9555150772273.jpg/100x100bb.jpg",
  },
  {
    title: "这世界那么多人",
    artist: "莫文蔚",
    artwork: "https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/a4/63/38/a4633883-727f-581e-8a11-862fdc29ccac/cover.jpg/100x100bb.jpg",
  },
  {
    title: "朋友",
    artist: "周华健",
    artwork: "https://is1-ssl.mzstatic.com/image/thumb/Features125/v4/a3/b4/49/a3b44940-9cdf-618b-41b5-e1ec8265afe4/dj.tcffrslk.jpg/100x100bb.jpg",
  },
  {
    title: "心太软",
    artist: "任贤齐",
    artwork: "https://is1-ssl.mzstatic.com/image/thumb/Music112/v4/d1/64/d3/d164d302-4e4b-b0cc-c9fc-1757c579af46/4710149613332_cover.jpg/100x100bb.jpg",
  },
  {
    title: "情非得已",
    artist: "庾澄庆",
    artwork: "https://is1-ssl.mzstatic.com/image/thumb/Music124/v4/b2/49/44/b24944a5-28a5-ffe9-a852-f3d5cdfc8054/mzi.mcskqzfu.jpg/100x100bb.jpg",
  },
  {
    title: "当爱已成往事",
    artist: "张国荣",
    artwork:
      "https://is1-ssl.mzstatic.com/image/thumb/Features124/v4/ba/fc/0a/bafc0a80-40ba-f919-0f9a-36d2346f6866/dj.hfqcftay.jpg/100x100bb.jpg",
  },
  {
    title: "夕阳之歌",
    artist: "梅艳芳",
    artwork:
      "https://is1-ssl.mzstatic.com/image/thumb/Music124/v4/b0/5c/33/b05c3360-33e4-1f41-d004-8479a2d2d0ac/825646271818.jpg/100x100bb.jpg",
  },
  {
    title: "可惜我是水瓶座",
    artist: "杨千嬅",
    artwork:
      "https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/fd/1f/80/fd1f8020-a7c9-48ed-9950-ea08439a6b1c/00602527304991.rgb.jpg/100x100bb.jpg",
  },
  {
    title: "爱如潮水",
    artist: "张信哲",
    artwork:
      "https://is1-ssl.mzstatic.com/image/thumb/Music124/v4/98/fd/e8/98fde8f3-1ff6-d037-6053-b051461468ce/886444716215.jpg/100x100bb.jpg",
  },
  {
    title: "领悟",
    artist: "辛晓琪",
    artwork:
      "https://is1-ssl.mzstatic.com/image/thumb/Features/v4/29/9e/67/299e67f4-98c8-3e39-61ef-0ee72534a120/dj.yxvobgjn.jpg/100x100bb.jpg",
  },
  {
    title: "挪威的森林",
    artist: "伍佰",
    artwork:
      "https://is1-ssl.mzstatic.com/image/thumb/Features115/v4/f6/7f/e2/f67fe262-8303-d556-2284-541ee5e1e703/dj.fwydjubj.jpg/100x100bb.jpg",
  },
  {
    title: "爱的代价",
    artist: "张艾嘉",
    artwork:
      "https://is1-ssl.mzstatic.com/image/thumb/Features/v4/2f/8f/5b/2f8f5bd4-d6ea-b66c-f653-87701706ae95/dj.xyliymws.jpg/100x100bb.jpg",
  },
  {
    title: "最熟悉的陌生人",
    artist: "萧亚轩",
    artwork:
      "https://is1-ssl.mzstatic.com/image/thumb/Music4/v4/45/6c/72/456c72e2-54b4-ae1e-9365-0ee6bd8cfff4/825646245505.jpg/100x100bb.jpg",
  },
  {
    title: "身骑白马",
    artist: "徐佳莹",
    artwork:
      "https://is1-ssl.mzstatic.com/image/thumb/Music6/v4/43/52/5e/43525e86-9c47-cb57-5ca5-a374aa7afa40/LaLa.jpg/100x100bb.jpg",
  },
  {
    title: "恋曲1990",
    artist: "罗大佑",
    artwork:
      "https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/1b/a8/56/1ba8560d-a426-255d-a68c-561fad7dc3bc/cover.jpg/100x100bb.jpg",
  },
  {
    title: "用心良苦",
    artist: "张宇",
    artwork:
      "https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/1a/5a/e7/1a5ae768-3974-49aa-5d7a-d37a0f9fd58d/contsched.etxishtg.jpg/100x100bb.jpg",
  },
  {
    title: "特别的爱给特别的你",
    artist: "伍思凯",
    artwork:
      "https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/2f/60/8d/2f608d63-99d9-b4c6-6c75-8528a00445ef/cover.jpg/100x100bb.jpg",
  },
  {
    title: "小情歌",
    artist: "苏打绿",
    artwork:
      "https://is1-ssl.mzstatic.com/image/thumb/Music116/v4/ca/24/73/ca247344-65c2-5bb3-c722-6c7308a222c1/22UMGIM08913.rgb.jpg/100x100bb.jpg",
  },
  {
    title: "被风吹过的夏天",
    artist: "金莎",
    artwork:
      "https://is1-ssl.mzstatic.com/image/thumb/Music124/v4/4e/a8/3e/4ea83ed5-2a4d-eaa8-abfc-15d3e95346da/fengmian_2.jpg/100x100bb.jpg",
  },
  {
    title: "他一定很爱你",
    artist: "阿杜",
    artwork:
      "https://is1-ssl.mzstatic.com/image/thumb/Music125/v4/98/2c/1d/982c1dc2-54ed-89af-046a-0bb49853fcea/fengmian.jpg/100x100bb.jpg",
  },
] as const;

type PreviewSong = (typeof MANDOPOP_PREVIEW_POOL)[number];

const HOME_PREVIEW_STORAGE_KEY = "songshare-home-preview-rows:v3";
const HOME_PREVIEW_ROW_COUNT = 3;
const HOME_PREVIEW_ROW_LENGTH = 8;

function getPreviewArtworkUrl(url: string) {
  return url.replace(/\/100x100bb\.jpg$/, "/360x360bb.jpg");
}

function readCachedPreviewRows() {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.sessionStorage.getItem(HOME_PREVIEW_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== HOME_PREVIEW_ROW_COUNT) return null;

    const rows = parsed
      .map((row) => {
        if (!Array.isArray(row) || row.length !== HOME_PREVIEW_ROW_LENGTH) return null;
        const nextRow = row.filter(
          (item): item is PreviewSong =>
            Boolean(
              item &&
                typeof item === "object" &&
                typeof (item as { title?: unknown }).title === "string" &&
                typeof (item as { artist?: unknown }).artist === "string" &&
                typeof (item as { artwork?: unknown }).artwork === "string"
            )
        );
        return nextRow.length === HOME_PREVIEW_ROW_LENGTH ? nextRow : null;
      })
      .filter((row): row is PreviewSong[] => Array.isArray(row));

    return rows.length === HOME_PREVIEW_ROW_COUNT ? rows : null;
  } catch {
    return null;
  }
}

function writeCachedPreviewRows(rows: readonly PreviewSong[][]) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(HOME_PREVIEW_STORAGE_KEY, JSON.stringify(rows));
  } catch {
    // ignore cache write errors
  }
}

function shuffleSongs() {
  const shuffled = [...MANDOPOP_PREVIEW_POOL];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function buildPreviewRows() {
  const shuffled = shuffleSongs();
  const targetCount = HOME_PREVIEW_ROW_COUNT * HOME_PREVIEW_ROW_LENGTH;
  const selected: PreviewSong[] = [];

  while (selected.length < targetCount) {
    const next = shuffled[selected.length % shuffled.length];
    if (!next) break;
    selected.push(next);
  }

  return Array.from({ length: HOME_PREVIEW_ROW_COUNT }, (_, rowIndex) =>
    selected.slice(
      rowIndex * HOME_PREVIEW_ROW_LENGTH,
      (rowIndex + 1) * HOME_PREVIEW_ROW_LENGTH
    )
  );
}

export default function HomeKindEntry() {
  const [previewRows] = useState<readonly PreviewSong[][]>(() =>
    readCachedPreviewRows() ?? buildPreviewRows()
  );

  useEffect(() => {
    if (previewRows.length === HOME_PREVIEW_ROW_COUNT) {
      writeCachedPreviewRows(previewRows);
    }
  }, [previewRows]);

  useEffect(() => {
    void primeSongRecommendationClientCache("song");
  }, []);

  return (
    <main className="relative isolate h-[100svh] overflow-hidden px-3 py-3 text-foreground sm:min-h-screen sm:px-4 sm:py-6">
      <MusicBackdrop compact />
      <div className="relative z-10 mx-auto flex h-full w-full max-w-[430px] flex-col">
        <MusicPanel className="flex h-full min-h-0 flex-col gap-4 px-4 py-4 sm:gap-5 sm:p-6">
          <div className="space-y-2 sm:space-y-3">
            <p className="music-kicker">Song Grid</p>
            <h1 className="text-[2.8rem] font-black leading-[0.92] text-foreground sm:text-[3.2rem]">
              我的歌单
              <span className="music-accent-text block">你听吗</span>
            </h1>
            <p className="text-[13px] leading-5 text-muted-foreground sm:text-sm sm:leading-6">
              挑 1 到 9 首，发给刚好会听的人。
            </p>
          </div>

          <div className="music-grid-shell min-h-0 flex-1 overflow-hidden rounded-[1.65rem] p-3 sm:rounded-[1.8rem] sm:p-4">
            <div className="flex h-full min-h-0 flex-col gap-2">
              {previewRows.map((row, rowIndex) => {
                const duplicatedRow = [...row, ...row];
                return (
                  <div key={`row-${rowIndex}`} className="music-marquee-row min-h-0 flex-1">
                    <div
                      className="music-marquee-track"
                      style={{
                        ["--marquee-duration" as string]: `${18 + rowIndex * 2}s`,
                        ["--marquee-direction" as string]: rowIndex === 1 ? "reverse" : "normal",
                      }}
                    >
                      {duplicatedRow.map((song, songIndex) => (
                        <div
                          key={`${rowIndex}-${song.artist}-${song.title}-${songIndex}`}
                          className="music-grid-slot music-marquee-card relative flex h-full overflow-hidden text-left"
                          aria-hidden={songIndex >= row.length}
                        >
                          <img
                            src={getPreviewArtworkUrl(song.artwork)}
                            alt={`${song.artist} - ${song.title}`}
                            className="absolute inset-0 h-full w-full object-cover"
                            loading={rowIndex === 0 ? "eager" : "lazy"}
                            decoding="async"
                            fetchPriority={rowIndex === 0 ? "high" : "low"}
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-black/0" />
                          <div className="relative mt-auto space-y-0.5 p-2.5 pt-7 text-white">
                            <p className="line-clamp-2 text-[0.72rem] font-semibold leading-[1.08] drop-shadow-[0_1px_2px_rgba(0,0,0,0.25)]">
                              {song.title}
                            </p>
                            <p className="truncate text-[0.58rem] font-medium leading-[1.08] text-white/82">
                              {song.artist}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <Button asChild size="lg" className="w-full shrink-0">
            <Link href="/song" prefetch={false}>
              开始选歌
            </Link>
          </Button>
        </MusicPanel>
      </div>
    </main>
  );
}
