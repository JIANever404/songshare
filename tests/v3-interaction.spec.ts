import { expect, test, type Page } from "@playwright/test";

const SHARE_ID = "60fe04cbe7874fa2";
const DERIVED_SHARE_ID = "91ab22e145ad4cd0";
const ONE_PIXEL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9YxX5iQAAAAASUVORK5CYII=";

type MockSong = {
  id: number;
  entryId?: string;
  name: string;
  localizedName: string;
  cover: string;
  releaseYear: number;
  genres: string[];
  storeUrls: {
    apple: string;
  };
};

type MockShareState = {
  kind: "song";
  creatorName: string | null;
  shareMessage: string | null;
  games: Array<MockSong | null>;
};

type PreviewHandler = (params: {
  title: string;
  artist: string;
}) => Promise<Record<string, unknown>>;

function createSong(id: number, title: string, artist: string, releaseYear: number): MockSong {
  return {
    id,
    name: artist,
    localizedName: title,
    cover: `https://is1-ssl.mzstatic.com/image/thumb/Music123/v4/mock/${id}/cover/300x300bb.jpg`,
    releaseYear,
    genres: ["Mandopop"],
    storeUrls: {
      apple: `https://music.apple.com/cn/song/${encodeURIComponent(title)}/${id}`,
    },
  };
}

const SONG_FIXTURES: MockSong[] = [
  createSong(101, "稻香", "周杰伦", 2008),
  createSong(102, "富士山下", "陈奕迅", 2006),
  createSong(103, "红豆", "王菲", 1998),
  createSong(104, "后来", "刘若英", 1999),
  createSong(105, "晴天", "周杰伦", 2003),
  createSong(106, "明明就", "周杰伦", 2012),
  createSong(107, "花海", "周杰伦", 2008),
  createSong(108, "夜曲", "周杰伦", 2005),
  createSong(109, "一路向北", "周杰伦", 2005),
];

function cloneSong(song: MockSong): MockSong {
  return {
    ...song,
    genres: [...song.genres],
    storeUrls: { ...song.storeUrls },
  };
}

function withEntryIds(games: Array<MockSong | null>, shareId: string) {
  return games.map((game, index) => {
    if (!game) return null;
    return {
      ...cloneSong(game),
      entryId: game.entryId ?? `${shareId}-entry-${index + 1}`,
    };
  });
}

function cloneGames(games: Array<MockSong | null>) {
  return games.map((game) => (game ? cloneSong(game) : null));
}

function padGames(games: Array<MockSong | null>) {
  if (games.length >= 9) {
    return cloneGames(games.slice(0, 9));
  }
  return [...cloneGames(games), ...Array.from({ length: 9 - games.length }, () => null)];
}

function createInitialShareState(): MockShareState {
  return {
    kind: "song",
    creatorName: "测试玩家",
    shareMessage: "留给你的三首歌",
    games: withEntryIds(padGames(SONG_FIXTURES.slice(0, 3)), SHARE_ID),
  };
}

function buildShareStateSignature(state: MockShareState) {
  return JSON.stringify({
    kind: state.kind,
    creatorName: state.creatorName,
    shareMessage: state.shareMessage,
    games: state.games.map((game) =>
      game
        ? {
            id: game.id,
            entryId: game.entryId ?? null,
            name: game.name,
            localizedName: game.localizedName,
          }
        : null
    ),
  });
}

function buildSongSearchResponse(query: string) {
  const normalized = query.trim().toLowerCase();
  const matched = SONG_FIXTURES.filter((song) => {
    return (
      song.localizedName.toLowerCase().includes(normalized) ||
      song.name.toLowerCase().includes(normalized)
    );
  });
  const items = matched.length > 0 ? matched : [createSong(9000 + normalized.length, query, "测试歌手", 2024)];

  return {
    ok: true,
    source: "itunes" as const,
    kind: "song",
    items: items.map((song) => cloneSong(song)),
    noResultQuery: null,
  };
}

function buildPreviewResponse(title: string, artist: string) {
  return {
    ok: true,
    source: "itunes",
    query: `${artist} ${title}`.trim(),
    preview: {
      id: `${artist}-${title}`,
      title,
      artist,
      cover: SONG_FIXTURES.find((song) => song.localizedName === title)?.cover ?? null,
      previewUrl: `https://example.com/previews/${encodeURIComponent(`${artist}-${title}`)}.m4a`,
      appleUrl: `https://music.apple.com/cn/search?term=${encodeURIComponent(`${artist} ${title}`)}`,
    },
    noResultQuery: null,
  };
}

function buildRecommendationResponse() {
  return {
    ok: true,
    source: "apple-charts" as const,
    kind: "song" as const,
    items: SONG_FIXTURES.slice(0, 9).map((song, index) => ({
      ...cloneSong(song),
      chartStorefront: index < 6 ? "cn" : "us",
      chartRank: index + 1,
      isHot: index < 4,
    })),
  };
}

async function installClientSpies(page: Page) {
  await page.addInitScript(() => {
    type MockAudioState = {
      paused: boolean;
      currentTime: number;
      duration: number;
      volume: number;
      readyState: number;
      ended: boolean;
    };

    const g = window as typeof window & {
      __clipboardWrites?: string[];
      __clipboardFail?: boolean;
      __SONGSHARE_LAST_DOWNLOAD_NAME__?: string;
      __SONGSHARE_ORIGINAL_ANCHOR_SET_ATTRIBUTE__?: typeof HTMLAnchorElement.prototype.setAttribute;
    };

    g.__clipboardWrites = [];
    g.__clipboardFail = false;

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          if (g.__clipboardFail) {
            throw new Error("clipboard_failed");
          }
          g.__clipboardWrites!.push(text);
        },
      },
    });

    if (!g.__SONGSHARE_ORIGINAL_ANCHOR_SET_ATTRIBUTE__) {
      g.__SONGSHARE_ORIGINAL_ANCHOR_SET_ATTRIBUTE__ = HTMLAnchorElement.prototype.setAttribute;
      HTMLAnchorElement.prototype.setAttribute = function (name: string, value: string) {
        if (name === "download") {
          g.__SONGSHARE_LAST_DOWNLOAD_NAME__ = value;
        }
        return g.__SONGSHARE_ORIGINAL_ANCHOR_SET_ATTRIBUTE__!.call(this, name, value);
      };
    }

    const mediaStates = new WeakMap<HTMLMediaElement, MockAudioState>();
    const ensureState = (media: HTMLMediaElement): MockAudioState => {
      const current = mediaStates.get(media);
      if (current) return current;
      const next: MockAudioState = {
        paused: true,
        currentTime: 0,
        duration: 30,
        volume: 1,
        readyState: 4,
        ended: false,
      };
      mediaStates.set(media, next);
      return next;
    };
    const defineMediaProperty = (
      name: string,
      descriptor: PropertyDescriptor
    ) => {
      try {
        Object.defineProperty(HTMLMediaElement.prototype, name, {
          configurable: true,
          ...descriptor,
        });
      } catch {
        // ignore descriptor override failures in browser internals
      }
    };

    defineMediaProperty("paused", {
      get(this: HTMLMediaElement) {
        return ensureState(this).paused;
      },
    });
    defineMediaProperty("currentTime", {
      get(this: HTMLMediaElement) {
        return ensureState(this).currentTime;
      },
      set(this: HTMLMediaElement, value: number) {
        ensureState(this).currentTime = value;
      },
    });
    defineMediaProperty("duration", {
      get(this: HTMLMediaElement) {
        return ensureState(this).duration;
      },
      set(this: HTMLMediaElement, value: number) {
        ensureState(this).duration = value;
      },
    });
    defineMediaProperty("volume", {
      get(this: HTMLMediaElement) {
        return ensureState(this).volume;
      },
      set(this: HTMLMediaElement, value: number) {
        ensureState(this).volume = value;
      },
    });
    defineMediaProperty("readyState", {
      get(this: HTMLMediaElement) {
        return ensureState(this).readyState;
      },
    });
    defineMediaProperty("ended", {
      get(this: HTMLMediaElement) {
        return ensureState(this).ended;
      },
    });

    try {
      Object.defineProperty(HTMLMediaElement.prototype, "play", {
        configurable: true,
        value: function (this: HTMLMediaElement) {
          const state = ensureState(this);
          state.paused = false;
          state.ended = false;
          this.dispatchEvent(new Event("play"));
          return Promise.resolve();
        },
      });
    } catch {
      // ignore override failures
    }

    try {
      Object.defineProperty(HTMLMediaElement.prototype, "pause", {
        configurable: true,
        value: function (this: HTMLMediaElement) {
          const state = ensureState(this);
          const wasPaused = state.paused;
          state.paused = true;
          if (!wasPaused) {
            this.dispatchEvent(new Event("pause"));
          }
        },
      });
    } catch {
      // ignore override failures
    }
  });
}

async function mockSongApis(
  page: Page,
  options?: {
    initialState?: MockShareState;
    previewHandler?: PreviewHandler;
  }
) {
  const initialState = options?.initialState ?? createInitialShareState();
  const shareSnapshots = new Map<string, MockShareState>([
    [
      SHARE_ID,
      {
        kind: initialState.kind,
        creatorName: initialState.creatorName,
        shareMessage: initialState.shareMessage,
        games: cloneGames(initialState.games),
      },
    ],
  ]);
  const calls = {
    sharePostCount: 0,
  };
  let hasLoadedExistingShare = false;

  await page.route(/https:\/\/wsrv\.nl\/\?url=/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "image/png",
      body: Buffer.from(ONE_PIXEL_PNG_BASE64, "base64"),
    });
  });

  await page.route(/\/api\/subjects\/search\?/, async (route) => {
    const url = new URL(route.request().url());
    const query = (url.searchParams.get("q") || "").trim();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(buildSongSearchResponse(query)),
    });
  });

  await page.route(/\/api\/song\/recommendations(\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(buildRecommendationResponse()),
    });
  });

  await page.route(/\/api\/share(\?.*)?$/, async (route) => {
    const request = route.request();

    if (request.method() === "POST") {
      calls.sharePostCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 120));
      const body = request.postDataJSON() as {
        kind?: "song";
        creatorName?: string | null;
        shareMessage?: string | null;
        games?: Array<MockSong | null>;
      };
      const draftState: MockShareState = {
        kind: "song",
        creatorName: typeof body.creatorName === "string" ? body.creatorName : null,
        shareMessage: typeof body.shareMessage === "string" ? body.shareMessage : null,
        games: padGames(Array.isArray(body.games) ? body.games : []),
      };
      const existingShareState = shareSnapshots.get(SHARE_ID) ?? initialState;
      const nextShareId =
        hasLoadedExistingShare &&
        buildShareStateSignature(draftState) !== buildShareStateSignature(existingShareState)
          ? DERIVED_SHARE_ID
          : SHARE_ID;
      const nextState: MockShareState = {
        kind: draftState.kind,
        creatorName: draftState.creatorName,
        shareMessage: draftState.shareMessage,
        games: withEntryIds(padGames(Array.isArray(body.games) ? body.games : []), nextShareId),
      };
      shareSnapshots.set(nextShareId, nextState);

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          kind: nextState.kind,
          shareId: nextShareId,
          shareUrl: `http://localhost:3001/${nextState.kind}/s/${nextShareId}`,
          deduped: false,
        }),
      });
      return;
    }

    const url = new URL(request.url());
    const id = url.searchParams.get("id");
    if (id === SHARE_ID) {
      hasLoadedExistingShare = true;
    }
    const state = id ? shareSnapshots.get(id) : null;
    if (!state || !id) {
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: "分享不存在" }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        kind: state.kind,
        shareId: id,
        creatorName: state.creatorName,
        shareMessage: state.shareMessage,
        games: cloneGames(state.games),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastViewedAt: Date.now(),
      }),
    });
  });

  await page.route(/\/api\/song\/preview\?/, async (route) => {
    const url = new URL(route.request().url());
    const title = (url.searchParams.get("title") || "").trim();
    const artist = (url.searchParams.get("artist") || "").trim();
    const payload = options?.previewHandler
      ? await options.previewHandler({ title, artist })
      : buildPreviewResponse(title, artist);

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(payload),
    });
  });

  return calls;
}

async function addSong(page: Page, query: string) {
  await page.getByRole("button", { name: "添加歌曲" }).click();
  const searchInput = page.getByRole("combobox", { name: "歌曲搜索输入框" });
  await expect(searchInput).toBeVisible();
  await searchInput.fill(query);
  await searchInput.press("Enter");

  const firstResult = page.locator("#search-results-list button").first();
  await expect(firstResult).toBeVisible();
  await firstResult.click();
  await expect(searchInput).toHaveCount(0);
}

async function readVisibleSongTitles(page: Page) {
  return page.locator("article h3").evaluateAll((nodes) => {
    return nodes
      .map((node) => node.textContent?.trim() || "")
      .filter((text) => Boolean(text));
  });
}

async function dragSongCard(
  page: Page,
  sourceTitle: string,
  targetTitle: string,
  options?: { targetOffsetYFactor?: number }
) {
  const source = page.locator("article").filter({ hasText: sourceTitle }).first();
  const target = page.locator("article").filter({ hasText: targetTitle }).first();
  await expect(source).toBeVisible();
  await expect(target).toBeVisible();

  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  if (!sourceBox || !targetBox) {
    throw new Error("drag target not visible");
  }

  const sourceX = sourceBox.x + sourceBox.width / 2;
  const sourceY = sourceBox.y + sourceBox.height / 2;
  const targetX = targetBox.x + targetBox.width / 2;
  const targetY = targetBox.y + targetBox.height * (options?.targetOffsetYFactor ?? 0.35);

  await page.mouse.move(sourceX, sourceY);
  await page.mouse.down();
  await page.waitForTimeout(260);
  await page.mouse.move(targetX, targetY, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(180);
}

async function readClipboardWrites(page: Page) {
  return page.evaluate(() => {
    const g = window as typeof window & { __clipboardWrites?: string[] };
    return g.__clipboardWrites || [];
  });
}

async function readShareExportInfo(page: Page) {
  return page.evaluate(() => {
    const g = window as typeof window & {
      __SONGSHARE_LAST_SHARE_EXPORT__?: {
        width: number;
        height: number;
        mode?: string;
        visibleCoverEntryIds?: string[];
      };
    };
    return g.__SONGSHARE_LAST_SHARE_EXPORT__ || null;
  });
}

test.describe("song share interaction", () => {
  test.beforeEach(async ({ page }) => {
    await installClientSpies(page);
  });

  test("首页可进入当前歌曲填写页", async ({ page }) => {
    await mockSongApis(page);
    await page.goto("/");

    await expect(page.getByRole("heading", { name: /我的歌单/ })).toBeVisible();
    await expect(page.getByText("挑 1 到 9 首，发给刚好会听的人。")).toBeVisible();
    await expect(page.getByRole("link", { name: "开始选歌" })).toBeVisible();

    await page.getByRole("link", { name: "开始选歌" }).click();

    await expect(page).toHaveURL("/song", { timeout: 30_000 });
    await expect(page.getByText("Song Share")).toBeVisible();
    await expect(page.getByRole("heading", { name: "我的歌单你听吗" })).toBeVisible();
    await expect(page.getByRole("button", { name: "先选一首歌" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "添加歌曲" })).toBeVisible();
  });

  test("歌曲填写页直接进入正式分享页，并复用当前正式链接", async ({ page }) => {
    const apiCalls = await mockSongApis(page);
    await page.goto("/song");

    await page.getByPlaceholder("输入你的昵称").fill("阿泽");
    await page.getByPlaceholder("这是我精心挑选的歌，分享给你听").fill("这两首最近循环很多");

    await addSong(page, "稻香");
    await addSong(page, "富士山下");

    await expect(page.locator("article").filter({ hasText: "稻香" }).first()).toBeVisible();
    await expect(page.locator("article").filter({ hasText: "富士山下" }).first()).toBeVisible();
    await expect(page.getByText("2 首", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "生成分享页" })).toBeEnabled();

    await page.getByRole("button", { name: "生成分享页" }).click();

    await expect(page).toHaveURL(`/song/s/${SHARE_ID}`, { timeout: 30_000 });
    expect(apiCalls.sharePostCount).toBe(1);
    await expect(page.getByRole("heading", { name: "阿泽分享给你2首歌" })).toBeVisible();
    await expect(page.getByText("这两首最近循环很多")).toBeVisible();
    await expect(page.getByRole("button", { name: "生成分享链接" })).toBeVisible();
    await expect(page.getByRole("button", { name: "生成分享图片" })).toBeVisible();

    await page.getByRole("button", { name: "生成分享链接" }).click();
    expect(apiCalls.sharePostCount).toBe(1);
    await expect(page.getByRole("button", { name: "已复制到剪贴板" })).toBeVisible();
    const copied = await readClipboardWrites(page);
    expect(copied.some((item) => item.endsWith(`/song/s/${SHARE_ID}`))).toBeTruthy();
    await expect(page).toHaveURL(`/song/s/${SHARE_ID}`);
  });

  test("加歌搜索弹层每次打开都会清空上次关键词，并在空态展示推荐气泡", async ({ page }) => {
    await mockSongApis(page);
    await page.goto("/song");

    await page.getByRole("button", { name: "添加歌曲" }).click();
    const searchInput = page.getByRole("combobox", { name: "歌曲搜索输入框" });
    await expect(searchInput).toBeVisible();
    await expect(page.getByTestId("search-recommendations")).toBeVisible();
    await searchInput.fill("稻香");
    await page.getByRole("button", { name: "关闭" }).click();
    await expect(searchInput).toHaveCount(0);

    await page.getByRole("button", { name: "添加歌曲" }).click();
    const reopenedInput = page.getByRole("combobox", { name: "歌曲搜索输入框" });
    await expect(reopenedInput).toHaveValue("");
    await expect(page.getByTestId("search-recommendations")).toBeVisible();
  });

  test("空搜索态点击推荐气泡可快速添加歌曲", async ({ page }) => {
    await mockSongApis(page);
    await page.goto("/song");

    await page.getByRole("button", { name: "添加歌曲" }).click();
    await expect(page.getByTestId("search-recommendations")).toBeVisible();
    const recommendationBubble = page
      .getByTestId("search-recommendation-bubble")
      .filter({ hasText: "稻香" })
      .first();
    await recommendationBubble.evaluate((element) => {
      (element as HTMLButtonElement).click();
    });

    await expect(page.getByRole("combobox", { name: "歌曲搜索输入框" })).toHaveCount(0);
    await expect(page.locator("article").filter({ hasText: "稻香" }).first()).toBeVisible();
  });

  test("歌曲填写页支持拖动调整顺序，删除后序号会重算并带入正式分享页", async ({ page }) => {
    await mockSongApis(page);
    await page.goto("/song");

    await addSong(page, "稻香");
    await addSong(page, "富士山下");
    await addSong(page, "红豆");

    await dragSongCard(page, "富士山下", "稻香", { targetOffsetYFactor: 0.2 });

    await expect(page.locator("article").nth(0)).toContainText("富士山下");
    await expect(page.locator("article").nth(1)).toContainText("稻香");
    await expect(page.locator("article").nth(2)).toContainText("红豆");

    await page.getByRole("button", { name: "移除第 1 首歌曲" }).click();

    await expect(page.locator("article").nth(0)).toContainText("稻香");
    await expect(page.locator("article").nth(1)).toContainText("红豆");
    await expect(page.getByRole("button", { name: "替换第 2 首歌曲" })).toBeVisible();

    await page.getByRole("button", { name: "替换第 2 首歌曲" }).click();
    const searchInput = page.getByRole("combobox", { name: "歌曲搜索输入框" });
    await searchInput.fill("后来");
    await searchInput.press("Enter");
    await page.locator("#search-results-list button").first().click();
    await expect(searchInput).toHaveCount(0);

    const titles = await readVisibleSongTitles(page);
    expect(titles.slice(0, 2)).toEqual(["稻香 (2008)", "后来 (1999)"]);

    await page.getByRole("button", { name: "生成分享页" }).click();
    await expect(page).toHaveURL(`/song/s/${SHARE_ID}`, { timeout: 30_000 });
    await expect(page.locator("article").nth(0)).toContainText("稻香");
    await expect(page.locator("article").nth(1)).toContainText("后来");
  });

  test("歌曲分享页支持复用原链接，并在拖动后复制新链接", async ({ page }) => {
    const apiCalls = await mockSongApis(page);
    await page.goto(`/song/s/${SHARE_ID}`);

    await expect(page.getByRole("heading", { name: "测试玩家分享给你3首歌" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole("button", { name: "生成分享链接" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "生成分享图片" })).toBeEnabled();

    await page.getByRole("button", { name: "生成分享链接" }).click();
    expect(apiCalls.sharePostCount).toBe(0);
    await expect(page.getByRole("button", { name: "已复制到剪贴板" })).toBeVisible();
    const initialCopies = await readClipboardWrites(page);
    expect(initialCopies.some((item) => item.endsWith(`/song/s/${SHARE_ID}`))).toBeTruthy();

    await dragSongCard(page, "红豆", "稻香", { targetOffsetYFactor: 0.2 });
    await expect(page.locator("article").nth(0)).toContainText("红豆");
    await expect(page.locator("article").nth(1)).toContainText("稻香");

    await page.getByRole("button", { name: "生成分享链接" }).click();
    expect(apiCalls.sharePostCount).toBe(1);
    await expect(page.getByRole("button", { name: "已复制到剪贴板" })).toBeVisible();
    const nextCopies = await readClipboardWrites(page);
    expect(nextCopies.some((item) => item.endsWith(`/song/s/${DERIVED_SHARE_ID}`))).toBeTruthy();
  });

  test("分享图片弹层支持拖动虚拟封面位置调整顺序，并在关闭后恢复默认顺序", async ({ page }) => {
    const apiCalls = await mockSongApis(page);
    await page.goto(`/song/s/${SHARE_ID}`);

    await expect(page.getByRole("heading", { name: "测试玩家分享给你3首歌" })).toBeVisible({
      timeout: 15_000,
    });

    await page.getByRole("button", { name: "生成分享图片" }).click();
    expect(apiCalls.sharePostCount).toBe(0);
    await expect(page.getByAltText("分享图片预览")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("share-image-hero-candidate-0")).toBeVisible();
    await expect(page.getByTestId("share-image-hero-candidate-1")).toBeVisible();
    await expect(page.getByTestId("share-image-hero-candidate-2")).toBeVisible();
    await expect(page.getByTestId("share-image-virtual-slot-1")).toBeVisible();
    await expect(page.getByTestId("share-image-virtual-slot-2")).toBeVisible();
    await expect(page.getByTestId("share-image-virtual-slot-3")).toBeVisible();

    const previewImage = page.getByAltText("分享图片预览");
    const initialPreviewSrc = await previewImage.getAttribute("src");
    expect(initialPreviewSrc).toBeTruthy();

    const initialExportInfo = await readShareExportInfo(page);
    expect(initialExportInfo).not.toBeNull();
    expect(initialExportInfo?.visibleCoverEntryIds).toEqual([
      `${SHARE_ID}-entry-1`,
      `${SHARE_ID}-entry-1`,
      `${SHARE_ID}-entry-2`,
      `${SHARE_ID}-entry-3`,
    ]);

    await page.getByTestId("share-image-hero-candidate-1").click();

    await expect
      .poll(async () => {
        const exportInfo = await readShareExportInfo(page);
        return exportInfo?.visibleCoverEntryIds || [];
      })
      .toEqual([
        `${SHARE_ID}-entry-2`,
        `${SHARE_ID}-entry-1`,
        `${SHARE_ID}-entry-2`,
        `${SHARE_ID}-entry-3`,
      ]);

    await expect
      .poll(async () => {
        return await previewImage.getAttribute("src");
      })
      .not.toBe(initialPreviewSrc);

    await page.getByTestId("share-image-hero-candidate-0").click();

    await expect
      .poll(async () => {
        return await previewImage.getAttribute("src");
      })
      .toBe(initialPreviewSrc);

    const downloadNameBefore = await page.evaluate(() => {
      const g = window as typeof window & { __SONGSHARE_LAST_DOWNLOAD_NAME__?: string };
      return g.__SONGSHARE_LAST_DOWNLOAD_NAME__ || "";
    });
    expect(downloadNameBefore).toBe("");

    await page.getByRole("button", { name: "Close" }).click();
    await expect(page.getByAltText("分享图片预览")).toHaveCount(0);

    await page.getByRole("button", { name: "生成分享图片" }).click();
    expect(apiCalls.sharePostCount).toBe(0);
    await expect(page.getByAltText("分享图片预览")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("share-image-hero-candidate-0")).toBeVisible();

    await expect
      .poll(async () => {
        const exportInfo = await readShareExportInfo(page);
        return exportInfo?.visibleCoverEntryIds || [];
      })
      .toEqual([
        `${SHARE_ID}-entry-1`,
        `${SHARE_ID}-entry-1`,
        `${SHARE_ID}-entry-2`,
        `${SHARE_ID}-entry-3`,
      ]);

    await page.getByRole("button", { name: "下载图片" }).click();

    const exportInfo = await readShareExportInfo(page);
    const downloadName = await page.evaluate(() => {
      const g = window as typeof window & { __SONGSHARE_LAST_DOWNLOAD_NAME__?: string };
      return g.__SONGSHARE_LAST_DOWNLOAD_NAME__ || "";
    });

    expect(exportInfo).not.toBeNull();
    expect(exportInfo?.width).toBe(1080);
    expect(exportInfo?.height).toBe(1440);
    expect(exportInfo?.mode).toBe("song-poster");
    expect(downloadName).toContain("测试玩家分享给你3首歌");
    expect(downloadName.endsWith(".png")).toBeTruthy();

    await page.getByRole("button", { name: "Close" }).click();
    await page.getByRole("button", { name: "生成分享链接" }).click();
    expect(apiCalls.sharePostCount).toBe(0);
    await expect(page.getByRole("button", { name: "已复制到剪贴板" })).toBeVisible();
    const copied = await readClipboardWrites(page);
    expect(copied.some((item) => item.endsWith(`/song/s/${SHARE_ID}`))).toBeTruthy();
  });

  test("歌曲分享页快速切歌时旧请求会被丢弃", async ({ page }) => {
    await mockSongApis(page, {
      previewHandler: async ({ title, artist }) => {
        const delayMs = title === "稻香" ? 600 : 40;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        return buildPreviewResponse(title, artist);
      },
    });

    await page.goto(`/song/s/${SHARE_ID}?playerDebug=1`);

    await expect(page.getByRole("button", { name: "日志" })).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "日志" }).click();
    await expect(page.getByText("播放器日志")).toBeVisible();

    const firstSong = page.locator("article").filter({ hasText: "稻香" }).first();
    const secondSong = page.locator("article").filter({ hasText: "富士山下" }).first();

    await firstSong.click();
    await page.waitForTimeout(60);
    await secondSong.click();

    await expect(page.getByText("试听地址返回已过期，忽略本次结果")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator("article.music-playback-card-active")).toContainText("富士山下");
  });
});
